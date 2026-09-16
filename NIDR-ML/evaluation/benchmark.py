"""
NaviSense 40-Meter Outage Benchmark Engine.

Standardizes evaluation of indoor/outdoor dead-reckoning performance at
explicit distance intervals: 10m, 20m, 30m, 40m.

Multi-Metric Model Selection Ranking:
1. Maximum pointwise error: max_t ||P_hat_t - P_ref_t||
2. P95 pointwise error
3. Final endpoint error
4. Mean trajectory error
5. Maximum drift %

Strict Quality Gate Rule:
NO VALID UNSEEN-DEVICE GROUPS -> NO QUALITY-GATE PASS.
Must be validated on distinct physical hardware devices (physical_device_id).
"""

import numpy as np
from .baselines import run_double_integration_baseline, run_weinberg_pdr_baseline


def evaluate_trajectory_at_milestones(
    pred_enu: np.ndarray,
    ref_enu: np.ndarray,
    milestones_m: list = None
) -> dict:
    """
    Evaluates drift metrics at exact distance milestones (e.g. 10m, 20m, 30m, 40m)
    and computes primary path quality selection metrics.
    """
    if milestones_m is None:
        milestones_m = [10.0, 20.0, 30.0, 40.0]

    step_dists = np.linalg.norm(np.diff(ref_enu[:, 0:2], axis=0), axis=-1)
    cum_dist = np.insert(np.cumsum(step_dists), 0, 0.0)

    point_errors = np.linalg.norm(pred_enu - ref_enu, axis=-1)
    final_err = float(np.linalg.norm(pred_enu[-1] - ref_enu[-1]))
    total_dist = float(cum_dist[-1])
    final_drift = float((final_err / max(total_dist, 1.0)) * 100.0)

    results = {
        'milestones': {},
        'total_distance_m': total_dist,
        'final_error_m': final_err,
        'final_drift_pct': final_drift,
        # Multi-Metric Selection Ranking Fields:
        'max_pointwise_error_m': float(np.max(point_errors)),
        'p95_pointwise_error_m': float(np.percentile(point_errors, 95)),
        'mean_pointwise_error_m': float(np.mean(point_errors)),
        'max_drift_pct': 0.0
    }

    vel = np.diff(ref_enu[:, 0:2], axis=0, prepend=ref_enu[0:1, 0:2])
    speeds = np.linalg.norm(vel, axis=1)

    all_drifts = []
    for m in milestones_m:
        idx = np.searchsorted(cum_dist, m)
        if idx < len(ref_enu):
            err_vec = pred_enu[idx, 0:2] - ref_enu[idx, 0:2]
            err_norm = float(np.linalg.norm(err_vec))
            drift_pct = (err_norm / m) * 100.0
            all_drifts.append(drift_pct)

            sp = speeds[idx]
            if sp > 0.1:
                tangent = vel[idx] / sp
                normal = np.array([-tangent[1], tangent[0]])
                along = float(abs(np.dot(err_vec, tangent)))
                cross = float(abs(np.dot(err_vec, normal)))
            else:
                along = err_norm / np.sqrt(2.0)
                cross = err_norm / np.sqrt(2.0)

            results['milestones'][f"{int(m)}m"] = {
                'distance_m': m,
                'error_m': err_norm,
                'drift_pct': drift_pct,
                'along_track_m': along,
                'cross_track_m': cross
            }
        else:
            results['milestones'][f"{int(m)}m"] = None

    if all_drifts:
        results['max_drift_pct'] = float(np.max(all_drifts))

    return results


def run_comprehensive_benchmark(
    pdr_net_pred: np.ndarray,
    ref_enu: np.ndarray,
    accel_raw_body: np.ndarray,
    accel_gravity_aligned: np.ndarray,
    yaw_heading_rad: np.ndarray,
    dt_pred: float = 0.05,
    dt_imu: float = 0.01,
    num_physical_devices: int = 1,
    is_unseen_device_test: bool = True
) -> dict:
    """
    Executes the full comparative benchmark comparing:
    1. Baseline 1: Fair Double Integration
    2. Baseline 2: Classical Weinberg Step-PDR
    3. Model: NaviSense IDR (Teacher or Student)

    Strict Quality Gate:
    Requires num_physical_devices >= 2 and is_unseen_device_test == True.
    """
    step_ratio = int(round(dt_pred / dt_imu))

    # 1. Baseline 1: Double Integration
    pos_di_raw = run_double_integration_baseline(accel_gravity_aligned, dt=dt_imu, initial_position=ref_enu[0])
    pos_di = pos_di_raw[::step_ratio][:len(ref_enu)]

    # 2. Baseline 2: Weinberg PDR
    pos_wein_raw = run_weinberg_pdr_baseline(
        accel_raw_body,
        yaw_heading_rad,
        sample_rate_hz=1.0/dt_imu,
        initial_position=ref_enu[0]
    )
    pos_wein = pos_wein_raw[::step_ratio][:len(ref_enu)]

    # Evaluate all at standard milestones
    bm_pdr = evaluate_trajectory_at_milestones(pdr_net_pred, ref_enu)
    bm_di = evaluate_trajectory_at_milestones(pos_di, ref_enu)
    bm_wein = evaluate_trajectory_at_milestones(pos_wein, ref_enu)

    drift_criterion = bm_pdr['final_drift_pct'] <= 20.0 and (
        bm_pdr['milestones'].get('40m') is None or bm_pdr['milestones']['40m']['drift_pct'] <= 20.0
    )

    # Strict Quality Gate Enforcement
    has_sufficient_cross_device_evidence = (num_physical_devices >= 2) and is_unseen_device_test

    if not has_sufficient_cross_device_evidence:
        gate_verdict = "INSUFFICIENT_CROSS_DEVICE_EVIDENCE"
        passed_gate = False
    elif drift_criterion:
        gate_verdict = "PASS_APPROVED_FOR_EXPORT"
        passed_gate = True
    else:
        gate_verdict = "FAIL_EXCEEDS_20_PCT_DRIFT"
        passed_gate = False

    report = {
        'navisense_pdr_net': bm_pdr,
        'baseline_double_integration': bm_di,
        'baseline_weinberg_pdr': bm_wein,
        'quality_gate_passed': passed_gate,
        'quality_gate_verdict': gate_verdict,
        'num_physical_devices': num_physical_devices,
        'threshold_target_pct': 20.0
    }

    return report
