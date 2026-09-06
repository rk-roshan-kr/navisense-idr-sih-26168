"""
Unit tests for SensorConditioner V2.2:
Tests synthetic stationary phone orientations (Identity, 90 deg pitch, 90 deg roll, compound Euler)
and verifies that de-biased conditioned forward/lateral acceleration converges to 0.0 m/s^2
and gyro converges to 0.0 rad/s.
"""

import sys, math
from pathlib import Path
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.models.sensor_conditioner import SensorConditioner, build_rotation_matrix_3d_np

def test_rotation_matrix_properties():
    # Orthogonality test: R @ R.T == I, det(R) == +1
    angles = [0.1, -0.4, 0.7]
    R = build_rotation_matrix_3d_np(np.array(angles))
    I = np.eye(3)
    np.testing.assert_allclose(R @ R.T, I, atol=1e-12)
    np.testing.assert_allclose(np.linalg.det(R), 1.0, atol=1e-12)
    print("PASS: Rotation matrix orthogonality & determinant.")

def run_stationary_adaptation_test(name: str, mount_euler: np.ndarray, true_bias_a: np.ndarray, true_bias_g: np.ndarray):
    g = 9.80665
    R = build_rotation_matrix_3d_np(mount_euler)
    # Expected stationary specific force in sensor frame
    a_sensor_clean = R.T @ np.array([0.0, 0.0, g])
    w_sensor_clean = np.array([0.0, 0.0, 0.0])

    # Corrupted sensor readings with synthetic hardware DC biases + small noise
    np.random.seed(42)
    N = 250  # 25 seconds of stationary data at 10 Hz
    noise_a = np.random.randn(3, N) * 0.005
    noise_w = np.random.randn(3, N) * 0.001

    a_sensor = a_sensor_clean[:, None] + true_bias_a[:, None] + noise_a
    w_sensor = w_sensor_clean[:, None] + true_bias_g[:, None] + noise_w
    grav_sensor = a_sensor_clean[:, None] + noise_a * 0.1

    raw_9ch = np.vstack([a_sensor, w_sensor, grav_sensor])

    conditioner = SensorConditioner(dt=0.1, alpha_bias=0.08)
    conditioner.set_mount_euler(mount_euler)

    # Sequentially condition the stationary sequence
    cond_seq = conditioner.condition_sequence(raw_9ch)

    # Check that after convergence (last 50 samples):
    # 1. Forward (ch 0) and lateral (ch 1) vehicle accelerations are close to 0
    # 2. Vertical (ch 2) vehicle acceleration is close to +g (contact reaction force)
    # 3. All gyros (ch 3-5) are close to 0
    cond_tail = cond_seq[:, -50:]
    mean_a_fwd = np.mean(cond_tail[0, :])
    mean_a_lat = np.mean(cond_tail[1, :])
    mean_a_vert = np.mean(cond_tail[2, :])
    mean_w = np.mean(cond_tail[3:6, :], axis=1)

    print(f"[{name}]")
    print(f"  True bias a: {true_bias_a.round(3)}, Estimated: {conditioner.accel_bias.round(3)}")
    print(f"  True bias w: {true_bias_g.round(4)}, Estimated: {conditioner.gyro_bias.round(4)}")
    print(f"  Tail mean forward accel: {mean_a_fwd:.4f} m/s^2 (Expected ~ 0.0)")
    print(f"  Tail mean lateral accel: {mean_a_lat:.4f} m/s^2 (Expected ~ 0.0)")
    print(f"  Tail mean vertical accel: {mean_a_vert:.4f} m/s^2 (Expected ~ {g:.3f})")
    print(f"  Tail mean gyro XYZ: {mean_w.round(4)} rad/s (Expected ~ 0.0)")

    assert abs(mean_a_fwd) < 0.02, f"Forward accel {mean_a_fwd} too large"
    assert abs(mean_a_lat) < 0.02, f"Lateral accel {mean_a_lat} too large"
    assert abs(mean_a_vert - g) < 0.05, f"Vertical accel {mean_a_vert} differs from g={g}"
    assert np.all(np.abs(mean_w) < 0.005), f"Gyro residual {mean_w} too large"
    print(f"PASS: {name}\n")

def main():
    print("=" * 70)
    print("  RUNNING SENSOR CONDITIONER ROTATION & DYNAMIC BIAS UNIT TESTS")
    print("=" * 70)
    test_rotation_matrix_properties()

    # 1. Identity Mount (Flat on console)
    run_stationary_adaptation_test(
        "1. Identity Mount (Flat)",
        mount_euler=np.array([0.0, 0.0, 0.0]),
        true_bias_a=np.array([0.15, -0.12, 0.08]),
        true_bias_g=np.array([0.012, -0.008, 0.015])
    )

    # 2. 90-degree Pitch (Upright windshield/dash mount)
    run_stationary_adaptation_test(
        "2. 90-deg Pitch (Upright Dash)",
        mount_euler=np.array([0.0, math.pi / 2.0, 0.0]),
        true_bias_a=np.array([-0.20, 0.10, -0.15]),
        true_bias_g=np.array([0.005, 0.010, -0.007])
    )

    # 3. 90-degree Roll (Landscape phone mount)
    run_stationary_adaptation_test(
        "3. 90-deg Roll (Landscape Mount)",
        mount_euler=np.array([math.pi / 2.0, 0.0, 0.0]),
        true_bias_a=np.array([0.10, -0.25, 0.05]),
        true_bias_g=np.array([-0.010, 0.004, 0.008])
    )

    # 4. Arbitrary Compound Euler Mount (Tilted portrait dash mount)
    run_stationary_adaptation_test(
        "4. Compound Euler Mount (Roll 15 deg, Pitch 45 deg, Yaw -10 deg)",
        mount_euler=np.radians(np.array([15.0, 45.0, -10.0])),
        true_bias_a=np.array([0.18, -0.14, 0.22]),
        true_bias_g=np.array([0.008, -0.012, 0.014])
    )

    print("=" * 70)
    print("ALL SENSOR CONDITIONER ROTATION & BIAS UNIT TESTS PASSED SUCCESSFULLY!")
    print("=" * 70)

if __name__ == "__main__":
    main()
