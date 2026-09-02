"""
SIH 26168 - GNSS Blackout Simulation Protocol (10s, 30s, 60s, 1km)
Evaluates B1 (Raw INS), B2 (EKF+NHC), B4 (Base IDR), and B5 (Personalized IDR)
with strict GNSS isolation during outages.
"""

import numpy as np
from src.baselines.ins_physics import run_raw_strapdown_ins
from src.baselines.ekf_nhc import run_ekf_nhc
from src.baselines.base_idr import run_base_idr
from src.core.personalized_idr import run_personalized_idr
from src.analysis.metrics import compute_navigation_metrics


class BlackoutWindow:
    def __init__(self, start_idx, end_idx, duration_sec, distance_m):
        self.start_idx = start_idx
        self.end_idx = end_idx
        self.duration_sec = duration_sec
        self.distance_m = distance_m


def generate_blackout_windows_time(sequence, duration_sec=30.0, step_sec=20.0, min_start_sec=30.0):
    windows = []
    cur_t = sequence.timestamps[0] + min_start_sec
    
    while cur_t + duration_sec <= sequence.timestamps[-1]:
        start_idx = int(np.searchsorted(sequence.timestamps, cur_t))
        end_idx = int(np.searchsorted(sequence.timestamps, cur_t + duration_sec))
        
        if end_idx - start_idx > 10:
            diffs = np.diff(sequence.truth_enu[start_idx:end_idx, :2], axis=0)
            dist = float(np.sum(np.sqrt(np.sum(diffs**2, axis=1))))
            if dist > 20.0:
                windows.append(BlackoutWindow(start_idx, end_idx, duration_sec, dist))
                
        cur_t += step_sec
        
    return windows


def generate_blackout_windows_distance(sequence, target_distance_m=1000.0, min_start_sec=30.0):
    windows = []
    min_start_idx = int(np.searchsorted(sequence.timestamps, sequence.timestamps[0] + min_start_sec))
    
    diffs = np.diff(sequence.truth_enu[:, :2], axis=0)
    step_dists = np.sqrt(np.sum(diffs**2, axis=1))
    cum_dist = np.hstack([[0.0], np.cumsum(step_dists)])
    
    total_dist = cum_dist[-1]
    if total_dist < target_distance_m + 50.0:
        target_distance_m = max(200.0, total_dist - 50.0)
        
    start_d = cum_dist[min_start_idx]
    while start_d + target_distance_m <= total_dist:
        start_idx = int(np.searchsorted(cum_dist, start_d))
        end_idx = int(np.searchsorted(cum_dist, start_d + target_distance_m))
        
        if end_idx - start_idx > 20:
            dur = sequence.timestamps[end_idx] - sequence.timestamps[start_idx]
            windows.append(BlackoutWindow(start_idx, end_idx, dur, target_distance_m))
            
        start_d += 250.0
        
    return windows


def evaluate_blackout_window(sequence, window, personalization_state):
    s_idx = window.start_idx
    e_idx = window.end_idx
    
    truth_seg = sequence.truth_enu[s_idx:e_idx]
    truth_spd = sequence.truth_speed_ms[s_idx:e_idx]
    dist = window.distance_m
    
    # 1. B1 - Raw Strapdown INS
    pos_b1, vel_b1 = run_raw_strapdown_ins(sequence, s_idx, e_idx)
    spd_b1 = np.linalg.norm(vel_b1[:, :2], axis=1) if len(vel_b1) > 0 else np.zeros(len(truth_seg))
    metrics_b1 = compute_navigation_metrics(pos_b1, truth_seg, dist, spd_b1, truth_spd)
    
    # 2. B2 - EKF + NHC (GNSS severed)
    mask = np.zeros(len(sequence.timestamps), dtype=bool)
    mask[s_idx:e_idx] = True
    pos_b2, vel_b2 = run_ekf_nhc(sequence, s_idx, e_idx, gnss_mask=mask)
    spd_b2 = np.linalg.norm(vel_b2[:, :2], axis=1) if len(vel_b2) > 0 else np.zeros(len(truth_seg))
    metrics_b2 = compute_navigation_metrics(pos_b2, truth_seg, dist, spd_b2, truth_spd)
    
    # 3. B4 - Base Learned IDR
    pos_b4, spd_b4, _ = run_base_idr(sequence, s_idx, e_idx)
    metrics_b4 = compute_navigation_metrics(pos_b4, truth_seg, dist, spd_b4, truth_spd)
    
    # 4. B5 - Personalized IDR (Strict GNSS isolation)
    pos_b5, spd_b5, _ = run_personalized_idr(sequence, personalization_state, s_idx, e_idx)
    metrics_b5 = compute_navigation_metrics(pos_b5, truth_seg, dist, spd_b5, truth_spd)
    
    return {
        "duration_sec": window.duration_sec,
        "distance_m": window.distance_m,
        "raw_ins": metrics_b1,
        "ekf_nhc": metrics_b2,
        "base_idr": metrics_b4,
        "personalized_idr": metrics_b5,
        "trajectories": {
            "truth": truth_seg.tolist(),
            "raw_ins": pos_b1.tolist(),
            "ekf_nhc": pos_b2.tolist(),
            "base_idr": pos_b4.tolist(),
            "personalized_idr": pos_b5.tolist()
        }
    }
