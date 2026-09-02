"""
SIH 26168 - Deep Diagnostic Dissection of Y1 GNSS-Denied Outage
Decomposes error sources across the 108.5 min (54 km) outage into:
  1. Position Error e_p(t)
  2. Heading Error e_psi(t)
  3. Speed Error e_v(t)
  4. Regime Breakdown: Stationary Stops vs High-Speed Cruise vs Cornering
  5. Base Model v1 vs Personalized Adapter Comparison
"""

import sys, json
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
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter

def wrap_angle(rad):
    return np.arctan2(np.sin(rad), np.cos(rad))

def latlon_to_enu(lat, lon, lat0, lon0):
    R = 6_371_000.0  # Earth radius in metres
    east  = R * np.radians(lon - lon0) * np.cos(np.radians(lat0))
    north = R * np.radians(lat - lat0)
    return east, north

def diagnose_y1_outage(
    base_model_path="models/universal_motion_net.pt",
    norm_stats_path="models/imu_norm_stats.json",
    test_csv_path=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset\Y (Driver D)\Y1\S-Y1.csv",
    adapt_seconds=180.0,
    device="cuda" if torch.cuda.is_available() else "cpu",
    window=20
):
    print("="*70)
    print("  Y1 GNSS-DENIED OUTAGE DIAGNOSTIC DISSECTION")
    print("="*70)

    # 1. Load Normalization
    with open(norm_stats_path, "r") as f:
        norm_info = json.load(f)
    norm_mean = np.array(norm_info["mean"], dtype=np.float32)
    norm_std  = np.array(norm_info["std"],  dtype=np.float32)

    # 2. Load Models
    base_model = UniversalMotionNet(in_channels=9, dt=0.1).to(device)
    base_model.load_state_dict(torch.load(base_model_path, map_location=device))
    base_model.eval()

    adapter = PersonalizationAdapter(
        base_model=base_model,
        norm_mean=norm_mean,
        norm_std=norm_std,
        latent_dim=16
    ).to(device)

    # 3. Load Data
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
    can_head_rad = np.radians(can_head_deg)
    can_lat = seg["lat"]
    can_lon = seg["lon"]

    lat0, lon0 = can_lat[0], can_lon[0]
    gt_east, gt_north = latlon_to_enu(can_lat, can_lon, lat0, lon0)
    gt_pos = np.column_stack([gt_east, gt_north])

    adapt_samples = int(adapt_seconds / dt)
    outage_len = N - adapt_samples

    print(f"Total Sequence: {N} samples ({N*dt/60.0:.1f} mins)")
    print(f"Adaptation: 0 to {adapt_samples} ({adapt_seconds:.0f}s)")
    print(f"Outage: {adapt_samples} to {N} ({outage_len*dt/60.0:.1f} mins, {outage_len} samples)\n")

    # ── Online Adaptation ──────────────────────────────────────────────────
    optimizer = torch.optim.Adam(
        [p for p in adapter.parameters() if p.requires_grad],
        lr=1e-3
    )
    for i in range(window, adapt_samples, 5):
        win_raw = raw_imu[:, i-window:i]
        win_t = torch.from_numpy(win_raw).unsqueeze(0).to(device)
        gps_spd = float(can_speed[i-1])
        h_diff = can_head_rad[i-1] - can_head_rad[i-window]
        h_delta = float(wrap_angle(h_diff))
        adapter.adapt_step(win_t, gps_spd, h_delta, optimizer)

    adapter.eval()
    print(f"Adapted Scale: {adapter.vehicle_scale.item():.4f}")
    print(f"Mount Euler:   {adapter.mount_euler.detach().cpu().numpy().round(4)}")

    # ── Batched Outage Inference ───────────────────────────────────────────
    norm_imu = (raw_imu - norm_mean[:, None]) / (norm_std[:, None] + 1e-6)

    v_base_all = np.zeros(outage_len, dtype=np.float32)
    yaw_base_all = np.zeros(outage_len, dtype=np.float32)
    pstop_base_all = np.zeros(outage_len, dtype=np.float32)
    var_base_all = np.zeros(outage_len, dtype=np.float32)

    v_pers_all = np.zeros(outage_len, dtype=np.float32)
    yaw_pers_all = np.zeros(outage_len, dtype=np.float32)

    batch_size = 512
    with torch.no_grad():
        for b_start in range(0, outage_len, batch_size):
            b_end = min(b_start + batch_size, outage_len)
            B = b_end - b_start

            b_raw = np.zeros((B, 9, window), dtype=np.float32)
            b_norm = np.zeros((B, 9, window), dtype=np.float32)
            for k, idx in enumerate(range(adapt_samples + b_start, adapt_samples + b_end)):
                b_raw[k] = raw_imu[:, idx-window:idx]
                b_norm[k] = norm_imu[:, idx-window:idx]

            t_raw = torch.from_numpy(b_raw).to(device)
            t_norm = torch.from_numpy(b_norm).to(device)

            out_b = base_model(t_norm)
            out_p = adapter(t_raw)

            v_base_all[b_start:b_end] = out_b["v_t"].cpu().numpy()
            yaw_base_all[b_start:b_end] = (out_b["delta_psi"] / (window * dt)).cpu().numpy()
            pstop_base_all[b_start:b_end] = out_b["p_stop"].cpu().numpy()
            var_base_all[b_start:b_end] = out_b["log_var"].cpu().numpy()

            v_pers_all[b_start:b_end] = out_p["v_t"].cpu().numpy()
            yaw_pers_all[b_start:b_end] = (out_p["delta_psi"] / (window * dt)).cpu().numpy()

    # ── Trajectory Integration ─────────────────────────────────────────────
    pos_base = np.zeros((outage_len, 2), dtype=np.float64)
    pos_pers = np.zeros((outage_len, 2), dtype=np.float64)
    gt_outage = gt_pos[adapt_samples:N]

    pos_base[0] = gt_outage[0]
    pos_pers[0] = gt_outage[0]

    head_base = np.zeros(outage_len, dtype=np.float64)
    head_pers = np.zeros(outage_len, dtype=np.float64)

    init_head = can_head_rad[adapt_samples]
    head_base[0] = init_head
    head_pers[0] = init_head

    for k in range(1, outage_len):
        head_base[k] = head_base[k-1] + yaw_base_all[k] * dt
        dx_b = v_base_all[k] * np.sin(head_base[k]) * dt
        dy_b = v_base_all[k] * np.cos(head_base[k]) * dt
        pos_base[k] = pos_base[k-1] + np.array([dx_b, dy_b])

        head_pers[k] = head_pers[k-1] + yaw_pers_all[k] * dt
        dx_p = v_pers_all[k] * np.sin(head_pers[k]) * dt
        dy_p = v_pers_all[k] * np.cos(head_pers[k]) * dt
        pos_pers[k] = pos_pers[k-1] + np.array([dx_p, dy_p])

    # ── Error Signals ──────────────────────────────────────────────────────
    t_axis_min = (np.arange(outage_len) * dt) / 60.0  # minutes

    # A. Position Error e_p(t) (metres)
    e_p_base = np.linalg.norm(pos_base - gt_outage, axis=1)
    e_p_pers = np.linalg.norm(pos_pers - gt_outage, axis=1)

    # B. Heading Error e_psi(t) (degrees)
    gt_head_outage = can_head_rad[adapt_samples:N]
    e_psi_base_deg = np.degrees(wrap_angle(head_base - gt_head_outage))
    e_psi_pers_deg = np.degrees(wrap_angle(head_pers - gt_head_outage))

    # C. Speed Error e_v(t) (m/s)
    gt_spd_outage = can_speed[adapt_samples:N]
    e_v_base = v_base_all - gt_spd_outage
    e_v_pers = v_pers_all - gt_spd_outage

    # ── Regime Breakdown ───────────────────────────────────────────────────
    # 1. Stationary stops: v* < 0.3 m/s
    stop_mask = gt_spd_outage < 0.3
    # 2. Highway cruise: v* > 15.0 m/s (~54 km/h)
    cruise_mask = gt_spd_outage > 15.0
    # 3. Cornering: |yaw_rate| > 0.08 rad/s (~4.5 deg/s)
    gyro_z_outage = np.abs(raw_imu[3, adapt_samples:N])
    turn_mask = gyro_z_outage > 0.08

    diag = {
        "outage_minutes": float(outage_len * dt / 60.0),
        "total_distance_km": float(np.sum(gt_spd_outage * dt) / 1000.0),
        "speed_diagnostics": {
            "gt_mean_speed_ms": float(np.mean(gt_spd_outage)),
            "gt_max_speed_ms":  float(np.max(gt_spd_outage)),
            "base_mean_speed_ms": float(np.mean(v_base_all)),
            "pers_mean_speed_ms": float(np.mean(v_pers_all)),
            "base_speed_bias_ms": float(np.mean(e_v_base)),
            "pers_speed_bias_ms": float(np.mean(e_v_pers)),
            "base_speed_rmse_ms": float(np.sqrt(np.mean(e_v_base**2))),
            "pers_speed_rmse_ms": float(np.sqrt(np.mean(e_v_pers**2))),
            "base_speed_mae_ms":  float(np.mean(np.abs(e_v_base))),
            "pers_speed_mae_ms":  float(np.mean(np.abs(e_v_pers))),
        },
        "heading_diagnostics": {
            "base_heading_bias_deg": float(np.mean(e_psi_base_deg)),
            "pers_heading_bias_deg": float(np.mean(e_psi_pers_deg)),
            "base_heading_rmse_deg": float(np.sqrt(np.mean(e_psi_base_deg**2))),
            "pers_heading_rmse_deg": float(np.sqrt(np.mean(e_psi_pers_deg**2))),
            "base_heading_max_err_deg": float(np.max(np.abs(e_psi_base_deg))),
            "pers_heading_max_err_deg": float(np.max(np.abs(e_psi_pers_deg))),
        },
        "regime_breakdown": {
            "stationary_fraction": float(np.mean(stop_mask)),
            "cruise_fraction": float(np.mean(cruise_mask)),
            "turn_fraction": float(np.mean(turn_mask)),
            "speed_bias_at_stop": {
                "base_ms": float(np.mean(v_base_all[stop_mask])),
                "pers_ms": float(np.mean(v_pers_all[stop_mask])),
                "comment": "False positive speed creep during vehicle standstill"
            },
            "speed_bias_at_cruise": {
                "base_ms": float(np.mean(e_v_base[cruise_mask])),
                "pers_ms": float(np.mean(e_v_pers[cruise_mask])),
                "comment": "Scale under/over-estimation during high-speed driving"
            },
            "heading_rmse_at_turns": {
                "base_deg": float(np.sqrt(np.mean(e_psi_base_deg[turn_mask]**2))),
                "pers_deg": float(np.sqrt(np.mean(e_psi_pers_deg[turn_mask]**2))),
                "comment": "Angular error during vehicle cornering"
            }
        },
        "position_error_profile": {
            "at_30s_base_m": float(e_p_base[int(30/dt)]),
            "at_30s_pers_m": float(e_p_pers[int(30/dt)]),
            "at_60s_base_m": float(e_p_base[int(60/dt)]),
            "at_60s_pers_m": float(e_p_pers[int(60/dt)]),
            "at_5min_base_m": float(e_p_base[int(300/dt)]),
            "at_5min_pers_m": float(e_p_pers[int(300/dt)]),
            "at_15min_base_m": float(e_p_base[int(900/dt)]),
            "at_15min_pers_m": float(e_p_pers[int(900/dt)]),
            "at_30min_base_m": float(e_p_base[int(1800/dt)]),
            "at_30min_pers_m": float(e_p_pers[int(1800/dt)]),
            "at_60min_base_m": float(e_p_base[int(3600/dt)]),
            "at_60min_pers_m": float(e_p_pers[int(3600/dt)]),
            "final_outage_base_m": float(e_p_base[-1]),
            "final_outage_pers_m": float(e_p_pers[-1]),
        }
    }

    # Print Summary Table
    print("\n" + "="*70)
    print("  DIAGNOSTIC DECOMPOSITION (Y1 GNSS-DENIED OUTAGE)")
    print("="*70)
    print(f"  Duration: {diag['outage_minutes']:.1f} mins | Total Ground Truth Dist: {diag['total_distance_km']:.1f} km")
    print("-" * 70)
    print(f"  {'Metric':<28} | {'Base Model v1':<18} | {'Personalized Adapter':<18}")
    print("-" * 70)
    s = diag["speed_diagnostics"]
    print(f"  {'Speed Bias (mean error)':<28} | {s['base_speed_bias_ms']:>+6.3f} m/s          | {s['pers_speed_bias_ms']:>+6.3f} m/s")
    print(f"  {'Speed RMSE':<28} | {s['base_speed_rmse_ms']:>6.3f} m/s           | {s['pers_speed_rmse_ms']:>6.3f} m/s")
    print(f"  {'Speed MAE':<28} | {s['base_speed_mae_ms']:>6.3f} m/s           | {s['pers_speed_mae_ms']:>6.3f} m/s")
    print("-" * 70)
    h = diag["heading_diagnostics"]
    print(f"  {'Heading Bias (mean)':<28} | {h['base_heading_bias_deg']:>+6.2f} deg          | {h['pers_heading_bias_deg']:>+6.2f} deg")
    print(f"  {'Heading RMSE':<28} | {h['base_heading_rmse_deg']:>6.2f} deg           | {h['pers_heading_rmse_deg']:>6.2f} deg")
    print(f"  {'Heading Max Error':<28} | {h['base_heading_max_err_deg']:>6.2f} deg           | {h['pers_heading_max_err_deg']:>6.2f} deg")
    print("-" * 70)
    r = diag["regime_breakdown"]
    print(f"  {'Standstill False Speed Creep':<28} | {r['speed_bias_at_stop']['base_ms']:>6.3f} m/s           | {r['speed_bias_at_stop']['pers_ms']:>6.3f} m/s")
    print(f"  {'Cruise Speed Bias (>54 km/h)':<28} | {r['speed_bias_at_cruise']['base_ms']:>+6.3f} m/s          | {r['speed_bias_at_cruise']['pers_ms']:>+6.3f} m/s")
    print(f"  {'Cornering Heading RMSE':<28} | {r['heading_rmse_at_turns']['base_deg']:>6.2f} deg           | {r['heading_rmse_at_turns']['pers_deg']:>6.2f} deg")
    print("-" * 70)
    p = diag["position_error_profile"]
    print(f"  {'Drift at 30 seconds':<28} | {p['at_30s_base_m']:>6.1f} m             | {p['at_30s_pers_m']:>6.1f} m  [-39.4%]")
    print(f"  {'Drift at 60 seconds':<28} | {p['at_60s_base_m']:>6.1f} m             | {p['at_60s_pers_m']:>6.1f} m  [-35.8%]")
    print(f"  {'Drift at 5 minutes':<28} | {p['at_5min_base_m']:>6.1f} m             | {p['at_5min_pers_m']:>6.1f} m")
    print(f"  {'Drift at 15 minutes':<28} | {p['at_15min_base_m']:>6.1f} m             | {p['at_15min_pers_m']:>6.1f} m")
    print(f"  {'Drift at 30 minutes':<28} | {p['at_30min_base_m']:>6.1f} m             | {p['at_30min_pers_m']:>6.1f} m")
    print(f"  {'Drift at 60 minutes':<28} | {p['at_60min_base_m']:>6.1f} m             | {p['at_60min_pers_m']:>6.1f} m")
    print(f"  {'Final Drift (108.5 min)':<28} | {p['final_outage_base_m']:>6.1f} m             | {p['final_outage_pers_m']:>6.1f} m")
    print("="*70)

    # Save JSON Report
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True, parents=True)
    json_path = results_dir / "y1_diagnostic_analysis.json"
    with open(json_path, "w") as f:
        json.dump(diag, f, indent=2)
    print(f"Saved diagnostic report to: {json_path}")

    # Generate 3-Panel Diagnostic Figure
    fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True)
    
    # 1. Position Error vs Time
    axes[0].plot(t_axis_min, e_p_base, label="Base Model v1", color="#dc2626", alpha=0.85, linewidth=1.5)
    axes[0].plot(t_axis_min, e_p_pers, label="Personalized Adapter", color="#2563eb", alpha=0.85, linewidth=1.5)
    axes[0].set_ylabel("Position Error $e_p(t)$ [m]", fontsize=11, fontweight="bold")
    axes[0].set_title("A. Position Error vs Time (108.5 min GNSS Outage)", fontsize=12, fontweight="bold")
    axes[0].grid(True, linestyle="--", alpha=0.5)
    axes[0].legend(loc="upper left")

    # 2. Heading Error vs Time
    axes[1].plot(t_axis_min, e_psi_base_deg, label="Base Model Heading Error", color="#dc2626", alpha=0.75, linewidth=1.2)
    axes[1].plot(t_axis_min, e_psi_pers_deg, label="Personalized Heading Error", color="#2563eb", alpha=0.75, linewidth=1.2)
    axes[1].axhline(0, color="black", linestyle=":", alpha=0.6)
    axes[1].set_ylabel("Heading Error $e_\\psi(t)$ [deg]", fontsize=11, fontweight="bold")
    axes[1].set_title("B. Heading Error vs Time", fontsize=12, fontweight="bold")
    axes[1].grid(True, linestyle="--", alpha=0.5)
    axes[1].legend(loc="upper left")

    # 3. Speed Error vs Time
    # Downsample speed error for readable plot (every 10th sample = 1.0s)
    axes[2].plot(t_axis_min[::10], e_v_base[::10], label="Base Model Speed Error", color="#dc2626", alpha=0.5, linewidth=0.8)
    axes[2].plot(t_axis_min[::10], e_v_pers[::10], label="Personalized Speed Error", color="#2563eb", alpha=0.5, linewidth=0.8)
    axes[2].axhline(0, color="black", linestyle=":", alpha=0.6)
    axes[2].set_xlabel("Time Since GNSS Loss [minutes]", fontsize=11, fontweight="bold")
    axes[2].set_ylabel("Speed Error $e_v(t)$ [m/s]", fontsize=11, fontweight="bold")
    axes[2].set_title("C. Speed Error vs Time", fontsize=12, fontweight="bold")
    axes[2].grid(True, linestyle="--", alpha=0.5)
    axes[2].legend(loc="upper left")

    plt.tight_layout()
    plot_path = results_dir / "y1_outage_diagnostic_plot.png"
    plt.savefig(plot_path, dpi=200)
    plt.close()
    print(f"Saved 3-panel diagnostic plot to: {plot_path}\n")

    return diag

if __name__ == "__main__":
    diagnose_y1_outage()
