"""
Window Generator & Physically Consistent Data Augmentation for Closed-Loop Trajectory Rollouts.

Features:
- Slices 100 Hz canonical IMU and 20 Hz reference trajectories into fixed-length
  closed-loop rollout sequences.
- Physically Consistent 3D Augmentation:
  Correlated sensors (accel, gyro, orientation quaternion, world gravity-aligned accel)
  undergo mathematically exact joint SO(3) transformations.
- Invariant: Reference trajectory coordinates remain 100% pristine.
"""

import numpy as np
import torch
from torch.utils.data import Dataset
from .frame_transform import wrap_angle, quat_multiply, quat_to_rot_matrix, transform_body_to_gravity_aligned


class TrajectoryRolloutDataset(Dataset):
    """
    PyTorch Dataset providing closed-loop trajectory rollout sequences with physically consistent augmentations.
    """
    def __init__(self, samples: list, augment: bool = False, augment_config: dict = None):
        self.samples = samples
        self.augment = augment
        self.aug_cfg = augment_config or {}

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        item = self.samples[idx]

        imu_seq = np.copy(item['imu_seq'])          # Shape: (T_imu, 13)
        ref_enu = np.copy(item['ref_enu'])          # Shape: (T_pred, 3)
        ref_yaw = np.copy(item['ref_yaw'])          # Shape: (T_pred,)
        ref_qual = np.copy(item['ref_quality'])     # Shape: (T_pred,)
        ref_regime = np.copy(item['ref_regime'])    # Shape: (T_pred,)

        if self.augment:
            imu_seq = self._apply_physically_consistent_augmentation(imu_seq)

        return {
            'imu_seq': torch.from_numpy(imu_seq).float(),
            'ref_enu': torch.from_numpy(ref_enu).float(),
            'ref_yaw': torch.from_numpy(ref_yaw).float(),
            'ref_quality': torch.from_numpy(ref_qual).float(),
            'ref_regime': torch.from_numpy(ref_regime).long(),
            'session_id': item['session_id'],
            'physical_device_id': item['physical_device_id'],
            'participant_id': item['participant_id'],
            'placement': item.get('placement', 'HAND')
        }

    def _apply_physically_consistent_augmentation(self, imu_seq: np.ndarray) -> np.ndarray:
        """
        Applies mathematically rigorous, physically correlated 3D sensor perturbations:
        1. Joint SO(3) 3D Body Frame Rotation:
           Rotating the physical phone by R_aug rotates body accel and gyro, and updates
           quaternion q <- q * q_aug^*. World gravity-aligned accel is recomputed to ensure
           perfect kinematic consistency.
        2. Sensor biases: Constant 3D gyro bias b_g, constant 3D accel bias b_a.
        3. Sensor noise: High-frequency additive Gaussian noise.
        4. Linear scale calibration variation.
        """
        T = len(imu_seq)
        # imu_seq format:
        # [0:3]   ax_body, ay_body, az_body
        # [3:6]   gx_body, gy_body, gz_body
        # [6:9]   ag_x_world, ag_y_world, ag_z_world
        # [9:13]  qw, qx, qy, qz

        a_body = imu_seq[:, 0:3].copy()
        g_body = imu_seq[:, 3:6].copy()
        q_canon = imu_seq[:, 9:13].copy()

        # 1. Joint 3D Body Frame Rotation Perturbation
        max_deg = self.aug_cfg.get('body_rotation_perturb_deg', 5.0)
        if max_deg > 0:
            angles = np.radians(np.random.uniform(-max_deg, max_deg, 3))
            cx, cy, cz = np.cos(angles / 2.0)
            sx, sy, sz = np.sin(angles / 2.0)

            # q_aug: [qw, qx, qy, qz]
            q_aug = np.array([
                cx * cy * cz + sx * sy * sz,
                sx * cy * cz - cx * sy * sz,
                cx * sy * cz + sx * cy * sz,
                cx * cy * sz - sx * sy * cz
            ], dtype=np.float64)

            r_aug = quat_to_rot_matrix(q_aug)  # (3, 3)

            # Rotate body vectors: v_b' = R_aug * v_b
            a_body = a_body @ r_aug.T
            g_body = g_body @ r_aug.T

            # Update orientation quaternion: q_new = q * q_aug_conjugate
            q_aug_conj = np.array([q_aug[0], -q_aug[1], -q_aug[2], -q_aug[3]])
            q_canon = quat_multiply(q_canon, q_aug_conj)

        # 2. Recompute gravity-aligned world acceleration from consistent physics
        a_world = transform_body_to_gravity_aligned(a_body, q_canon)

        # 3. Additive Sensor Biases (constant drift per sequence)
        gyro_bias_std = self.aug_cfg.get('gyro_bias_std_rad_s', 0.002)
        if gyro_bias_std > 0:
            g_body += np.random.normal(0, gyro_bias_std, (1, 3))

        accel_bias_std = self.aug_cfg.get('accel_bias_std_m_s2', 0.02)
        if accel_bias_std > 0:
            a_body += np.random.normal(0, accel_bias_std, (1, 3))

        # 4. Sensor Scale Calibration Variation
        scale_min = self.aug_cfg.get('scale_variation_min', 0.98)
        scale_max = self.aug_cfg.get('scale_variation_max', 1.02)
        scale = np.random.uniform(scale_min, scale_max)
        a_body *= scale

        # 5. Additive White Gaussian Noise
        acc_noise = self.aug_cfg.get('accel_noise_std_m_s2', 0.03)
        if acc_noise > 0:
            a_body += np.random.normal(0, acc_noise, (T, 3))

        gyro_noise = self.aug_cfg.get('gyro_noise_std_rad_s', 0.001)
        if gyro_noise > 0:
            g_body += np.random.normal(0, gyro_noise, (T, 3))

        imu_seq[:, 0:3] = a_body
        imu_seq[:, 3:6] = g_body
        imu_seq[:, 6:9] = a_world
        imu_seq[:, 9:13] = q_canon

        return imu_seq


