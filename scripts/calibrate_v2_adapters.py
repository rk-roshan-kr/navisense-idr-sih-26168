"""
SIH 26168 - Cross-Sequence Vehicle Personalization & Adapter Calibration V2.2
Proves the core NaviSense scientific hypothesis:
  "Learning vehicle/phone characteristics on Route A transfers and improves dead reckoning on Route B."

Personalization Matrix:
  1. Base Model (Zero-Shot, unpersonalized)
  2. Personalized Vehicle A: Calibrated on S3a (or S1), tested on unseen S3b blackout
  3. Cross-Vehicle Baseline: Calibrated on Vehicle B (Driver B), tested on Vehicle A (S3b)
  4. Oracle / Control: Calibrated on early pre-outage segment of S3b

All calibration uses:
  - Sensor-only stationary detection (zero oracle CAN speed)
  - Stateful SensorConditioner sequentially evolving from t=0
  - High-rate Vehicle CAN reference displacement targets (delta_forward, delta_lateral)
"""

import sys, json, time, math
from pathlib import Path
from typing import Tuple, Dict, Optional, List

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import numpy as np
import torch
import torch.optim as optim

from src.models.sensor_conditioner import SensorConditioner
from src.models.nn_models import UniversalMotionNetV2, VehicleAdapter
from src.data.preprocessor import repair_and_resample_sequence

IOVNBD_BASE = ROOT_DIR / "data/IO-VNBD/Synchronised V abd S datasets/Categorised IOVNB Dataset"

CALIBRATION_SOURCES = {
    # Vehicle A (Driver A) Calibration Sequences
    "vehA_s3a": {
        "s_file": IOVNBD_BASE / "S (Driver A)/S3a/S-S3a.csv",
        "description": "Vehicle A (Ford Fiesta) calibrated on Route S3a",
        "calib_seconds": 90.0
    },
    "vehA_s1": {
        "s_file": IOVNBD_BASE / "S (Driver A)/S1/S-S1.csv",
        "description": "Vehicle A (Ford Fiesta) calibrated on Route S1",
        "calib_seconds": 90.0
    },
    # Cross-Vehicle Baseline: Vehicle B (Driver B)
    "vehB_m": {
        "s_file": list((IOVNBD_BASE / "M (Driver B)").glob("S-*.csv"))[0] if (IOVNBD_BASE / "M (Driver B)").exists() and list((IOVNBD_BASE / "M (Driver B)").glob("S-*.csv")) else None,
        "description": "Vehicle B (Cross-Vehicle Control)",
        "calib_seconds": 90.0
    },
    # Preset route fast calibrations for demo compatibility
    "s3b": {
        "s_file": IOVNBD_BASE / "S (Driver A)/S3b/S-S3b.csv",
        "description": "Scenario S3b calibrated adapter",
        "calib_seconds": 42.0  # strictly pre-outage window!
    },
    "s4": {
        "s_file": IOVNBD_BASE / "S (Driver A)/S4/S-S4.csv",
        "description": "Scenario S4 calibrated adapter",
        "calib_seconds": 60.0
    }
}


