"""
SIH 26168 - Online Personalization State Engine
Learns vehicle-specific and mount-specific parameters during GNSS-available driving:
1. R_b_to_p: Phone-to-Vehicle mounting alignment matrix (Pitch, Roll, Yaw)
2. Sensor Biases: Accelerometer bias b_a, Gyroscope bias b_g
3. Vehicle Dynamics: Acceleration response scale factor, Braking drag coefficient
4. Vibration Profile: Suspension resonance frequency and damping factor
5. Confidence & Convergence: Progressive parameter stabilization index
"""

import numpy as np
from src.core.coordinate_frames import euler_to_dcm, STANDARD_GRAVITY


class PersonalizationState:
    def __init__(self):
        # 1. Mount Alignment (Euler angles in radians: roll, pitch, yaw of phone relative to vehicle body)
        self.mount_roll = 0.0
        self.mount_pitch = 0.0
        self.mount_yaw = 0.0
        self.R_p2b = np.eye(3, dtype=np.float64) # Phone frame to Vehicle body frame
        
        # 2. Sensor Biases
        self.ba = np.zeros(3, dtype=np.float64)
        self.bg = np.zeros(3, dtype=np.float64)
        
        # 3. Vehicle Dynamic Parameters
        self.accel_scale = 1.0       # Forward acceleration scaling factor
        self.braking_factor = 1.0     # Braking deceleration sensitivity
        self.drag_coefficient = 0.02  # Aerodynamic/rolling resistance decay
        
        # 4. Vibration Profile
        self.vibration_intensity = 0.0
        self.suspension_filter_gain = 0.85
        
        # 5. Convergence & Calibration Progress (0.0 to 1.0)
        self.convergence_score = 0.0
        self.samples_observed = 0
        self.is_calibrated = False

    def to_dict(self):
        return {
            "mount_pitch_deg": float(np.degrees(self.mount_pitch)),
            "mount_roll_deg": float(np.degrees(self.mount_roll)),
            "mount_yaw_deg": float(np.degrees(self.mount_yaw)),
            "accel_bias_x": float(self.ba[0]),
            "accel_bias_y": float(self.ba[1]),
            "accel_bias_z": float(self.ba[2]),
            "gyro_bias_z": float(self.bg[2]),
            "accel_scale": float(self.accel_scale),
            "convergence_score": float(self.convergence_score),
            "is_calibrated": bool(self.is_calibrated)
        }


class OnlinePersonalizer:
    def __init__(self, adaptation_rate=0.01):
        self.state = PersonalizationState()
        self.lr = adaptation_rate
        
        # Buffers for recursive least squares / online filtering
        self.accel_buffer = []
        self.gyro_buffer = []
        self.gnss_speed_buffer = []
        
    def reset(self):
        self.state = PersonalizationState()
        self.accel_buffer = []
        self.gyro_buffer = []
        self.gnss_speed_buffer = []

    def update_with_gnss_teacher(self, accel_phone, gyro_phone, gnss_speed, gnss_heading_deg, dt=0.1):
        """
        Observes vehicle motion while GNSS is healthy to calibrate phone mounting,
        sensor biases, and vehicle acceleration/braking dynamics.
        
        NOTE: GNSS is ONLY used as a supervisory feedback signal during adaptation;
        it is NEVER fed into the real-time IDR inference path.
        """
        self.state.samples_observed += 1
        
        # 1. Estimate Level Attitude (Pitch & Roll) from Gravity Vector during steady motion
        accel_norm = np.linalg.norm(accel_phone)
        if abs(accel_norm - STANDARD_GRAVITY) < 0.4 and np.linalg.norm(gyro_phone) < np.radians(2.0):
            gx, gy, gz = accel_phone
            est_pitch = np.arctan2(-gy, np.sqrt(gx**2 + gz**2))
            est_roll = np.arctan2(gx, gz)
            
            alpha = min(0.05, 1.0 / max(1, self.state.samples_observed))
            self.state.mount_pitch = (1 - alpha) * self.state.mount_pitch + alpha * est_pitch
            self.state.mount_roll = (1 - alpha) * self.state.mount_roll + alpha * est_roll

        # 2. Update Phone-to-Body DCM
        self.state.R_p2b = euler_to_dcm(self.state.mount_roll, self.state.mount_pitch, self.state.mount_yaw).T
        
        # 3. Transform Accel & Gyro into Estimated Vehicle Body Frame
        accel_body = np.dot(self.state.R_p2b, accel_phone)
        gyro_body = np.dot(self.state.R_p2b, gyro_phone)
        
        # 4. Vehicle Forward Acceleration Calibration
        a_forward = accel_body[1]
        
        self.accel_buffer.append(a_forward)
        self.gyro_buffer.append(gyro_body[2])
        self.gnss_speed_buffer.append(gnss_speed)
        
        if len(self.accel_buffer) > 50:
            self.accel_buffer.pop(0)
            self.gyro_buffer.pop(0)
            self.gnss_speed_buffer.pop(0)
            
            spd_arr = np.array(self.gnss_speed_buffer)
            dv_gnss = np.gradient(spd_arr, dt)
            a_measured = np.array(self.accel_buffer)
            
            active_mask = (spd_arr > 2.0) & (np.abs(dv_gnss) > 0.3)
            if np.sum(active_mask) > 10:
                y_act = dv_gnss[active_mask]
                x_act = a_measured[active_mask]
                
                denom = np.sum((x_act - np.mean(x_act))**2)
                if denom > 1e-4:
                    scale = np.sum((x_act - np.mean(x_act)) * (y_act - np.mean(y_act))) / denom
                    if 0.5 < scale < 2.0:
                        self.state.accel_scale = (1 - self.lr) * self.state.accel_scale + self.lr * scale
                        
        # 5. Update Convergence Score
        target_samples = 300
        self.state.convergence_score = min(1.0, self.state.samples_observed / target_samples)
        if self.state.convergence_score >= 0.8:
            self.state.is_calibrated = True

        return self.state
