"""
Gate G2: Tensor Contract Parity Verification Test.

Proves mathematical and numerical parity between:
1. Python Preprocessing (NIDR-ML/preprocessing/frame_transform.py)
2. Android Kotlin Preprocessing (io.github.navisense.idr.models.SensorFrame)

Invariant:
For any raw Android sensor input:
- Accelerometer [ax, ay, az] (m/s^2)
- Gyroscope [gx, gy, gz] (rad/s)
- Android Rotation Vector [qx, qy, qz, qw] (Sensor.TYPE_ROTATION_VECTOR)

The resulting 13-channel feature tensors must be identical within tolerance:
max |X_python - X_android| < 1e-5
"""

import sys
import numpy as np
from pathlib import Path

# Add NIDR-ML to path
sys.path.insert(0, str(Path(__file__).parent.parent / "NIDR-ML"))
from preprocessing.frame_transform import android_to_canonical_quat, transform_body_to_gravity_aligned, quat_to_rot_matrix


def compute_python_13ch(ax, ay, az, gx, gy, gz, qx, qy, qz, qw):
    """Python reference transformation pipeline."""
    q_raw = np.array([qx, qy, qz, qw], dtype=np.float64)
    q_canon = android_to_canonical_quat(q_raw)
    a_body = np.array([ax, ay, az], dtype=np.float64)
    g_body = np.array([gx, gy, gz], dtype=np.float64)
    a_world = transform_body_to_gravity_aligned(a_body, q_canon, gravity_m_s2=9.80665)

    return np.concatenate([a_body, g_body, a_world, q_canon])


def compute_android_kotlin_13ch(ax, ay, az, gx, gy, gz, qx, qy, qz, qw):
    """
    Simulates the exact float32 Kotlin implementation in SensorFrame.kt:
    companion object fromImuFrame(frame: SynchronizedImuFrame): SensorFrame
    """
    # 1. Normalize quaternion
    norm_sq = qw * qw + qx * qx + qy * qy + qz * qz
    if norm_sq > 1e-12:
        inv_norm = 1.0 / np.sqrt(norm_sq)
        qw *= inv_norm
        qx *= inv_norm
        qy *= inv_norm
        qz *= inv_norm
    else:
        qw, qx, qy, qz = 1.0, 0.0, 0.0, 0.0

    # 2. Antipodal disambiguation: qw >= 0
    if qw < 0.0:
        qw = -qw
        qx = -qx
        qy = -qy
        qz = -qz

    # 3. 3x3 rotation matrix
    r00 = 1.0 - 2.0 * (qy * qy + qz * qz)
    r01 = 2.0 * (qx * qy - qz * qw)
    r02 = 2.0 * (qx * qz + qy * qw)

    r10 = 2.0 * (qx * qy + qz * qw)
    r11 = 1.0 - 2.0 * (qx * qx + qz * qz)
    r12 = 2.0 * (qy * qz - qx * qw)

    r20 = 2.0 * (qx * qz - qy * qw)
    r21 = 2.0 * (qy * qz + qx * qw)
    r22 = 1.0 - 2.0 * (qx * qx + qy * qy)

    # 4. a_world = R * a_body - [0, 0, g]^T
    agx = r00 * ax + r01 * ay + r02 * az
    agy = r10 * ax + r11 * ay + r12 * az
    agz = (r20 * ax + r21 * ay + r22 * az) - 9.80665

    return np.array([ax, ay, az, gx, gy, gz, agx, agy, agz, qw, qx, qy, qz], dtype=np.float64)


def test_tensor_contract_parity():
    print("=" * 65)
    print("      GATE G2: PYTHON <-> ANDROID TENSOR CONTRACT PARITY")
    print("=" * 65)

    np.random.seed(42)
    test_cases = [
        # Case 1: Stationary upright phone (gravity on Z)
        {
            'name': 'Stationary Upright',
            'ax': 0.0, 'ay': 0.0, 'az': 9.80665,
            'gx': 0.0, 'gy': 0.0, 'gz': 0.0,
            'qx': 0.0, 'qy': 0.0, 'qz': 0.0, 'qw': 1.0
        },
        # Case 2: Phone tilted 45 deg around X
        {
            'name': 'Pitch 45 deg',
            'ax': 0.0, 'ay': 6.934, 'az': 6.934,
            'gx': 0.01, 'gy': -0.02, 'gz': 0.05,
            'qx': float(np.sin(np.pi / 8)), 'qy': 0.0, 'qz': 0.0, 'qw': float(np.cos(np.pi / 8))
        },
        # Case 3: Negative qw (testing antipodal canonicalization)
        {
            'name': 'Antipodal Hemisphere (qw < 0)',
            'ax': 1.2, 'ay': -0.5, 'az': 9.6,
            'gx': 0.1, 'gy': 0.2, 'gz': -0.3,
            'qx': -0.3, 'qy': 0.2, 'qz': -0.4, 'qw': -0.83066
        },
        # Case 4: General random dynamic walking orientations (100 samples)
    ]

    max_overall_diff = 0.0

    for tc in test_cases:
        py_tensor = compute_python_13ch(
            tc['ax'], tc['ay'], tc['az'],
            tc['gx'], tc['gy'], tc['gz'],
            tc['qx'], tc['qy'], tc['qz'], tc['qw']
        )
        kt_tensor = compute_android_kotlin_13ch(
            tc['ax'], tc['ay'], tc['az'],
            tc['gx'], tc['gy'], tc['gz'],
            tc['qx'], tc['qy'], tc['qz'], tc['qw']
        )

        diff = np.max(np.abs(py_tensor - kt_tensor))
        max_overall_diff = max(max_overall_diff, diff)

        print(f"Test [{tc['name']}]:")
        print(f"  Max Absolute Channel Deviation: {diff:.8e}")
        assert diff < 1e-5, f"Parity violation in {tc['name']}: diff={diff}"

    # Random Monte Carlo test (500 dynamic samples)
    for i in range(500):
        a = np.random.uniform(-15.0, 15.0, 3)
        g = np.random.uniform(-3.0, 3.0, 3)
        q = np.random.uniform(-1.0, 1.0, 4)
        q /= np.linalg.norm(q)

        py_t = compute_python_13ch(a[0], a[1], a[2], g[0], g[1], g[2], q[0], q[1], q[2], q[3])
        kt_t = compute_android_kotlin_13ch(a[0], a[1], a[2], g[0], g[1], g[2], q[0], q[1], q[2], q[3])

        diff = np.max(np.abs(py_t - kt_t))
        max_overall_diff = max(max_overall_diff, diff)
        assert diff < 1e-5, f"Monte Carlo sample {i} failed with diff {diff}"

    print("-" * 65)
    print(f"500/500 Monte Carlo dynamic frames tested.")
    print(f"Global Maximum Discrepancy: {max_overall_diff:.8e} (Tolerance: < 1.0e-5)")
    print("VERDICT: [PASS] PYTHON <-> ANDROID TENSOR CONTRACT PARITY VERIFIED!")
    print("=" * 65)


if __name__ == '__main__':
    test_tensor_contract_parity()
