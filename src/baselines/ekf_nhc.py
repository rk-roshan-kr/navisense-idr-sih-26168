"""
SIH 26168 - Baseline B2: Classical Error-State Extended Kalman Filter (ES-EKF) with NHC
Implements a 15-state ES-EKF:
- Position error (3)
- Velocity error (3)
- Attitude tilt error (3)
- Accelerometer bias (3)
- Gyroscope bias (3)
"""

import numpy as np
from src.core.coordinate_frames import propagate_attitude_dcm, euler_to_dcm, STANDARD_GRAVITY


class ES_EKF_NHC:
    def __init__(self, initial_pos_enu, initial_vel_enu, initial_heading_deg):
        self.p_n = np.array(initial_pos_enu, dtype=np.float64)
        self.v_n = np.array(initial_vel_enu, dtype=np.float64)
        
        yaw_enu_rad = np.radians(90.0 - initial_heading_deg)
        self.R_b2n = euler_to_dcm(0.0, 0.0, yaw_enu_rad)
        
        self.ba = np.zeros(3, dtype=np.float64)
        self.bg = np.zeros(3, dtype=np.float64)
        
        self.P = np.diag([
            1.0, 1.0, 4.0,
            0.5, 0.5, 0.5,
            np.radians(2.0)**2, np.radians(2.0)**2, np.radians(5.0)**2,
            0.05**2, 0.05**2, 0.05**2,
            0.005**2, 0.005**2, 0.005**2
        ]).astype(np.float64)
        
        self.q_accel = 0.2**2
        self.q_gyro = (np.radians(0.5))**2
        self.q_ba = 1e-4
        self.q_bg = 1e-5
        
        self.g_nav = np.array([0.0, 0.0, -STANDARD_GRAVITY], dtype=np.float64)

    def predict(self, accel_b_raw, gyro_b_raw, dt):
        accel_b = accel_b_raw - self.ba
        gyro_b = gyro_b_raw - self.bg
        
        self.R_b2n = propagate_attitude_dcm(self.R_b2n, gyro_b, dt)
        accel_nav = np.dot(self.R_b2n, accel_b) + self.g_nav
        new_v = self.v_n + accel_nav * dt
        self.p_n += 0.5 * (self.v_n + new_v) * dt
        self.v_n = new_v
        
        F = np.eye(15, dtype=np.float64)
        F[0:3, 3:6] = np.eye(3) * dt
        
        f_nav = np.dot(self.R_b2n, accel_b)
        f_skew = np.array([
            [0.0, -f_nav[2], f_nav[1]],
            [f_nav[2], 0.0, -f_nav[0]],
            [-f_nav[1], f_nav[0], 0.0]
        ])
        F[3:6, 6:9] = -f_skew * dt
        F[3:6, 9:12] = -self.R_b2n * dt
        F[6:9, 12:15] = -self.R_b2n * dt
        
        G = np.zeros((15, 12), dtype=np.float64)
        G[3:6, 0:3] = -self.R_b2n
        G[6:9, 3:6] = -self.R_b2n
        G[9:12, 6:9] = np.eye(3)
        G[12:15, 9:12] = np.eye(3)
        
        Q_c = np.diag([
            self.q_accel, self.q_accel, self.q_accel,
            self.q_gyro, self.q_gyro, self.q_gyro,
            self.q_ba, self.q_ba, self.q_ba,
            self.q_bg, self.q_bg, self.q_bg
        ])
        
        Q_d = np.dot(np.dot(G, Q_c), G.T) * dt
        self.P = np.dot(np.dot(F, self.P), F.T) + Q_d

    def update_nhc(self):
        R_n2b = self.R_b2n.T
        v_b = np.dot(R_n2b, self.v_n)
        z = np.array([v_b[1], v_b[2]], dtype=np.float64)
        
        H = np.zeros((2, 15), dtype=np.float64)
        H[0, 3:6] = R_n2b[1, :]
        H[1, 3:6] = R_n2b[2, :]
        
        v_skew = np.array([
            [0.0, -self.v_n[2], self.v_n[1]],
            [self.v_n[2], 0.0, -self.v_n[0]],
            [-self.v_n[1], self.v_n[0], 0.0]
        ])
        rot_v_skew = np.dot(R_n2b, v_skew)
        H[0, 6:9] = rot_v_skew[1, :]
        H[1, 6:9] = rot_v_skew[2, :]
        
        R_nhc = np.diag([0.15**2, 0.15**2])
        self._apply_kalman_update(H, z, R_nhc)

    def update_zupt(self):
        z = self.v_n.copy()
        H = np.zeros((3, 15), dtype=np.float64)
        H[0:3, 3:6] = np.eye(3)
        R_zupt = np.diag([0.05**2, 0.05**2, 0.05**2])
        self._apply_kalman_update(H, z, R_zupt)

    def update_gnss(self, pos_enu_meas, vel_enu_meas=None):
        if vel_enu_meas is not None:
            z = np.hstack([self.p_n - pos_enu_meas, self.v_n - vel_enu_meas])
            H = np.zeros((6, 15), dtype=np.float64)
            H[0:3, 0:3] = np.eye(3)
            H[3:6, 3:6] = np.eye(3)
            R_gnss = np.diag([2.0**2, 2.0**2, 4.0**2, 0.2**2, 0.2**2, 0.5**2])
        else:
            z = self.p_n - pos_enu_meas
            H = np.zeros((3, 15), dtype=np.float64)
            H[0:3, 0:3] = np.eye(3)
            R_gnss = np.diag([2.5**2, 2.5**2, 5.0**2])
            
        self._apply_kalman_update(H, z, R_gnss)

    def _apply_kalman_update(self, H, z, R_meas):
        S = np.dot(np.dot(H, self.P), H.T) + R_meas
        K = np.dot(np.dot(self.P, H.T), np.linalg.inv(S))
        dx = np.dot(K, z)
        
        self.p_n -= dx[0:3]
        self.v_n -= dx[3:6]
        
        psi = dx[6:9]
        psi_skew = np.array([
            [0.0, -psi[2], psi[1]],
            [psi[2], 0.0, -psi[0]],
            [-psi[1], psi[0], 0.0]
        ])
        self.R_b2n = np.dot(np.eye(3) - psi_skew, self.R_b2n)
        u, _, vt = np.linalg.svd(self.R_b2n)
        self.R_b2n = np.dot(u, vt)
        
        self.ba += dx[9:12]
        self.bg += dx[12:15]
        
        I_KH = np.eye(15) - np.dot(K, H)
        self.P = np.dot(np.dot(I_KH, self.P), I_KH.T) + np.dot(np.dot(K, R_meas), K.T)


