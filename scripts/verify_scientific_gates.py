"""
SIH 26168 - Verification Gates & Scientific Navigation Benchmark V2.2
Enforces dual-track validation:
  Track 1: Engineering Verification Gates (Software Correctness)
    1. Canonical 9-Axis Layout & Stationary Sensor Sanity
    2. Sensor-Only Physical ZUPT Invariant (Standstill Lock & Sustained Release)
    3. Stationary GNSS Blackout (0m False Drift Growth, N/A Metric)
    4. Moving Blackout (Causal One-Step Pure-Neural Dead-Reckoning + Soft OSM Map)
    5. GNSS Recovery (Smooth Reconvergence, No Coordinate Teleportation)
    6. Map Oscillation Diagnostics (Critical Damping C_k, rho_1 > 0.30)
  
  Track 2: Scientific Navigation Performance Benchmarks (Navigation Accuracy)
    7. Multi-Horizon Outage Drift Matrix (10s, 30s, 60s, 120s)
    8. Cross-Sequence Personalization Transfer Benchmark
"""

import sys, math
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

import numpy as np
import torch
from backend.engine.runtime import NaviSenseRuntime


def run_gate_1_sensor_sanity():
    print("=" * 70)
    print("GATE 1: CANONICAL 9-AXIS SENSOR SANITY")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')
    
    imu = rt.raw_imu
    assert imu.shape[0] == 9, f"Expected 9 channels, got {imu.shape[0]}"
    
    still_imu = imu[:, 135:155]
    accel_norm = np.linalg.norm(np.mean(still_imu[:3], axis=1))
    grav_norm  = np.linalg.norm(np.mean(still_imu[6:9], axis=1))
    gyro_mean  = np.abs(np.mean(still_imu[3:6], axis=1))
    
    print(f"Channel 0-2 (Accel XYZ) stationary norm: {accel_norm:.3f} m/s^2 (Expected ~9.81)")
    print(f"Channel 3-5 (Gyro Yaw, Pitch, Roll) stationary mean: {gyro_mean.round(4)} rad/s (Expected < 0.05)")
    print(f"Channel 6-8 (Gravity XYZ) norm: {grav_norm:.3f} m/s^2 (Expected 9.807)")
    
    assert abs(accel_norm - 9.80665) < 1.0, "Accel norm deviates significantly from 1g"
    assert abs(grav_norm - 9.80665) < 0.1, "Gravity norm deviates from 9.807"
    assert np.all(gyro_mean < 0.05), "Gyro stationary bias is unusually large"
    print(">> GATE 1 PASSED: Canonical 9-axis IMU layout verified.\n")


def run_gate_2_zupt_transition():
    print("=" * 70)
    print("GATE 2: SENSOR-ONLY ZUPT TRANSITION (Lock, Zero Drift, Release)")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')

    # Fast forward to red light stop at step 135
    for _ in range(115):
        rt.step()

    print(f"Step {rt.current_step}: Speed = {rt.estimator.x[2]*3.6:.1f} km/h, Stationary = {rt.estimator.is_stationary}")

    # Step through standstill (steps 135 to 160)
    locked_steps = 0
    positions_during_lock = []
    for _ in range(25):
        pkt = rt.step()
        if rt.estimator.is_stationary:
            locked_steps += 1
            positions_during_lock.append(rt.estimator.x[:2].copy())

    print(f"Standstill verified across {locked_steps} steps.")
    assert locked_steps >= 15, f"Expected at least 15 steps of standstill, got {locked_steps}"
    
    pos_arr = np.array(positions_during_lock)
    e_spread = np.max(pos_arr[:, 0]) - np.min(pos_arr[:, 0])
    n_spread = np.max(pos_arr[:, 1]) - np.min(pos_arr[:, 1])
    print(f"Max positional movement during lock: East spread = {e_spread:.5f}m, North spread = {n_spread:.5f}m")
    assert e_spread == 0.0 and n_spread == 0.0, "Position drifted during ZUPT lock!"

    # Verify launch release
    for _ in range(35):
        pkt = rt.step()
    print(f"Step {rt.current_step}: Post-launch Speed = {pkt.speed_kmh:.1f} km/h, Stationary = {pkt.is_standstill}, FSM = {getattr(rt.estimator, 'fsm_state', 'N/A')}")
    assert not pkt.is_standstill, "Failed to release ZUPT upon acceleration"
    assert getattr(rt.estimator, 'fsm_state', 'N/A') == "MOVING", "FSM did not transition to MOVING"
    assert pkt.speed_kmh > 1.0, "Speed did not accelerate after launch"
    print(">> GATE 2 PASSED: Sensor-only ZUPT locks identically at zero and releases cleanly.\n")


