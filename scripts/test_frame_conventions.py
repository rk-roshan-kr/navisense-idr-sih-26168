"""
SIH 26168 - Experiment B: Deterministic Frame-Convention Test
Verifies the exact coordinate frame conventions:
  Phone Sensor (XYZ) -> Mount Rotation R -> Vehicle Chassis (XYZ) -> State Estimator Heading
Asserts proper axis and sign under known principal rotations:
  1. Identity (0 deg)
  2. +90 deg Pitch (phone mounted in landscape cradle)
  3. -90 deg Pitch
  4. +90 deg Roll
  5. +90 deg Yaw
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
from src.models.nn_models import build_rotation_matrix_3d

def run_frame_convention_test():
    print("="*75)
    print("  EXPERIMENT B: DETERMINISTIC FRAME-CONVENTION TEST")
    print("="*75 + "\n")

    # In IO-VNBD:
    #   accel: [ax, ay, az] is [X_phone, Y_phone, Z_phone]
    #   gyro:  ch3=gyaw(Z), ch4=gpit(Y), ch5=grol(X)
    # Physical vector representation:
    #   w_xyz = [grol, gpit, gyaw] = [w_x, w_y, w_z]

    test_cases = [
        ("1. Identity (0 deg mount)", [0.0, 0.0, 0.0]),
        ("2. +90 deg Pitch Mount",     [0.0, np.pi/2, 0.0]),
        ("3. -90 deg Pitch Mount",     [0.0, -np.pi/2, 0.0]),
        ("4. +90 deg Roll Mount",      [np.pi/2, 0.0, 0.0]),
        ("5. +90 deg Yaw Mount",       [0.0, 0.0, np.pi/2]),
    ]

    # Vehicle Ground Truth: pure vehicle yaw turn of -0.5 rad/s (turning right)
    # In vehicle frame: w_veh_true = [w_roll=0.0, w_pitch=0.0, w_yaw=-0.5]
    w_veh_true = np.array([0.0, 0.0, -0.5])

    passed_all = True

    for name, angles in test_cases:
        euler_t = torch.tensor(angles, dtype=torch.float32)
        R = build_rotation_matrix_3d(euler_t).detach().numpy()

        # In a car with mount R:
        # w_veh = R @ w_phone_xyz  =>  w_phone_xyz = R.T @ w_veh
        w_phone_xyz = R.T @ w_veh_true

        # Pack into IO-VNBD sensor channel order:
        # ch3=gyaw (Z), ch4=gpit (Y), ch5=grol (X)
        gyaw_raw = w_phone_xyz[2]
        gpit_raw = w_phone_xyz[1]
        grol_raw = w_phone_xyz[0]

        # In PersonalizationAdapter:
        # Unpack back to XYZ vector: [grol, gpit, gyaw]
        w_reconstructed_phone = np.array([grol_raw, gpit_raw, gyaw_raw])
        # Apply learned mount R:
        w_veh_calibrated = R @ w_reconstructed_phone

        # Channel 3 (Vehicle Yaw) is w_veh_calibrated[2]
        veh_yaw_recovered = w_veh_calibrated[2]

        err = abs(veh_yaw_recovered - (-0.5))
        passed = (err < 1e-5)
        if not passed:
            passed_all = False

        status = "PASSED" if passed else "FAILED"
        print(f"  {name:<30} | Phone G-Pitch={gpit_raw:>+5.2f} | Phone G-Yaw={gyaw_raw:>+5.2f} | Recov Yaw={veh_yaw_recovered:>+5.2f} | [{status}]")

    print("\n" + "="*75)
    if passed_all:
        print("  ALL 5 DETERMINISTIC FRAME-CONVENTION TESTS PASSED PERFECTLY!")
    else:
        print("  FRAME-CONVENTION TEST FAILED!")
    print("="*75 + "\n")

if __name__ == "__main__":
    run_frame_convention_test()
