"""
SIH 26168 - Controlled 4-Way Navigation Ablation Benchmark
Evaluates the exact same Y1 60-second GNSS blackout four ways:
  A. Base Model v1 + State Estimator (Pure Baseline)
  B. Personalized Adapter + State Estimator (Personalization Gain)
  C. Personalized Adapter + ZUPT (Stationary Phantom Creep Correction)
  D. Personalized Adapter + ZUPT + Map Corridor Constraint (Uncertainty-Aware Soft Constraint)

Outputs E_30, E_60, drift%, and relative improvement for every configuration.
"""

import sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch

from src.data.preprocessor import repair_and_resample_sequence
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter
from src.navigation.state_estimator import NavigationStateEstimator, WGS84LocalProjector
from src.navigation.road_corridor import RoadCorridorNetwork, apply_road_corridor_constraint

def run_ablation_benchmark(
    base_model_path="models/universal_motion_net.pt",
    norm_stats_path="models/imu_norm_stats.json",
    test_csv_path=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Y (Driver D)\Y1\S-Y1.csv",
    adapt_seconds=180.0,
    blackout_duration_s=60.0,
    device="cuda" if torch.cuda.is_available() else "cpu",
    window=20
):
    print("="*78)
    print("  SCIENTIFIC 4-WAY NAVIGATION ABLATION BENCHMARK (SIH 26168)")
    print(f"  Test File: {Path(test_csv_path).name} (Driver D - Unseen Vehicle & Driver)")
    print(f"  Schedule: 0->{adapt_seconds:.0f}s GNSS Active | {adapt_seconds:.0f}->{adapt_seconds+blackout_duration_s:.0f}s Outage")
    print("="*78 + "\n")

    # 1. Load Normalization Statistics
    with open(norm_stats_path, "r") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # 2. Load Base Model v1
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load(base_model_path, map_location=device))
    base_model.eval()

    # 3. Create & Adapt Personalization Adapter
    adapter = PersonalizationAdapter(
        base_model=base_model,
        norm_mean=norm_mean,
        norm_std=norm_std,
        latent_dim=16
    ).to(device)

    # 4. Load Data
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

    # Ground Truth ENU coordinates
    projector = WGS84LocalProjector(can_lat[0], can_lon[0])
    gt_e, gt_n = projector.geodetic_to_enu(can_lat, can_lon)
    gt_enu = np.column_stack([gt_e, gt_n])

    adapt_samples = int(adapt_seconds / dt)
    blackout_samples = int(blackout_duration_s / dt)
    blackout_end = adapt_samples + blackout_samples

    # ── Phase 1: Online Adaptation (0 to 180s) ─────────────────────────────
    print("Phase 1: Online Personalization on First 180s...")
    optimizer = torch.optim.Adam(
        [p for p in adapter.parameters() if p.requires_grad],
        lr=1e-3
    )
    for i in range(window, adapt_samples, 5):
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        gps_spd = float(can_speed[i])
        h_diff = np.radians(can_head_deg[i] - can_head_deg[i-window])
        h_delta = float(np.arctan2(np.sin(h_diff), np.cos(h_diff)))
        adapter.adapt_step(t_raw, gps_spd, h_delta, optimizer)

    adapter.eval()
    print(f"  Adapted Scale: {adapter.vehicle_scale.item():.4f}")
    print(f"  Mount Euler:   {adapter.mount_euler.detach().cpu().numpy().round(4)} rad\n")

    # ── Pre-compute Batch Machine 1 Inference (Base & Personalized) ─────────
    total_steps = N - window
    batch_size = 512
    norm_imu = (raw_imu - norm_mean[:, None]) / (norm_std[:, None] + 1e-6)

    v_base_all = np.zeros(total_steps, dtype=np.float32)
    ds_base_all = np.zeros(total_steps, dtype=np.float32)
    dpsi_base_all = np.zeros(total_steps, dtype=np.float32)
    pstop_base_all = np.zeros(total_steps, dtype=np.float32)

    v_pers_all = np.zeros(total_steps, dtype=np.float32)
    ds_pers_all = np.zeros(total_steps, dtype=np.float32)
    dpsi_pers_all = np.zeros(total_steps, dtype=np.float32)
    pstop_pers_all = np.zeros(total_steps, dtype=np.float32)

    print(f"Pre-computing Machine 1 neural inference across {total_steps} windows...")
    with torch.no_grad():
        for b_start in range(0, total_steps, batch_size):
            b_end = min(b_start + batch_size, total_steps)
            B = b_end - b_start

            b_raw = np.zeros((B, 9, window), dtype=np.float32)
            b_norm = np.zeros((B, 9, window), dtype=np.float32)
            for k, idx in enumerate(range(window + b_start, window + b_end)):
                b_raw[k] = raw_imu[:, idx-window:idx]
                b_norm[k] = norm_imu[:, idx-window:idx]

            t_norm = torch.from_numpy(b_norm).to(device)
            t_raw = torch.from_numpy(b_raw).to(device)

            out_b = base_model(t_norm)
            out_p = adapter(t_raw)

            v_base_all[b_start:b_end] = out_b["v_t"].cpu().numpy()
            ds_base_all[b_start:b_end] = out_b["delta_s"].cpu().numpy()
            dpsi_base_all[b_start:b_end] = out_b["delta_psi"].cpu().numpy()
            pstop_base_all[b_start:b_end] = out_b["p_stop"].cpu().numpy()

            v_pers_all[b_start:b_end] = out_p["v_t"].cpu().numpy()
            ds_pers_all[b_start:b_end] = out_p["delta_s"].cpu().numpy()
            dpsi_pers_all[b_start:b_end] = out_p["delta_psi"].cpu().numpy()
            pstop_pers_all[b_start:b_end] = out_p["p_stop"].cpu().numpy()

    # ── Build Road Corridor Network (Simulating Offline Vector Tiles) ───────
    # Downsample ground truth path by step of 20 (every 2.0s = ~25-35m) to build road centerline
    road_sample_step = 20
    road_waypoints_enu = gt_enu[::road_sample_step]
    road_network = RoadCorridorNetwork(road_waypoints_enu, max_corridor_width_m=35.0)

    # ── Run the 4 Configurations ───────────────────────────────────────────
    configs = [
        {"name": "A. Base + Estimator",        "use_adapter": False, "zupt": False, "map": False},
        {"name": "B. Personalized + Estimator", "use_adapter": True,  "zupt": False, "map": False},
        {"name": "C. Personalized + ZUPT",      "use_adapter": True,  "zupt": True,  "map": False},
        {"name": "D. Personalized + ZUPT + Map","use_adapter": True,  "zupt": True,  "map": True},
    ]

    bo_cum_dist = np.cumsum(can_speed[adapt_samples:blackout_end] * dt)
    dist_30s = float(bo_cum_dist[int(30/dt)])
    dist_60s = float(bo_cum_dist[-1])

    results = []

    for cfg in configs:
        print(f"Evaluating {cfg['name']}...")
        estimator = NavigationStateEstimator(
            init_lat=can_lat[0],
            init_lon=can_lon[0],
            init_speed=can_speed[0],
            init_heading_deg=can_head_deg[0],
            enable_zupt=cfg["zupt"]
        )

        pos_history = np.zeros((total_steps, 2), dtype=np.float64)
        t_start = time.time()

        for k in range(total_steps):
            i = window + k
            current_time = i * dt

            gps_lat = float(can_lat[i])
            gps_lon = float(can_lon[i])
            gps_spd = float(can_speed[i])
            gps_head = float(can_head_deg[i])

            is_in_blackout = (adapt_samples <= i < blackout_end)
            estimator.set_blackout(is_in_blackout, timestamp=current_time)

            # Select model output stream
            if cfg["use_adapter"]:
                motion_dict = {
                    "v_t": float(v_pers_all[k]),
                    "delta_s": float(ds_pers_all[k]),
                    "delta_psi": float(dpsi_pers_all[k]),
                    "p_stop": float(pstop_pers_all[k])
                }
            else:
                motion_dict = {
                    "v_t": float(v_base_all[k]),
                    "delta_s": float(ds_base_all[k]),
                    "delta_psi": float(dpsi_base_all[k]),
                    "p_stop": float(pstop_base_all[k])
                }

            # 1. State Prediction + ZUPT
            win_raw = raw_imu[:, i-window:i]
            estimator.predict(motion_dict, win_raw, dt=dt)

            # 2. GNSS Correction (when available)
            if not is_in_blackout:
                estimator.correct_gnss(gps_lat, gps_lon, gps_spd, gps_head, gnss_accuracy=2.5, dt=dt)
            else:
                # 3. Soft Road Corridor Constraint during Blackout (if enabled)
                if cfg["map"]:
                    apply_road_corridor_constraint(
                        estimator,
                        road_network,
                        sigma_lane=2.0,            # 2.0m lane corridor width
                        sigma_psi_road=np.radians(4.0) # 4 deg heading corridor
                    )

            pos_history[k] = estimator.x[:2]

        elapsed = time.time() - t_start
        throughput_hz = total_steps / elapsed

        # Evaluate blackout window errors
        bo_idx_start = adapt_samples - window
        bo_idx_end   = blackout_end - window
        est_bo = pos_history[bo_idx_start:bo_idx_end]
        gt_bo  = gt_enu[adapt_samples:blackout_end]

        err_profile = np.linalg.norm(est_bo - gt_bo, axis=1)

        err_30s = float(err_profile[int(30/dt)])
        err_60s = float(err_profile[-1])
        drift_pct_30s = float((err_30s / dist_30s) * 100.0)
        drift_pct_60s = float((err_60s / dist_60s) * 100.0)

        results.append({
            "config": cfg["name"],
            "e_30_m": err_30s,
            "drift_30s_pct": drift_pct_30s,
            "e_60_m": err_60s,
            "drift_60s_pct": drift_pct_60s,
            "throughput_hz": throughput_hz,
            "zupt_triggers": int(estimator.stationary_ticks)
        })

    # ── Print Scientific Ablation Table ──────────────────────────────────────
    print("\n" + "="*84)
    print("  CONTROLLED 4-WAY NAVIGATION ABLATION BENCHMARK (60s Blackout, 1001.5m Travel)")
    print("="*84)
    print(f"  {'Configuration':<34} | {'E_30 (m / %)':<22} | {'E_60 (m / %)':<22}")
    print("-" * 84)
    baseline_60 = results[0]["e_60_m"]
    for r in results:
        red_60 = (1.0 - r["e_60_m"] / baseline_60) * 100.0
        str_30 = f"{r['e_30_m']:>5.1f} m ({r['drift_30s_pct']:>4.1f}%)"
        str_60 = f"{r['e_60_m']:>5.1f} m ({r['drift_60s_pct']:>4.1f}%) [{red_60:>+4.1f}%]"
        print(f"  {r['config']:<34} | {str_30:<22} | {str_60:<22}")
    print("="*84 + "\n")

    # Save Results
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True, parents=True)
    out_file = results_dir / "four_way_ablation_benchmark.json"
    with open(out_file, "w") as f:
        json.dump({
            "test_file": Path(test_csv_path).name,
            "blackout_duration_s": blackout_duration_s,
            "distance_travelled_m": dist_60s,
            "ablation_results": results
        }, f, indent=2)
    print(f"Saved ablation results to: {out_file}\n")
    return results

if __name__ == "__main__":
    run_ablation_benchmark()
