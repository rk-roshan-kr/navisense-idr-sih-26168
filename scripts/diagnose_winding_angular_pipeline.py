"""
SIH 26168 - Forensic Investigation of the Winding Route Angular Pipeline & Urban Map Gating
Investigates:
  1. Winding Route (Vta01a):
     - Raw phone angular channels vs CAN vehicle yaw rate (physical observability).
     - Calibrated angular rate (R_mount @ omega) vs CAN yaw rate.
     - Model predicted yaw increment vs integrated CAN heading.
     - Decomposes the 10s error into: Initial Alignment vs Turn Kinematics vs Bias Drift vs Map Gating.
  2. Urban Stop-and-Go (S-S1):
     - Telemetry analysis explaining why map helps dramatically at 60s (60.3% -> 6.5%) while lagging at 10s (19.4% -> 24.1%).
     - Logs candidate ambiguity, acceptance/rejection counts, and Kalman innovation magnitudes.
"""

import sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from src.data.preprocessor import repair_and_resample_sequence
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter, build_rotation_matrix_3d
from src.navigation.state_estimator import NavigationStateEstimator, WGS84LocalProjector
from src.navigation.road_corridor import RoadCorridorNetwork, apply_road_corridor_constraint

def wrap_angle_deg(deg):
    return (deg + 180.0) % 360.0 - 180.0

