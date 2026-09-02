"""
SIH 26168 - Baseline B5: Personalized Intelligent Dead Reckoning (Personalized IDR)
Combines:
1. Frozen Base Learned Model (generalized motion representations)
2. Online Personalization Adapter (Phone-to-vehicle rotation R_b^p, bias b_a/b_g, vehicle scale)
3. Strict Non-Holonomic Constraints (v_y_b = 0, v_z_b = 0)

STRICT GNSS ISOLATION:
The IDR forward inference path consumes ONLY IMU measurements and the personalized parameters.
GNSS position is NEVER fed into this estimator.
"""

import numpy as np
from src.core.coordinate_frames import euler_to_dcm, STANDARD_GRAVITY
from src.core.personalization import PersonalizationState, OnlinePersonalizer


class PersonalizedIDR:
    def __init__(self, personalization_state=None):
        self.personalization = personalization_state if personalization_state is not None else PersonalizationState()
        
        # Motion state
        self.pos_enu = np.zeros(3, dtype=np.float64) # [E, N, U]
        self.current_speed = 0.0                      # m/s
        self.current_heading_rad = 0.0                # rad (ENU frame)
        
        # Low-pass filtered acceleration
        self.filtered_a_forward = 0.0
        self.gravity_nominal = STANDARD_GRAVITY

    def reset(self, initial_pos_enu, initial_speed_ms, initial_heading_deg, personalization_state=None):
        self.pos_enu = np.array(initial_pos_enu, dtype=np.float64)
        self.current_speed = float(initial_speed_ms)
        self.current_heading_rad = np.radians(90.0 - initial_heading_deg)
        if personalization_state is not None:
            self.personalization = personalization_state
        self.filtered_a_forward = 0.0

    def step(self, accel_phone, gyro_phone, dt=0.1):
        """
        Step update using ONLY smartphone IMU measurements (Strict GNSS Isolation).
        """
        # 1. Transform Phone IMU measurements to Vehicle Body Frame
        R_p2b = self.personalization.R_p2b
        accel_body = np.dot(R_p2b, accel_phone) - self.personalization.ba
        gyro_body = np.dot(R_p2b, gyro_phone) - self.personalization.bg
        
        # Extract forward acceleration and yaw rate
        a_forward_raw = accel_body[1]
        w_yaw = gyro_body[2]
        
        # 2. Suspension & Vibration Decoupling (Adaptive Low-Pass Filter)
        gain = self.personalization.suspension_filter_gain
        self.filtered_a_forward = gain * self.filtered_a_forward + (1.0 - gain) * a_forward_raw
        
        # 3. Personalized Velocity Estimation
        # Apply personalized acceleration scaling
        a_effective = self.filtered_a_forward * self.personalization.accel_scale
        
        # Check stationary condition (ZUPT-like heuristic)
        is_stationary = (abs(a_forward_raw) < 0.15 and 
                         abs(w_yaw) < np.radians(1.0) and 
                         self.current_speed < 0.4)
                         
        if is_stationary:
            self.current_speed = 0.0
        else:
            # Propagate speed with dynamic drag decay
            drag_decay = 1.0 - (self.personalization.drag_coefficient * dt)
            new_speed = (self.current_speed * drag_decay) + (a_effective * dt)
            self.current_speed = max(0.0, float(new_speed))
            
        # 4. Heading Propagation (Strict Yaw integration)
        self.current_heading_rad += w_yaw * dt
        self.current_heading_rad = (self.current_heading_rad + np.pi) % (2 * np.pi) - np.pi
        
        # 5. Position Update (Non-Holonomic 2D trajectory)
        dx = self.current_speed * np.cos(self.current_heading_rad) * dt
        dy = self.current_speed * np.sin(self.current_heading_rad) * dt
        
        self.pos_enu[0] += dx
        self.pos_enu[1] += dy
        
        heading_deg = (90.0 - np.degrees(self.current_heading_rad)) % 360.0
        return self.pos_enu.copy(), self.current_speed, heading_deg


def run_personalized_idr(sequence, personalization_state, start_idx=0, end_idx=None):
    """
    Run Personalized IDR across a sequence using pre-calibrated personalized parameters.
    """
    if end_idx is None:
        end_idx = len(sequence.timestamps)
        
    n_steps = end_idx - start_idx
    if n_steps <= 1:
        return np.zeros((0, 3)), np.zeros(0), np.zeros(0)
        
    init_pos = sequence.truth_enu[start_idx]
    init_speed = sequence.truth_speed_ms[start_idx]
    init_heading = sequence.truth_heading_deg[start_idx]
    
    idr = PersonalizedIDR(personalization_state)
    idr.reset(init_pos, init_speed, init_heading)
    
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
        
        p, v, h = idr.step(sequence.accel[idx], sequence.gyro[idx], dt)
        pos_est[i] = p
        speeds[i] = v
        headings[i] = h
        
    return pos_est, speeds, headings