def classify_motion_regime(speed_mps: float, yaw_rate_rad_s: float, accel_mag: float) -> int:
    """
    Categorizes motion regime for multi-task auxiliary head:
    0: Stationary / Stopping
    1: Steady Walking
    2: Turning / Cornering
    3: Accelerating / Braking
    4: Irregular Handling / Dynamic Motion
    """
    if speed_mps < 0.2 and abs(accel_mag - 9.80665) < 0.5:
        return 0  # Stationary
    if abs(yaw_rate_rad_s) > 0.4:
        return 2  # Turning
    if abs(accel_mag - 9.80665) > 3.0:
        return 4  # Irregular / Dynamic
    if abs(accel_mag - 9.80665) > 1.2:
        return 3  # Accelerating / Decelerating
    return 1      # Steady Walking


def build_rollout_windows(
    sync_session: dict,
    session_id: str,
    physical_device_id: str,
    participant_id: str,
    rollout_steps: int = 200,
    stride_steps: int = 40,
    imu_hz: int = 100,
    pred_hz: int = 20,
    placement: str = "HAND"
) -> list:
    """
    Slices a synchronized session into fixed-length trajectory rollout chunks.
    """
    ratio = imu_hz // pred_hz
    imu_all = sync_session['imu_100hz']
    enu_all = sync_session['ref_enu_20hz']
    yaw_all = sync_session['ref_yaw_20hz']
    qual_all = sync_session['ref_quality_20hz']

    n_pred_total = len(enu_all)
    windows = []

    if n_pred_total < rollout_steps:
        return windows

    for start_p in range(0, n_pred_total - rollout_steps + 1, stride_steps):
        end_p = start_p + rollout_steps

        start_imu = start_p * ratio
        end_imu = end_p * ratio

        imu_chunk = imu_all[start_imu:end_imu]
        enu_chunk = enu_all[start_p:end_p].copy()
        yaw_chunk = yaw_all[start_p:end_p].copy()
        qual_chunk = qual_all[start_p:end_p].copy()

        if len(imu_chunk) != rollout_steps * ratio or len(enu_chunk) != rollout_steps:
            continue

        # Zero-center the position to anchor P0 of this window
        enu_chunk -= enu_chunk[0:1, :]

        dt = 1.0 / pred_hz
        de = np.diff(enu_chunk[:, 0], prepend=enu_chunk[0, 0])
        dn = np.diff(enu_chunk[:, 1], prepend=enu_chunk[0, 1])
        speed = np.sqrt(de**2 + dn**2) / dt
        dyaw = np.diff(yaw_chunk, prepend=yaw_chunk[0]) / dt

        regime_chunk = np.zeros(rollout_steps, dtype=np.int64)
        for t in range(rollout_steps):
            seg_accel = imu_chunk[t * ratio:(t + 1) * ratio, 0:3]
            acc_mag = np.mean(np.linalg.norm(seg_accel, axis=1)) if len(seg_accel) > 0 else 9.80665
            regime_chunk[t] = classify_motion_regime(speed[t], dyaw[t], acc_mag)

        windows.append({
            'imu_seq': imu_chunk.astype(np.float32),
            'ref_enu': enu_chunk.astype(np.float32),
            'ref_yaw': yaw_chunk.astype(np.float32),
            'ref_quality': qual_chunk.astype(np.float32),
            'ref_regime': regime_chunk.astype(np.int64),
            'session_id': session_id,
            'physical_device_id': physical_device_id,
            'participant_id': participant_id,
            'placement': placement
        })

    return windows
