"""
SIH 26168 - Scientific Evaluation Metrics
Calculates all mandatory navigation metrics:
1. End-point Error: E_end = ||p_est(T) - p_ref(T)|| (meters)
2. Drift Percentage: Drift% = (E_end / Distance_travelled) * 100%
3. Maximum Error: E_max = max_t ||p_est(t) - p_ref(t)|| (meters)
4. Along-Track Error: E_along (RMSE in meters)
5. Cross-Track Error: E_cross (RMSE in meters)
6. Velocity RMSE: v_rmse (m/s)
"""

import numpy as np


def compute_trajectory_distance(pos_enu):
    if len(pos_enu) <= 1:
        return 0.0
    diffs = np.diff(pos_enu[:, :2], axis=0)
    return float(np.sum(np.sqrt(np.sum(diffs**2, axis=1))))


def compute_along_cross_track_errors(pos_est, pos_ref):
    n = min(len(pos_est), len(pos_ref))
    if n <= 1:
        return np.zeros(n), np.zeros(n)
        
    along_track = np.zeros(n)
    cross_track = np.zeros(n)
    
    for i in range(n):
        if i < n - 1:
            ref_vec = pos_ref[i+1, :2] - pos_ref[i, :2]
        else:
            ref_vec = pos_ref[i, :2] - pos_ref[i-1, :2]
            
        ref_norm = np.linalg.norm(ref_vec)
        if ref_norm < 1e-4:
            unit_along = np.array([1.0, 0.0])
            unit_cross = np.array([0.0, 1.0])
        else:
            unit_along = ref_vec / ref_norm
            unit_cross = np.array([-unit_along[1], unit_along[0]])
            
        pos_err = pos_est[i, :2] - pos_ref[i, :2]
        along_track[i] = abs(np.dot(pos_err, unit_along))
        cross_track[i] = abs(np.dot(pos_err, unit_cross))
        
    return along_track, cross_track


def compute_navigation_metrics(pos_est, pos_ref, total_distance=None, speed_est=None, speed_ref=None):
    n = min(len(pos_est), len(pos_ref))
    if n == 0:
        return {
            "end_point_error_m": 0.0,
            "drift_percentage": 0.0,
            "max_error_m": 0.0,
            "mean_error_m": 0.0,
            "along_track_rmse_m": 0.0,
            "cross_track_rmse_m": 0.0,
            "velocity_rmse_ms": 0.0,
            "distance_travelled_m": 0.0
        }

    err_2d = np.linalg.norm(pos_est[:n, :2] - pos_ref[:n, :2], axis=1)
    
    e_end = float(err_2d[-1])
    e_max = float(np.max(err_2d))
    e_mean = float(np.mean(err_2d))
    
    if total_distance is None or total_distance <= 0:
        total_distance = compute_trajectory_distance(pos_ref[:n])
        
    drift_pct = (e_end / max(1.0, total_distance)) * 100.0
    along_track, cross_track = compute_along_cross_track_errors(pos_est[:n], pos_ref[:n])
    
    along_rmse = float(np.sqrt(np.mean(along_track**2)))
    cross_rmse = float(np.sqrt(np.mean(cross_track**2)))
    
    if speed_est is not None and speed_ref is not None:
        m_len = min(len(speed_est), len(speed_ref), n)
        v_rmse = float(np.sqrt(np.mean((speed_est[:m_len] - speed_ref[:m_len])**2)))
    else:
        v_rmse = 0.0
    
    return {
        "end_point_error_m": e_end,
        "drift_percentage": drift_pct,
        "max_error_m": e_max,
        "mean_error_m": e_mean,
        "along_track_rmse_m": along_rmse,
        "cross_track_rmse_m": cross_rmse,
        "velocity_rmse_ms": v_rmse,
        "distance_travelled_m": float(total_distance)
    }


def aggregate_experiment_statistics(metrics_list):
    if not metrics_list:
        return {}
        
    end_errors = [m["end_point_error_m"] for m in metrics_list]
    drift_pcts = [m["drift_percentage"] for m in metrics_list]
    max_errors = [m["max_error_m"] for m in metrics_list]
    along_rmses = [m["along_track_rmse_m"] for m in metrics_list]
    cross_rmses = [m["cross_track_rmse_m"] for m in metrics_list]
    v_rmses = [m.get("velocity_rmse_ms", 0.0) for m in metrics_list]
    
    return {
        "end_error_mean": float(np.mean(end_errors)),
        "end_error_median": float(np.median(end_errors)),
        "end_error_p95": float(np.percentile(end_errors, 95)),
        "end_error_worst": float(np.max(end_errors)),
        
        "drift_pct_mean": float(np.mean(drift_pcts)),
        "drift_pct_median": float(np.median(drift_pcts)),
        "drift_pct_p95": float(np.percentile(drift_pcts, 95)),
        "drift_pct_worst": float(np.max(drift_pcts)),
        
        "max_error_mean": float(np.mean(max_errors)),
        "along_track_rmse_mean": float(np.mean(along_rmses)),
        "cross_track_rmse_mean": float(np.mean(cross_rmses)),
        "velocity_rmse_mean": float(np.mean(v_rmses)),
        "num_runs": len(metrics_list)
    }
