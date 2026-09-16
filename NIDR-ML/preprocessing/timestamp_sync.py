"""
Timestamp Repair & Multi-Rate Sensor Synchronization.

Repairs monotonic nanosecond timelines and synchronizes disparate
sensor streams (IMU ~100-500 Hz, GNSS ~1 Hz) onto a uniform canonical grid (100 Hz).
Quaternions are interpolated using NLERP/SLERP to preserve unit SO(3) geometry.
"""

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d
from .frame_transform import android_to_canonical_quat


def repair_monotonic_timestamps(timestamps_nanos: np.ndarray, min_step_nanos: int = 1_000_000) -> np.ndarray:
    """
    Enforces strictly increasing monotonic timestamps.
    Handles hardware clock resets, jitter, or duplicate nanosecond events.
    """
    repaired = np.copy(timestamps_nanos)
    for i in range(1, len(repaired)):
        if repaired[i] <= repaired[i - 1]:
            repaired[i] = repaired[i - 1] + min_step_nanos
    return repaired


def nlerp_quaternions(t_orig: np.ndarray, q_orig: np.ndarray, t_target: np.ndarray) -> np.ndarray:
    """
    Normalized Linear Interpolation (NLERP) for SO(3) unit quaternions.
    Fast and geometrically accurate for high-frequency orientation streams.
    """
    n_targets = len(t_target)
    q_out = np.zeros((n_targets, 4), dtype=np.float64)

    # Standard 1D linear interpolation per component
    for dim in range(4):
        f = interp1d(t_orig, q_orig[:, dim], kind='linear', fill_value='extrapolate')
        q_out[:, dim] = f(t_target)

    # Renormalize to ensure unit sphere
    norms = np.linalg.norm(q_out, axis=1, keepdims=True)
    norms = np.where(norms < 1e-12, 1.0, norms)
    q_out = q_out / norms

    # Disambiguate upper hemisphere: qw >= 0
    neg_mask = q_out[:, 0] < 0.0
    q_out[neg_mask] = -q_out[neg_mask]
    return q_out


