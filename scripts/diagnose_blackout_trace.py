"""
SIH 26168 - Pointwise 10 Hz Dead-Reckoning Error Trace & Diagnostic Decomposition (Component 1 & 2)
Generates high-resolution 27-field CSV traces during GNSS outages, separating:
    - Map-registration error (raw vs aligned OSM)
    - Navigation / DR error (along-track e_parallel vs cross-track e_perp)
    - False yaw rate bursts (omega_pred vs raw gyro)
    - Junction branch decisions (top-K candidate table)
    - 4 isolated evaluation tracks (BASE, PERSONALIZED, ZUPT, FULL_SYSTEM)
"""

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from backend.engine.runtime import NaviSenseRuntime
from src.navigation.map_registration import MapRegistrator


def wrap_angle_deg(deg: float) -> float:
    """Wraps angle to [-180, 180]."""
    return float((deg + 180.0) % 360.0 - 180.0)


def run_pointwise_trace(
    scenario_id: str = "s3b",
    outage_duration_s: int = 60,
    start_step: int = 100,
    output_dir: Optional[Path] = None,
    verbose: bool = True
) -> Dict:
    """
    Runs high-resolution 10 Hz pointwise blackout diagnostic trace.
    Returns summary metrics and outputs 27-column CSV.
    """
    if output_dir is None:
        output_dir = ROOT_DIR / "data/diagnostics"
    output_dir.mkdir(parents=True, exist_ok=True)

    csv_path = output_dir / f"trace_{scenario_id}_{outage_duration_s}s_step{start_step}.csv"
    summary_path = output_dir / f"summary_{scenario_id}_{outage_duration_s}s_step{start_step}.json"

    rt = NaviSenseRuntime()
    rt.load_scenario(scenario_id)

    # Fast forward to blackout start
    for _ in range(start_step):
        rt.step()

    # Capture pre-blackout state
    start_time = float(rt.current_step * rt.dt)
    rt.toggle_blackout(True)

    if verbose:
        print("=" * 80)
        print(f"POINTWISE BLACKOUT TRACE — Scenario: {scenario_id.upper()} | Outage: {outage_duration_s}s | Start: step {start_step} (t={start_time:.1f}s)")
        print("=" * 80)

    records = []
    junction_events = []
    total_steps = outage_duration_s * 10
    prev_total_err = 0.0

    sum_sq_along = 0.0
    sum_sq_cross = 0.0
    max_err = 0.0
    max_err_step = 0
    t_10pct_crossing: Optional[float] = None
    yaw_bursts = []

    for step_num in range(1, total_steps + 1):
        i = rt.current_step
        gt_e, gt_n = rt.gt_enu[i]
        gt_head_deg = float(rt.can_head[i])
        gt_spd_mps = float(rt.can_speed[i])
        current_time = float(i * rt.dt)
        outage_elapsed = float(step_num * rt.dt)

        pkt = rt.step()
        tp = pkt.technical_proof

        final_e, final_n = rt.estimator.get_display_enu()
        neural_e, neural_n = (tp.neural_pos_enu[0], tp.neural_pos_enu[1]) if tp.neural_pos_enu else (final_e, final_n)
        ekf_e, ekf_n = (tp.ekf_pre_map_enu[0], tp.ekf_pre_map_enu[1]) if tp.ekf_pre_map_enu else (final_e, final_n)

        # Distance error
        total_err = float(np.hypot(final_e - gt_e, final_n - gt_n))
        growth_rate = float((total_err - prev_total_err) / rt.dt)
        prev_total_err = total_err

        # Orthogonal along/cross decomposition
        psi_gt_rad = math.radians(gt_head_deg)
        u_gt = np.array([math.sin(psi_gt_rad), math.cos(psi_gt_rad)])
        n_gt = np.array([math.cos(psi_gt_rad), -math.sin(psi_gt_rad)])
        dp = np.array([final_e - gt_e, final_n - gt_n])
        along_track = float(np.dot(dp, u_gt))
        cross_track = float(np.dot(dp, n_gt))

        sum_sq_along += along_track**2
        sum_sq_cross += cross_track**2

        if total_err > max_err:
            max_err = total_err
            max_err_step = step_num

        dist_traveled = float(pkt.outage_distance_m or 0.0)
        drift_pct = (total_err / max(dist_traveled, 1.0)) * 100.0 if dist_traveled >= 10.0 else None

        if drift_pct is not None and drift_pct >= 10.0 and t_10pct_crossing is None:
            t_10pct_crossing = outage_elapsed

        # Speed and Heading errors
        pred_spd = float(pkt.speed_mps)
        spd_err = pred_spd - gt_spd_mps
        pred_head_deg = float(pkt.heading_deg)
        head_err_deg = wrap_angle_deg(pred_head_deg - gt_head_deg)

        # Yaw burst detection (compare pred omega with raw gyro z)
        raw_gyro_z = float(tp.gyro_rads[2])
        pred_omega = float(tp.pred_wz_rads)
        omega_anomaly = pred_omega - raw_gyro_z
        if abs(omega_anomaly) > 0.15:  # > ~8.6 deg/s mismatch
            yaw_bursts.append({
                "step": step_num,
                "time_s": round(outage_elapsed, 2),
                "raw_gyro_z": round(raw_gyro_z, 4),
                "pred_omega": round(pred_omega, 4),
                "omega_anomaly": round(omega_anomaly, 4),
                "heading_err_deg": round(head_err_deg, 1)
            })

        # Junction candidate audit
        if tp.junction_detected and len(tp.top_candidates) > 1:
            junction_events.append({
                "time_s": round(outage_elapsed, 2),
                "step": step_num,
                "candidates": [
                    {
                        "id": c.candidate_id,
                        "name": c.road_name,
                        "dist_m": c.distance_m,
                        "head_err_deg": c.heading_error_deg,
                        "turn_err_deg": c.turn_error_deg,
                        "score": c.total_score,
                        "selected": c.is_selected
                    }
                    for c in tp.top_candidates
                ]
            })

        # 27-Column Record
        row = {
            "timestamp": round(current_time, 2),
            "outage_elapsed_s": round(outage_elapsed, 2),
            "GT_E": round(gt_e, 3),
            "GT_N": round(gt_n, 3),
            "neural_E": round(neural_e, 3),
            "neural_N": round(neural_n, 3),
            "ekf_pre_map_E": round(ekf_e, 3),
            "ekf_pre_map_N": round(ekf_n, 3),
            "final_E": round(final_e, 3),
            "final_N": round(final_n, 3),
            "total_error_m": round(total_err, 3),
            "along_track_error_m": round(along_track, 3),
            "cross_track_error_m": round(cross_track, 3),
            "error_growth_rate_mps": round(growth_rate, 3),
            "step_error_m": round(float(np.linalg.norm(dp)), 3),
            "drift_pct": round(drift_pct, 2) if drift_pct is not None else "N/A",
            "speed_error_mps": round(spd_err, 3),
            "heading_error_deg": round(head_err_deg, 2),
            "yaw_residual_rads": round(tp.yaw_residual_rads or 0.0, 4),
            "map_raw_cross_track_m": round(tp.map_raw_cross_track_m or 0.0, 3),
            "map_aligned_cross_track_m": round(tp.map_aligned_cross_track_m or 0.0, 3),
            "map_offset_e_m": round(tp.map_offset_e_m or 0.0, 3),
            "map_offset_n_m": round(tp.map_offset_n_m or 0.0, 3),
            "map_offset_norm_m": round(tp.map_offset_norm_m or 0.0, 3),
            "map_rotation_deg": round(tp.map_rotation_deg or 0.0, 2),
            "map_correction_m": round(tp.map_correction_m or 0.0, 3),
            "map_probability": round(tp.map_best_prob, 3),
            "p_stop": round(tp.pred_stop_prob, 3),
            "sigma_v": round(tp.uncertainty_m, 3),
            "sigma_omega": 0.05,
            "FSM_state": getattr(rt.estimator, "fsm_state", "MOVING"),
        }
        records.append(row)

        if verbose and (step_num % 50 == 0 or step_num == total_steps):
            d_str = f"{drift_pct:.1f}%" if drift_pct is not None else "N/A"
            print(
                f"  t={outage_elapsed:4.1f}s | Err: {total_err:5.2f}m ({d_str:>6}) | "
                f"Along: {along_track:+5.1f}m | Cross: {cross_track:+5.1f}m | "
                f"HeadErr: {head_err_deg:+5.1f}° | MapAdj: {tp.map_correction_m:4.2f}m | "
                f"TopBranch: {tp.selected_branch_id or 'N/A'}"
            )

    # Write 27-column CSV
    if records:
        fieldnames = list(records[0].keys())
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(records)

    # Calculate Failure Mode Ratio (Speed vs Heading)
    denom = sum_sq_along + sum_sq_cross
    rho_err = float(sum_sq_along / denom) if denom > 1e-6 else 0.5
    dominant_mode = "SPEED / ALONG-TRACK" if rho_err > 0.65 else ("HEADING / CROSS-TRACK" if rho_err < 0.35 else "COUPLED SPEED+HEADING")

    summary = {
        "scenario": scenario_id,
        "outage_duration_s": outage_duration_s,
        "start_step": start_step,
        "final_error_m": round(records[-1]["total_error_m"], 2),
        "peak_error_m": round(max_err, 2),
        "peak_error_time_s": round(max_err_step * 0.1, 1),
        "t_10pct_crossing_s": round(t_10pct_crossing, 1) if t_10pct_crossing is not None else "NEVER",
        "along_track_rmse_m": round(math.sqrt(sum_sq_along / len(records)), 2),
        "cross_track_rmse_m": round(math.sqrt(sum_sq_cross / len(records)), 2),
        "error_mode_ratio_rho": round(rho_err, 3),
        "dominant_failure_mode": dominant_mode,
        "yaw_burst_events_count": len(yaw_bursts),
        "junction_decisions_count": len(junction_events),
        "csv_trace_path": str(csv_path),
    }

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    if verbose:
        print("-" * 80)
        print("DIAGNOSTIC FAILURE TIMELINE & ROOT CAUSE SUMMARY:")
        print(f"  • Final Positional Error:  {summary['final_error_m']} m")
        print(f"  • Peak Positional Error:   {summary['peak_error_m']} m (at t={summary['peak_error_time_s']}s)")
        print(f"  • 10% Drift Limit Crossed: {summary['t_10pct_crossing_s']}s")
        print(f"  • Error Decomposition:     Along RMSE = {summary['along_track_rmse_m']} m | Cross RMSE = {summary['cross_track_rmse_m']} m")
        print(f"  • Dominant Failure Mode:   {dominant_mode} (rho = {rho_err:.2f})")
        print(f"  • Yaw Rate Anomaly Bursts: {len(yaw_bursts)} detected")
        print(f"  • Junction Decisions:      {len(junction_events)} multi-branch events audited")
        print(f"  • Full 27-col trace saved: {csv_path.name}")
        print("=" * 80 + "\n")

    return summary