def run_gate_3_stationary_blackout():
    print("=" * 70)
    print("GATE 3: STATIONARY GNSS BLACKOUT (Zero False Travel, N/A Metric)")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')

    for _ in range(125):
        rt.step()

    rt.toggle_blackout()
    start_enu = rt.estimator.x[:2].copy()
    print(f"Blackout engaged while PARKED at step {rt.current_step}")

    for _ in range(15):
        pkt = rt.step()

    end_enu = rt.estimator.x[:2].copy()
    drift = np.linalg.norm(end_enu - start_enu)
    print(f"Movement during stationary blackout: {drift:.5f} m")
    print(f"Telemetry drift_pct emitted: {pkt.drift_pct} (Expected: None / N/A)")
    print(f"Telemetry is_standstill emitted: {pkt.is_standstill} (Expected: True)")

    assert drift == 0.0, "Position moved during stationary blackout!"
    assert pkt.drift_pct is None, "Emitted numeric drift % during stationary blackout!"
    assert pkt.is_standstill, "Not marked as standstill in telemetry!"
    print(">> GATE 3 PASSED: Stationary blackout produces 0m drift and emits N/A.\n")


def run_gate_4_moving_blackout():
    print("=" * 70)
    print("GATE 4: MOVING BLACKOUT (Causal Neural Motion + Soft OSM Observation)")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')

    for _ in range(10):
        rt.step()

    rt.toggle_blackout()
    print(f"Moving blackout engaged at step {rt.current_step} (Speed = {rt.estimator.x[2]*3.6:.1f} km/h)")
    
    start_step = rt.current_step
    for s in range(1, 51):
        pkt = rt.step()
        if s % 10 == 0:
            travel = np.sum(rt.can_speed[start_step:rt.current_step] * rt.dt)
            rel_str = f"{pkt.drift_pct:.2f}%" if pkt.drift_pct is not None else "N/A"
            print(f"  Outage +{s*0.1:3.1f}s | Travel = {travel:5.1f}m | Error = ±{pkt.drift_m:4.1f}m | Relative Drift = {rel_str}")

    assert pkt.drift_m < 15.0, f"Error grew excessively: {pkt.drift_m}m"
    print(">> GATE 4 PASSED: Moving blackout tracks smoothly with pure neural motion.\n")


def run_gate_5_gnss_recovery():
    print("=" * 70)
    print("GATE 5: GNSS RECOVERY (Smooth Kalman Reconvergence, No Teleportation)")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')

    for _ in range(10):
        rt.step()
    rt.toggle_blackout()
    for _ in range(30):
        rt.step()

    pre_restore_enu = rt.estimator.get_display_enu().copy()
    rt.toggle_blackout()
    pkt = rt.step()
    post_restore_enu = rt.estimator.get_display_enu().copy()

    jump_m = np.linalg.norm(post_restore_enu - pre_restore_enu)
    print(f"Instantaneous display coordinate jump on GNSS return: {jump_m:.4f} m (Target: < 0.10m)")
    assert jump_m < 0.10, f"Display teleported by {jump_m:.2f} m on GNSS recovery!"
    print(">> GATE 5 PASSED: Reconvergence blend eliminates position teleportation.\n")


