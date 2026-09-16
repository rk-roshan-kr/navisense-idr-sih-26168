"""
Strict Orientation & Coordinate Frame Transforms for NaviSense IDR.

Conventions:
1. Android Raw Rotation Vector: [qx, qy, qz, qw] (last element is scalar).
2. Canonical Internal Format:   [qw, qx, qy, qz] (scalar-first, normalized).
3. Antipodal Disambiguation:    If qw < 0, q <- -q (same SO(3) rotation).
4. Active World Frame Rotation: a_world = R(q) * a_body - [0, 0, g]^T
   where g = 9.80665 m/s^2 along the gravity down vector.
5. Navigation Frame Anchoring: R_{phone->nav} = R_{yaw}(psi_0) * R_{gravity}
   Anchored strictly at the initial trusted GNSS heading psi_0 (no future leak).
"""

import numpy as np


def android_to_canonical_quat(q_android: np.ndarray) -> np.ndarray:
    """
    Converts Android rotation vector quaternion [qx, qy, qz, qw]
    to canonical scalar-first unit quaternion [qw, qx, qy, qz].

    Enforces:
    - Unit norm ||q|| = 1
    - Canonical upper hemisphere qw >= 0 (resolving antipodal ambiguity)
    """
    q_android = np.asarray(q_android, dtype=np.float64)
    if q_android.shape[-1] == 4:
        # [qx, qy, qz, qw] -> [qw, qx, qy, qz]
        if q_android.ndim == 1:
            qw = q_android[3]
            qx, qy, qz = q_android[0], q_android[1], q_android[2]
            q = np.array([qw, qx, qy, qz], dtype=np.float64)
        else:
            qw = q_android[:, 3:4]
            qx_qy_qz = q_android[:, 0:3]
            q = np.hstack([qw, qx_qy_qz])
    elif q_android.shape[-1] == 3:
        norm_sq = np.sum(q_android**2, axis=-1, keepdims=True)
        qw = np.sqrt(np.clip(1.0 - norm_sq, 0.0, 1.0))
        q = np.hstack([qw, q_android])
    else:
        raise ValueError(f"Invalid quaternion shape: {q_android.shape}")

    # Normalize
    norm = np.linalg.norm(q, axis=-1, keepdims=True)
    norm = np.where(norm < 1e-12, 1.0, norm)
    q = q / norm

    # Antipodal disambiguation: qw >= 0
    if q.ndim == 1:
        if q[0] < 0.0:
            q = -q
    else:
        neg_mask = q[:, 0] < 0.0
        q[neg_mask] = -q[neg_mask]

    return q


def quat_to_rot_matrix(q: np.ndarray) -> np.ndarray:
    """
    Converts scalar-first unit quaternion [qw, qx, qy, qz] to 3x3 rotation matrix R.
    Supports single quaternion (shape: 4) or batch (shape: N, 4).
    """
    q = np.asarray(q, dtype=np.float64)
    if q.ndim == 1:
        qw, qx, qy, qz = q
        r00 = 1.0 - 2.0 * (qy**2 + qz**2)
        r01 = 2.0 * (qx * qy - qz * qw)
        r02 = 2.0 * (qx * qz + qy * qw)

        r10 = 2.0 * (qx * qy + qz * qw)
        r11 = 1.0 - 2.0 * (qx**2 + qz**2)
        r12 = 2.0 * (qy * qz - qx * qw)

        r20 = 2.0 * (qx * qz - qy * qw)
        r21 = 2.0 * (qy * qz + qx * qw)
        r22 = 1.0 - 2.0 * (qx**2 + qy**2)

        return np.array([[r00, r01, r02],
                         [r10, r11, r12],
                         [r20, r21, r22]], dtype=np.float64)
    else:
        qw = q[:, 0]
        qx = q[:, 1]
        qy = q[:, 2]
        qz = q[:, 3]

        r00 = 1.0 - 2.0 * (qy**2 + qz**2)
        r01 = 2.0 * (qx * qy - qz * qw)
        r02 = 2.0 * (qx * qz + qy * qw)

        r10 = 2.0 * (qx * qy + qz * qw)
        r11 = 1.0 - 2.0 * (qx**2 + qz**2)
        r12 = 2.0 * (qy * qz - qx * qw)

        r20 = 2.0 * (qx * qz - qy * qw)
        r21 = 2.0 * (qy * qz + qx * qw)
        r22 = 1.0 - 2.0 * (qx**2 + qy**2)

        r = np.stack([
            np.stack([r00, r01, r02], axis=-1),
            np.stack([r10, r11, r12], axis=-1),
            np.stack([r20, r21, r22], axis=-1)
        ], axis=-2)
        return r


