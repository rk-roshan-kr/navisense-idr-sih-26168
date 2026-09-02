"""
SIH 26168 - Baseline B1: Raw Strapdown Inertial Navigation System (INS)
Implements a physically rigorous strapdown mechanization:
1. Gyro integration -> Attitude propagation (DCM R_b^n)
2. Body acceleration -> Navigation frame acceleration (a_n = R_b^n * a_b - g_n)
3. Integration -> Velocity (v_n)
4. Integration -> Position (p_n)

Demonstrates the unconstrained quadratic drift explosion inherent to MEMS double integration.
"""

import numpy as np
from src.core.coordinate_frames import propagate_attitude_dcm, euler_to_dcm, STANDARD_GRAVITY


class RawStrapdownINS:
    def __init__(self, initial_pos_enu, initial_vel_enu, initial_heading_deg, initial_pitch_deg=0.0, initial_roll_deg=0.0):
        self.pos_enu = np.array(initial_pos_enu, dtype=np.float64)
        self.vel_enu = np.array(initial_vel_enu, dtype=np.float64)
        
        yaw_enu_rad = np.radians(90.0 - initial_heading_deg)
        pitch_rad = np.radians(initial_pitch_deg)
        roll_rad = np.radians(initial_roll_deg)
        
        self.dcm_b2n = euler_to_dcm(roll_rad, pitch_rad, yaw_enu_rad)
        self.g_nav = np.array([0.0, 0.0, -STANDARD_GRAVITY], dtype=np.float64)

    def update(self, accel_b, gyro_b, dt):
        accel_b = np.array(accel_b, dtype=np.float64)
        gyro_b = np.array(gyro_b, dtype=np.float64)
        
        self.dcm_b2n = propagate_attitude_dcm(self.dcm_b2n, gyro_b, dt)
        accel_nav = np.dot(self.dcm_b2n, accel_b) + self.g_nav
        new_vel = self.vel_enu + accel_nav * dt
        self.pos_enu += 0.5 * (self.vel_enu + new_vel) * dt
        self.vel_enu = new_vel
        
        return self.pos_enu.copy(), self.vel_enu.copy()


def run_raw_strapdown_ins(sequence, start_idx=0, end_idx=None):
    if end_idx is None:
        end_idx = len(sequence.timestamps)
        
    n_steps = end_idx - start_idx
    if n_steps <= 1:
        return np.zeros((0, 3)), np.zeros((0, 3))
        
    init_pos = sequence.truth_enu[start_idx]
    init_speed = sequence.truth_speed_ms[start_idx]
    init_heading = sequence.truth_heading_deg[start_idx]
    
    yaw_enu_rad = np.radians(90.0 - init_heading)
    init_vel = np.array([
        init_speed * np.cos(yaw_enu_rad),
        init_speed * np.sin(yaw_enu_rad),
        0.0
    ], dtype=np.float64)
    
    ins = RawStrapdownINS(init_pos, init_vel, init_heading)
    
    pos_est = np.zeros((n_steps, 3))
    vel_est = np.zeros((n_steps, 3))
    
    pos_est[0] = init_pos
    vel_est[0] = init_vel
    
    for i in range(1, n_steps):
        idx = start_idx + i
        dt = sequence.timestamps[idx] - sequence.timestamps[idx-1]
        if dt <= 0: dt = sequence.dt
        
        p, v = ins.update(sequence.accel[idx], sequence.gyro[idx], dt)
        pos_est[i] = p
        vel_est[i] = v
        
    return pos_est, vel_est
