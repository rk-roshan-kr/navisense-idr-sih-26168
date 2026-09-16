"""
Deterministic Closed-Form Physics Unit Tests for NaviSense IDR Rollout Engine.

Validates coordinate transformation, yaw accumulation, ENU projection, and trajectory
propagation independently of ML models against exact analytical solutions:

Test 1: Straight North (1 m/s, 40s, heading = 0)         -> Target: [0, 40, 0]
Test 2: Straight East  (1 m/s, 40s, heading = π/2)       -> Target: [40, 0, 0]
Test 3: Straight South (1 m/s, 40s, heading = π)         -> Target: [0, -40, 0]
Test 4: Straight West  (1 m/s, 40s, heading = -π/2)      -> Target: [-40, 0, 0]
Test 5: 90° Left Turn  (20s North + turn + 20s West)     -> Target: [-20, 20, 0]
Test 6: 90° Right Turn (20s North + turn + 20s East)     -> Target: [20, 20, 0]
Test 7: Full Circle    (40s constant turn rate 2π/40)    -> Target: [0, 0, 0]
Test 8: Stationary     (40s zero motion)                 -> Target: [0, 0, 0]
"""

import sys
import numpy as np
import torch
from pathlib import Path

# Add project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from training.rollout import propagate_trajectory_closed_loop


def run_all_deterministic_physics_tests():
    dt = 0.05       # 20 Hz prediction steps
    T_steps = 800   # 40.0 seconds
    speed = 1.0     # 1.0 m/s
    step_fwd = speed * dt  # 0.05m per step

    tests_passed = 0
    total_tests = 8

    print("\n" + "=" * 70)
    print("      DETERMINISTIC PHYSICS & ROLLOUT COORDINATE UNIT TESTS")
    print("=" * 70)

    # -------------------------------------------------------------
    # Test 1: Straight North (heading ψ = 0)
    # -------------------------------------------------------------
    disp = torch.zeros(1, T_steps, 3)
    disp[0, :, 0] = step_fwd
    dyaw = torch.zeros(1, T_steps)
    init_yaw = torch.tensor([0.0])  # North

    p, _ = propagate_trajectory_closed_loop(disp, dyaw, initial_yaw=init_yaw)
    end_pt = p[0, -1].numpy()
    target = np.array([0.0, 40.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 1 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 1: Straight North 40m -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 2: Straight East (heading ψ = π/2)
    # -------------------------------------------------------------
    init_yaw = torch.tensor([np.pi / 2.0])  # East
    p, _ = propagate_trajectory_closed_loop(disp, dyaw, initial_yaw=init_yaw)
    end_pt = p[0, -1].numpy()
    target = np.array([40.0, 0.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 2 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 2: Straight East 40m  -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 3: Straight South (heading ψ = π)
    # -------------------------------------------------------------
    init_yaw = torch.tensor([np.pi])  # South
    p, _ = propagate_trajectory_closed_loop(disp, dyaw, initial_yaw=init_yaw)
    end_pt = p[0, -1].numpy()
    target = np.array([0.0, -40.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 3 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 3: Straight South 40m -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 4: Straight West (heading ψ = -π/2)
    # -------------------------------------------------------------
    init_yaw = torch.tensor([-np.pi / 2.0])  # West
    p, _ = propagate_trajectory_closed_loop(disp, dyaw, initial_yaw=init_yaw)
    end_pt = p[0, -1].numpy()
    target = np.array([-40.0, 0.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 4 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 4: Straight West 40m  -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 5: 90° Left Turn (20s North, then 90° turn left to West for 20s)
    # -------------------------------------------------------------
    disp5 = torch.zeros(1, T_steps, 3)
    disp5[0, :, 0] = step_fwd
    dyaw5 = torch.zeros(1, T_steps)
    # Turn at step index 399 so rotation applies to steps [400, 800)
    dyaw5[0, 399] = -np.pi / 2.0

    p, _ = propagate_trajectory_closed_loop(disp5, dyaw5, initial_yaw=torch.tensor([0.0]))
    end_pt = p[0, -1].numpy()
    target = np.array([-20.0, 20.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 5 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 5: 90° Left Turn (North->West) -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 6: 90° Right Turn (20s North, then 90° turn right to East for 20s)
    # -------------------------------------------------------------
    disp6 = torch.zeros(1, T_steps, 3)
    disp6[0, :, 0] = step_fwd
    dyaw6 = torch.zeros(1, T_steps)
    dyaw6[0, 399] = np.pi / 2.0

    p, _ = propagate_trajectory_closed_loop(disp6, dyaw6, initial_yaw=torch.tensor([0.0]))
    end_pt = p[0, -1].numpy()
    target = np.array([20.0, 20.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    assert err < 1e-4, f"Test 6 Failed: Got {end_pt}, expected {target}, err={err}"
    print(f"[PASS] Test 6: 90° Right Turn (North->East) -> Result: {end_pt[:2]} (Err: {err:.6f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 7: Full 40s Circular Trajectory (Constant yaw rate 2π / 40s)
    # -------------------------------------------------------------
    disp7 = torch.zeros(1, T_steps, 3)
    disp7[0, :, 0] = step_fwd
    # Angular increment per step = (2π / 40s) * dt = 2π / T_steps
    omega_step = 2.0 * np.pi / T_steps
    dyaw7 = torch.full((1, T_steps), omega_step)

    p, _ = propagate_trajectory_closed_loop(disp7, dyaw7, initial_yaw=torch.tensor([0.0]))
    end_pt = p[0, -1].numpy()
    target = np.array([0.0, 0.0, 0.0])
    err = np.linalg.norm(end_pt - target)
    # Discretization error for numerical integration around a circle with dt=0.05s
    assert err < 0.25, f"Test 7 Failed: Got {end_pt}, expected return to start, err={err}"
    print(f"[PASS] Test 7: Full Circle Return -> Result: {end_pt[:2]} (Closure Error: {err:.4f}m)")
    tests_passed += 1

    # -------------------------------------------------------------
    # Test 8: Stationary (Speed = 0 for 40s)
    # -------------------------------------------------------------
    disp8 = torch.zeros(1, T_steps, 3)
    dyaw8 = torch.zeros(1, T_steps)
    p, _ = propagate_trajectory_closed_loop(disp8, dyaw8, initial_yaw=torch.tensor([0.0]))
    end_pt = p[0, -1].numpy()
    err = np.linalg.norm(end_pt)
    assert err == 0.0, f"Test 8 Failed: Got {end_pt}, expected strictly 0"
    print(f"[PASS] Test 8: Stationary Hold 40s -> Result: {end_pt[:2]} (Err: 0.000000m)")
    tests_passed += 1

    print("-" * 70)
    print(f"ALL {tests_passed}/{total_tests} DETERMINISTIC PHYSICS TESTS PASSED PERFECTLY!")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    run_all_deterministic_physics_tests()