def quat_multiply(q1: np.ndarray, q2: np.ndarray) -> np.ndarray:
    """
    Computes quaternion product q = q1 * q2 for scalar-first quaternions [qw, qx, qy, qz].
    """
    w1, x1, y1, z1 = q1[..., 0], q1[..., 1], q1[..., 2], q1[..., 3]
    w2, x2, y2, z2 = q2[..., 0], q2[..., 1], q2[..., 2], q2[..., 3]

    w = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    x = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2
    y = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2
    z = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2

    res = np.stack([w, x, y, z], axis=-1)
    norm = np.linalg.norm(res, axis=-1, keepdims=True)
    norm = np.where(norm < 1e-12, 1.0, norm)
    res = res / norm
    return res


def transform_body_to_gravity_aligned(
    accel_body: np.ndarray,
    quat_canonical: np.ndarray,
    gravity_m_s2: float = 9.80665,
    initial_yaw_rad: float = None
) -> np.ndarray:
    """
    Transforms body acceleration into gravity-aligned frame, with optional initial heading anchor.
    R_{phone->nav} = R_yaw(psi_0) * R_gravity

    Parameters:
        accel_body: (N, 3) body accelerations.
        quat_canonical: (N, 4) canonical scalar-first quaternions.
        gravity_m_s2: 9.80665 m/s^2.
        initial_yaw_rad: (Optional) Initial trusted heading angle psi_0 from GNSS.
                         Anchors horizontal frame at t=0 without leaking future heading.
    """
    accel_body = np.asarray(accel_body, dtype=np.float64)
    quat_canonical = np.asarray(quat_canonical, dtype=np.float64)

    r = quat_to_rot_matrix(quat_canonical)

    if accel_body.ndim == 1:
        a_world = r @ accel_body
        a_world[2] -= gravity_m_s2
        if initial_yaw_rad is not None:
            c = np.cos(initial_yaw_rad)
            s = np.sin(initial_yaw_rad)
            r_z0 = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)
            a_world = r_z0 @ a_world
        return a_world
    else:
        a_world = np.einsum('nij,nj->ni', r, accel_body)
        a_world[:, 2] -= gravity_m_s2
        if initial_yaw_rad is not None:
            c = np.cos(initial_yaw_rad)
            s = np.sin(initial_yaw_rad)
            r_z0 = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)
            a_world = np.einsum('ij,nj->ni', r_z0, a_world)
        return a_world


def quat_to_yaw_heading(quat_canonical: np.ndarray) -> np.ndarray:
    """
    Extracts yaw heading angle (radians, [-pi, pi]) from canonical quaternion.
    """
    quat_canonical = np.asarray(quat_canonical, dtype=np.float64)
    if quat_canonical.ndim == 1:
        qw, qx, qy, qz = quat_canonical
        yaw = np.arctan2(2.0 * (qw * qz + qx * qy), 1.0 - 2.0 * (qy**2 + qz**2))
        return float(yaw)
    else:
        qw = quat_canonical[:, 0]
        qx = quat_canonical[:, 1]
        qy = quat_canonical[:, 2]
        qz = quat_canonical[:, 3]
        return np.arctan2(2.0 * (qw * qz + qx * qy), 1.0 - 2.0 * (qy**2 + qz**2))


def wrap_angle(angle_rad: np.ndarray) -> np.ndarray:
    """Wraps angle difference to [-pi, pi]."""
    return (angle_rad + np.pi) % (2.0 * np.pi) - np.pi