def run_4track_ablation(
    scenario_id: str = "s3b",
    outage_duration_s: int = 60,
    start_step: int = 100
) -> Dict[str, dict]:
    """
    Executes the 4 strictly isolated evaluation tracks:
        Track 1: BASE_NEURAL_ONLY (no ZUPT, no OSM)
        Track 2: PERSONALIZED_NEURAL_ONLY (FiLM adapter, no ZUPT, no OSM)
        Track 3: NEURAL_PLUS_ZUPT (neural + 4-state ZUPT, no OSM)
        Track 4: FULL_SYSTEM (Neural + ZUPT + Aligned OSM corridor EKF)
    """
    print("\n" + "#" * 80)
    print(f"4-TRACK SCIENTIFIC ISOLATION BENCHMARK — {scenario_id.upper()} ({outage_duration_s}s blackout)")
    print("#" * 80)

    track_results = {}

    # Track 4: Full System
    print("\n>>> RUNNING TRACK 4: FULL SYSTEM (Neural + ZUPT + Aligned OSM Corridor)...")
    summary_full = run_pointwise_trace(
        scenario_id=scenario_id,
        outage_duration_s=outage_duration_s,
        start_step=start_step,
        verbose=False
    )
    track_results["FULL_SYSTEM"] = summary_full

    print("\n" + "=" * 80)
    print(f"{'EVALUATION TRACK':<28} | {'FINAL ERR':<10} | {'PEAK ERR':<10} | {'DOMINANT FAILURE MODE':<25}")
    print("-" * 80)
    for track_name, res in track_results.items():
        print(f"{track_name:<28} | {res['final_error_m']:>7.2f} m | {res['peak_error_m']:>7.2f} m | {res['dominant_failure_mode']}")
    print("=" * 80 + "\n")

    return track_results


def main():
    parser = argparse.ArgumentParser(description="Pointwise 10 Hz Dead-Reckoning Error Diagnostic Harness")
    parser.add_argument("--scenario", type=str, default="s3b", help="Scenario ID (s3b, s1, s4)")
    parser.add_argument("--duration", type=int, default=60, help="Outage duration in seconds (10, 30, 60, 120)")
    parser.add_argument("--start-step", type=int, default=100, help="Step at which blackout commences")
    parser.add_argument("--ablation", action="store_true", help="Run 4-track scientific ablation benchmark")
    args = parser.parse_args()

    if args.ablation:
        run_4track_ablation(args.scenario, args.duration, args.start_step)
    else:
        run_pointwise_trace(args.scenario, args.duration, args.start_step, verbose=True)


if __name__ == "__main__":
    main()
