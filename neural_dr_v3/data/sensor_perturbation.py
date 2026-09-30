"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/data/sensor_perturbation.py
Description: Physics-based sensor perturbation engine for training robust
neural dead-reckoning models against bias drift, mount tilt, and noise.
================================================================================
"""

import numpy as np
import torch
import math
from typing import Dict, Optional, Tuple


def euler_to_rotation_matrix(roll_rad: float, pitch_rad: float, yaw_rad: float) -> np.ndarray:
    """Computes standard 3D rotation matrix R = Rz(yaw) * Ry(pitch) * Rx(roll)."""
    cr, sr = math.cos(roll_rad), math.sin(roll_rad)
    cp, sp = math.cos(pitch_rad), math.sin(pitch_rad)
    cy, sy = math.cos(yaw_rad), math.sin(yaw_rad)

    Rx = np.array([[1.0, 0.0, 0.0],
                   [0.0, cr, -sr],
                   [0.0, sr, cr]], dtype=np.float64)
    Ry = np.array([[cp, 0.0, sp],
                   [0.0, 1.0, 0.0],
                   [-sp, 0.0, cp]], dtype=np.float64)
    Rz = np.array([[cy, -sy, 0.0],
                   [sy, cy, 0.0],
                   [0.0, 0.0, 1.0]], dtype=np.float64)
    return Rz @ Ry @ Rx


class SensorPerturbationEngine:
    """
    Simulates realistic smartphone sensor degradation:
      - Accelerometer and Gyroscope DC bias drift
      - Sensor scale factor errors
      - Additive white Gaussian measurement noise
      - Random 3D mount rotation misalignment
      - Synthetic vehicle vibration
    """
    def __init__(
        self,
        accel_bias_bound: float = 0.25,      # m/s^2
        gyro_bias_bound: float = 0.015,      # rad/s
        accel_noise_std: float = 0.04,       # m/s^2
        gyro_noise_std: float = 0.003,       # rad/s
        scale_error_std: float = 0.03,       # 3% scale factor error
        mount_tilt_max_deg: float = 5.0,     # max 5 degrees mount tilt jitter
        vibration_amplitude: float = 0.15    # vibration amplitude
    ):
        self.accel_bias_bound = accel_bias_bound
        self.gyro_bias_bound = gyro_bias_bound
        self.accel_noise_std = accel_noise_std
        self.gyro_noise_std = gyro_noise_std
        self.scale_error_std = scale_error_std
        self.mount_tilt_max_deg = mount_tilt_max_deg
        self.vibration_amplitude = vibration_amplitude

    def perturb_imu_sequence(self, imu_9ch: np.ndarray, speed_ref: Optional[np.ndarray] = None) -> np.ndarray:
        """
        Perturbs a (9, N) IMU array:
          0:3 -> accel_x, accel_y, accel_z
          3:6 -> gyro_yaw, gyro_pitch, gyro_roll
          6:9 -> gravity_x, gravity_y, gravity_z
        """
        perturbed = imu_9ch.copy()
        N = perturbed.shape[1]

        # 1. Mount rotation misalignment jitter
        roll_jitter = np.random.uniform(-self.mount_tilt_max_deg, self.mount_tilt_max_deg)
        pitch_jitter = np.random.uniform(-self.mount_tilt_max_deg, self.mount_tilt_max_deg)
        yaw_jitter = np.random.uniform(-self.mount_tilt_max_deg, self.mount_tilt_max_deg)
        R = euler_to_rotation_matrix(math.radians(roll_jitter), math.radians(pitch_jitter), math.radians(yaw_jitter))

        # Rotate accelerometer, gyro, and gravity vectors
        perturbed[0:3, :] = R @ perturbed[0:3, :]
        perturbed[3:6, :] = R @ perturbed[3:6, :]
        perturbed[6:9, :] = R @ perturbed[6:9, :]

        # 2. Scale factor error
        scale_acc = 1.0 + np.random.randn(3, 1) * self.scale_error_std
        scale_gyr = 1.0 + np.random.randn(3, 1) * self.scale_error_std
        perturbed[0:3, :] *= scale_acc
        perturbed[3:6, :] *= scale_gyr

        # 3. Sensor DC bias walk (constant over episode + slight drift)
        b_acc = np.random.uniform(-self.accel_bias_bound, self.accel_bias_bound, (3, 1))
        b_gyr = np.random.uniform(-self.gyro_bias_bound, self.gyro_bias_bound, (3, 1))
        
        # Add random walk drift across time
        acc_walk = np.cumsum(np.random.randn(3, N) * 0.002, axis=1)
        gyr_walk = np.cumsum(np.random.randn(3, N) * 0.0001, axis=1)
        perturbed[0:3, :] += (b_acc + acc_walk)
        perturbed[3:6, :] += (b_gyr + gyr_walk)

        # 4. Additive Gaussian sensor noise
        perturbed[0:3, :] += np.random.randn(3, N) * self.accel_noise_std
        perturbed[3:6, :] += np.random.randn(3, N) * self.gyro_noise_std

        # 5. Vehicle engine & road vibration simulation
        if speed_ref is not None and len(speed_ref) == N:
            # Vibration magnitude proportional to speed + engine idle
            vib_amp = (speed_ref * 0.02 + 0.05) * self.vibration_amplitude
            t_steps = np.arange(N) * 0.1
            # 15 Hz and 28 Hz vibration aliases
            synth_vib = np.sin(2 * np.pi * 15.0 * t_steps) + 0.5 * np.cos(2 * np.pi * 28.0 * t_steps)
            perturbed[0, :] += synth_vib * vib_amp
            perturbed[1, :] += synth_vib * (vib_amp * 0.7)
            perturbed[2, :] += synth_vib * (vib_amp * 1.2)

        return perturbed
