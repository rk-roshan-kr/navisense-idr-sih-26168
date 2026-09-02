"""
SIH 26168 - Baseline B4: Base Learned Intelligent Dead Reckoning (Base IDR)
"""

import numpy as np


class MotionState:
    STATIONARY = 0
    CRUISING = 1
    ACCELERATING = 2
    BRAKING = 3
    CORNERING = 4
    ROUGH_ROAD = 5


class BaseLearnedIDR:
    def __init__(self, window_size=20):
        self.window_size = window_size
        self.imu_buffer = []
        self.w_speed = np.array([0.45, 0.35, 0.20])
        self.w_decay = 0.985
        self.gravity_nominal = 9.80665
        
        self.current_speed = 0.0
        self.current_heading_rad = 0.0
        self.pos_enu = np.zeros(3, dtype=np.float64)

    def reset(self, initial_pos_enu, initial_speed_ms, initial_heading_deg):
        self.pos_enu = np.array(initial_pos_enu, dtype=np.float64)
        self.current_speed = float(initial_speed_ms)
        self.current_heading_rad = np.radians(90.0 - initial_heading_deg)
        self.imu_buffer = []

    def classify_motion_state(self, accel_mag, gyro_norm, ax_long, az_vert):
        if gyro_norm < np.radians(1.2) and abs(accel_mag - self.gravity_nominal) < 0.25 and self.current_speed < 0.4:
            return MotionState.STATIONARY
        if abs(az_vert - self.gravity_nominal) > 1.8:
            return MotionState.ROUGH_ROAD
        if gyro_norm > np.radians(4.0):
            return MotionState.CORNERING
        if ax_long > 0.6:
            return MotionState.ACCELERATING
        if ax_long < -0.8:
            return MotionState.BRAKING
        return MotionState.CRUISING

    def step(self, accel_raw, gyro_raw, dt=0.1):
        self.imu_buffer.append(np.hstack([accel_raw, gyro_raw]))
        if len(self.imu_buffer) > self.window_size:
            self.imu_buffer.pop(0)

        buf = np.array(self.imu_buffer)
        accel_mag = np.linalg.norm(accel_raw)
        gyro_norm = np.linalg.norm(gyro_raw)
        
        ax = accel_raw[0]
        ay = accel_raw[1]
        az = accel_raw[2]
        wz = gyro_raw[0] if abs(gyro_raw[0]) > abs(gyro_raw[2]) else gyro_raw[2]
        
        m_state = self.classify_motion_state(accel_mag, gyro_norm, ay, az)
        
        if m_state == MotionState.STATIONARY:
            self.current_speed = 0.0
            uncertainty = 0.05
        else:
            ay_smoothed = np.mean(buf[-min(5, len(buf)):, 1])
            speed_delta = ay_smoothed * dt
            predicted_speed = self.current_speed * self.w_decay + speed_delta
            self.current_speed = max(0.0, float(predicted_speed))
            uncertainty = 0.5 + 0.1 * self.current_speed

        self.current_heading_rad += wz * dt
        self.current_heading_rad = (self.current_heading_rad + np.pi) % (2 * np.pi) - np.pi

        dx = self.current_speed * np.cos(self.current_heading_rad) * dt
        dy = self.current_speed * np.sin(self.current_heading_rad) * dt
        
        self.pos_enu[0] += dx
        self.pos_enu[1] += dy
        
        heading_deg = (90.0 - np.degrees(self.current_heading_rad)) % 360.0
        return self.pos_enu.copy(), self.current_speed, heading_deg, m_state, uncertainty


def run_base_idr(sequence, start_idx=0, end_idx=None):
    if end_idx is None:
        end_idx = len(sequence.timestamps)
        
    n_steps = end_idx - start_idx
    if n_steps <= 1:
        return np.zeros((0, 3)), np.zeros(0), np.zeros(0)
        
    init_pos = sequence.truth_enu[start_idx]
    init_speed = sequence.truth_speed_ms[start_idx]
    init_heading = sequence.truth_heading_deg[start_idx]
    
    base_model = BaseLearnedIDR()
    base_model.reset(init_pos, init_speed, init_heading)
    
    pos_est = np.zeros((n_steps, 3))
    speeds = np.zeros(n_steps)
    headings = np.zeros(n_steps)
    
    pos_est[0] = init_pos
    speeds[0] = init_speed
    headings[0] = init_heading
    
    for i in range(1, n_steps):
        idx = start_idx + i
        dt = sequence.timestamps[idx] - sequence.timestamps[idx-1]
        if dt <= 0: dt = sequence.dt
        
        p, v, h, _, _ = base_model.step(sequence.accel[idx], sequence.gyro[idx], dt)
        pos_est[i] = p
        speeds[i] = v
        headings[i] = h
        
    return pos_est, speeds, headings
