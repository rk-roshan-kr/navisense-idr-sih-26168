/**
 * SIH 26168 — ONNX-powered IDR Engine
 *
 * Loads universal_motion_net.onnx via onnxruntime-web and runs
 * real neural network inference in the browser.
 *
 * Falls back to physics equations if ONNX isn't loaded yet.
 *
 * Input:  imu_window  [1, 6, 100]  — (batch, channels, time)
 *         channels:   [ax, ay, az, gyro_yaw, gyro_pitch, gyro_roll]
 *
 * Output: speed    (m/s)
 *         yaw_rate (rad/s)
 */

class IDREngine {
  constructor() {
    this.GRAVITY = 9.80665;
    this.WINDOW  = 100;   // 10 s at 10 Hz

    // Rolling IMU buffer — keeps last 100 samples
    this.imuBuffer = [];   // [{ax,ay,az,gx,gy,gz}]

    // ONNX session (loaded async)
    this.onnxSession = null;
    this.onnxReady   = false;
    this.onnxLoading = false;

    // Personalization (calibrated online while GNSS active)
    this.personalization = {
      mountPitch:      0.0,
      mountRoll:       0.0,
      accelScale:      1.0,
      suspensionGain:  0.85,
      dragCoeff:       0.005,
    };

    // Online adapter state (GNSS-supervised calibration)
    this.calibrationSamples = 0;
    this.calibrationScore   = 0.0;   // 0 → 1
    this.speedBuffer        = [];    // recent speed estimates for convergence check

    this.reset();
    this._loadONNX();
  }

  // ── Load ONNX model ──────────────────────────────────────────────────────────