def synchronize_session(
    imu_df: pd.DataFrame,
    gnss_df: pd.DataFrame,
    target_imu_hz: float = 100.0,
    target_prediction_hz: float = 20.0,
    gnss_min_accuracy_m: float = 15.0
) -> dict:
    """
    Synchronizes an IMU dataframe and GNSS dataframe onto a synchronized timeline.

    Returns dict containing:
    - 'time_s': relative timestamps in seconds from session start
    - 'imu_100hz': (N, 13) array [ax, ay, az, gx, gy, gz, ag_x, ag_y, ag_z, qw, qx, qy, qz]
    - 'ref_enu_20hz': (M, 3) reference trajectory positions [E, N, U] in meters
    - 'ref_yaw_20hz': (M,) reference heading angle in radians
    - 'ref_quality_20hz': (M,) target quality weight w_t in [0.1, 1.0]
    - 'metadata': anchor coordinates and timing information
    """
    if len(imu_df) < 50:
        raise ValueError("IMU dataset too short (< 50 samples)")

    # 1. Clean, sort, and deduplicate simultaneous IMU events
    ts_col = 'timestamp_elapsed_nanos' if 'timestamp_elapsed_nanos' in imu_df.columns else 'timestamp_unix_ms'
    imu_df = imu_df.sort_values(ts_col).drop_duplicates(subset=ts_col, keep='last')

    t_nanos_raw = imu_df[ts_col].values.astype(np.int64)
    t_nanos = repair_monotonic_timestamps(t_nanos_raw, min_step_nanos=1000)
    scale_to_s = 1e-9 if ts_col == 'timestamp_elapsed_nanos' else 1e-3
    t_s = (t_nanos - t_nanos[0]) * scale_to_s
    total_duration_s = t_s[-1]

    # Create uniform target time grids
    dt_imu = 1.0 / target_imu_hz
    t_target_imu = np.arange(0.0, total_duration_s, dt_imu)

    # Extract raw body accel & gyro
    ax = imu_df['ax'].values
    ay = imu_df['ay'].values
    az = imu_df['az'].values
    gx = imu_df['gx'].values
    gy = imu_df['gy'].values
    gz = imu_df['gz'].values

    # Resample body inertial signals linearly onto uniform 100 Hz grid
    ax_100 = interp1d(t_s, ax, kind='linear', fill_value='extrapolate')(t_target_imu)
    ay_100 = interp1d(t_s, ay, kind='linear', fill_value='extrapolate')(t_target_imu)
    az_100 = interp1d(t_s, az, kind='linear', fill_value='extrapolate')(t_target_imu)
    gx_100 = interp1d(t_s, gx, kind='linear', fill_value='extrapolate')(t_target_imu)
    gy_100 = interp1d(t_s, gy, kind='linear', fill_value='extrapolate')(t_target_imu)
    gz_100 = interp1d(t_s, gz, kind='linear', fill_value='extrapolate')(t_target_imu)

    # Extract and canonicalize quaternions
    if 'rot_qw' in imu_df.columns:
        # Check if scalar is first or last in source
        q_raw = imu_df[['rot_qx', 'rot_qy', 'rot_qz', 'rot_qw']].values
    else:
        # Fallback identity quaternion
        q_raw = np.tile([0.0, 0.0, 0.0, 1.0], (len(imu_df), 1))

    q_canonical_orig = android_to_canonical_quat(q_raw)
    q_100 = nlerp_quaternions(t_s, q_canonical_orig, t_target_imu)

    # Gravity-aligned acceleration transform
    from .frame_transform import transform_body_to_gravity_aligned
    accel_body_100 = np.stack([ax_100, ay_100, az_100], axis=1)
    ag_100 = transform_body_to_gravity_aligned(accel_body_100, q_100)

    # 13-channel input matrix: [ax, ay, az, gx, gy, gz, ag_x, ag_y, ag_z, qw, qx, qy, qz]
    imu_100hz = np.hstack([
        accel_body_100,
        np.stack([gx_100, gy_100, gz_100], axis=1),
        ag_100,
        q_100
    ])

    # 2. Process GNSS reference trajectory if available
    dt_pred = 1.0 / target_prediction_hz
    t_target_pred = np.arange(0.0, total_duration_s, dt_pred)
    n_pred = len(t_target_pred)

    ref_enu_20hz = np.zeros((n_pred, 3), dtype=np.float64)
    ref_yaw_20hz = np.zeros(n_pred, dtype=np.float64)
    ref_quality_20hz = np.zeros(n_pred, dtype=np.float64)
    anchor_info = {}

    has_valid_gnss = False
    if gnss_df is not None and len(gnss_df) >= 2:
        # Filter valid fixes with coordinates
        valid_mask = (gnss_df['lat'].abs() > 1e-4) & (gnss_df['lon'].abs() > 1e-4)
        if 'accuracy_m' in gnss_df.columns:
            valid_mask &= (gnss_df['accuracy_m'] < gnss_min_accuracy_m * 2.0)

        valid_gnss = gnss_df[valid_mask].sort_values('timestamp_elapsed_nanos').drop_duplicates(subset='timestamp_elapsed_nanos', keep='last').copy()
        if len(valid_gnss) >= 2:
            has_valid_gnss = True
            t_gnss_nanos = repair_monotonic_timestamps(valid_gnss['timestamp_elapsed_nanos'].values.astype(np.int64), min_step_nanos=10_000_000)
            t_gnss_s = (t_gnss_nanos - t_nanos[0]) * 1e-9

            anchor_lat = float(valid_gnss['lat'].iloc[0])
            anchor_lon = float(valid_gnss['lon'].iloc[0])
            anchor_alt = float(valid_gnss['alt'].iloc[0]) if 'alt' in valid_gnss.columns else 0.0

            anchor_info = {
                'anchor_lat': anchor_lat,
                'anchor_lon': anchor_lon,
                'anchor_alt': anchor_alt,
                'anchor_time_s': float(t_gnss_s[0])
            }

            from .gnss_reference import geodetic_to_enu, smooth_reference_trajectory, compute_reference_quality_weights

            e_raw, n_raw, u_raw = geodetic_to_enu(
                valid_gnss['lat'].values, valid_gnss['lon'].values,
                valid_gnss['alt'].values if 'alt' in valid_gnss.columns else np.zeros(len(valid_gnss)),
                anchor_lat, anchor_lon, anchor_alt
            )

            acc_raw = valid_gnss['accuracy_m'].values if 'accuracy_m' in valid_gnss.columns else np.ones(len(valid_gnss)) * 5.0
            e_sm, n_sm, u_sm = smooth_reference_trajectory(e_raw, n_raw, u_raw, t_gnss_s, acc_raw)

            # Interpolate smoothed reference trajectory onto 20 Hz prediction grid
            e_20 = interp1d(t_gnss_s, e_sm, kind='linear', fill_value='extrapolate')(t_target_pred)
            n_20 = interp1d(t_gnss_s, n_sm, kind='linear', fill_value='extrapolate')(t_target_pred)
            u_20 = interp1d(t_gnss_s, u_sm, kind='linear', fill_value='extrapolate')(t_target_pred)
            ref_enu_20hz = np.stack([e_20, n_20, u_20], axis=1)

            # Compute reference yaw from velocity displacement
            de = np.diff(e_20, prepend=e_20[0])
            dn = np.diff(n_20, prepend=n_20[0])
            speed = np.sqrt(de**2 + dn**2) / dt_pred
            yaw_from_motion = np.arctan2(de, dn)  # Azimuth from North toward East

            # When stationary, keep last heading
            current_yaw = 0.0
            for i in range(n_pred):
                if speed[i] > 0.3:
                    current_yaw = yaw_from_motion[i]
                ref_yaw_20hz[i] = current_yaw

            # Quality weights
            acc_20 = interp1d(t_gnss_s, acc_raw, kind='linear', fill_value='extrapolate')(t_target_pred)
            # Distance in time to nearest actual GNSS fix
            time_dist = np.min(np.abs(t_target_pred[:, None] - t_gnss_s[None, :]), axis=1)
            ref_quality_20hz = compute_reference_quality_weights(acc_20, time_dist, gnss_min_accuracy_m)

    return {
        'time_imu_s': t_target_imu,
        'time_pred_s': t_target_pred,
        'imu_100hz': imu_100hz.astype(np.float32),
        'ref_enu_20hz': ref_enu_20hz.astype(np.float32),
        'ref_yaw_20hz': ref_yaw_20hz.astype(np.float32),
        'ref_quality_20hz': ref_quality_20hz.astype(np.float32),
        'has_valid_gnss': has_valid_gnss,
        'anchor_info': anchor_info
    }
