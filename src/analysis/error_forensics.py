"""
SIH 26168 - Sensor Forensic & Error Decomposition Analyzer
"""

import numpy as np
from src.core.coordinate_frames import STANDARD_GRAVITY


def analyze_sensor_forensics(sequence):
    accel = sequence.accel
    gyro = sequence.gyro
    speed = sequence.truth_speed_ms
    dt = sequence.dt
    
    n_samples = len(accel)
    if n_samples < 50:
        return {}

    accel_mag = np.linalg.norm(accel, axis=1)
    gravity_residual = np.abs(accel_mag - STANDARD_GRAVITY)
    
    window = 10
    kernel = np.ones(window) / window
    
    accel_smooth_y = np.convolve(accel[:, 1], kernel, mode='same')
    vibration_component_y = accel[:, 1] - accel_smooth_y
    
    vibration_power_y = np.var(vibration_component_y)
    kinematic_power_y = np.var(accel_smooth_y)
    
    impulse_shocks = np.where(gravity_residual > 3.0)[0]
    pothole_event_count = len(impulse_shocks)
    
    stationary_idx = np.where((speed < 0.2) & (np.linalg.norm(gyro, axis=1) < np.radians(1.5)))[0]
    if len(stationary_idx) > 20:
        stationary_accel = accel[stationary_idx]
        stationary_gyro = gyro[stationary_idx]
        
        bias_accel_x = float(np.mean(stationary_accel[:, 0]))
        bias_accel_y = float(np.mean(stationary_accel[:, 1]))
        bias_gyro_z = float(np.mean(stationary_gyro[:, 2]))
        
        noise_accel_std = float(np.std(stationary_accel[:, 1]))
        noise_gyro_std = float(np.std(stationary_gyro[:, 2]))
    else:
        bias_accel_x, bias_accel_y, bias_gyro_z = 0.0, 0.0, 0.0
        noise_accel_std, noise_gyro_std = 0.05, 0.002

    drift_from_accel_bias_30s = 0.5 * abs(bias_accel_y) * (30.0 ** 2) if abs(bias_accel_y) > 0.001 else 0.5 * 0.05 * 900
    tilt_leakage_accel = STANDARD_GRAVITY * np.sin(np.radians(1.0))
    drift_from_1deg_tilt_30s = 0.5 * tilt_leakage_accel * (30.0 ** 2)
    
    mean_speed = np.mean(speed)
    drift_from_gyro_bias_30s = mean_speed * abs(bias_gyro_z) * (30.0 ** 2) if abs(bias_gyro_z) > 0.0001 else mean_speed * np.radians(0.2) * 30

    return {
        "sequence_name": sequence.name,
        "samples_analyzed": n_samples,
        "stationary_samples": len(stationary_idx),
        "estimated_biases": {
            "accel_y_bias_ms2": bias_accel_y,
            "gyro_z_bias_rad_s": bias_gyro_z,
            "accel_noise_std": noise_accel_std,
            "gyro_noise_std": noise_gyro_std
        },
        "vibration_metrics": {
            "vibration_power_ms2": float(vibration_power_y),
            "kinematic_power_ms2": float(kinematic_power_y),
            "vibration_to_signal_ratio": float(vibration_power_y / max(1e-4, kinematic_power_y)),
            "pothole_spikes_detected": pothole_event_count
        },
        "theoretical_30s_drift_breakdown": {
            "drift_from_mount_tilt_1deg_m": float(drift_from_1deg_tilt_30s),
            "drift_from_sensor_bias_m": float(drift_from_accel_bias_30s),
            "drift_from_gyro_yaw_drift_m": float(drift_from_gyro_bias_30s)
        }
    }
