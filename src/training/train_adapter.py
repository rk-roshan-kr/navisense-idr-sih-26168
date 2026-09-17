"""
SIH 26168 — Bounded Continual Personalization Benchmark V2
Scientific Protocol:
  1. Unseen Vehicle / Driver (e.g. Driver D - Y1, or S3b / S1 / S4).
  2. Phase 1 (Adaptation): GNSS-supervised bounded adaptation of VehicleAdapter (FiLM).
     - Base model strictly FROZEN.
     - 8-D physical vibration signature z_vib accumulated during stationary intervals.
     - Loss supervises relative velocity sequence, yaw rate sequence, and heading-aligned displacement.
  3. Phase 2 (Freeze): Freezes adapter into eval() mode.
  4. Phase 3 (Outage Evaluation): Zero-GNSS blackout evaluation comparing Base Model vs. FiLM Personalized Model.
"""

import sys, json, time, math
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from src.data.preprocessor import repair_and_resample_sequence
from src.models.sensor_conditioner import SensorConditioner
from src.models.nn_models import UniversalMotionNetV2, VehicleAdapter


def latlon_to_enu(lat, lon, lat0, lon0):
    R = 6_371_000.0  # Earth radius in metres
    east  = R * np.radians(lon - lon0) * np.cos(np.radians(lat0))
    north = R * np.radians(lat - lat0)
    return east, north


