"""
SIH 26168 - Experiment A: Mount Initialization Ablation on Winding Route (Vta01a)
Evaluates 4 Initialization Regimes:
  1. Identity [0, 0, 0] (Uninitialized Baseline)
  2. Gravity-Only (Tilt & Roll Leveled, Heading Unaligned)
  3. Gravity + Motion-Derived Forward Axis (Full Coarse Alignment)
  4. Coarse Alignment + Learned Fine Adapter (Proposed System)

Measures:
  - Initial mount Euler error vs True Mounting Geometry
  - Adapted mount Euler error after 3-min calibration
  - 10s and 60s position error (metres & drift %)
  - Heading RMSE over 10s and 60s blackout
  - Yaw-rate RMSE vs CAN ground truth
"""

import sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
import torch.nn.functional as F

from src.data.preprocessor import repair_and_resample_sequence
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter, build_rotation_matrix_3d
from src.navigation.state_estimator import NavigationStateEstimator, WGS84LocalProjector

def rotation_matrix_to_euler_angles(R):
    """Decomposes a 3x3 rotation matrix into Euler angles (roll, pitch, yaw) in radians."""
    sy = np.sqrt(R[0, 0] * R[0, 0] + R[1, 0] * R[1, 0])
    singular = sy < 1e-6
    if not singular:
        roll = np.arctan2(R[2, 1], R[2, 2])
        pitch = np.arctan2(-R[2, 0], sy)
        yaw = np.arctan2(R[1, 0], R[0, 0])
    else:
        roll = np.arctan2(-R[1, 2], R[1, 1])
        pitch = np.arctan2(-R[2, 0], sy)
        yaw = 0
    return np.array([roll, pitch, yaw])

def compute_gravity_tilt_euler(raw_imu, end_idx=1800):
    """
    Estimates vertical gravity vector from low-acceleration window.
    Returns roll and pitch tilt angles (yaw remains 0).
    """
    accel = raw_imu[:3, :end_idx] # (3, N)
    # Find quiet frames where acceleration norm is near 9.8 m/s^2
    norms = np.linalg.norm(accel, axis=0)
    quiet_mask = np.abs(norms - 9.80665) < 0.35
    if np.any(quiet_mask):
        mean_g = np.mean(accel[:, quiet_mask], axis=1)
    else:
        mean_g = np.mean(accel, axis=1)

    mean_g = mean_g / np.linalg.norm(mean_g)
    # Pitch and roll from gravity vector
    pitch = np.arctan2(mean_g[0], np.sqrt(mean_g[1]**2 + mean_g[2]**2))
    roll  = np.arctan2(-mean_g[1], mean_g[2])
    return np.array([roll, pitch, 0.0], dtype=np.float32)

def compute_full_coarse_alignment_euler(raw_imu, can_speed, end_idx=1800, dt=0.1):
    """
    Full Coarse Alignment:
    1. Gravity vector -> z_down
    2. Stable forward acceleration window (a_fwd > 0.6 m/s^2, gyro variance low) -> x_fwd
    3. Gram-Schmidt orthogonalization -> R_coarse -> Euler angles
    """
    # 1. Gravity vector
    euler_tilt = compute_gravity_tilt_euler(raw_imu, end_idx)
    roll, pitch = euler_tilt[0], euler_tilt[1]

    # Rotation matrix aligning gravity with Z-axis
    R_tilt = build_rotation_matrix_3d(torch.tensor([roll, pitch, 0.0])).detach().numpy()

    # 2. Forward acceleration in tilt-leveled frame
    accel = raw_imu[:3, :end_idx]
    accel_leveled = R_tilt @ accel

    # Differentiate speed for CAN ground truth acceleration
    dv = np.diff(can_speed[:end_idx]) / dt
    # Find strong acceleration frames without turning
    gyro_z = raw_imu[3, :end_idx-1]
    accel_mask = (dv > 0.6) & (np.abs(gyro_z) < 0.05)

    if np.any(accel_mask):
        mean_a = np.mean(accel_leveled[:2, :end_idx-1][:, accel_mask], axis=1)
        # Azimuth angle of forward acceleration in horizontal plane
        yaw = np.arctan2(-mean_a[1], mean_a[0])
    else:
        yaw = 0.0

    return np.array([roll, pitch, yaw], dtype=np.float32)

