"""
SIH 26168 - End-to-End Three-Machine Production Pipeline
Connects:
  Machine 1: Learned Universal MotionNet + Personalization Adapter (Motion Increments)
  Machine 2: NavigationStateEstimator (10-State Kinematic Propagation + ZUPT Gating)
  Machine 3: GNSS Correction & Smooth Reconvergence Engine

Runs on unseen Driver D (Y1) to demonstrate the complete lifecycle:
  1. GNSS Active (0 -> 180s): Online Calibration + State Updates.
  2. Complete GNSS Blackout (180s -> 240s / 300s): Seamless PseudoGNSS Propagation.
  3. GNSS Restoration: Innovation calculation & smooth reconvergence without teleportation.
"""

import sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch

from src.data.preprocessor import repair_and_resample_sequence
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter
from src.navigation.state_estimator import NavigationStateEstimator, PseudoGNSSPacket

def run_pipeline_on_y1(
    base_model_path="models/universal_motion_net.pt",
    norm_stats_path="models/imu_norm_stats.json",
    test_csv_path=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Y (Driver D)\Y1\S-Y1.csv",
    adapt_seconds=180.0,
    blackout_duration_s=60.0,
    device="cuda" if torch.cuda.is_available() else "cpu",
    window=20
):
    print("\n" + "="*75)
    print("  PRODUCTION 3-MACHINE PSEUDO-GNSS PIPELINE EXECUTION")
    print(f"  Test File: {Path(test_csv_path).name}")
    print(f"  Schedule: 0->{adapt_seconds:.0f}s GNSS Active | {adapt_seconds:.0f}->{adapt_seconds+blackout_duration_s:.0f}s Blackout | ->End Restored")
    print("="*75 + "\n")

    # 1. Load Normalization Statistics
    with open(norm_stats_path, "r") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # 2. Machine 1: Load Trained Motion Model & Adapter
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load(base_model_path, map_location=device))
    base_model.eval()

    adapter = PersonalizationAdapter(
        base_model=base_model,
        norm_mean=norm_mean,
        norm_std=norm_std,
        latent_dim=16
    ).to(device)

    # 3. Load Synchronized Test Sequence
    segs = repair_and_resample_sequence(test_csv_path)
    seg = max(segs, key=lambda s: len(s["time_s"]))
    N = len(seg["time_s"])
    dt = 0.1

    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)

    can_speed = seg["spd_ms"].astype(np.float32)
    can_head_deg = seg["head_deg"].astype(np.float32)
    can_lat = seg["lat"]
    can_lon = seg["lon"]

    # 4. Machine 2: Initialize State Estimator
    estimator = NavigationStateEstimator(
        init_lat=can_lat[0],
        init_lon=can_lon[0],
        init_speed=can_speed[0],
        init_heading_deg=can_head_deg[0]
    )

    adapt_samples = int(adapt_seconds / dt)
    blackout_samples = int(blackout_duration_s / dt)
    blackout_end = adapt_samples + blackout_samples

    # Optimizer for Machine 3 Online Personalization
    optimizer = torch.optim.Adam(
        [p for p in adapter.parameters() if p.requires_grad],
        lr=1e-3
    )

    # Logging telemetry
    output_packets = []
    drift_errors_m = []
    stationary_detections = 0

    # ── Online Adaptation Phase (First 3 minutes) ─────────────────────────
    print("Phase 1: Online Adaptation (First 180s)...")
    for i in range(window, adapt_samples, 5):
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        gps_spd = float(can_speed[i])
        h_diff = np.radians(can_head_deg[i] - can_head_deg[i-window])
        h_delta = float(np.arctan2(np.sin(h_diff), np.cos(h_diff)))
        adapter.adapt_step(t_raw, gps_spd, h_delta, optimizer)

    adapter.eval()
    print("  Adaptation Complete. Parameters frozen.")

    # ── Batch Machine 1 Neural Inference (Fast GPU Evaluation) ─────────────
    print(f"Batching Machine 1 neural inference across {N - window} windows...")
    total_steps = N - window
    batch_size = 512

    v_all = np.zeros(total_steps, dtype=np.float32)
    delta_s_all = np.zeros(total_steps, dtype=np.float32)
    delta_psi_all = np.zeros(total_steps, dtype=np.float32)
    pstop_all = np.zeros(total_steps, dtype=np.float32)
    logvar_all = np.zeros(total_steps, dtype=np.float32)

    with torch.no_grad():
        for b_start in range(0, total_steps, batch_size):
            b_end = min(b_start + batch_size, total_steps)
            B = b_end - b_start

            b_raw = np.zeros((B, 9, window), dtype=np.float32)
            for k, idx in enumerate(range(window + b_start, window + b_end)):
                b_raw[k] = raw_imu[:, idx-window:idx]

            t_raw = torch.from_numpy(b_raw).to(device)
            out_motion = adapter(t_raw)

            v_all[b_start:b_end] = out_motion["v_t"].cpu().numpy()
            delta_s_all[b_start:b_end] = out_motion["delta_s"].cpu().numpy()
            delta_psi_all[b_start:b_end] = out_motion["delta_psi"].cpu().numpy()
            pstop_all[b_start:b_end] = out_motion["p_stop"].cpu().numpy()
            logvar_all[b_start:b_end] = out_motion.get("log_var", torch.zeros(B)).cpu().numpy()

    # ── Sequential Machine 2 & 3 Navigation State Loop ────────────────────
    print("Running NavigationStateEstimator & PseudoGNSS Generation...")
    t0 = time.time()

    for k in range(total_steps):
        i = window + k
        current_time = i * dt

        gps_lat = float(can_lat[i])
        gps_lon = float(can_lon[i])
        gps_spd = float(can_speed[i])
        gps_head = float(can_head_deg[i])

        # Blackout state: true between adapt_samples and blackout_end
        is_in_blackout = (adapt_samples <= i < blackout_end)
        estimator.set_blackout(is_in_blackout, timestamp=current_time)

        # Machine 1 motion dictionary
        motion_dict = {
            "v_t": float(v_all[k]),
            "delta_s": float(delta_s_all[k]),
            "delta_psi": float(delta_psi_all[k]),
            "p_stop": float(pstop_all[k]),
            "log_var": float(logvar_all[k])
        }

        # Step 2: Machine 2 Predict & ZUPT
        win_raw = raw_imu[:, i-window:i]
        estimator.predict(motion_dict, win_raw, dt=dt)
        if estimator.is_stationary:
            stationary_detections += 1

        # Step 3: Machine 3 GNSS Correction & Smooth Reconvergence
        if not is_in_blackout:
            estimator.correct_gnss(gps_lat, gps_lon, gps_spd, gps_head, gnss_accuracy=2.5, dt=dt)

        # Step 4: Emit PseudoGNSSPacket
        pkt = estimator.get_pseudo_gnss_packet(timestamp=current_time)

        # Ground truth error
        gt_e, gt_n = estimator.projector.geodetic_to_enu(gps_lat, gps_lon)
        est_e, est_n = estimator.projector.geodetic_to_enu(pkt.lat, pkt.lon)
        err = np.hypot(est_e - gt_e, est_n - gt_n)
        drift_errors_m.append(err)

        if i % 100 == 0:
            output_packets.append({
                "time_s": current_time,
                "lat": pkt.lat,
                "lon": pkt.lon,
                "speed_mps": pkt.speed_mps,
                "heading_deg": pkt.heading_deg,
                "accuracy_m": pkt.accuracy_m,
                "confidence": pkt.confidence,
                "source": pkt.source,
                "is_stationary": pkt.is_stationary,
                "drift_error_m": float(err)
            })

    elapsed = time.time() - t0
    print(f"Navigation Loop Complete in {elapsed:.2f}s ({N/elapsed:.1f} Hz throughput)")

    # ── Analyze Outage Performance ───────────────────────────────────────────
    blackout_errs = drift_errors_m[adapt_samples - window : blackout_end - window]
    bo_cum_dist = np.cumsum(can_speed[adapt_samples:blackout_end] * dt)

    drift_30s = blackout_errs[int(30/dt)] if len(blackout_errs) > int(30/dt) else 0
    drift_60s = blackout_errs[-1]
    total_bo_dist = bo_cum_dist[-1]

    results = {
        "test_file": Path(test_csv_path).name,
        "total_duration_minutes": float(N * dt / 60.0),
        "blackout_duration_seconds": float(blackout_duration_s),
        "blackout_distance_travelled_m": float(total_bo_dist),
        "drift_at_30s_m": float(drift_30s),
        "drift_at_30s_pct": float(drift_30s / bo_cum_dist[int(30/dt)] * 100.0),
        "drift_at_60s_m": float(drift_60s),
        "drift_at_60s_pct": float(drift_60s / total_bo_dist * 100.0),
        "stationary_zupt_triggers": stationary_detections,
        "telemetry_timeline": output_packets
    }

    print("\n" + "="*75)
    print("  3-MACHINE PIPELINE EVALUATION METRICS")
    print("="*75)
    print(f"  Blackout Duration:           {blackout_duration_s:.1f} seconds")
    print(f"  Distance Travelled:          {total_bo_dist:.1f} metres")
    print(f"  Drift at 30 seconds:         {results['drift_at_30s_m']:.2f} m ({results['drift_at_30s_pct']:.1f}% of distance)")
    print(f"  Drift at 60 seconds:         {results['drift_at_60s_m']:.2f} m ({results['drift_at_60s_pct']:.1f}% of distance)")
    print(f"  Stationary ZUPT Locks:       {stationary_detections} ticks ({stationary_detections*dt:.1f}s)")
    print("="*75 + "\n")

    # Save Results
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True, parents=True)
    out_path = results_dir / "pseudo_gnss_pipeline_evaluation.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved pipeline evaluation to: {out_path}")

    return results

if __name__ == "__main__":
    run_pipeline_on_y1()