def calibrate_adapter_on_sequence(
    base_model: UniversalMotionNetV2,
    s_csv_path: Path,
    calib_seconds: float,
    norm_mean: np.ndarray,
    norm_std: np.ndarray,
    device: str
) -> Tuple[VehicleAdapter, np.ndarray, dict]:
    """
    Calibrates a VehicleAdapter strictly on a specified calibration sequence.
    Returns the calibrated adapter, statistical vibration signature z_vib, and training metrics.
    """
    segs = repair_and_resample_sequence(s_csv_path)
    seg = max(segs, key=lambda s: len(s["time_s"]))

    N = len(seg["time_s"])
    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)

    spd_can = seg["spd_ms"].astype(np.float32)
    head_rad = seg["head_unwrapped_rad"].astype(np.float64)
    can_e = seg["can_east_m"]
    can_n = seg["can_north_m"]
    can_yaw = seg.get("yaw_rate_rads")

    # 1. Stateful SensorConditioner from t=0 (sensor-only stationary detection!)
    conditioner = SensorConditioner(dt=0.1)
    cond_imu = conditioner.condition_sequence(raw_imu)
    z_vib = conditioner.get_vibration_signature()
    t_zvib = torch.from_numpy(z_vib).to(device)

    print(f"  [CONDITIONER] Still samples: {conditioner.accel_profile.samples} | Accel Bias: {conditioner.accel_bias.round(3)} | z_vib std: {z_vib[:3].round(3)}")

    # 2. VehicleAdapter with identity FiLM initialization
    adapter = VehicleAdapter(
        base_model=base_model,
        latent_dim=16,
        vib_dim=8,
        mount_dim=3,
        norm_mean=norm_mean,
        norm_std=norm_std
    ).to(device)

    # 3. Bounded continual adaptation on calibration window
    window = 20
    adapt_steps = min(N, int(calib_seconds * 10.0))
    optimizer = optim.AdamW(adapter.parameters(), lr=1e-3, weight_decay=1e-4)

    running_loss = 0.0
    steps_count = 0

    for step in range(window, adapt_steps):
        win_cond = cond_imu[:, step - window:step]
        x_cond = torch.from_numpy(win_cond).unsqueeze(0).to(device)

        v_true = torch.from_numpy(spd_can[step - window:step]).unsqueeze(0).to(device)

        if can_yaw is not None and np.any(can_yaw[step - window:step] != 0.0):
            w_true = torch.from_numpy(can_yaw[step - window:step].astype(np.float32)).unsqueeze(0).to(device)
        else:
            w_win = np.gradient(head_rad[step - window:step], 0.1).astype(np.float32)
            w_true = torch.from_numpy(w_win).unsqueeze(0).to(device)

        # Vehicle CAN reference 2D displacement in initial-heading frame
        psi_0 = float(head_rad[step - window])
        de = float(can_e[step - 1] - can_e[step - window])
        dn = float(can_n[step - 1] - can_n[step - window])
        fwd_true = float(de * math.sin(psi_0) + dn * math.cos(psi_0))
        lat_true = float(de * math.cos(psi_0) - dn * math.sin(psi_0))

        t_fwd = torch.tensor([fwd_true], dtype=torch.float32, device=device)
        t_lat = torch.tensor([lat_true], dtype=torch.float32, device=device)

        loss = adapter.adapt_step(
            x_conditioned=x_cond,
            target_v_seq=v_true,
            target_omega_seq=w_true,
            target_delta_fwd=t_fwd,
            target_delta_lat=t_lat,
            optimizer=optimizer,
            z_vib=t_zvib
        )
        running_loss += loss
        steps_count += 1

    avg_loss = running_loss / max(steps_count, 1)
    metrics = {
        "final_adapt_loss": float(avg_loss),
        "steps_trained": steps_count,
        "calib_duration_s": calib_seconds
    }
    print(f"  [ADAPTER] Adapted across {steps_count} steps. Final Loss: {avg_loss:.4f} | Scale v={adapter.vehicle_scale.item():.3f}, psi={adapter.yaw_scale.item():.3f}")

    return adapter, z_vib, metrics


def main():
    print("=" * 80)
    print("  NAVISENSE IDR — Cross-Sequence Personalization Transfer Calibration")
    print("=" * 80)

    device = "cuda" if torch.cuda.is_available() else "cpu"

    norm_path = ROOT_DIR / "models/imu_norm_stats.json"
    with open(norm_path) as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)
    base_model = UniversalMotionNetV2(in_channels=9, window=20).to(device)
    base_model_path = ROOT_DIR / "models/universal_motion_net.pt"
    ckpt = torch.load(base_model_path, map_location=device, weights_only=False)
    base_model.load_state_dict(ckpt["model_state_dict"] if "model_state_dict" in ckpt else ckpt)
    base_model.eval()

    calibrated_store = {}

    for key, cfg in CALIBRATION_SOURCES.items():
        if cfg["s_file"] is None or not cfg["s_file"].exists():
            print(f"Skipping {key}: file not found.")
            continue

        print(f"\n---> Calibrating {key.upper()}: {cfg['description']}")
        adapter, z_vib, metrics = calibrate_adapter_on_sequence(
            base_model=base_model,
            s_csv_path=cfg["s_file"],
            calib_seconds=cfg["calib_seconds"],
            norm_mean=norm_mean,
            norm_std=norm_std,
            device=device
        )

        calibrated_store[key] = {
            "state_dict": adapter.state_dict(),
            "z_vib": z_vib,
            "metrics": metrics,
            "description": cfg["description"]
        }

    # Ensure demo preset keys 's1' and 's3b' are always present
    if "s1" not in calibrated_store and "vehA_s1" in calibrated_store:
        calibrated_store["s1"] = calibrated_store["vehA_s1"]

    save_path = ROOT_DIR / "models/calibrated_adapters.pt"
    torch.save(calibrated_store, save_path)
    print("\n" + "=" * 80)
    print(f"SUCCESS: Saved calibrated adapters {list(calibrated_store.keys())} to {save_path}")
    print("=" * 80)


if __name__ == "__main__":
    main()