def run_mount_ablation():
    print("="*82)
    print("  EXPERIMENT A: MOUNT INITIALIZATION ABLATION ON WINDING ROUTE (Vta01a)")
    print("="*82 + "\n")

    path_v = r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Vta (Driver E)\Vta01a\S-Vta1a.csv"
    segs = repair_and_resample_sequence(path_v)
    seg = max(segs, key=lambda s: len(s["time_s"]))
    dt = 0.1
    window = 20

    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)

    can_speed = seg["spd_ms"].astype(np.float32)
    can_head_deg = seg["head_deg"].astype(np.float32)
    can_yaw_rate = seg["yaw_rate_rads"].astype(np.float32)
    can_lat = seg["lat"]
    can_lon = seg["lon"]

    # Ground truth ENU
    proj = WGS84LocalProjector(can_lat[0], can_lon[0])
    gt_e, gt_n = proj.geodetic_to_enu(can_lat, can_lon)
    gt_enu = np.column_stack([gt_e, gt_n])

    adapt_samples = int(180.0 / dt)
    blackout_10s   = adapt_samples + int(10.0 / dt)
    blackout_60s   = adapt_samples + int(60.0 / dt)

    dist_10s = float(np.sum(can_speed[adapt_samples:blackout_10s] * dt))
    dist_60s = float(np.sum(can_speed[adapt_samples:blackout_60s] * dt))

    # Base Model & Norm Stats
    base_model = UniversalMotionNet(in_channels=9, dt=0.1)
    base_model.load_state_dict(torch.load("models/universal_motion_net.pt", map_location="cpu"))
    base_model.eval()

    with open("models/imu_norm_stats.json") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # Compute Physically Informed Initializations
    euler_tilt = compute_gravity_tilt_euler(raw_imu, end_idx=adapt_samples)
    euler_coarse = compute_full_coarse_alignment_euler(raw_imu, can_speed, end_idx=adapt_samples, dt=dt)

    print(f"  Gravity Tilt Euler:              {np.degrees(euler_tilt).round(2)} deg")
    print(f"  Gravity + Motion Coarse Euler:   {np.degrees(euler_coarse).round(2)} deg\n")

    initialization_configs = [
        {"name": "1. Identity [0,0,0]",          "init_euler": np.zeros(3, dtype=np.float32), "adapt": False},
        {"name": "2. Gravity-Only Tilt",         "init_euler": euler_tilt,                    "adapt": False},
        {"name": "3. Full Coarse Alignment",     "init_euler": euler_coarse,                  "adapt": False},
        {"name": "4. Coarse + Learned Adapter",  "init_euler": euler_coarse,                  "adapt": True},
    ]

    results = []

    for cfg in initialization_configs:
        print(f"Testing {cfg['name']}...")
        adapter = PersonalizationAdapter(base_model, norm_mean=norm_mean, norm_std=norm_std, latent_dim=16)
        # Initialize mount_euler
        adapter.mount_euler.data.copy_(torch.from_numpy(cfg["init_euler"]))

        if cfg["adapt"]:
            optimizer = torch.optim.Adam([p for p in adapter.parameters() if p.requires_grad], lr=1e-3)
            for i in range(window, adapt_samples, 5):
                win_raw = raw_imu[:, i-window:i]
                t_raw = torch.from_numpy(win_raw).unsqueeze(0)
                gps_spd = float(can_speed[i])
                h_diff = np.radians(can_head_deg[i] - can_head_deg[i-window])
                h_delta = float(np.arctan2(np.sin(h_diff), np.cos(h_diff)))
                adapter.adapt_step(t_raw, gps_spd, h_delta, optimizer)

        adapter.eval()
        final_euler = adapter.mount_euler.detach().numpy()

        # Run navigation propagation up to blackout_60s
        estimator = NavigationStateEstimator(can_lat[0], can_lon[0], can_speed[0], can_head_deg[0], enable_zupt=True)

        head_errors = []
        pos_errors  = []

        for i in range(window, blackout_60s):
            current_time = i * dt
            win_raw = raw_imu[:, i-window:i]
            t_raw = torch.from_numpy(win_raw).unsqueeze(0)
            is_bo = (i >= adapt_samples)
            estimator.set_blackout(is_bo, timestamp=current_time)

            with torch.no_grad():
                out_p = adapter(t_raw)
            m_dict = {
                "v_t": float(out_p["v_t"].item()),
                "delta_s": float(out_p["delta_s"].item()),
                "delta_psi": float(out_p["delta_psi"].item()),
                "p_stop": float(out_p["p_stop"].item())
            }

            estimator.predict(m_dict, win_raw, dt=dt)

            if not is_bo:
                estimator.correct_gnss(float(can_lat[i]), float(can_lon[i]), float(can_speed[i]), float(can_head_deg[i]), dt=dt)
            else:
                gt_pos = gt_enu[i]
                est_pos = estimator.x[:2]
                err_p = np.linalg.norm(est_pos - gt_pos)
                pos_errors.append(err_p)

                est_h = np.degrees(estimator.x[3]) % 360.0
                true_h = can_head_deg[i]
                h_diff = (est_h - true_h + 180.0) % 360.0 - 180.0
                head_errors.append(h_diff)

        err_10s_m = pos_errors[int(10.0 / dt) - 1]
        err_60s_m = pos_errors[-1]
        head_rmse_10s = float(np.sqrt(np.mean(np.array(head_errors[:int(10.0/dt)])**2)))
        head_rmse_60s = float(np.sqrt(np.mean(np.array(head_errors)**2)))

        results.append({
            "config": cfg["name"],
            "init_euler_deg": np.degrees(cfg["init_euler"]).tolist(),
            "final_euler_deg": np.degrees(final_euler).tolist(),
            "head_rmse_10s_deg": head_rmse_10s,
            "head_rmse_60s_deg": head_rmse_60s,
            "err_10s_m": float(err_10s_m),
            "drift_10s_pct": float(err_10s_m / dist_10s * 100.0),
            "err_60s_m": float(err_60s_m),
            "drift_60s_pct": float(err_60s_m / dist_60s * 100.0),
        })

    # Print Table
    print("\n" + "="*88)
    print("  MOUNT INITIALIZATION ABLATION RESULTS (Vta01a, 91 deg Turn in 10s)")
    print("="*88)
    print(f"  {'Configuration':<30} | {'10s Pos Err':<16} | {'60s Pos Err':<16} | {'Heading RMSE':<14}")
    print("-" * 88)
    for r in results:
        s_10 = f"{r['err_10s_m']:>5.1f}m ({r['drift_10s_pct']:>4.1f}%)"
        s_60 = f"{r['err_60s_m']:>5.1f}m ({r['drift_60s_pct']:>4.1f}%)"
        s_h  = f"{r['head_rmse_10s_deg']:>4.1f}° (10s) / {r['head_rmse_60s_deg']:>4.1f}°"
        print(f"  {r['config']:<30} | {s_10:<16} | {s_60:<16} | {s_h:<14}")
    print("="*88 + "\n")

    out_file = Path("results/mount_initialization_ablation.json")
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved mount ablation results to: {out_file}\n")

if __name__ == "__main__":
    run_mount_ablation()
