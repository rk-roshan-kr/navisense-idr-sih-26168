"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/evaluation/metrics.py
Description: Authoritative navigation performance metrics calculation:
pointwise drift, Along-Track Error (ATE), Cross-Track Error (CTE),
heading alignment, velocity RMSE, and failure time (T_fail).
================================================================================
"""

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import numpy as np


@dataclass
class NavigationMetrics:
    duration_s: float
    distance_traveled_m: float
    final_drift_m: float
    drift_percentage: float
    max_drift_m: float
    mean_drift_m: float
    along_track_error_m: float
    cross_track_error_m: float
    mean_heading_error_deg: float
    max_heading_error_deg: float
    speed_rmse_mps: float
    time_to_10m_fail_s: Optional[float]
    standstill_f1: float


def compute_navigation_metrics(
    pred_enu: np.ndarray,          # (N, 2) [East, North]
    gt_enu: np.ndarray,            # (N, 2) [East, North]
    pred_speed: np.ndarray,        # (N,) m/s
    gt_speed: np.ndarray,          # (N,) m/s
    pred_heading_rad: np.ndarray,  # (N,) radians
    gt_heading_rad: np.ndarray,    # (N,) radians
    pred_stop: np.ndarray,         # (N,) [0, 1]
    gt_stop: np.ndarray,           # (N,) [0, 1]
    dt: float = 0.1,
    fail_threshold_m: float = 10.0
) -> NavigationMetrics:
    """
    Computes rigorous navigation metrics across a continuous blackout trajectory.
    """
    N = len(pred_enu)
    assert len(gt_enu) == N, f"Length mismatch: pred={N} vs gt={len(gt_enu)}"

    # 1. Trajectory Euclidean Errors
    diff_2d = pred_enu - gt_enu
    drift_profile = np.sqrt(np.sum(diff_2d**2, axis=1))  # (N,)
    final_drift = float(drift_profile[-1])
    max_drift = float(np.max(drift_profile))
    mean_drift = float(np.mean(drift_profile))

    # Total distance traveled along ground truth
    seg_steps = np.diff(gt_enu, axis=0)
    distance_traveled = float(np.sum(np.sqrt(np.sum(seg_steps**2, axis=1))))

    # Drift percentage
    if distance_traveled >= 10.0:
        drift_pct = (final_drift / distance_traveled) * 100.0
    else:
        drift_pct = 0.0

    # 2. Decomposition into Along-Track (ATE) and Cross-Track Error (CTE)
    ate_list = []
    cte_list = []
    for i in range(N):
        # Local tangent unit vector
        if i < N - 1:
            tangent = gt_enu[i + 1] - gt_enu[i]
        elif i > 0:
            tangent = gt_enu[i] - gt_enu[i - 1]
        else:
            tangent = np.array([1.0, 0.0])

        norm_tangent = np.linalg.norm(tangent)
        if norm_tangent > 1e-4:
            u_tan = tangent / norm_tangent
            u_norm = np.array([-u_tan[1], u_tan[0]])  # orthogonal normal
            err = diff_2d[i]
            ate_list.append(abs(float(np.dot(err, u_tan))))
            cte_list.append(abs(float(np.dot(err, u_norm))))
        else:
            ate_list.append(drift_profile[i])
            cte_list.append(0.0)

    along_track_err = float(np.mean(ate_list))
    cross_track_err = float(np.mean(cte_list))

    # 3. Heading Errors
    # Angular difference wrapped to [-pi, pi]
    ang_diff = (pred_heading_rad - gt_heading_rad + np.pi) % (2 * np.pi) - np.pi
    ang_diff_deg = np.abs(np.degrees(ang_diff))
    mean_head_err = float(np.mean(ang_diff_deg))
    max_head_err = float(np.max(ang_diff_deg))

    # 4. Speed RMSE
    speed_rmse = float(np.sqrt(np.mean((pred_speed - gt_speed)**2)))

    # 5. Failure Time T_fail (first time error exceeds fail_threshold_m)
    fail_idx = np.where(drift_profile > fail_threshold_m)[0]
    if len(fail_idx) > 0:
        t_fail_s = float(fail_idx[0] * dt)
    else:
        t_fail_s = None

    # 6. Standstill F1-score
    pred_bin = (pred_stop > 0.5).astype(int)
    gt_bin = (gt_stop > 0.5).astype(int)
    tp = np.sum((pred_bin == 1) & (gt_bin == 1))
    fp = np.sum((pred_bin == 1) & (gt_bin == 0))
    fn = np.sum((pred_bin == 0) & (gt_bin == 1))
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * (precision * recall) / max(precision + recall, 1e-6)

    return NavigationMetrics(
        duration_s=float(N * dt),
        distance_traveled_m=distance_traveled,
        final_drift_m=final_drift,
        drift_percentage=drift_pct,
        max_drift_m=max_drift,
        mean_drift_m=mean_drift,
        along_track_error_m=along_track_err,
        cross_track_error_m=cross_track_err,
        mean_heading_error_deg=mean_head_err,
        max_heading_error_deg=max_head_err,
        speed_rmse_mps=speed_rmse,
        time_to_10m_fail_s=t_fail_s,
        standstill_f1=float(f1)
    )
