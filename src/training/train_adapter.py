"""
SIH 26168 — Frozen-Adapter Personalization Benchmark
Scientific Protocol:
  1. Unseen Vehicle / Driver (e.g. Driver D - Y1).
  2. Phase 1 (Adaptation): First 3 minutes (180s) with GNSS supervision -> adapt parameters.
  3. Phase 2 (Freeze): Completely FREEZE adapter parameters at t = 180s.
  4. Phase 3 (Evaluation): 15-60 min GNSS DENIED outage -> evaluate position drift at 30s, 60s, 1km.
  5. Compare Unadapted Universal Base Model vs Personalized Adapter side-by-side.
"""

import sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
import torch.nn as nn

from src.data.preprocessor import repair_and_resample_sequence
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter

def latlon_to_enu(lat, lon, lat0, lon0):
    R = 6_371_000.0  # Earth radius in metres
    east  = R * np.radians(lon - lon0) * np.cos(np.radians(lat0))
    north = R * np.radians(lat - lat0)
    return east, north

def run_frozen_adapter_benchmark(
    base_model_path="models/universal_motion_net.pt",
    norm_stats_path="models/imu_norm_stats.json",
    test_csv_path=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Y (Driver D)\Y1\S-Y1.csv",
    adapt_seconds=180.0,   # 3 minutes GNSS-assisted adaptation
    device="cuda" if torch.cuda.is_available() else "cpu",
    window=20
):
    print(f"\n{'='*70}")
    print(f"  FROZEN-ADAPTER GNSS-DENIED BENCHMARK (SIH 26168)")
    print(f"  Test File: {Path(test_csv_path).name}")
    print(f"  Protocol:  {adapt_seconds:.0f}s GNSS Adaptation -> FREEZE -> Outage Evaluation")
    print(f"{'='*70}\n")

    # 1. Load Normalization Statistics
    with open(norm_stats_path, "r") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # 2. Load Base Model
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load(base_model_path, map_location=device))
    base_model.eval()

    # 3. Create Personalization Adapter
    adapter = PersonalizationAdapter(
        base_model=base_model,
        norm_mean=norm_mean,
        norm_std=norm_std,
        latent_dim=16
    ).to(device)

    # 4. Load & Preprocess Unseen Test Sequence
    segs = repair_and_resample_sequence(test_csv_path)
    if not segs:
        raise ValueError(f"Failed loading {test_csv_path}")

    # Use the longest continuous segment
    seg = max(segs, key=lambda s: len(s["time_s"]))
    N = len(seg["time_s"])
    total_dur_s = seg["time_s"][-1]
    print(f"Test Segment: {N} samples ({total_dur_s/60.0:.1f} mins) at 10.0 Hz")

    # Prepare raw sensor arrays (physical units: m/s^2, rad/s)
    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)  # (9, N)

    can_speed = seg["spd_ms"]
    can_lat = seg["lat"]
    can_lon = seg["lon"]
    can_head = seg["head_deg"]
    dt = 0.1

    # Convert CAN coordinates to ENU ground truth trajectory
    lat0, lon0 = can_lat[0], can_lon[0]
    gt_east, gt_north = latlon_to_enu(can_lat, can_lon, lat0, lon0)
    gt_pos = np.column_stack([gt_east, gt_north])  # (N, 2)

    adapt_samples = int(adapt_seconds / dt)
    adapt_samples = min(adapt_samples, N // 3)

    print(f"Adaptation window: samples 0 to {adapt_samples} ({adapt_samples * dt:.0f}s)")
    print(f"Outage evaluation window: samples {adapt_samples} to {N} ({(N - adapt_samples)*dt/60.0:.1f} mins)\n")

    # ── PHASE 1: Online GNSS-Assisted Adaptation (0 -> adapt_samples) ─────────
    optimizer = torch.optim.Adam(
        [p for p in adapter.parameters() if p.requires_grad],
        lr=1e-3
    )

    adapt_losses = []
    print("Running Online Adaptation...")
    for i in range(window, adapt_samples, 5):  # adapt every 0.5s
        win_raw = raw_imu[:, i-window:i]  # (9, W) in physical units
        win_t = torch.from_numpy(win_raw).unsqueeze(0).to(device)

        gps_spd = float(can_speed[i-1])
        # Heading delta over window
        h_diff = np.radians(can_head[i-1] - can_head[i-window])
        h_delta = np.arctan2(np.sin(h_diff), np.cos(h_diff))

        loss, l_spd = adapter.adapt_step(win_t, gps_spd, h_delta, optimizer)
        adapt_losses.append(loss)

    print(f"  Adaptation Complete. Final Loss: {np.mean(adapt_losses[-10:]):.4f}")
    print(f"  Calibrated Mount Euler: {adapter.mount_euler.detach().cpu().numpy().round(4)} rad")
    print(f"  Calibrated Accel Bias:  {adapter.accel_bias.detach().cpu().numpy().round(4)} m/s^2")
    print(f"  Calibrated Gyro Bias:   {adapter.gyro_bias.detach().cpu().numpy().round(5)} rad/s")
    print(f"  Calibrated Vehicle Scale: {adapter.vehicle_scale.item():.4f}")

    # ── PHASE 2: FREEZE ADAPTER & RUN OUTAGE EVALUATION ──────────────────────
    adapter.eval()
    print("\nFREEZING ADAPTER. Cutting GNSS. Running Pure Dead Reckoning...")

    # Trajectories to evaluate:
    # 1. Base Model (Unadapted)
    # 2. Personalized Adapter (Adapted & Frozen)
    pos_base = np.zeros((N, 2))
    pos_pers = np.zeros((N, 2))

    # Initialize at true CAN position at blackout boundary
    pos_base[:adapt_samples] = gt_pos[:adapt_samples]
    pos_pers[:adapt_samples] = gt_pos[:adapt_samples]

    heading_base = np.radians(can_head[adapt_samples - 1])
    heading_pers = np.radians(can_head[adapt_samples - 1])

    # Pre-normalize for Base Model
    norm_imu = (raw_imu - norm_mean[:, None]) / (norm_std[:, None] + 1e-6)

    # ── BATCHED INFERENCE ACROSS OUTAGE (Fast GPU Execution) ────────────────
    outage_len = N - adapt_samples
    print(f"Running batched GPU inference across {outage_len} outage samples...")

    # Build all sliding windows for the outage using tensor slicing
    batch_size = 512
    v_base_all = np.zeros(outage_len, dtype=np.float32)
    yaw_base_all = np.zeros(outage_len, dtype=np.float32)
    v_pers_all = np.zeros(outage_len, dtype=np.float32)
    yaw_pers_all = np.zeros(outage_len, dtype=np.float32)

    with torch.no_grad():
        for b_start in range(0, outage_len, batch_size):
            b_end = min(b_start + batch_size, outage_len)
            B = b_end - b_start

            # Extract window slices for this batch: (B, 9, W)
            batch_raw = np.zeros((B, 9, window), dtype=np.float32)
            batch_norm = np.zeros((B, 9, window), dtype=np.float32)
            for k, idx in enumerate(range(adapt_samples + b_start, adapt_samples + b_end)):
                batch_raw[k] = raw_imu[:, idx-window:idx]
                batch_norm[k] = norm_imu[:, idx-window:idx]

            t_raw = torch.from_numpy(batch_raw).to(device)
            t_norm = torch.from_numpy(batch_norm).to(device)

            out_b = base_model(t_norm)
            out_p = adapter(t_raw)

            v_base_all[b_start:b_end] = out_b["v_t"].cpu().numpy()
            yaw_base_all[b_start:b_end] = (out_b["delta_psi"] / (window * dt)).cpu().numpy()

            v_pers_all[b_start:b_end] = out_p["v_t"].cpu().numpy()
            yaw_pers_all[b_start:b_end] = (out_p["delta_psi"] / (window * dt)).cpu().numpy()

    # ── INTEGRATE DEAD-RECKONING POSITION ────────────────────────────────────
    print("Integrating ENU positions...")
    for k in range(outage_len):
        i = adapt_samples + k
        v_b, yaw_b = v_base_all[k], yaw_base_all[k]
        v_p, yaw_p = v_pers_all[k], yaw_pers_all[k]

        heading_base += yaw_b * dt
        dx_b = v_b * np.sin(heading_base) * dt
        dy_b = v_b * np.cos(heading_base) * dt
        pos_base[i] = pos_base[i-1] + np.array([dx_b, dy_b])

        heading_pers += yaw_p * dt
        dx_p = v_p * np.sin(heading_pers) * dt
        dy_p = v_p * np.cos(heading_pers) * dt
        pos_pers[i] = pos_pers[i-1] + np.array([dx_p, dy_p])

    # ── COMPUTE DRIFT METRICS ACROSS OUTAGE ──────────────────────────────────
    outage_mask = np.arange(adapt_samples, N)
    cum_dist = np.cumsum(np.linalg.norm(np.diff(gt_pos[outage_mask], axis=0), axis=1))
    cum_dist = np.insert(cum_dist, 0, 0.0)

    err_base = np.linalg.norm(pos_base[outage_mask] - gt_pos[outage_mask], axis=1)
    err_pers = np.linalg.norm(pos_pers[outage_mask] - gt_pos[outage_mask], axis=1)

    def get_drift_metrics(err_arr, seconds=None, metres=None):
        if seconds:
            idx = min(int(seconds / dt), len(err_arr) - 1)
        elif metres:
            idx = min(int(np.searchsorted(cum_dist, metres)), len(err_arr) - 1)
        err_m = float(err_arr[idx])
        dist_m = float(cum_dist[idx])
        pct = (err_m / max(dist_m, 1.0)) * 100.0
        return err_m, pct

    results = {
        "test_file": Path(test_csv_path).name,
        "adapt_duration_s": adapt_seconds,
        "outage_duration_s": (N - adapt_samples) * dt,
        "total_distance_m": float(cum_dist[-1]),
        "base_model": {
            "drift_30s_m": get_drift_metrics(err_base, seconds=30)[0],
            "drift_30s_pct": get_drift_metrics(err_base, seconds=30)[1],
            "drift_60s_m": get_drift_metrics(err_base, seconds=60)[0],
            "drift_60s_pct": get_drift_metrics(err_base, seconds=60)[1],
            "drift_1km_m": get_drift_metrics(err_base, metres=1000)[0],
            "drift_1km_pct": get_drift_metrics(err_base, metres=1000)[1],
            "final_drift_m": float(err_base[-1]),
            "final_drift_pct": float(err_base[-1] / max(1.0, cum_dist[-1]) * 100.0)
        },
        "personalized_adapter": {
            "drift_30s_m": get_drift_metrics(err_pers, seconds=30)[0],
            "drift_30s_pct": get_drift_metrics(err_pers, seconds=30)[1],
            "drift_60s_m": get_drift_metrics(err_pers, seconds=60)[0],
            "drift_60s_pct": get_drift_metrics(err_pers, seconds=60)[1],
            "drift_1km_m": get_drift_metrics(err_pers, metres=1000)[0],
            "drift_1km_pct": get_drift_metrics(err_pers, metres=1000)[1],
            "final_drift_m": float(err_pers[-1]),
            "final_drift_pct": float(err_pers[-1] / max(1.0, cum_dist[-1]) * 100.0)
        }
    }

    # Print Comparison Table
    print("\n" + "="*70)
    print("  SCIENTIFIC DRIFT BENCHMARK: BASE MODEL vs. PERSONALIZED ADAPTER")
    print("="*70)
    print(f"  {'Outage Interval':<20} | {'Base Model':<22} | {'Personalized':<22}")
    print("-" * 70)
    b, p = results["base_model"], results["personalized_adapter"]
    print(f"  {'30s GNSS Outage':<20} | {b['drift_30s_m']:>6.1f} m ({b['drift_30s_pct']:>4.1f}%)        | {p['drift_30s_m']:>6.1f} m ({p['drift_30s_pct']:>4.1f}%)")
    print(f"  {'60s GNSS Outage':<20} | {b['drift_60s_m']:>6.1f} m ({b['drift_60s_pct']:>4.1f}%)        | {p['drift_60s_m']:>6.1f} m ({p['drift_60s_pct']:>4.1f}%)")
    print(f"  {'1 km Distance':<20}   | {b['drift_1km_m']:>6.1f} m ({b['drift_1km_pct']:>4.1f}%)        | {p['drift_1km_m']:>6.1f} m ({p['drift_1km_pct']:>4.1f}%)")
    print(f"  {'Total Outage':<20}   | {b['final_drift_m']:>6.1f} m ({b['final_drift_pct']:>4.1f}%)        | {p['final_drift_m']:>6.1f} m ({p['final_drift_pct']:>4.1f}%)")
    print("="*70)

    # Save to results
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True, parents=True)
    out_file = results_dir / "frozen_adapter_benchmark.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved benchmark results to: {out_file}\n")
    return results

if __name__ == "__main__":
    run_frozen_adapter_benchmark()
