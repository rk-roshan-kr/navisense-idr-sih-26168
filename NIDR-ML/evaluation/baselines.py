"""
Fair & Rigorous Baseline Dead-Reckoning Models.

Equipped with identical initial conditions, sensor conditioning, and coordinate anchoring
available to the neural system:
1. Double Integration (with initial velocity seeding and stationary bias removal)
2. Classical Weinberg Step-PDR (with step interpolation and initial heading alignment)
"""

import numpy as np
from scipy.signal import find_peaks


def run_double_integration_baseline(
    accel_gravity_aligned: np.ndarray,
    dt: float = 0.01,
    initial_velocity: np.ndarray = None,
    initial_position: np.ndarray = None,
    remove_initial_bias: bool = True
) -> np.ndarray:
    """
    Executes fair numerical double integration:
    a(t) -> v(t) -> p(t)
    Receives identical initial position P0, initial velocity v0, and optional stationary bias estimation.
    """
    T = len(accel_gravity_aligned)
    acc = np.copy(accel_gravity_aligned)

    if remove_initial_bias and T > 20:
        # Estimate bias over initial 0.2s assuming near-constant or known stance
        init_bias = np.mean(acc[:20], axis=0)
        # Only remove small residual bias (< 0.5 m/s^2)
        if np.linalg.norm(init_bias) < 0.5:
            acc -= init_bias

    vel = np.zeros((T, 3), dtype=np.float64)
    pos = np.zeros((T, 3), dtype=np.float64)

    if initial_velocity is not None:
        vel[0] = initial_velocity
    if initial_position is not None:
        pos[0] = initial_position

    for t in range(1, T):
        vel[t] = vel[t - 1] + acc[t] * dt
        pos[t] = pos[t - 1] + vel[t] * dt

    return pos


def run_weinberg_pdr_baseline(
    accel_body: np.ndarray,
    yaw_heading_rad: np.ndarray,
    sample_rate_hz: float = 100.0,
    k_weinberg: float = 0.42,
    initial_position: np.ndarray = None,
    initial_heading_rad: float = None
) -> np.ndarray:
    """
    Classical Step-Based Pedestrian Dead Reckoning (Weinberg PDR).
    """
    T = len(accel_body)
    pos = np.zeros((T, 3), dtype=np.float64)
    if initial_position is not None:
        pos[0] = initial_position

    acc_mag = np.linalg.norm(accel_body, axis=1)

    min_dist_samples = int(0.35 * sample_rate_hz)
    peaks, _ = find_peaks(acc_mag, height=10.5, distance=min_dist_samples)

    if len(peaks) < 2:
        return pos

    # Use initial heading offset if specified
    hdg = np.copy(yaw_heading_rad)
    if initial_heading_rad is not None:
        hdg = hdg - hdg[0] + initial_heading_rad

    current_pos = pos[0].copy()
    last_peak_idx = 0

    for i in range(1, len(peaks)):
        p_curr = peaks[i]
        p_prev = peaks[i - 1]

        window = acc_mag[p_prev:p_curr]
        a_max = np.max(window)
        a_min = np.min(window)

        stride_m = k_weinberg * ((a_max - a_min) ** 0.25)
        stride_m = np.clip(stride_m, 0.35, 1.1)

        step_yaw = hdg[p_curr]
        de = stride_m * np.sin(step_yaw)
        dn = stride_m * np.cos(step_yaw)

        next_pos = current_pos + np.array([de, dn, 0.0])

        # Smooth linear interpolation between step events
        step_len = p_curr - last_peak_idx
        if step_len > 0:
            alphas = np.linspace(0.0, 1.0, step_len)[:, None]
            pos[last_peak_idx:p_curr] = (1.0 - alphas) * current_pos + alphas * next_pos

        current_pos = next_pos
        last_peak_idx = p_curr

    pos[last_peak_idx:] = current_pos
    return pos