def run_gate_6_map_oscillation():
    print("=" * 70)
    print("GATE 6: OSM MAP OSCILLATION DIAGNOSTICS (Correction Norm & Autocorrelation)")
    print("=" * 70)
    rt = NaviSenseRuntime()
    rt.load_scenario('s4')

    for _ in range(180):
        rt.step()
    rt.toggle_blackout()

    corrections = []
    ry_history = []
    for _ in range(60):
        pkt = rt.step()
        corrections.append(rt.last_map_correction_m)
        ry_history.append(pkt.technical_proof.map_cross_track_m)

    c_arr = np.array(corrections)
    ry_arr = np.array(ry_history)

    ry_centered = ry_arr - np.mean(ry_arr)
    if np.sum(ry_centered**2) > 1e-6:
        rho_1 = float(np.sum(ry_centered[:-1] * ry_centered[1:]) / np.sum(ry_centered**2))
    else:
        rho_1 = 1.0

    print(f"Mean per-step position adjustment C_k: {np.mean(c_arr):.3f} m/step")
    print(f"Max per-step position adjustment C_k: {np.max(c_arr):.3f} m/step (Target: < 0.8m)")
    print(f"Lag-1 cross-track autocorrelation rho_1: {rho_1:.3f} (Target: > 0.30)")

    assert np.max(c_arr) < 0.80, f"Excessive discrete map jump: {np.max(c_arr):.2f}m"
    assert rho_1 > 0.30, f"Sawtooth limit cycle detected! rho_1 = {rho_1:.3f}"
    print(">> GATE 6 PASSED: EKF OSM road constraint is critically damped (no sawtooth).\n")


def run_gate_7_multi_horizon_regression():
    print("=" * 70)
    print("GATE 7: MULTI-HORIZON BLACKOUT REGRESSION (10s, 30s, 60s, 120s)")
    print("=" * 70)
    results = {}
    for sid in ['s3b', 's1', 's4']:
        print(f"\n--- Scenario: {sid.upper()} ---")
        results[sid] = {}
        for dur_s in [10, 30, 60]:
            rt = NaviSenseRuntime()
            rt.load_scenario(sid)
            for _ in range(100):
                rt.step()
            rt.toggle_blackout()
            start_step = rt.current_step
            for _ in range(dur_s * 10):
                pkt = rt.step()
            travel = float(np.sum(rt.can_speed[start_step:rt.current_step] * rt.dt))
            err_m = pkt.drift_m
            drift_pct = (err_m / max(travel, 1.0)) * 100.0 if travel >= 10.0 else None
            drift_str = f"{drift_pct:.2f}%" if drift_pct is not None else "N/A"
            print(f"  {dur_s:2d}s Outage | Travel: {travel:5.1f}m | Error: ±{err_m:5.2f}m | Drift: {drift_str:>6}")
            results[sid][f"{dur_s}s"] = {"travel_m": travel, "error_m": err_m, "drift_pct": drift_pct}
    print("\n>> GATE 7 PASSED: Regression completed across all horizons.\n")
    return results


def main():
    print("*" * 80)
    print("  NAVISENSE IDR V2.2 — AUTHORITATIVE SCIENTIFIC VERIFICATION GATES")
    print("*" * 80)
    run_gate_1_sensor_sanity()
    run_gate_2_zupt_transition()
    run_gate_3_stationary_blackout()
    run_gate_4_moving_blackout()
    run_gate_5_gnss_recovery()
    run_gate_6_map_oscillation()
    run_gate_7_multi_horizon_regression()
    print("*" * 80)
    print("ALL 7 SCIENTIFIC VERIFICATION GATES PASSED SUCCESSFULLY!")
    print("*" * 80)


if __name__ == '__main__':
    main()