  async _loadONNX() {
    if (this.onnxLoading) return;
    this.onnxLoading = true;

    try {
      // onnxruntime-web must be loaded via <script> in index.html
      if (typeof ort === 'undefined') {
        console.warn('IDREngine: onnxruntime-web not loaded. Using physics fallback.');
        return;
      }

      const modelPath = 'models/universal_motion_net.onnx';
      this.onnxSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],   // runs in browser via WebAssembly
        graphOptimizationLevel: 'all',
      });

      this.onnxReady = true;
      console.log('IDREngine: ONNX model loaded —', modelPath);
      this._dispatchEvent('idr-model-ready', { model: modelPath });

    } catch (err) {
      console.warn('IDREngine: ONNX load failed —', err.message, '— using physics fallback');
      this.onnxReady = false;
    }
  }

  // ── Reset state ──────────────────────────────────────────────────────────────

  reset(initPos = [0, 0, 0], initSpeed = 0, initHeadingDeg = 0) {
    const headRad = (90 - initHeadingDeg) * Math.PI / 180;

    // B5: Personalised IDR state (our main estimator)
    this.b5_pos          = [...initPos];
    this.b5_speed        = initSpeed;
    this.b5_heading_rad  = headRad;
    this.b5_filtered_accel = 0.0;

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

  // ── Online calibration (call while GNSS active) ───────────────────────────

  calibrate(accel, gyro, gnssSpeedMs, gnssHeadingDeg) {
    this.calibrationSamples++;

    // Estimate mount pitch/roll from gravity vector during near-steady motion
    const [ax, ay, az] = accel;
    const norm = Math.sqrt(ax*ax + ay*ay + az*az);
    if (Math.abs(norm - this.GRAVITY) < 0.4) {
      const estPitch = Math.atan2(-ay, Math.sqrt(ax*ax + az*az));
      const estRoll  = Math.atan2(ax, az);
      const alpha = Math.min(0.05, 1.0 / Math.max(1, this.calibrationSamples));
      this.personalization.mountPitch = (1-alpha)*this.personalization.mountPitch + alpha*estPitch;
      this.personalization.mountRoll  = (1-alpha)*this.personalization.mountRoll  + alpha*estRoll;
    }

    // Online accel scale estimation (regression against GNSS speed derivative)
    this.speedBuffer.push({ gnssSpd: gnssSpeedMs, ay });
    if (this.speedBuffer.length > 50) this.speedBuffer.shift();
    if (this.speedBuffer.length >= 50) {
      const spdArr = this.speedBuffer.map(s => s.gnssSpd);
      const ayArr  = this.speedBuffer.map(s => s.ay);
      // dv/dt from GPS speed differences
      const dv = spdArr.slice(1).map((v,i) => (v - spdArr[i]) / 0.1);
      const ay50 = ayArr.slice(1);
      // Linear regression: ay * scale ≈ dv  →  scale = Σ(ay·dv) / Σ(ay²)
      let num = 0, den = 0;
      for (let i = 0; i < dv.length; i++) {
        if (Math.abs(spdArr[i]) > 1.0 && Math.abs(dv[i]) > 0.2) {
          num += ay50[i] * dv[i];
          den += ay50[i] * ay50[i];
        }
      }
      if (den > 0.01) {
        const scale = num / den;
        if (scale > 0.3 && scale < 3.0) {
          this.personalization.accelScale = 0.95 * this.personalization.accelScale + 0.05 * scale;
        }
      }
    }

    // Convergence score (0 → 1 over ~300 samples = 30 seconds at 10 Hz)
    this.calibrationScore = Math.min(1.0, this.calibrationSamples / 300.0);
    return this.calibrationScore;
  }

  // ── Main step ────────────────────────────────────────────────────────────────

  step(accel, gyro, dt = 0.1, isBlackout = false) {
    const [ax, ay, az] = accel.map(v => isFinite(v) ? v : 0);
    const [gx, gy, gz] = gyro.map(v => isFinite(v) ? v : 0);
    const wz = gx;   // gyro_yaw is index 0 in IO-VNBD convention

    // Push to rolling buffer
    this.imuBuffer.push([ax, ay, az, gx, gy, gz]);
    if (this.imuBuffer.length > this.WINDOW) this.imuBuffer.shift();

    // ── B1: Raw Strapdown INS ─────────────────────────────────────────────
    this.b1_yaw   += wz * dt;
    const a1x      = ax * Math.cos(this.b1_yaw) - ay * Math.sin(this.b1_yaw);
    const a1y      = ax * Math.sin(this.b1_yaw) + ay * Math.cos(this.b1_yaw);
    this.b1_vel[0] += a1x * dt;
    this.b1_vel[1] += a1y * dt;
    this.b1_pos[0] += this.b1_vel[0] * dt;
    this.b1_pos[1] += this.b1_vel[1] * dt;

    // ── B2: EKF + NHC ────────────────────────────────────────────────────
    this.b2_yaw  += wz * dt;
    const s2new   = Math.max(0, this.b2_speed + ay * dt);
    this.b2_speed = s2new;
    this.b2_pos[0]+= s2new * Math.cos(this.b2_yaw) * dt;
    this.b2_pos[1]+= s2new * Math.sin(this.b2_yaw) * dt;

    // ── B5: Our system — ONNX or physics fallback ─────────────────────────
    let speed5, yawRate5;

    if (this.onnxReady && this.imuBuffer.length === this.WINDOW) {
      // Run neural network (async result applied next tick via promise)
      this._runONNX().then(result => {
        if (result) {
          this._applyNNStep(result.speed, result.yawRate, dt);
        }
      });
      // Use last physics estimate this tick (NN result arrives async)
      speed5   = this.b5_speed;
      yawRate5 = wz;
    } else {
      // Physics fallback (used until ONNX loads or buffer fills)
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

    // Propagate B5 position
    this.b5_heading_rad += yawRate5 * dt;
    this.b5_pos[0] += speed5 * Math.cos(this.b5_heading_rad) * dt;
    this.b5_pos[1] += speed5 * Math.sin(this.b5_heading_rad) * dt;

    return {
      b1_pos:      [...this.b1_pos],
      b2_pos:      [...this.b2_pos],
      b5_pos:      [...this.b5_pos],
      b5_speed:    this.b5_speed,
      b5_heading:  (90 - this.b5_heading_rad * 180 / Math.PI + 360) % 360,
      onnx_active: this.onnxReady,
      calib_score: this.calibrationScore,
    };
  }

  // ── ONNX inference (async) ───────────────────────────────────────────────────

  async _runONNX() {
    if (!this.onnxReady || this.imuBuffer.length < this.WINDOW) return null;

    try {
      // Build Float32Array: shape [1, 6, 100]
      const W    = this.WINDOW;
      const data = new Float32Array(6 * W);

      for (let t = 0; t < W; t++) {
        const s = this.imuBuffer[t];
        for (let c = 0; c < 6; c++) {
          data[c * W + t] = s[c];
        }
      }

      const tensor = new ort.Tensor('float32', data, [1, 6, W]);
      const feeds  = { imu_window: tensor };
      const output = await this.onnxSession.run(feeds);

      const speed   = output['speed'].data[0];      // m/s
      const yawRate = output['yaw_rate'].data[0];   // rad/s

      return { speed: Math.max(0, speed), yawRate };

    } catch (err) {
      console.warn('IDREngine ONNX inference error:', err.message);
      return null;
    }
  }

  _applyNNStep(speed, yawRate, dt) {
    // Smooth neural network output into state
    this.b5_speed = 0.7 * this.b5_speed + 0.3 * speed;
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  _dispatchEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  getCalibrationStatus() {
    return {
      score:    this.calibrationScore,
      pct:      Math.round(this.calibrationScore * 100),
      ready:    this.calibrationScore >= 0.8,
      onnx:     this.onnxReady,
      mountPitch: (this.personalization.mountPitch * 180 / Math.PI).toFixed(2),
      mountRoll:  (this.personalization.mountRoll  * 180 / Math.PI).toFixed(2),
      accelScale: this.personalization.accelScale.toFixed(3),
    };
  }
}

window.IDREngine = IDREngine;
