/**
 * IDREngine — Universal MotionNet Inference & Dead Reckoning Core
 *
 * Runs the pre-trained Universal MotionNet via ONNX Runtime Web.
 * Input: 9-channel normalized sliding window (2.0s at 10.0 Hz)
 *        [ax, ay, az, gyro_yaw, gyro_pitch, gyro_roll, gx, gy, gz]
 * Output: PseudoGNSSPacket
 *         { lat, lon, speed, heading, accuracy, confidence, source }
 */

class IDREngine {
  constructor() {
    this.GRAVITY = 9.80665;
    this.WINDOW  = 20;   // 2.0 s at 10.0 Hz canonical timeline

    // Rolling IMU buffer — keeps last 20 samples
    this.imuBuffer = []; // [[ax,ay,az,gyaw,gpit,grol,gx,gy,gz]]

    // ONNX session (loaded async)
    this.onnxSession = null;
    this.onnxReady   = false;
    this.onnxLoading = false;
    this.normStats   = null;

    // Personalization state
    this.personalization = {
      mountPitch:      0.0,
      mountRoll:       0.0,
      accelScale:      1.0,
      suspensionGain:  0.85,
    };

    // Online calibration metrics
    this.calibrationSamples = 0;
    this.calibrationScore   = 0.0;

    this.reset();
    this._loadONNX();
  }

  // ── Load ONNX model & Normalization Stats ───────────────────────────────────

  async _loadONNX() {
    if (this.onnxLoading) return;
    this.onnxLoading = true;

    try {
      if (typeof ort === 'undefined') {
        console.warn('IDREngine: onnxruntime-web not loaded. Using physics fallback.');
        return;
      }

      // 1. Fetch Train-Set Normalization Statistics
      try {
        const normRes = await fetch('models/imu_norm_stats.json');
        if (normRes.ok) {
          this.normStats = await normRes.json();
          console.log('IDREngine: Normalization statistics loaded:', this.normStats);
        }
      } catch (e) {
        console.warn('IDREngine: Could not load imu_norm_stats.json, using identity.');
      }

      // 2. Load ONNX Session
      const modelPath = 'models/universal_motion_net.onnx';
      this.onnxSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });

