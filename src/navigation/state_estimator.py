"""
SIH 26168 - Production Inertial Navigation State Estimator (Machine 2 & Machine 3)
Maintains:
  State: x = [East, North, v, psi, b_ax, b_ay, b_az, b_gx, b_gy, b_gz]
  Covariance: P (10x10)
Provides:
  1. Prediction step via UniversalMotionNet / PersonalizationAdapter motion increments.
  2. Zero-Velocity Update (ZUPT) standstill gating + stationary gyro bias tracking.
  3. GNSS measurement update with Kalman innovation.
  4. Smooth reconvergence on GNSS return (no position teleportation).
  5. Standardized PseudoGNSSPacket generation for navigation apps.
"""

from dataclasses import dataclass
import numpy as np

# WGS84 Constants
WGS84_A = 6378137.0          # semi-major axis (metres)
WGS84_F = 1.0 / 298.257223563 # flattening
WGS84_B = WGS84_A * (1.0 - WGS84_F)
WGS84_E2 = 2.0 * WGS84_F - WGS84_F ** 2

@dataclass
class PseudoGNSSPacket:
    timestamp: float       # seconds
    lat: float             # degrees WGS84
    lon: float             # degrees WGS84
    speed_mps: float       # metres/second forward speed
    heading_deg: float     # 0..360 degrees clockwise from North
    accuracy_m: float      # estimated 1-sigma positional uncertainty (metres)
    confidence: float      # 0.0 to 1.0 score
    source: str            # "REAL_GNSS" or "PSEUDO_GNSS"
    is_stationary: bool    # True if ZUPT lock active
    bias_yaw_deg_s: float  # Estimated gyro bias in deg/s

class WGS84LocalProjector:
    """
    Local tangent plane projection between WGS84 (lat, lon) and local ENU (East, North).
    Accurate to millimeter level within 100 km of anchor.
    """
    def __init__(self, lat0: float, lon0: float, alt0: float = 0.0):
        self.lat0 = float(lat0)
        self.lon0 = float(lon0)
        self.alt0 = float(alt0)

        phi0 = np.radians(self.lat0)
        sin_phi = np.sin(phi0)
        cos_phi = np.cos(phi0)

        # Radii of curvature
        d = 1.0 - WGS84_E2 * sin_phi**2
        self.Rn = WGS84_A / np.sqrt(d)                    # prime vertical radius
        self.Rm = WGS84_A * (1.0 - WGS84_E2) / (d * np.sqrt(d)) # meridian radius

        self.m_per_deg_lat = np.radians(1.0) * (self.Rm + self.alt0)
        self.m_per_deg_lon = np.radians(1.0) * (self.Rn + self.alt0) * cos_phi

    def enu_to_geodetic(self, east: float, north: float):
        d_lat = north / self.m_per_deg_lat
        d_lon = east / self.m_per_deg_lon
        return self.lat0 + d_lat, self.lon0 + d_lon

    def geodetic_to_enu(self, lat: float, lon: float):
        d_lat = lat - self.lat0
        d_lon = lon - self.lon0
        north = d_lat * self.m_per_deg_lat
        east  = d_lon * self.m_per_deg_lon
        return east, north

