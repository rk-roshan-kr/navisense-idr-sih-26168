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
from typing import Optional
import numpy as np
from src.core.idr_core import IMUConditioner
from src.core.vibration_signature import VehicleVibrationProfiler

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
    def __init__(
        self,
        init_lat: float,
        init_lon: float,
        init_speed: float = 0.0,
        init_heading_deg: float = 0.0,
        enable_zupt: bool = True,
        projector: Optional[WGS84LocalProjector] = None
    ):
        if projector is not None:
            self.projector = projector
        else:
            self.projector = WGS84LocalProjector(init_lat, init_lon)
        self.enable_zupt = bool(enable_zupt)

        # State vector: [E, N, v, psi (rad), b_ax, b_ay, b_az, b_gx, b_gy, b_gz]
        self.x = np.zeros(10, dtype=np.float64)
        init_e, init_n = self.projector.geodetic_to_enu(init_lat, init_lon)
        self.x[0] = float(init_e)                                # East (m)
        self.x[1] = float(init_n)                                # North (m)
        self.x[2] = float(init_speed)                            # speed (m/s)
        self.x[3] = float(np.arctan2(np.sin(np.radians(float(init_heading_deg))), np.cos(np.radians(float(init_heading_deg)))))  # psi in [-π,π]

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
        self.x_model[0] = float(init_e)
        self.x_model[1] = float(init_n)
        self.x_model[2] = float(init_speed)
        # BUG-14 FIX: x_model heading must match x[3] arctan2 [-π,π] convention (BUG-10 fix).
        # Previously np.radians() could produce [0,2π) → model track immediately diverges from
        # main EKF on northbound headings (≥180°), corrupting model_error_m metric.
        self.x_model[3] = float(np.arctan2(np.sin(np.radians(float(init_heading_deg))), np.cos(np.radians(float(init_heading_deg)))))
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
        self.launch_evidence_ticks = 0
        self._stationary_pos_enu = None  # Standstill anchor: guarantees 0.00000m motion during ZUPT

        # FP-suppression state (False Positive ZUPT prevention)
        self._raw_v_ema = 0.0          # FP-4: exponential moving average of raw_v (α=0.3)
        self._prev_delta_psi = 0.0     # FP-3: last window's raw gyro heading increment

        # Adaptive Vehicle Vibration Profiler (0-5 Hz observable stationary noise envelope)
        self.vibration_profiler = VehicleVibrationProfiler()

        # IMU Conditioners (Component 4 from idr_core.py — suspension damping + pothole rejection)
        # gz (yaw rate): gain=0.80 → τ ≈ 0.4s, fast enough for turns, damps road spikes
        # ax (fwd accel): gain=0.85 → τ ≈ 0.57s, used in ZUPT accel variance
        self.imu_cond_gz = IMUConditioner(filter_gain=0.80)
        self.imu_cond_ax = IMUConditioner(filter_gain=0.85)

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
        # TURN-BUG-1 FIX: raw_v is the unzeroed speed before stop clamping in runtime.py.
        raw_v = float(motion_pred.get("raw_v", v_t))
        # FP-1: p_turn from ManeuverSpecialistNet — a vehicle that is turning cannot be stopped
        p_turn = float(motion_pred.get("p_turn", 0.0))

        # ── FP-4: Exponential Moving Average of raw_v (α=0.3, ~5 window memory) ─────────────
        # Prevents ZUPT triggering when NN speed dips for 1-2 ticks during corner approach.
        # If the recent speed history shows motion, we assume motion even if current tick dips.
        self._raw_v_ema = 0.3 * raw_v + 0.7 * self._raw_v_ema
        effective_raw_v = max(raw_v, self._raw_v_ema)  # trust whichever is higher

        # Multi-signal physical sensor statistics
        recent_accel = imu_raw[:3, -10:]
        recent_gyro  = imu_raw[3:6, -10:]
        accel_var = float(np.var(recent_accel, axis=1).sum())
        # Canonical 9-channel schema: row 0 of recent_gyro is channel 3 (Yaw Rate)
        gyro_var  = float(np.var(recent_gyro[0]))
        mean_accel_norm = float(np.linalg.norm(np.mean(recent_accel, axis=1)))
        grav_err = abs(mean_accel_norm - 9.80665)
        gyro_mag = float(np.linalg.norm(np.mean(recent_gyro, axis=1)))

        # ── FP-3: Heading Coherence Check ─────────────────────────────────────────────────────
        # Canonical channel 3 is yaw rate: recent_gyro[0]
        step_yaw_deg = abs(np.degrees(float(recent_gyro[0, -1]) * dt))
        heading_changing = (step_yaw_deg > 0.5) or (gyro_mag > 0.04)
        self._prev_delta_psi = float(recent_gyro[0, -1]) * dt

        accel_thresh, gyro_thresh = self.vibration_profiler.get_adaptive_zupt_thresholds()

        # Incline-invariant physical standstill detection (all physical conditions must hold)
        physical_still = (
            (gyro_var < gyro_thresh) and
            (gyro_mag < 0.04) and
            (accel_var < (accel_thresh * 1.5)) and
            (grav_err < 0.35) and
            not heading_changing
        )
        cond_model = p_stop > 0.65
        cond_speed = effective_raw_v < 0.4
        is_candidate_stop = physical_still and (cond_model or cond_speed)

        # High-confidence soft stop path (requires physical standstill)
        soft_zupt_thresh = 0.97 if p_turn > 0.20 else 0.85
        high_conf_stop = (p_stop > soft_zupt_thresh) and (effective_raw_v < 0.5) and physical_still
        is_candidate_stop = is_candidate_stop or high_conf_stop

        # Composite motion override: specialist p_turn can ONLY override if vehicle is actually moving!
        clear_motion = (
            (p_turn > 0.35 and effective_raw_v > 0.8) or
            (gyro_mag > 0.04) or
            heading_changing
        )
        if clear_motion:
            is_candidate_stop = False
            high_conf_stop = False

        # ── 4-State Persistent FSM: MOVING <-> POSSIBLE_STOP -> STATIONARY -> POSSIBLE_LAUNCH -> MOVING ──
        if not hasattr(self, 'fsm_state'):
            self.fsm_state = "MOVING"

        if self.enable_zupt:
            if self.fsm_state in ("MOVING", "POSSIBLE_STOP"):
                if is_candidate_stop:
                    self.fsm_state = "POSSIBLE_STOP"
                    self.zupt_candidate_ticks += 1
                    # Persistent confirmation: require 3 consecutive candidate ticks
                    if self.zupt_candidate_ticks >= 3:
                        self.fsm_state = "STATIONARY"
                        self.is_stationary = True
                        self.stationary_ticks = 1
                        self.launch_evidence_ticks = 0
                        self._stationary_pos_enu = self.x[:2].copy()
                else:
                    self.fsm_state = "MOVING"
                    self.zupt_candidate_ticks = 0
                    self.is_stationary = False
            elif self.fsm_state in ("STATIONARY", "POSSIBLE_LAUNCH"):
                # Vehicle is in confirmed stationary state.
                # Check for genuine persistent launch evidence vs single shock (pothole, door slam, bump)
                sensor_motion = (gyro_mag > 0.04) or (accel_var > accel_thresh * 2.0) or (grav_err > 0.40)
                model_motion = (p_stop < 0.45) and (effective_raw_v > 0.8)
                fast_breakout = (raw_v > 2.0)

                # Genuine launch requires model velocity rising OR sustained sensor motion
                launch_evidence = (sensor_motion and model_motion) or fast_breakout or (model_motion and effective_raw_v > 1.2)

                if launch_evidence:
                    self.launch_evidence_ticks += 1
                    self.fsm_state = "POSSIBLE_LAUNCH"
                    # Require 2 consecutive ticks of verified launch evidence (or 1 tick for fast emergency breakout)
                    if self.launch_evidence_ticks >= (1 if fast_breakout else 2):
                        self.fsm_state = "MOVING"
                        self.is_stationary = False
                        self.zupt_candidate_ticks = 0
                        self.launch_evidence_ticks = 0
                        self.stationary_ticks = 0
                        self._stationary_pos_enu = None
                else:
                    self.fsm_state = "STATIONARY"
                    self.launch_evidence_ticks = 0
                    self.stationary_ticks += 1
                    self.vibration_profiler.update_profile(imu_raw[:3, -1], imu_raw[3:6, -1], stationary=True)
                    wz_current = float(imu_raw[3, -1])  # channel 3 = yaw rate
                    alpha = 0.02
                    self.x[9] = (1.0 - alpha) * self.x[9] + alpha * wz_current
                    self.P[9, 9] = max(1e-8, (1.0 - alpha) * self.P[9, 9])
                    self.P[2, 2] = min(self.P[2, 2], 0.01)
        else:
            self.fsm_state = "MOVING"
            self.is_stationary = False

        is_still = self.is_stationary

        # ── 2. One-Step Endpoint Heading Increment & Uncertainty ─────────────
        W = float(imu_raw.shape[1])
        bgz = self.x[9]
        if "step_dpsi" in motion_pred:
            model_step_dpsi = float(motion_pred["step_dpsi"])
        else:
            clean_delta_psi = delta_psi - bgz * (W * dt)
            model_step_dpsi = (clean_delta_psi / W) if not is_still else 0.0

        if not is_still:
            step_dpsi = model_step_dpsi
        else:
            step_dpsi = 0.0

        # ── 3. State Kinematics Integration (ENU) ────────────────────────────
        # Authoritative standstill invariant: zero displacement, zero speed, zero heading drift
        effective_v = v_t if not is_still else 0.0
        if "step_ds" in motion_pred:
            step_ds = float(motion_pred["step_ds"]) if not is_still else 0.0
        else:
            step_ds = float(motion_pred.get("delta_s", effective_v * dt)) if not is_still else 0.0
        current_psi = self.x[3]
        half_turn = current_psi + step_dpsi * 0.5

        # Geographic bearing convention (0 = North, 90 = East)
        dE = step_ds * np.sin(half_turn)
        dN = step_ds * np.cos(half_turn)

        # Update Kalman fused navigation state & pure neural dead reckoning
        if is_still and self._stationary_pos_enu is not None:
            self.x[:2] = self._stationary_pos_enu.copy()
            self.x_model[:2] = self._stationary_pos_enu.copy()
        else:
            self.x[0] += dE
            self.x[1] += dN
            self.x_model[0] += dE
            self.x_model[1] += dN

        self.x[2] = effective_v
        self.x[3] = float(np.arctan2(np.sin(current_psi + step_dpsi), np.cos(current_psi + step_dpsi)))
        self.x_model[2] = effective_v
        self.x_model[3] = float(np.arctan2(np.sin(self.x_model[3] + step_dpsi), np.cos(self.x_model[3] + step_dpsi)))

        # ── 4. Covariance Growth: Bridged from Learned Uncertainty ───────────
        # Standstill invariant: suppress positional, velocity, and heading covariance growth
        log_var_v = float(motion_pred.get("log_var_v", motion_pred.get("log_var", 0.0)))
        log_var_w = float(motion_pred.get("log_var_w", 0.0))
        v_sigma = float(np.sqrt(np.exp(np.clip(log_var_v, -2.5, 2.5))))
        w_sigma = float(np.sqrt(np.exp(np.clip(log_var_w, -2.5, 2.5))))

        pos_noise = (v_sigma * dt) ** 2 if not is_still else 1e-6
        # Responsive turning: increase heading covariance when specialist detects cornering
        psi_mult = 2.5 if p_turn > 0.4 else 1.0
        heading_noise = (w_sigma * dt) ** 2 * psi_mult if not is_still else 1e-8

        self.P[0, 0] += pos_noise + (self.Q_base[0, 0] * dt if not is_still else 0.0)
        self.P[1, 1] += pos_noise + (self.Q_base[1, 1] * dt if not is_still else 0.0)
        self.P[2, 2] = (v_sigma ** 2) * dt if not is_still else 1e-4
        self.P[3, 3] += heading_noise + (self.Q_base[3, 3] * dt if not is_still else 0.0)

        if is_still:
            # Standstill covariance decoupling: zero out off-diagonal cross-correlations
            # between position and dynamic states (velocity, heading) to eliminate numerical drag.
            self.P[0, 2] = self.P[2, 0] = 0.0
            self.P[1, 2] = self.P[2, 1] = 0.0
            self.P[0, 3] = self.P[3, 0] = 0.0
            self.P[1, 3] = self.P[3, 1] = 0.0


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

        # Standard Kalman Measurement Update
        z = np.array([meas_e, meas_n, gnss_speed, meas_psi], dtype=np.float64)
        H = np.zeros((4, 10))
        H[0, 0] = 1.0  # East
        H[1, 1] = 1.0  # North
        H[2, 2] = 1.0  # Speed
        H[3, 3] = 1.0  # Heading

        y = z - H @ self.x
        y[3] = np.arctan2(np.sin(y[3]), np.cos(y[3]))

        # Compute TRUE innovation error of our neural model prediction vs GPS on this step
        self.model_error_m = float(np.linalg.norm(y[:2]))

        # Synchronize model dead-reckoning state to GPS during GNSS-locked operation
        self.x_model[0] = meas_e
        self.x_model[1] = meas_n
        self.x_model[2] = self.x[2]
        self.x_model[3] = self.x[3]

        # ── Handle GNSS Recovery (No Teleportation Jump!) ─────────────────────
        recovering = False
        if self.is_blackout or self.pending_reconvergence:
            self.is_blackout = False
            self.pending_reconvergence = False
            recovering = True
            pre_update_pos = getattr(self, "_pre_recovery_display_pos", None)
            if pre_update_pos is None:
                pre_update_pos = self.get_display_enu().copy()
            self._pre_recovery_display_pos = None

        if self.is_stationary:
            # Standstill Invariant: reject GPS multipath jitter while verified stopped
            y[0] = 0.0
            y[1] = 0.0
            y[2] = 0.0 - self.x[2]
            y[3] = 0.0

        R = np.diag([
            gnss_accuracy**2, gnss_accuracy**2,
            0.2**2,
            np.radians(1.0)**2
        ])

        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)

        self.x = self.x + K @ y
        # BUG-15 FIX: Re-wrap heading to [-π,π] after Kalman update. Without this, a large
        # heading innovation (e.g. K*y adds +0.5 rad to x[3] near π) pushes x[3] past [-π,π]
        # bounds, causing the next predict() step to compute incorrect dE/dN displacements.
        self.x[3] = float(np.arctan2(np.sin(self.x[3]), np.cos(self.x[3])))
        # Use Joseph form for numerical stability: P = (I-KH)P(I-KH)ᵀ + KRKᵀ
        # This prevents P from becoming asymmetric/negative-definite over long routes
        IKH = np.eye(10) - K @ H
        self.P = IKH @ self.P @ IKH.T + K @ R @ K.T
        # Enforce exact symmetry to eliminate floating-point drift
        self.P = 0.5 * (self.P + self.P.T)

        if recovering:
            # Offset = pre_update_pos - new_kalman_pos, guaranteeing display_enu matches pre_update_pos identically
            self.blend_offset_enu = pre_update_pos - self.x[:2]
            self.blend_remaining_s = self.blend_total_s
            self.x_model[0] = meas_e
            self.x_model[1] = meas_n

        if self.is_stationary and self._stationary_pos_enu is not None:
            self.x[:2] = self._stationary_pos_enu.copy()
            self.x[2] = 0.0
            self.P[0, 2] = self.P[2, 0] = 0.0
            self.P[1, 2] = self.P[2, 1] = 0.0
            self.P[0, 3] = self.P[3, 0] = 0.0
            self.P[1, 3] = self.P[3, 1] = 0.0

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
            self._pre_recovery_display_pos = self.get_display_enu().copy()

    def get_pseudo_gnss_packet(self, timestamp: float) -> PseudoGNSSPacket:
        """
        Emits standard PseudoGNSSPacket consumed identically by navigation layer.
        """
        # Blend offset applied to position for smooth visualization
        disp_enu = self.get_display_enu()
        lat, lon = self.projector.enu_to_geodetic(disp_enu[0], disp_enu[1])
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
