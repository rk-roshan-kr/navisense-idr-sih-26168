/**
 * SIH 26168 - Real-Time Dynamic Charts (Drift Curve E(t) & IMU Oscilloscope)
 */

class ChartRenderer {
  constructor(driftCanvasId, imuCanvasId) {
    this.driftCanvas = document.getElementById(driftCanvasId);
    this.imuCanvas = document.getElementById(imuCanvasId);
    
    this.driftCtx = this.driftCanvas ? this.driftCanvas.getContext('2d') : null;
    this.imuCtx = this.imuCanvas ? this.imuCanvas.getContext('2d') : null;
    
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    [this.driftCanvas, this.imuCanvas].forEach(c => {
      if (!c || !c.parentElement) return;
      const rect = c.parentElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      c.width = rect.width * this.dpr;
      c.height = rect.height * this.dpr;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(this.dpr, this.dpr);
      }
    });
  }

  renderDriftChart(history, maxDuration = 30) {
    if (!this.driftCtx || !this.driftCanvas) return;
    const ctx = this.driftCtx;
    const w = this.driftCanvas.width / this.dpr;
    const h = this.driftCanvas.height / this.dpr;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#181818';
    ctx.lineWidth = 1;
    for (let y = 0.25; y < 1.0; y += 0.25) {
      ctx.beginPath();
      ctx.moveTo(0, h * y);
      ctx.lineTo(w, h * y);
      ctx.stroke();
    }

    if (!history || history.length < 2) return;

    let maxErr = 25.0;
    history.forEach(pt => {
      maxErr = Math.max(maxErr, pt.err_raw || 0, pt.err_ekf || 0, pt.err_pers || 0);
    });
    maxErr = Math.min(maxErr, 500.0);

    const xMap = (idx) => (idx / Math.max(history.length - 1, 1)) * w;
    const yMap = (val) => h - (Math.min(val, maxErr) / maxErr) * (h - 20) - 10;

    // Draw Raw INS (Red)
    this._drawLine(ctx, history.map((p, i) => ({ x: xMap(i), y: yMap(p.err_raw) })), '#ff3344', 1.5, [2, 2]);

    // Draw EKF+NHC (Orange)
    this._drawLine(ctx, history.map((p, i) => ({ x: xMap(i), y: yMap(p.err_ekf) })), '#ff8800', 1.8);

    // Draw Base IDR (Yellow)
    this._drawLine(ctx, history.map((p, i) => ({ x: xMap(i), y: yMap(p.err_base) })), '#eebb00', 1.8);

    // Draw Personalized IDR (Blue)
    this._drawLine(ctx, history.map((p, i) => ({ x: xMap(i), y: yMap(p.err_pers) })), '#0088ff', 2.5);

    // Scale label
    ctx.fillStyle = '#666666';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(`Scale: ${maxErr.toFixed(0)}m`, 8, 14);
  }

  // Alias
  renderDriftCurve(history) {
    this.renderDriftChart(history);
  }

  renderImuOscilloscope(accelHistory, gyroHistory) {
    if (!this.imuCtx || !this.imuCanvas) return;
    const ctx = this.imuCtx;
    const w = this.imuCanvas.width / this.dpr;
    const h = this.imuCanvas.height / this.dpr;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0, 0, w, h);

    // Center zero line
    ctx.strokeStyle = '#181818';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!accelHistory || accelHistory.length < 2) return;

    const xStep = w / Math.max(accelHistory.length - 1, 1);

    // Accel Y (Forward)
    const ptsAy = accelHistory.map((a, i) => ({
      x: i * xStep,
      y: (h / 2) - (a[1] * 8)
    }));
    this._drawLine(ctx, ptsAy, '#00e5ff', 1.5);

    // Gyro Z (Yaw rate)
    if (gyroHistory && gyroHistory.length >= 2) {
      const ptsGz = gyroHistory.map((g, i) => ({
        x: i * xStep,
        y: (h / 2) - (g[2] * 40)
      }));
      this._drawLine(ctx, ptsGz, '#eebb00', 1.5);
    }
  }

  // Alias
  renderIMUOscilloscope(accelHistory, gyroHistory) {
    this.renderImuOscilloscope(accelHistory, gyroHistory);
  }

  _drawLine(ctx, points, color, width, dash = []) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

window.ChartRenderer = ChartRenderer;