      this.onnxReady = true;
      console.log('IDREngine: Universal MotionNet ONNX loaded —', modelPath);
      this._dispatchEvent('idr-model-ready', { model: modelPath });

    } catch (err) {
      console.warn('IDREngine: ONNX load failed —', err.message, '— using physics fallback');
      this.onnxReady = false;
    }
  }

  // ── Reset state ────────────────────────────────────────────────────────────

  reset(initPos = [0, 0, 0], initSpeed = 0, initHeadingDeg = 0) {
    const headRad = (90 - initHeadingDeg) * Math.PI / 180;

    // B5: Personalised IDR state (our main estimator)
    this.b5_pos          = [...initPos];
    this.b5_speed        = initSpeed;
    this.b5_heading_rad  = headRad;
    this.b5_filtered_accel = 0.0;
    this.b5_uncertainty  = 0.5; // metres

    // B2: Classical EKF+NHC (comparison baseline)
    this.b2_pos   = [...initPos];
    this.b2_speed = initSpeed;
    this.b2_yaw   = headRad;

    // B1: Raw INS (worst case baseline)
    this.b1_pos = [...initPos];
    this.b1_vel = [
      initSpeed * Math.cos(headRad),
      initSpeed * Math.sin(headRad),
      0
    ];
    this.b1_yaw = headRad;

    this.imuBuffer = [];
  }

  // ── Online calibration (call while GNSS active) ─────────────────────────

  calibrate(accel, gyro, gnssSpeedMs, gnssHeadingDeg) {
    this.calibrationSamples++;

    const [ax, ay, az] = accel;
    if (Math.abs(ax) < 3.0 && Math.abs(ay) < 3.0) {
      const pitch = Math.atan2(ay, az);
      const roll  = Math.atan2(ax, az);
      this.personalization.mountPitch = 0.98 * this.personalization.mountPitch + 0.02 * pitch;
      this.personalization.mountRoll  = 0.98 * this.personalization.mountRoll  + 0.02 * roll;
    }

    if (gnssSpeedMs > 3.0 && this.b5_speed > 1.0) {
      const scale = gnssSpeedMs / Math.max(0.1, this.b5_speed);
      if (scale > 0.7 && scale < 1.4) {
        this.personalization.accelScale = 0.98 * this.personalization.accelScale + 0.02 * scale;
      }
    }

    this.calibrationScore = Math.min(1.0, this.calibrationSamples / 300.0);
    return this.calibrationScore;
  }

  // ── Main Step ──────────────────────────────────────────────────────────────

  step(accel, gyro, dt = 0.1, isBlackout = false, gravity = null) {
    const [ax, ay, az] = accel.map(v => isFinite(v) ? v : 0);
    const [gx, gy, gz] = gyro.map(v => isFinite(v) ? v : 0);
    const [gravX, gravY, gravZ] = gravity ? gravity : [0, 0, this.GRAVITY];
    const wz = gx; // gyro_yaw

    // 9-channel frame: [ax, ay, az, gyaw, gpit, grol, gx, gy, gz]
    this.imuBuffer.push([ax, ay, az, gx, gy, gz, gravX, gravY, gravZ]);
    if (this.imuBuffer.length > this.WINDOW) this.imuBuffer.shift();

    // ── B1: Raw Strapdown INS ─────────────────────────────────────────────
    this.b1_yaw   += wz * dt;
    const a1x      = ax * Math.cos(this.b1_yaw) - ay * Math.sin(this.b1_yaw);
    const a1y      = ax * Math.sin(this.b1_yaw) + ay * Math.cos(this.b1_yaw);
    this.b1_vel[0] += a1x * dt;
    this.b1_vel[1] += a1y * dt;
    this.b1_pos[0] += this.b1_vel[0] * dt;
    this.b1_pos[1] += this.b1_vel[1] * dt;

    // ── B2: Classical EKF + NHC ───────────────────────────────────────────
    this.b2_yaw  += wz * dt;
    this.b2_speed = Math.max(0, this.b2_speed + ay * dt);
    this.b2_pos[0]+= this.b2_speed * Math.cos(this.b2_yaw) * dt;
    this.b2_pos[1]+= this.b2_speed * Math.sin(this.b2_yaw) * dt;

    // ── B5: Universal MotionNet Pseudo-GNSS ────────────────────────────────
    let speed5, yawRate5;

    if (this.onnxReady && this.imuBuffer.length === this.WINDOW) {
      this._runONNX(isBlackout).then(packet => {
        if (packet) {
          this._applyNNStep(packet.speed, packet.yawRate, packet.uncertainty);
        }
      });
      speed5   = this.b5_speed;
      yawRate5 = wz;
    } else {
      // Physics fallback
      const p = this.personalization;
      const body_ay = ay * Math.cos(p.mountPitch) - (az - this.GRAVITY) * Math.sin(p.mountPitch);
      this.b5_filtered_accel = p.suspensionGain * this.b5_filtered_accel + (1 - p.suspensionGain) * body_ay;
      const isStationary = Math.abs(body_ay) < 0.12 && Math.abs(wz) < 0.015 && this.b5_speed < 0.4;
      if (isStationary) {
        this.b5_speed = 0;
      } else {
        this.b5_speed = Math.max(0, this.b5_speed + this.b5_filtered_accel * p.accelScale * dt);
      }
      speed5   = this.b5_speed;
      yawRate5 = wz;
    }

    // Propagate B5 ENU position
    this.b5_heading_rad += yawRate5 * dt;
    this.b5_pos[0] += speed5 * Math.cos(this.b5_heading_rad) * dt;
    this.b5_pos[1] += speed5 * Math.sin(this.b5_heading_rad) * dt;

    // Emit PseudoGNSS Packet
    const pseudoGNSSPacket = {
      pos:          [...this.b5_pos],
      speed:        this.b5_speed,
      heading_deg:  (90 - this.b5_heading_rad * 180 / Math.PI + 360) % 360,
      accuracy_m:   this.b5_uncertainty,
      confidence:   Math.max(0.1, Math.min(1.0, 1.0 / (1.0 + this.b5_uncertainty))),
      source:       isBlackout ? "PSEUDO_GNSS" : "REAL_GNSS"
    };

    return {
      b1_pos:      [...this.b1_pos],
      b2_pos:      [...this.b2_pos],
      b5_pos:      [...this.b5_pos],
      b5_speed:    this.b5_speed,
      b5_heading:  pseudoGNSSPacket.heading_deg,
      packet:      pseudoGNSSPacket,
      onnx_active: this.onnxReady,
      calib_score: this.calibrationScore,
    };
  }

  // ── ONNX Inference (async) ──────────────────────────────────────────────────

  async _runONNX(isBlackout) {
    if (!this.onnxReady || this.imuBuffer.length < this.WINDOW) return null;

    try {
      const W = this.WINDOW; // 20
      const C = 9;          // 9 channels
      const data = new Float32Array(C * W);

      const means = this.normStats ? this.normStats.mean : [0, 0, 9.8, 0, 0, 0, 0, 0, 9.8];
      const stds  = this.normStats ? this.normStats.std  : [1.7, 1.6, 0.8, 0.1, 0.25, 0.15, 1, 1, 1];

      for (let t = 0; t < W; t++) {
        const s = this.imuBuffer[t];
        for (let c = 0; c < C; c++) {
          const raw = s[c] || 0.0;
          const norm = (raw - means[c]) / (stds[c] + 1e-6);
          data[c * W + t] = norm;
        }
      }

      const tensor = new ort.Tensor('float32', data, [1, C, W]);
      const feeds  = { imu_window: tensor };
      const output = await this.onnxSession.run(feeds);

      const speed     = output['speed'] ? output['speed'].data[0] : 0;
      const delta_psi = output['delta_psi'] ? output['delta_psi'].data[0] : 0;
      const p_stop    = output['p_stop'] ? output['p_stop'].data[0] : 0;
      const log_var   = output['log_var'] ? output['log_var'].data[0] : 0;

      const uncertainty = Math.sqrt(Math.exp(Math.min(2.0, Math.max(-2.0, log_var))));

      return {
        speed: p_stop > 0.85 ? 0.0 : Math.max(0, speed * this.personalization.accelScale),
        yawRate: delta_psi / (W * 0.1),
        uncertainty: uncertainty,
        source: isBlackout ? "PSEUDO_GNSS" : "REAL_GNSS"
      };

    } catch (err) {
      console.warn('IDREngine ONNX inference error:', err.message);
      return null;
    }
  }

  _applyNNStep(speed, yawRate, uncertainty) {
    this.b5_speed = 0.6 * this.b5_speed + 0.4 * speed;
    this.b5_uncertainty = uncertainty;
  }

  _dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  getCalibrationStatus() {
    return {
      score:      this.calibrationScore,
      pct:        Math.round(this.calibrationScore * 100),
      ready:      this.calibrationScore >= 0.8,
      onnx:       this.onnxReady,
      mountPitch: (this.personalization.mountPitch * 180 / Math.PI).toFixed(2),
      mountRoll:  (this.personalization.mountRoll  * 180 / Math.PI).toFixed(2),
      accelScale: this.personalization.accelScale.toFixed(3),
    };
  }
}

window.IDREngine = IDREngine;
