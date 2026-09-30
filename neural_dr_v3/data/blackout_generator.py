"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/data/blackout_generator.py
Description: Generates multi-horizon artificial GNSS blackout episodes from
canonical IO-VNBD synchronized sequences.
================================================================================
"""

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np


@dataclass
class BlackoutEpisode:
    """Represents a single continuous GNSS blackout episode."""
    episode_id: str
    scenario_name: str
    duration_s: float
    num_steps: int
    dt: float

    # Anchor State at t=0 (last trusted GNSS)
    anchor_east: float
    anchor_north: float
    anchor_lat: float
    anchor_lon: float
    anchor_heading_rad: float
    anchor_speed_mps: float
    anchor_imu_history: np.ndarray    # (9, W_hist) preceding blackout

    # Blackout Observation Stream (IMU only, NO GNSS)
    imu_stream: np.ndarray            # (9, num_steps)

    # True Ground Truth Trajectory Targets during Blackout
    gt_delta_east: np.ndarray         # (num_steps,) E(t) - E_0
    gt_delta_north: np.ndarray        # (num_steps,) N(t) - N_0
    gt_delta_s: np.ndarray            # (num_steps,) cumulative along-track scalar distance
    gt_delta_psi: np.ndarray          # (num_steps,) relative heading psi(t) - psi_0
    gt_speed: np.ndarray              # (num_steps,) CAN reference speed
    gt_yaw_rate: np.ndarray           # (num_steps,) CAN reference yaw rate
    gt_p_stop: np.ndarray             # (num_steps,) binary standstill indicator (1.0 if v < 0.2 m/s)


def generate_blackout_episodes_from_segment(
    segment: Dict,
    durations_s: List[float] = [5.0, 10.0, 20.0, 30.0, 60.0],
    w_hist: int = 20,
    stride: int = 60,
    min_travel_m: float = 5.0,
    dt: float = 0.1
) -> List[BlackoutEpisode]:
    """
    Extracts artificial blackout episodes from a single resampled 10 Hz segment.
    """
    episodes = []
    t_len = len(segment["time_s"])
    if t_len < w_hist + 50:
        return episodes

    # Extract 9-channel IMU array: [ax, ay, az, gyaw, gpit, grol, gx, gy, gz]
    imu_9ch = np.vstack([
        segment["ax"], segment["ay"], segment["az"],
        segment["gyaw"], segment["gpit"], segment["grol"],
        segment["gx"], segment["gy"], segment["gz"]
    ]).astype(np.float32)

    can_e = segment["can_east_m"].astype(np.float64)
    can_n = segment["can_north_m"].astype(np.float64)
    spd = segment["spd_ms"].astype(np.float32)
    head_rad = segment["head_unwrapped_rad"].astype(np.float64)
    yaw_rate = segment.get("yaw_rate_rads", np.gradient(head_rad, dt)).astype(np.float32)
    lats = segment.get("lat", np.zeros(t_len, dtype=np.float64))
    lons = segment.get("lon", np.zeros(t_len, dtype=np.float64))
    seg_name = segment.get("name", "iovnbd_seg")

    for dur in durations_s:
        n_steps = int(round(dur / dt))
        total_span = w_hist + n_steps
        if total_span > t_len:
            continue

        for start_t in range(w_hist, t_len - n_steps, stride):
            end_t = start_t + n_steps

            # Check minimum motion criteria
            dist = float(np.sum(np.sqrt(np.diff(can_e[start_t:end_t])**2 + np.diff(can_n[start_t:end_t])**2)))
            # Allow some stationary episodes to learn standstill, but ensure majority have motion
            if dist < min_travel_m and np.random.rand() > 0.15:
                continue

            # 1. Anchor state at start_t (t=0 of blackout)
            p0_e = float(can_e[start_t])
            p0_n = float(can_n[start_t])
            psi_0 = float(head_rad[start_t])
            v_0 = float(spd[start_t])
            lat_0 = float(lats[start_t])
            lon_0 = float(lons[start_t])
            imu_hist = imu_9ch[:, start_t - w_hist:start_t]

            # 2. Blackout stream
            imu_blackout = imu_9ch[:, start_t:end_t]

            # 3. Ground truth targets relative to anchor
            delta_e = (can_e[start_t:end_t] - p0_e).astype(np.float32)
            delta_n = (can_n[start_t:end_t] - p0_n).astype(np.float32)
            delta_psi = (head_rad[start_t:end_t] - psi_0).astype(np.float32)

            # Cumulative along-track distance
            spd_sub = spd[start_t:end_t]
            cum_ds = np.zeros(n_steps, dtype=np.float32)
            if n_steps > 1:
                cum_ds[1:] = np.cumsum(0.5 * (spd_sub[:-1] + spd_sub[1:]) * dt)

            # Standstill indicator: 1.0 if speed < 0.2 m/s
            p_stop = (spd_sub < 0.2).astype(np.float32)

            ep = BlackoutEpisode(
                episode_id=f"{seg_name}_{dur}s_{start_t}",
                scenario_name=seg_name,
                duration_s=dur,
                num_steps=n_steps,
                dt=dt,
                anchor_east=p0_e,
                anchor_north=p0_n,
                anchor_lat=lat_0,
                anchor_lon=lon_0,
                anchor_heading_rad=psi_0,
                anchor_speed_mps=v_0,
                anchor_imu_history=imu_hist,
                imu_stream=imu_blackout,
                gt_delta_east=delta_e,
                gt_delta_north=delta_n,
                gt_delta_s=cum_ds,
                gt_delta_psi=delta_psi,
                gt_speed=spd_sub,
                gt_yaw_rate=yaw_rate[start_t:end_t],
                gt_p_stop=p_stop
            )
            episodes.append(ep)

    return episodes
