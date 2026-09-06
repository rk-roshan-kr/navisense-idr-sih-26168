"""
SIH 26168 - SensorConditioner V2.2
Authoritative physical sensor conditioning, sequential stateful DC bias tracking,
and 8-D statistical vibration/noise signature extraction.
Sole owner of physical 3D mount rotation and sensor coordinate frames.

Canonical 9-Axis Channel Layout:
  0: accel_x    - Vehicle forward/longitudinal acceleration (m/s^2)
  1: accel_y    - Vehicle lateral acceleration (m/s^2)
  2: accel_z    - Vehicle vertical acceleration (m/s^2)
  3: gyro_yaw   - Vehicle yaw rate about vertical axis (rad/s)
  4: gyro_pitch - Vehicle pitch rate (rad/s)
  5: gyro_roll  - Vehicle roll rate (rad/s)
  6: gravity_x  - Gravity vector projection X in world-vertical frame (m/s^2)
  7: gravity_y  - Gravity vector projection Y in world-vertical frame (m/s^2)
  8: gravity_z  - Gravity vector projection Z in world-vertical frame (m/s^2)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn

CANONICAL_CHANNEL_NAMES = [
    "accel_x", "accel_y", "accel_z",
    "gyro_yaw", "gyro_pitch", "gyro_roll",
    "gravity_x", "gravity_y", "gravity_z"
]
NUM_CANONICAL_CHANNELS = 9


def build_rotation_matrix_3d_np(euler_rad: np.ndarray) -> np.ndarray:
    """
    Constructs 3D rotation matrix R = R_z(yaw) * R_y(pitch) * R_x(roll)
    which transforms vectors from sensor frame into vehicle chassis frame:
      v_vehicle = R @ v_sensor
    """
    roll, pitch, yaw = float(euler_rad[0]), float(euler_rad[1]), float(euler_rad[2])

    Rx = np.array([
        [1.0, 0.0, 0.0],
        [0.0, math.cos(roll), -math.sin(roll)],
        [0.0, math.sin(roll), math.cos(roll)]
    ], dtype=np.float64)

    Ry = np.array([
        [math.cos(pitch), 0.0, math.sin(pitch)],
        [0.0, 1.0, 0.0],
        [-math.sin(pitch), 0.0, math.cos(pitch)]
    ], dtype=np.float64)

    Rz = np.array([
        [math.cos(yaw), -math.sin(yaw), 0.0],
        [math.sin(yaw), math.cos(yaw), 0.0],
        [0.0, 0.0, 1.0]
    ], dtype=np.float64)

    return Rz @ (Ry @ Rx)


@dataclass
class StationaryNoiseProfile:
    """Welford online accumulator for stationary sensor noise envelope statistics."""
    samples: int = 0
    mean: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))
    m2: np.ndarray = field(default_factory=lambda: np.zeros(3, dtype=np.float64))
    impulse_count: int = 0

    def update(self, x: np.ndarray, impulse_threshold_sigma: float = 3.5) -> bool:
        self.samples += 1
        x64 = np.asarray(x, dtype=np.float64)
        delta = x64 - self.mean
        self.mean += delta / self.samples
        delta2 = x64 - self.mean
        self.m2 += delta * delta2

        is_impulse = False
        if self.samples > 10:
            std = np.sqrt(np.maximum(self.m2 / (self.samples - 1), 1e-6))
            if np.any(np.abs(delta) > impulse_threshold_sigma * std):
                self.impulse_count += 1
                is_impulse = True
        return is_impulse

    @property
    def variance(self) -> np.ndarray:
        if self.samples < 2:
            return np.zeros(3, dtype=np.float64)
        return self.m2 / (self.samples - 1)

    @property
    def std(self) -> np.ndarray:
        return np.sqrt(np.maximum(self.variance, 0.0))

    @property
    def impulse_rate(self) -> float:
        if self.samples == 0:
            return 0.0
        return float(self.impulse_count / self.samples)


class SensorConditioner:
    """
    Physical sensor conditioner for 10 Hz smartphone IMU streams.
    Enforces canonical 9-axis channel contract:
      Channels 0-2: Accel XYZ (m/s^2)
      Channels 3-5: Gyro Yaw, Pitch, Roll (rad/s)
      Channels 6-8: Gravity XYZ (m/s^2)
      
    Maintains sequential, causal dynamic DC bias tracking:
      b_t = f(b_{t-1}, x_t)
    """

    def __init__(
        self,
        dt: float = 0.1,
        gravity_mps2: float = 9.80665,
        accel_clip_mps2: float = 12.0,
        alpha_bias: float = 0.03
    ):
        self.dt = dt
        self.gravity_mps2 = gravity_mps2
        self.accel_clip_mps2 = accel_clip_mps2
        self.alpha_bias = alpha_bias

        # Physical calibration parameters
        self.mount_euler = np.zeros(3, dtype=np.float64)   # [roll, pitch, yaw] in rad
        self.accel_bias  = np.zeros(3, dtype=np.float64)   # m/s^2 in sensor frame
        self.gyro_bias   = np.zeros(3, dtype=np.float64)   # rad/s in sensor frame

        # Stationary noise profiles (accumulated strictly during verified stationary ticks)
        self.accel_profile = StationaryNoiseProfile()
        self.gyro_profile  = StationaryNoiseProfile()

        # Recent buffer for sensor-only stationarity detection
        self.recent_accel: list[np.ndarray] = []
        self.recent_gyro: list[np.ndarray] = []
        self.buffer_len = 8  # 0.8s window

    def reset_state(self):
        """Resets all dynamic state for a new clean sequence."""
        self.accel_bias.fill(0.0)
        self.gyro_bias.fill(0.0)
        self.accel_profile = StationaryNoiseProfile()
        self.gyro_profile = StationaryNoiseProfile()
        self.recent_accel.clear()
        self.recent_gyro.clear()

    def set_mount_euler(self, euler_rad: np.ndarray):
        """Sets 3D Euler angles (roll, pitch, yaw) in radians."""
        self.mount_euler = np.asarray(euler_rad, dtype=np.float64).copy()

    def set_biases(self, accel_bias: np.ndarray, gyro_bias: np.ndarray):
        self.accel_bias = np.asarray(accel_bias, dtype=np.float64).copy()
        self.gyro_bias = np.asarray(gyro_bias, dtype=np.float64).copy()

    def detect_stationary_sensor(
        self,
        accel_sample: np.ndarray,
        gyro_sample: np.ndarray
    ) -> bool:
        """
        Pure smartphone sensor-only standstill detector with adaptive noise envelope:
          1. Acceleration norm near 1g: ||a|| in [g - thresh_a, g + thresh_a]
          2. Short-term acceleration variance bounded: Var(a) < var_thresh
          3. Gyroscope norm bounded: ||omega|| < thresh_w
        """
        a = np.asarray(accel_sample[:3], dtype=np.float64)
        w = np.asarray(gyro_sample[:3], dtype=np.float64)

        self.recent_accel.append(a)
        self.recent_gyro.append(w)
        if len(self.recent_accel) > self.buffer_len:
            self.recent_accel.pop(0)
            self.recent_gyro.pop(0)

        if len(self.recent_accel) < 4:
            return False

        a_win = np.array(self.recent_accel)
        w_win = np.array(self.recent_gyro)

        # Norms
        a_norms = np.linalg.norm(a_win, axis=1)
        w_norms = np.linalg.norm(w_win, axis=1)

        # Adaptive thresholds based on current noise envelope
        cur_a_std = np.mean(self.accel_profile.std) if self.accel_profile.samples > 10 else 0.05
        cur_w_std = np.mean(self.gyro_profile.std) if self.gyro_profile.samples > 10 else 0.01

        thresh_a = max(0.40, 3.5 * cur_a_std)
        var_thresh = max(0.04, 3.0 * (cur_a_std ** 2))
        thresh_w = max(0.06, 3.5 * cur_w_std)

        g_diff = np.abs(np.mean(a_norms) - self.gravity_mps2)
        a_var = np.mean(np.var(a_win, axis=0))
        w_max = np.max(w_norms)

        is_still = (g_diff < thresh_a) and (a_var < var_thresh) and (w_max < thresh_w)
        return bool(is_still)

    def update_stationary_step(
        self,
        accel_sample: np.ndarray,
        gyro_sample: np.ndarray,
        is_still: bool
    ):
        """
        Causal dynamic DC bias EMA tracking during verified stationary steps:
          b_g <- (1 - alpha)*b_g + alpha*omega_sensor
          b_a <- (1 - alpha)*b_a + alpha*(a_sensor - R^T [0, 0, g]^T)
        """
        if not is_still:
            return

        a = np.asarray(accel_sample[:3], dtype=np.float64)
        w = np.asarray(gyro_sample[:3], dtype=np.float64)

        # Accumulate statistical noise envelope
        self.accel_profile.update(a)
        self.gyro_profile.update(w)

        # Expected stationary gravity vector in sensor frame:
        # In vehicle frame: a_veh = [0, 0, +g]^T (contact force pointing up)
        # a_sensor_expected = R^T @ [0, 0, +g]^T
        R = build_rotation_matrix_3d_np(self.mount_euler)
        expected_g_sensor = R.T @ np.array([0.0, 0.0, self.gravity_mps2], dtype=np.float64)

        # Dynamic bias updates via EMA
        alpha = self.alpha_bias
        self.gyro_bias = (1.0 - alpha) * self.gyro_bias + alpha * w
        self.accel_bias = (1.0 - alpha) * self.accel_bias + alpha * (a - expected_g_sensor)

    def get_vibration_signature(self) -> np.ndarray:
        """
        Returns the rigorous 8-D statistical vibration and noise envelope vector z_vib in R^8:
          [sigma_ax, sigma_ay, sigma_az, sigma_gx, sigma_gy, sigma_gz,
           accel_impulse_rate, gyro_impulse_rate]
        """
        a_std = self.accel_profile.std
        g_std = self.gyro_profile.std
        a_imp = self.accel_profile.impulse_rate
        g_imp = self.gyro_profile.impulse_rate

        z_vib = np.array([
            float(a_std[0]), float(a_std[1]), float(a_std[2]),
            float(g_std[0]), float(g_std[1]), float(g_std[2]),
            float(a_imp), float(g_imp)
        ], dtype=np.float32)

        return z_vib

    def condition_sample(
        self,
        raw_sample_9ch: np.ndarray,
        update_state: bool = True
    ) -> np.ndarray:
        """
        Conditions a single 9-channel sample sequentially:
          1. Detects stationary state (sensor-only).
          2. Updates dynamic DC bias if stationary and update_state=True.
          3. De-biases accel and gyro: a_deb = a - b_a, w_deb = w - b_g.
          4. 3D rotates into vehicle frame: R @ a_deb, R @ w_deb.
          5. Clips non-physical acceleration impulses.
        """
        x = np.asarray(raw_sample_9ch, dtype=np.float64).copy()
        a_raw = x[:3]
        w_raw = x[3:6]

        if update_state:
            is_still = self.detect_stationary_sensor(a_raw, w_raw)
            if is_still:
                self.update_stationary_step(a_raw, w_raw, is_still=True)

        R = build_rotation_matrix_3d_np(self.mount_euler)

        # De-bias
        a_deb = a_raw - self.accel_bias
        w_deb = w_raw - self.gyro_bias

        # 3D Rotate into vehicle chassis frame
        a_rot = R @ a_deb
        w_rot = R @ w_deb

        # Causal impulse bounding
        a_clipped = np.clip(a_rot, -self.accel_clip_mps2, self.accel_clip_mps2)

        out = x.copy()
        out[:3] = a_clipped
        out[3:6] = w_rot
        if len(x) >= 9:
            # Gravity vector rotated into vehicle frame
            out[6:9] = R @ x[6:9]

        return out.astype(np.float32)

    def condition_sequence(self, raw_seq_9ch: np.ndarray) -> np.ndarray:
        """
        Causally processes a continuous (9, N) stream sequentially from t=0.
        Maintains evolving bias state b_t across the full sequence.
        """
        C, N = raw_seq_9ch.shape
        out = np.zeros((C, N), dtype=np.float32)
        for t in range(N):
            out[:, t] = self.condition_sample(raw_seq_9ch[:, t], update_state=True)
        return out

    def condition_window(self, win_raw: np.ndarray) -> np.ndarray:
        """
        Conditions a raw (9, W) IMU window using current dynamic bias and mount state.
        (Called during live runtime step inference).
        """
        out = win_raw.copy().astype(np.float64)
        R = build_rotation_matrix_3d_np(self.mount_euler)

        # De-bias
        accel_deb = out[:3, :] - self.accel_bias[:, None]
        gyro_deb  = out[3:6, :] - self.gyro_bias[:, None]

        # 3D Rotate into vehicle chassis frame
        accel_rot = R @ accel_deb
        gyro_rot  = R @ gyro_deb

        # Causal impulse bounding
        accel_clipped = np.clip(accel_rot, -self.accel_clip_mps2, self.accel_clip_mps2)

        out[:3, :] = accel_clipped
        out[3:6, :] = gyro_rot
        if win_raw.shape[0] >= 9:
            out[6:9, :] = R @ out[6:9, :]

        return out.astype(np.float32)