def run_ekf_nhc(sequence, start_idx=0, end_idx=None, gnss_mask=None):
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
    
    ekf = ES_EKF_NHC(init_pos, init_vel, init_heading)
    
    pos_est = np.zeros((n_steps, 3))
    vel_est = np.zeros((n_steps, 3))
    
    pos_est[0] = init_pos
    vel_est[0] = init_vel
    
    for i in range(1, n_steps):
        idx = start_idx + i
        dt = sequence.timestamps[idx] - sequence.timestamps[idx-1]
        if dt <= 0: dt = sequence.dt
        
        ekf.predict(sequence.accel[idx], sequence.gyro[idx], dt)
        ekf.update_nhc()
        
        gyro_norm = np.linalg.norm(sequence.gyro[idx])
        accel_norm = np.linalg.norm(sequence.accel[idx])
        if gyro_norm < np.radians(1.0) and abs(accel_norm - STANDARD_GRAVITY) < 0.3 and np.linalg.norm(ekf.v_n) < 0.5:
            ekf.update_zupt()
            
        is_blackout = gnss_mask[idx] if gnss_mask is not None else False
        if not is_blackout and idx < len(sequence.gnss_enu):
            ekf.update_gnss(sequence.gnss_enu[idx])
            
        pos_est[i] = ekf.p_n.copy()
        vel_est[i] = ekf.v_n.copy()
        
    return pos_est, vel_est
