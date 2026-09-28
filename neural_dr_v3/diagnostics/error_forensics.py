"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/diagnostics/error_forensics.py
Description: Forensics tools decomposing total navigation drift into heading drift,
speed scale bias, and false standstill creep.
================================================================================
"""

from typing import Dict
import numpy as np


def decompose_trajectory_errors(
    pred_enu: np.ndarray,
    gt_enu: np.ndarray,
    pred_speed: np.ndarray,
    gt_speed: np.ndarray,
    pred_heading_rad: np.ndarray,
    gt_heading_rad: np.ndarray,
    gt_stop: np.ndarray,
    dt: float = 0.1
) -> Dict[str, float]:
    """
    Decomposes total trajectory drift into:
      1. Pure Heading Integration Drift
      2. Speed Scaling Bias
      3. Standstill Creep
    """
    N = len(pred_enu)

    # Total endpoint drift
    total_drift_m = float(np.linalg.norm(pred_enu[-1] - gt_enu[-1]))

    # 1. Theoretical drift caused strictly by heading errors:
    # integrate GT speed with predicted heading
    e_head = np.cumsum(gt_speed * np.sin(pred_heading_rad) * dt)
    n_head = np.cumsum(gt_speed * np.cos(pred_heading_rad) * dt)
    pure_heading_drift_m = float(np.linalg.norm(np.array([e_head[-1], n_head[-1]]) - gt_enu[-1]))

    # 2. Theoretical drift caused strictly by speed scaling error:
    # integrate predicted speed with GT heading
    e_spd = np.cumsum(pred_speed * np.sin(gt_heading_rad) * dt)
    n_spd = np.cumsum(pred_speed * np.cos(gt_heading_rad) * dt)
    pure_speed_drift_m = float(np.linalg.norm(np.array([e_spd[-1], n_spd[-1]]) - gt_enu[-1]))

    # 3. False standstill creep (distance traveled when vehicle was stationary)
    is_stopped = (gt_stop > 0.5)
    standstill_creep_m = float(np.sum(pred_speed[is_stopped] * dt))

    # Error shares
    total_decomp = pure_heading_drift_m + pure_speed_drift_m + 1e-6
    heading_share_pct = (pure_heading_drift_m / total_decomp) * 100.0
    speed_share_pct = (pure_speed_drift_m / total_decomp) * 100.0

    return {
        "total_endpoint_drift_m": total_drift_m,
        "heading_induced_drift_m": pure_heading_drift_m,
        "speed_induced_drift_m": pure_speed_drift_m,
        "standstill_creep_m": standstill_creep_m,
        "heading_error_share_pct": heading_share_pct,
        "speed_error_share_pct": speed_share_pct
    }