def diagnose_winding_route():
    print("="*80)
    print("  DEEP FORENSIC INVESTIGATION: WINDING ROUTE ANGULAR PIPELINE (Vta01a)")
    print("="*80 + "\n")

    path_v = r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Vta (Driver E)\Vta01a\S-Vta1a.csv"
    segs = repair_and_resample_sequence(path_v)
    seg = max(segs, key=lambda s: len(s["time_s"]))
    dt = 0.1
    window = 20

    # Load Base Model & Normalization
    device = "cpu"
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load("models/universal_motion_net.pt", map_location=device))
    base_model.eval()

    with open("models/imu_norm_stats.json") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    adapter = PersonalizationAdapter(base_model, norm_mean=norm_mean, norm_std=norm_std, latent_dim=16).to(device)
    optimizer = torch.optim.Adam([p for p in adapter.parameters() if p.requires_grad], lr=1e-3)

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

    # 1. Adapt on first 180s
    adapt_samples = int(180.0 / dt)
    print("Step 1: Running 3-minute online adaptation...")
    for i in range(window, adapt_samples, 5):
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        gps_spd = float(can_speed[i])
        h_diff = np.radians(can_head_deg[i] - can_head_deg[i-window])
        h_delta = float(np.arctan2(np.sin(h_diff), np.cos(h_diff)))
        adapter.adapt_step(t_raw, gps_spd, h_delta, optimizer)

    adapter.eval()
    learned_euler = adapter.mount_euler.detach().cpu().numpy()
    learned_yaw_scale = adapter.yaw_scale.item()
    learned_gyro_bias = adapter.gyro_bias.detach().cpu().numpy()
    R_learned = build_rotation_matrix_3d(adapter.mount_euler).detach().cpu().numpy()

    print(f"  Learned Mount Euler (rad):  {learned_euler.round(4)}")
    print(f"  Learned Mount Euler (deg):  {np.degrees(learned_euler).round(2)}")
    print(f"  Learned Gyro Bias (rad/s):  {learned_gyro_bias.round(5)}")
    print(f"  Learned Yaw Scale:          {learned_yaw_scale:.4f}")
    print(f"  Rotation Matrix R:\n{R_learned.round(3)}\n")

    # 2. Inspect 10-second blackout interval (180s to 190s)
    blackout_start = adapt_samples
    blackout_10s   = adapt_samples + int(10.0 / dt) # 100 samples
    blackout_60s   = adapt_samples + int(60.0 / dt) # 600 samples

    proj = WGS84LocalProjector(can_lat[0], can_lon[0])
    gt_e, gt_n = proj.geodetic_to_enu(can_lat, can_lon)

    # Initialize State Estimators:
    # 1. Base Model Estimator
    # 2. Personalized + ZUPT Estimator
    est_base = NavigationStateEstimator(can_lat[0], can_lon[0], can_speed[0], can_head_deg[0], enable_zupt=False)
    est_pers = NavigationStateEstimator(can_lat[0], can_lon[0], can_speed[0], can_head_deg[0], enable_zupt=True)

    telemetry_10s = []

    print("Step 2: Propagating through 10-second blackout interval...")
    for i in range(window, blackout_10s):
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        current_time = i * dt
        is_bo = (i >= blackout_start)

        est_base.set_blackout(is_bo, timestamp=current_time)
        est_pers.set_blackout(is_bo, timestamp=current_time)

        # Base forward
        with torch.no_grad():
            b_norm = (win_raw - norm_mean[:, None]) / (norm_std[:, None] + 1e-6)
            out_b = base_model(torch.from_numpy(b_norm).unsqueeze(0).to(device))
            out_p = adapter(t_raw)

        m_base = {
            "v_t": float(out_b["v_t"].item()),
            "delta_s": float(out_b["delta_s"].item()),
            "delta_psi": float(out_b["delta_psi"].item()),
            "p_stop": float(out_b["p_stop"].item())
        }
        m_pers = {
            "v_t": float(out_p["v_t"].item()),
            "delta_s": float(out_p["delta_s"].item()),
            "delta_psi": float(out_p["delta_psi"].item()),
            "p_stop": float(out_p["p_stop"].item())
        }

        est_base.predict(m_base, win_raw, dt=dt)
        est_pers.predict(m_pers, win_raw, dt=dt)

        if not is_bo:
            est_base.correct_gnss(float(can_lat[i]), float(can_lon[i]), float(can_speed[i]), float(can_head_deg[i]), dt=dt)
            est_pers.correct_gnss(float(can_lat[i]), float(can_lon[i]), float(can_speed[i]), float(can_head_deg[i]), dt=dt)
        else:
            # During blackout, record telemetry
            # Calibrated phone gyro in chassis frame: R @ (w - b_g)
            w_raw = raw_imu[3:6, i]
            w_deb = w_raw - learned_gyro_bias
            w_cal = R_learned @ w_deb

            pred_wz_model = m_pers["delta_psi"] / (window * dt)

            head_true = float(can_head_deg[i])
            head_est_pers = float(np.degrees(est_pers.x[3]) % 360.0)
            head_est_base = float(np.degrees(est_base.x[3]) % 360.0)

            err_head_pers = wrap_angle_deg(head_est_pers - head_true)
            err_head_base = wrap_angle_deg(head_est_base - head_true)

            gt_pos = np.array([gt_e[i], gt_n[i]])
            pos_err_pers = float(np.linalg.norm(est_pers.x[:2] - gt_pos))
            pos_err_base = float(np.linalg.norm(est_base.x[:2] - gt_pos))

            # Along-track and cross-track error decomposition
            track_heading_rad = np.radians(head_true)
            track_unit = np.array([np.sin(track_heading_rad), np.cos(track_heading_rad)])
            norm_unit  = np.array([np.cos(track_heading_rad), -np.sin(track_heading_rad)])
            d_pos = est_pers.x[:2] - gt_pos
            along_err = float(np.dot(d_pos, track_unit))
            cross_err = float(np.dot(d_pos, norm_unit))

            telemetry_10s.append({
                "time_rel_s": round((i - blackout_start) * dt, 2),
                "can_speed": float(can_speed[i]),
                "can_yaw_rate": float(can_yaw_rate[i]),
                "can_head_deg": head_true,
                "phone_gyaw": float(raw_imu[3, i]),
                "phone_gpit": float(raw_imu[4, i]),
                "phone_grol": float(raw_imu[5, i]),
                "calibrated_wz": float(w_cal[0]),
                "model_wz": float(pred_wz_model),
                "head_est_pers": head_est_pers,
                "head_err_pers_deg": err_head_pers,
                "head_err_base_deg": err_head_base,
                "pos_err_pers_m": pos_err_pers,
                "pos_err_base_m": pos_err_base,
                "along_track_err_m": along_err,
                "cross_track_err_m": cross_err,
            })

    # Print summary table of the 10-second breakdown
    print("\n" + "="*85)
    print("  HIGH-RESOLUTION 10-SECOND BLACKOUT TELEMETRY BREAKDOWN (Vta01a)")
    print("="*85)
    print(f"  {'Rel Time':<9} | {'CAN Yaw':<10} | {'Phone G-Pit':<11} | {'Model Wz':<10} | {'Head Err (Pers)':<15} | {'Pos Err':<10} | {'Cross-Track':<11}")
    print("-" * 85)
    for sample in telemetry_10s[::10]: # every 1 second
        t_s = f"{sample['time_rel_s']:>4.1f}s"
        can_y = f"{sample['can_yaw_rate']:>+6.3f} r/s"
        g_pit = f"{sample['phone_gpit']:>+6.3f} r/s"
        m_wz  = f"{sample['model_wz']:>+6.3f} r/s"
        h_err = f"{sample['head_err_pers_deg']:>+6.1f} deg"
        p_err = f"{sample['pos_err_pers_m']:>6.1f} m"
        c_err = f"{sample['cross_track_err_m']:>+6.1f} m"
        print(f"  {t_s:<9} | {can_y:<10} | {g_pit:<11} | {m_wz:<10} | {h_err:<15} | {p_err:<10} | {c_err:<11}")
    print("="*85 + "\n")

    # Diagnostic Findings
    init_err = telemetry_10s[0]['head_err_pers_deg']
    final_err = telemetry_10s[-1]['head_err_pers_deg']
    mean_can_yaw = np.mean([s['can_yaw_rate'] for s in telemetry_10s])
    mean_model_yaw = np.mean([s['model_wz'] for s in telemetry_10s])
    final_pos_err = telemetry_10s[-1]['pos_err_pers_m']
    final_along = telemetry_10s[-1]['along_track_err_m']
    final_cross = telemetry_10s[-1]['cross_track_err_m']

    print("DIAGNOSTIC DECOMPOSITION:")
    print(f"  1. Initial Heading Discrepancy at t=0s:    {init_err:+.2f} deg")
    print(f"  2. Final Heading Discrepancy at t=10s:   {final_err:+.2f} deg")
    print(f"  3. Total True Angular Turn in 10s:       {telemetry_10s[-1]['can_head_deg'] - telemetry_10s[0]['can_head_deg']:+.1f} deg")
    print(f"  4. Mean True CAN Yaw Rate:               {mean_can_yaw:+.4f} rad/s")
    print(f"  5. Mean Model Predicted Yaw Rate:        {mean_model_yaw:+.4f} rad/s")
    print(f"  6. Final 10s Position Error:             {final_pos_err:.1f} m")
    print(f"     -> Along-Track (Speed Integration):   {final_along:+.1f} m")
    print(f"     -> Cross-Track (Heading Deflection):  {final_cross:+.1f} m ({abs(final_cross)/final_pos_err*100:.1f}% of total error!)")

    # Generate Forensic Plots
    fig, axes = plt.subplots(3, 1, figsize=(10, 11), sharex=True)
    times = [s['time_rel_s'] for s in telemetry_10s]

    # Curve A: Raw Phone Channels vs CAN Yaw Rate
    ax = axes[0]
    ax.plot(times, [s['can_yaw_rate'] for s in telemetry_10s], 'k-', lw=2.2, label='CAN Vehicle Yaw Rate (Ground Truth)')
    ax.plot(times, [s['phone_gyaw'] for s in telemetry_10s], 'b--', lw=1.5, label='Phone gyaw (Nominal Yaw)')
    ax.plot(times, [s['phone_gpit'] for s in telemetry_10s], 'r-.', lw=1.5, label='Phone gpit (Cross Axis)')
    ax.set_ylabel('Rate (rad/s)')
    ax.set_title('A. Physical Observability: Raw Phone Channels vs True CAN Vehicle Yaw Rate', fontsize=11, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper right', fontsize=9)

    # Curve B: Calibrated & Predicted Yaw vs CAN Yaw
    ax = axes[1]
    ax.plot(times, [s['can_yaw_rate'] for s in telemetry_10s], 'k-', lw=2.2, label='CAN Vehicle Yaw Rate')
    ax.plot(times, [s['calibrated_wz'] for s in telemetry_10s], 'g--', lw=1.8, label='R_mount @ Phone Gyro (Calibrated)')
    ax.plot(times, [s['model_wz'] for s in telemetry_10s], 'm-', lw=1.8, label='Personalized Model Output')
    ax.set_ylabel('Yaw Rate (rad/s)')
    ax.set_title('B. Personalization Projection: Calibrated Yaw Rate vs CAN Ground Truth', fontsize=11, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper right', fontsize=9)

    # Curve C: Error Decomposition over Time
    ax = axes[2]
    ax.plot(times, [s['pos_err_pers_m'] for s in telemetry_10s], 'b-', lw=2.2, label='Total Position Error (m)')
    ax.plot(times, [abs(s['cross_track_err_m']) for s in telemetry_10s], 'r--', lw=1.8, label='Cross-Track Deflection (m)')
    ax.plot(times, [abs(s['along_track_err_m']) for s in telemetry_10s], 'g-.', lw=1.8, label='Along-Track Distance Error (m)')
    ax.set_ylabel('Error (metres)')
    ax.set_xlabel('Outage Elapsed Time (seconds)')
    ax.set_title('C. Navigation Error Decomposition: Lateral Deflection vs Forward Odometer', fontsize=11, fontweight='bold')
    ax.grid(True, alpha=0.3)
    ax.legend(loc='upper left', fontsize=9)

    plt.tight_layout()
    plot_path = Path("results/winding_angular_diagnostics_plot.png")
    fig.savefig(plot_path, dpi=180)
    plt.close(fig)
    print(f"\nSaved diagnostic plot to: {plot_path}")

    # Save JSON metrics
    results_dir = Path("results")
    out_file = results_dir / "winding_angular_diagnostics.json"
    with open(out_file, "w") as f:
        json.dump({
            "test_file": Path(path_v).name,
            "learned_euler_rad": learned_euler.tolist(),
            "learned_euler_deg": np.degrees(learned_euler).tolist(),
            "learned_yaw_scale": float(learned_yaw_scale),
            "learned_gyro_bias": learned_gyro_bias.tolist(),
            "initial_heading_error_deg": float(init_err),
            "final_heading_error_deg": float(final_err),
            "final_pos_err_m": float(final_pos_err),
            "final_along_track_err_m": float(final_along),
            "final_cross_track_err_m": float(final_cross),
            "cross_track_pct": float(abs(final_cross) / final_pos_err * 100.0),
            "telemetry_timeline": telemetry_10s
        }, f, indent=2)
    print(f"Saved JSON diagnostics to: {out_file}\n")

def diagnose_urban_map_gating():
    print("="*80)
    print("  TELEMETRY ANALYSIS: URBAN MAP GATING AT 10s VS 60s (S-S1)")
    print("="*80 + "\n")

    path_s = r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\S (Driver A)\S1\S-S1.csv"
    segs = repair_and_resample_sequence(path_s)
    seg = max(segs, key=lambda s: len(s["time_s"]))
    dt = 0.1
    window = 20

    device = "cpu"
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load("models/universal_motion_net.pt", map_location=device))
    base_model.eval()

    with open("models/imu_norm_stats.json") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    adapter = PersonalizationAdapter(base_model, norm_mean=norm_mean, norm_std=norm_std, latent_dim=16).to(device)
    optimizer = torch.optim.Adam([p for p in adapter.parameters() if p.requires_grad], lr=1e-3)

    raw_imu = np.stack([
        seg["ax"], seg["ay"], seg["az"],
        seg["gyaw"], seg["gpit"], seg["grol"],
        seg["gx"], seg["gy"], seg["gz"]
    ], axis=0).astype(np.float32)

    can_speed = seg["spd_ms"].astype(np.float32)
    can_head_deg = seg["head_deg"].astype(np.float32)
    can_lat = seg["lat"]
    can_lon = seg["lon"]

    proj = WGS84LocalProjector(can_lat[0], can_lon[0])
    gt_e, gt_n = proj.geodetic_to_enu(can_lat, can_lon)
    gt_enu = np.column_stack([gt_e, gt_n])

    # Build road network
    step = 25
    sampled_pts = gt_enu[::step].copy()
    road_network = RoadCorridorNetwork(sampled_pts, max_corridor_width_m=35.0)

    adapt_samples = int(180.0 / dt)
    for i in range(window, adapt_samples, 5):
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        gps_spd = float(can_speed[i])
        h_diff = np.radians(can_head_deg[i] - can_head_deg[i-window])
        h_delta = float(np.arctan2(np.sin(h_diff), np.cos(h_diff)))
        adapter.adapt_step(t_raw, gps_spd, h_delta, optimizer)
    adapter.eval()

    # Track map decisions over 60 seconds of blackout
    blackout_start = adapt_samples
    blackout_end = adapt_samples + int(60.0 / dt)

    estimator = NavigationStateEstimator(can_lat[0], can_lon[0], can_speed[0], can_head_deg[0], enable_zupt=True)

    map_events = []
    for i in range(window, blackout_end):
        current_time = i * dt
        win_raw = raw_imu[:, i-window:i]
        t_raw = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        is_bo = (i >= blackout_start)
        estimator.set_blackout(is_bo, timestamp=current_time)

        with torch.no_grad():
            out_p = adapter(t_raw)
        m_pers = {
            "v_t": float(out_p["v_t"].item()),
            "delta_s": float(out_p["delta_s"].item()),
            "delta_psi": float(out_p["delta_psi"].item()),
            "p_stop": float(out_p["p_stop"].item())
        }

        estimator.predict(m_pers, win_raw, dt=dt)

        if not is_bo:
            estimator.correct_gnss(float(can_lat[i]), float(can_lon[i]), float(can_speed[i]), float(can_head_deg[i]), dt=dt)
        else:
            rel_t = (i - blackout_start) * dt
            # Query map candidate before applying
            pos_enu = estimator.x[:2]
            veh_psi = estimator.x[3]
            res = road_network.query_candidate(pos_enu, veh_psi)
            found, r_y, r_psi, psi_road, n_unit, prob = res

            applied = False
            if found:
                applied, _, _ = apply_road_corridor_constraint(estimator, road_network, sigma_lane=2.0)

            gt_pos = gt_enu[i]
            current_err = float(np.linalg.norm(estimator.x[:2] - gt_pos))

            map_events.append({
                "time_rel_s": round(rel_t, 2),
                "speed_mps": float(can_speed[i]),
                "found": bool(found),
                "prob": float(prob),
                "r_y_m": float(r_y),
                "r_psi_deg": float(np.degrees(r_psi)),
                "applied": bool(applied),
                "pos_err_m": current_err,
                "cov_trace": float(estimator.P[0,0] + estimator.P[1,1])
            })

    # Compare 0-10s vs 10-60s
    events_10s = [e for e in map_events if e["time_rel_s"] <= 10.0]
    events_60s = [e for e in map_events if e["time_rel_s"] > 10.0]

    rejections_10s = sum(1 for e in events_10s if not e["applied"])
    acceptances_10s = sum(1 for e in events_10s if e["applied"])

    rejections_60s = sum(1 for e in events_60s if not e["applied"])
    acceptances_60s = sum(1 for e in events_60s if e["applied"])

    mean_ry_10s = np.mean([abs(e["r_y_m"]) for e in events_10s if e["applied"]]) if acceptances_10s > 0 else 0
    mean_ry_60s = np.mean([abs(e["r_y_m"]) for e in events_60s if e["applied"]]) if acceptances_60s > 0 else 0

    print("URBAN MAP GATING TELEMETRY FINDINGS:")
    print(f"  First 10s Window (0 to 10s, 81m travel):")
    print(f"    - Accepted Map Updates:  {acceptances_10s} / {len(events_10s)}")
    print(f"    - Rejected Updates:      {rejections_10s} / {len(events_10s)}")
    print(f"    - Mean Cross-Track |ry|: {mean_ry_10s:.2f} m")
    print(f"    - Final 10s Pos Error:   {events_10s[-1]['pos_err_m']:.2f} m (Drift: {events_10s[-1]['pos_err_m']/81.0*100:.1f}%)")
    print(f"\n  Subsequent Window (10s to 60s, 535m travel):")
    print(f"    - Accepted Map Updates:  {acceptances_60s} / {len(events_60s)}")
    print(f"    - Rejected Updates:      {rejections_60s} / {len(events_60s)}")
    print(f"    - Mean Cross-Track |ry|: {mean_ry_60s:.2f} m")
    print(f"    - Final 60s Pos Error:   {events_60s[-1]['pos_err_m']:.2f} m (Drift: {events_60s[-1]['pos_err_m']/535.0*100:.1f}%)")
    print("-" * 80)

    out_urban = Path("results/urban_map_telemetry_analysis.json")
    with open(out_urban, "w") as f:
        json.dump({
            "test_file": Path(path_s).name,
            "window_10s": {
                "accepted": acceptances_10s,
                "rejected": rejections_10s,
                "mean_ry_m": float(mean_ry_10s),
                "final_err_m": float(events_10s[-1]['pos_err_m'])
            },
            "window_60s": {
                "accepted": acceptances_60s,
                "rejected": rejections_60s,
                "mean_ry_m": float(mean_ry_60s),
                "final_err_m": float(events_60s[-1]['pos_err_m'])
            },
            "events_sample": map_events[::5]
        }, f, indent=2)
    print(f"Saved urban analysis to: {out_urban}\n")

if __name__ == "__main__":
    diagnose_winding_route()
    diagnose_urban_map_gating()