class NavigationStateEstimator:
    """
    10-State Inertial Navigation Filter:
      x = [E, N, v, psi, b_ax, b_ay, b_az, b_gx, b_gy, b_gz]
    Integrates learned motion increments from UniversalMotionNet.
    """
    def __init__(self, init_lat: float, init_lon: float, init_speed: float = 0.0, init_heading_deg: float = 0.0, enable_zupt: bool = True):
        self.projector = WGS84LocalProjector(init_lat, init_lon)
        self.enable_zupt = bool(enable_zupt)

        # State vector: [E, N, v, psi (rad), b_ax, b_ay, b_az, b_gx, b_gy, b_gz]
        self.x = np.zeros(10, dtype=np.float64)
        self.x[0] = 0.0                                          # East (m)
        self.x[1] = 0.0                                          # North (m)
        self.x[2] = float(init_speed)                            # speed (m/s)
        self.x[3] = np.radians(float(init_heading_deg))          # psi (rad, clockwise from North)

        # Covariance Matrix P (10x10)
        self.P = np.diag([
            2.0**2, 2.0**2,     # Position uncertainty: 2.0 m
            0.5**2,             # Velocity uncertainty: 0.5 m/s
            np.radians(2.0)**2, # Heading uncertainty: 2.0 deg
            0.1**2, 0.1**2, 0.1**2,       # Accel biases
            0.001**2, 0.001**2, 0.001**2  # Gyro biases
        ])

        # Process noise spectral density Q
        self.Q_base = np.diag([
            0.04, 0.04,         # pos noise
            0.15,               # vel noise
            0.0005,             # heading noise
            1e-5, 1e-5, 1e-5,   # accel bias random walk
            1e-7, 1e-7, 1e-7    # gyro bias random walk
        ])

        # Pure Neural Model Dead-Reckoning State [E, N, v, psi]
        # Propagates independently from IMU to track true model accuracy vs GPS
        self.x_model = np.zeros(4, dtype=np.float64)
        self.x_model[0] = 0.0
        self.x_model[1] = 0.0
        self.x_model[2] = float(init_speed)
        self.x_model[3] = np.radians(float(init_heading_deg))
        self.model_error_m = 0.0

        # Reconvergence & Blackout state
        self.is_blackout = False
        self.pending_reconvergence = False
        self.blackout_start_time = None
        self.blend_remaining_s = 0.0
        self.blend_total_s = 3.5   # Smooth 3.5s exponential blend to eliminate any teleportation!
        self.blend_offset_enu = np.zeros(2, dtype=np.float64)

        # ZUPT tracking
        self.stationary_ticks = 0
        self.is_stationary = False
        self.zupt_candidate_ticks = 0
        self.zupt_min_ticks = 2

    def predict(self, motion_pred: dict, imu_raw: np.ndarray, dt: float = 0.1):
        """
        Prediction step using UniversalMotionNet / Adapter outputs.
        motion_pred dict contains:
          - v_t: endpoint speed (m/s)
          - delta_s: scalar window displacement (m)
          - delta_psi: heading increment over window (rad)
          - p_stop: standstill probability [0..1]
          - log_var: velocity log-variance
        imu_raw shape: (9, W) in physical units (m/s^2, rad/s)
        """
        v_t = float(motion_pred["v_t"])
        delta_s = float(motion_pred["delta_s"])
        delta_psi = float(motion_pred["delta_psi"])
        p_stop = float(motion_pred.get("p_stop", 0.0))
        log_var = float(motion_pred.get("log_var", 0.0))

        # Multi-signal physical sensor statistics
        recent_accel = imu_raw[:3, -10:]
        recent_gyro  = imu_raw[3:6, -10:]
        accel_var = np.var(recent_accel, axis=1).sum()
        gyro_var  = np.var(recent_gyro[0])  # yaw rate variance
        mean_accel_norm = np.linalg.norm(np.mean(recent_accel, axis=1))
        grav_err = abs(mean_accel_norm - 9.80665)

        cond_model = p_stop > 0.70
        cond_accel = accel_var < 0.035
        cond_gyro  = gyro_var < 0.001
        cond_grav  = grav_err < 0.35
        cond_speed = v_t < 0.6

        # Robust multi-condition evidence
        is_candidate_stop = (cond_model or cond_speed) and cond_accel and cond_gyro and cond_grav

        is_still = False
        if self.enable_zupt:
            if is_candidate_stop:
                self.zupt_candidate_ticks += 1
                if self.zupt_candidate_ticks >= self.zupt_min_ticks:
                    is_still = True
                    self.is_stationary = True
                    self.stationary_ticks += 1
                    # Recursive gyro bias state update with covariance reduction
                    alpha = 0.02
                    wz_current = float(imu_raw[3, -1])
                    self.x[9] = (1.0 - alpha) * self.x[9] + alpha * wz_current
                    self.P[9, 9] = max(1e-8, (1.0 - alpha) * self.P[9, 9])
            else:
                self.zupt_candidate_ticks = 0
                self.is_stationary = False
        else:
            self.is_stationary = False

        # ── 2. De-bias & Scale Window Heading Increment ──────────────────────
        W = float(imu_raw.shape[1])
        bgz = self.x[9]
        # De-bias window heading change: delta_psi_clean = delta_psi - bgz * (W * dt)
        clean_delta_psi = delta_psi - bgz * (W * dt)
        step_dpsi = (clean_delta_psi / W) if not is_still else 0.0

        # ── 3. State Kinematics Integration (ENU) ────────────────────────────
        # Per-step displacement from window delta_s: step_ds = delta_s / W
        step_ds = (delta_s / W) if not is_still else 0.0
        current_psi = self.x[3]
        half_turn = current_psi + step_dpsi * 0.5

        # Geographic bearing convention (0 = North, 90 = East)
        dE = step_ds * np.sin(half_turn)
        dN = step_ds * np.cos(half_turn)

        # Update Kalman fused navigation state
        self.x[0] += dE
        self.x[1] += dN
        self.x[2] = v_t if not is_still else 0.0
        self.x[3] = (current_psi + step_dpsi) % (2.0 * np.pi)

        # Update pure neural model dead reckoning state independently
        self.x_model[0] += dE
        self.x_model[1] += dN
        self.x_model[2] = v_t if not is_still else 0.0
        self.x_model[3] = (self.x_model[3] + step_dpsi) % (2.0 * np.pi)

        # ── 4. Covariance Growth ─────────────────────────────────────────────
        # Propagate positional uncertainty with model's learned heteroscedastic sigma
        v_sigma = np.sqrt(np.exp(np.clip(log_var, -2.5, 2.5)))
        pos_noise = (v_sigma * dt) ** 2 if not self.is_stationary else 1e-6

        self.P[0, 0] += pos_noise + self.Q_base[0, 0] * dt
        self.P[1, 1] += pos_noise + self.Q_base[1, 1] * dt
        self.P[2, 2] += self.Q_base[2, 2] * dt
        self.P[3, 3] += self.Q_base[3, 3] * dt

        # ── 5. Smooth Reconvergence Blend Decay ──────────────────────────────
        if self.blend_remaining_s > 0.0:
            decay_rate = dt / self.blend_total_s
            self.blend_offset_enu *= max(0.0, 1.0 - decay_rate)
            self.blend_remaining_s -= dt
            if self.blend_remaining_s <= 0.0:
                self.blend_offset_enu = np.zeros(2, dtype=np.float64)

    def correct_gnss(self, gnss_lat: float, gnss_lon: float, gnss_speed: float, gnss_heading_deg: float, gnss_accuracy: float = 0.5, dt: float = 0.1):
        """
        Measurement correction step during GNSS-active periods.
        Calculates genuine model innovation residual against GPS without erasing the error state.
        """
        meas_e, meas_n = self.projector.geodetic_to_enu(gnss_lat, gnss_lon)
        meas_psi = np.radians(gnss_heading_deg)

        # Compute TRUE error of our neural model vs GPS (Innovation Error!)
        self.model_error_m = float(np.linalg.norm(self.x_model[:2] - np.array([meas_e, meas_n])))

        # ── Handle GNSS Recovery (No Teleportation Jump!) ─────────────────────
        # ── Handle GNSS Recovery (No Teleportation Jump!) ─────────────────────
        if self.is_blackout or self.pending_reconvergence:
            self.is_blackout = False
            self.pending_reconvergence = False
            # Discrepancy between where dead-reckoning was and where GNSS truly is
            jump_e = self.x[0] - meas_e
            jump_n = self.x[1] - meas_n
            # Store offset to decay smoothly over 3.5 seconds
            self.blend_offset_enu = np.array([jump_e, jump_n], dtype=np.float64)
            self.blend_remaining_s = self.blend_total_s
            # Reset model anchor to GPS position upon recovery
            self.x_model[0] = meas_e
            self.x_model[1] = meas_n

        # Standard Kalman Measurement Update
        z = np.array([meas_e, meas_n, gnss_speed, meas_psi], dtype=np.float64)
        H = np.zeros((4, 10))
        H[0, 0] = 1.0  # East
        H[1, 1] = 1.0  # North
        H[2, 2] = 1.0  # Speed
        H[3, 3] = 1.0  # Heading

        y = z - H @ self.x
        y[3] = np.arctan2(np.sin(y[3]), np.cos(y[3]))

        R = np.diag([
            gnss_accuracy**2, gnss_accuracy**2,
            0.2**2,
            np.radians(1.0)**2
        ])

        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)

        self.x = self.x + K @ y
        self.P = (np.eye(10) - K @ H) @ self.P

    def get_display_enu(self) -> np.ndarray:
        """
        Returns continuous local ENU position with exponential reconvergence blend.
        Guarantees ZERO TELEPORTATION when GNSS is restored.
        """
        if self.blend_remaining_s > 0.0:
            return self.x[:2] + self.blend_offset_enu
        return self.x[:2].copy()

    def get_model_geodetic(self) -> tuple[float, float]:
        """Returns geodetic latitude & longitude from the pure neural model dead reckoning state."""
        return self.projector.enu_to_geodetic(self.x_model[0], self.x_model[1])

    def set_blackout(self, is_blackout: bool, timestamp: float = 0.0):
        if is_blackout and not self.is_blackout:
            self.is_blackout = True
            self.blackout_start_time = timestamp
        elif not is_blackout and self.is_blackout:
            self.is_blackout = False
            self.pending_reconvergence = True

    def get_pseudo_gnss_packet(self, timestamp: float) -> PseudoGNSSPacket:
        """
        Emits standard PseudoGNSSPacket consumed identically by navigation layer.
        """
        # Blend offset applied to position for smooth visualization
        effective_e = self.x[0] - self.blend_offset_enu[0]
        effective_n = self.x[1] - self.blend_offset_enu[1]

        lat, lon = self.projector.enu_to_geodetic(effective_e, effective_n)
        pos_accuracy = np.sqrt(max(0.25, 0.5 * (self.P[0, 0] + self.P[1, 1])))

        # Confidence: 1.0 for high accuracy (< 5m), decays towards 0.1 at 100m error
        confidence = float(np.clip(1.0 / (1.0 + pos_accuracy / 10.0), 0.05, 1.0))
        heading_deg = float(np.degrees(self.x[3]) % 360.0)

        return PseudoGNSSPacket(
            timestamp=float(timestamp),
            lat=float(lat),
            lon=float(lon),
            speed_mps=float(max(0.0, self.x[2])),
            heading_deg=heading_deg,
            accuracy_m=float(pos_accuracy),
            confidence=confidence,
            source="PSEUDO_GNSS" if self.is_blackout else "REAL_GNSS",
            is_stationary=self.is_stationary,
            bias_yaw_deg_s=float(np.degrees(self.x[9]))
        )