def run_bounded_personalization_benchmark(
    base_model_path="models/universal_motion_net.pt",
    norm_stats_path="models/imu_norm_stats.json",
    test_csv_path=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\S (Driver A)\S3b\S-S3b.csv",
    adapt_seconds=60.0,
    device="cuda" if torch.cuda.is_available() else "cpu",
    window=20
):
    print(f"\n{'='*75}")
    print(f"  BOUNDED CONTINUAL PERSONALIZATION BENCHMARK V2 (SIH 26168)")
    print(f"  Test File: {Path(test_csv_path).name}")
    print(f"  Protocol:  {adapt_seconds:.0f}s GNSS Adaptation -> FREEZE -> Blackout Evaluation")
    print(f"{'='*75}\n")

    # 1. Load Normalization Statistics
    with open(norm_stats_path, "r") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # 2. Load Base Model V2
    base_model = UniversalMotionNetV2(in_channels=9, dt=0.1, window=window).to(device)
    base_model.load_state_dict(torch.load(base_model_path, map_location=device, weights_only=False))
    base_model.eval()

    # 3. Create SensorConditioner & VehicleAdapter
    conditioner = SensorConditioner(dt=0.1)
    adapter = VehicleAdapter(
        base_model=base_model,
        latent_dim=16,
        vib_dim=8,
        mount_dim=3,
        norm_mean=norm_mean,
        norm_std=norm_std
    ).to(device)

    # 4. Load & Preprocess Test Sequence
    segs = repair_and_resample_sequence(test_csv_path)
    if not segs:
        raise ValueError(f"Failed loading {test_csv_path}")

    seg = max(segs, key=lambda s: len(s["time_s"]))
    N = len(seg["time_s"])
    total_dur_s = seg["time_s"][-1]
    print(f"[DATA] Test Segment: {N} samples ({total_dur_s/60.0:.1f} mins) at 10.0 Hz")

    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)

    spd_can = seg["spd_ms"].astype(np.float32)
    head_rad = seg["head_unwrapped_rad"].astype(np.float64)
    lats = seg["lat"].astype(np.float64)
    lons = seg["lon"].astype(np.float64)

    # Accumulate stationary noise signature during standstill ticks
    for i in range(min(N, 600)):
        if spd_can[i] < 0.2:
            conditioner.update_stationary_profile(raw_imu[:3, i], raw_imu[3:6, i], stationary=True)

    z_vib = torch.from_numpy(conditioner.get_vibration_signature()).to(device)
    print(f"[CONDITIONER] Extracted 8-D Physical Vibration Signature z_vib:\n  {z_vib.cpu().numpy().round(4)}")

    # 5. Phase 1: GNSS-Supervised Bounded Adaptation
    adapt_steps = int(adapt_seconds * 10.0)
    optimizer = torch.optim.AdamW(adapter.parameters(), lr=1e-3, weight_decay=1e-4)

    print(f"\n[PHASE 1] Starting Bounded Continual Adaptation for {adapt_seconds:.0f}s ({adapt_steps} steps)...")
    adapter.train()

    best_loss = float("inf")
    losses = []

    for step in range(window, adapt_steps):
        win_raw = raw_imu[:, step - window:step]
        x_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)

        v_seq_target = torch.from_numpy(spd_can[step - window:step]).unsqueeze(0).to(device)
        u_h = head_rad[step - window:step]
        w_seq_target = torch.from_numpy(np.gradient(u_h, 0.1).astype(np.float32)).unsqueeze(0).to(device)

        psi_0 = float(u_h[0])
        lat0, lon0 = float(lats[step - window]), float(lons[step - window])
        lat1, lon1 = float(lats[step - 1]), float(lons[step - 1])
        de = (lon1 - lon0) * (111320.0 * math.cos(math.radians(lat0)))
        dn = (lat1 - lat0) * 111320.0

        fwd_target = torch.tensor([[float(de * math.sin(psi_0) + dn * math.cos(psi_0))]], device=device, dtype=torch.float32)
        lat_target = torch.tensor([[float(de * math.cos(psi_0) - dn * math.sin(psi_0))]], device=device, dtype=torch.float32)

        loss = adapter.adapt_step(
            x_raw,
            target_v_seq=v_seq_target,
            target_omega_seq=w_seq_target,
            target_delta_fwd=fwd_target,
            target_delta_lat=lat_target,
            optimizer=optimizer,
            z_vib=z_vib
        )
        losses.append(loss)

    mean_loss = np.mean(losses[-50:]) if len(losses) >= 50 else np.mean(losses)
    print(f"[PHASE 1 COMPLETE] Adaptation Loss (final 50 steps): {mean_loss:.4f}")
    print(f"  Mount Euler: {np.degrees(adapter.mount_euler.detach().cpu().numpy()).round(2)} deg")
    print(f"  Speed Scale: {adapter.vehicle_scale.item():.4f} | Yaw Scale: {adapter.yaw_scale.item():.4f}")

    # 6. Phase 2: Lock & Freeze
    adapter.eval()
    print("\n[PHASE 2] Adapter parameters strictly FROZEN. Evaluating GNSS-Denied Blackout...")

    # 7. Phase 3: Outage Evaluation
    outage_steps = min(N - adapt_steps, 600)  # 60-second blackout evaluation
    gt_e, gt_n = latlon_to_enu(lats, lons, lats[adapt_steps], lons[adapt_steps])

    # Propagate Universal Base Model vs. Personalized Adapter
    pos_base = np.zeros(2, dtype=np.float64)
    pos_pers = np.zeros(2, dtype=np.float64)
    psi_base = float(head_rad[adapt_steps])
    psi_pers = float(head_rad[adapt_steps])

    with torch.no_grad():
        for k in range(adapt_steps, adapt_steps + outage_steps):
            win_raw = raw_imu[:, k - window:k]
            x_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)

            # Base model inference
            mean = adapter.norm_mean[:, :9, :]
            std  = adapter.norm_std[:, :9, :]
            x_norm = (x_raw - mean) / (std + 1e-6)
            out_base = base_model(x_norm)

            # Personalized adapter inference
            out_pers = adapter(x_raw, z_vib=z_vib)

            # Step integration over 1 tick (0.1s)
            ds_base = float(out_base["v_t"].item()) * 0.1
            dpsi_base = float(out_base["omega_t"].item()) * 0.1
            psi_base += dpsi_base
            pos_base[0] += ds_base * math.sin(psi_base)
            pos_base[1] += ds_base * math.cos(psi_base)

            ds_pers = float(out_pers["v_t"].item()) * 0.1
            dpsi_pers = float(out_pers["omega_t"].item()) * 0.1
            psi_pers += dpsi_pers
            pos_pers[0] += ds_pers * math.sin(psi_pers)
            pos_pers[1] += ds_pers * math.cos(psi_pers)

    gt_endpoint = np.array([gt_e[adapt_steps + outage_steps - 1], gt_n[adapt_steps + outage_steps - 1]])
    drift_base = float(np.linalg.norm(pos_base - gt_endpoint))
    drift_pers = float(np.linalg.norm(pos_pers - gt_endpoint))

    print(f"\n{'='*75}")
    print(f"  OUTAGE EVALUATION RESULTS ({outage_steps * 0.1:.0f}s GNSS Denied)")
    print(f"  Universal Base Drift:     {drift_base:.2f} m")
    print(f"  FiLM Personalized Drift:  {drift_pers:.2f} m")
    if drift_pers < drift_base:
        impr = (1.0 - drift_pers / drift_base) * 100.0
        print(f"  >> Improvement: {impr:.1f}% reduction in position drift!")
    print(f"{'='*75}\n")


if __name__ == "__main__":
    run_bounded_personalization_benchmark()
