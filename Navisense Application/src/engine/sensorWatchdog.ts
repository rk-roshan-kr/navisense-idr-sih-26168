// Sensor Watchdog — Timing and Hardware Integrity Monitor

export interface WatchdogReport {
  healthy: boolean;
  effectiveRateHz: number;
  jitterMs: number;
  dropCount: number;
  lastGapMs: number;
  accelHealthy: boolean;
  gyroHealthy: boolean;
  warning: string | null;
}

export class SensorWatchdog {
  private lastSampleMonotonicMs = 0;
  private sampleCount = 0;
  private dropCount = 0;
  private jitterSumMs = 0;
  private targetDtMs = 100; // 10 Hz nominal
  private lastGapMs = 0;
  private accelHealthy = true;
  private gyroHealthy = true;
  private rateHistory: number[] = [];

  constructor(targetRateHz = 10) {
    this.targetDtMs = 1000 / targetRateHz;
  }

  // Record an incoming sample with monotonic timestamp
  recordSample(monotonicTimestampMs: number, accelPresent = true, gyroPresent = true): WatchdogReport {
    this.accelHealthy = accelPresent;
    this.gyroHealthy = gyroPresent;

    if (this.lastSampleMonotonicMs > 0) {
      const dt = monotonicTimestampMs - this.lastSampleMonotonicMs;
      this.lastGapMs = dt;

      // Detect timing anomaly: negative timestamp or giant gap
      if (dt < 0) {
        // Monotonic violation
        this.dropCount++;
      } else if (dt > 200) {
        // Gap > 200ms is a sensor freeze event
        this.dropCount += Math.floor(dt / this.targetDtMs);
      }

      // Compute jitter
      const jitter = Math.abs(dt - this.targetDtMs);
      this.jitterSumMs += jitter;
      this.sampleCount++;

      // Rolling rate window
      const instantaneousRate = dt > 0 ? 1000 / dt : 10;
      this.rateHistory.push(instantaneousRate);
      if (this.rateHistory.length > 20) {
        this.rateHistory.shift();
      }
    } else {
      this.sampleCount = 1;
    }

    this.lastSampleMonotonicMs = monotonicTimestampMs;
    return this.getReport();
  }

  // Force-inject a sensor failure for testing
  injectSensorFault(faultType: 'DROP_GYRO' | 'TIMESTAMP_GAP' | 'RATE_COLLAPSE' | 'NONE') {
    if (faultType === 'DROP_GYRO') {
      this.gyroHealthy = false;
      this.dropCount += 5;
    } else if (faultType === 'TIMESTAMP_GAP') {
      this.lastGapMs = 450;
      this.dropCount += 4;
    } else if (faultType === 'RATE_COLLAPSE') {
      this.rateHistory = [3.2, 3.5, 4.0];
    } else {
      this.accelHealthy = true;
      this.gyroHealthy = true;
      this.lastGapMs = this.targetDtMs;
    }
  }

  getReport(): WatchdogReport {
    const avgRate =
      this.rateHistory.length > 0
        ? this.rateHistory.reduce((a, b) => a + b, 0) / this.rateHistory.length
        : 10.0;

    const avgJitter = this.sampleCount > 0 ? this.jitterSumMs / this.sampleCount : 0.0;

    let warning: string | null = null;
    let healthy = true;

    if (!this.accelHealthy) {
      healthy = false;
      warning = 'CRITICAL: Accelerometer hardware stream lost!';
    } else if (!this.gyroHealthy) {
      healthy = false;
      warning = 'WARNING: Gyroscope stopped producing events (>200ms gap).';
    } else if (this.lastGapMs > 250) {
      healthy = false;
      warning = `WARNING: Sensor timing gap detected (${this.lastGapMs.toFixed(0)}ms).`;
    } else if (avgRate < 6.0) {
      healthy = false;
      warning = `DEGRADED: Sensor rate collapsed to ${avgRate.toFixed(1)} Hz (expected 10 Hz).`;
    }

    return {
      healthy,
      effectiveRateHz: Number(avgRate.toFixed(1)),
      jitterMs: Number(avgJitter.toFixed(1)),
      dropCount: this.dropCount,
      lastGapMs: Number(this.lastGapMs.toFixed(1)),
      accelHealthy: this.accelHealthy,
      gyroHealthy: this.gyroHealthy,
      warning,
    };
  }

  reset() {
    this.lastSampleMonotonicMs = 0;
    this.sampleCount = 0;
    this.dropCount = 0;
    this.jitterSumMs = 0;
    this.lastGapMs = 0;
    this.accelHealthy = true;
    this.gyroHealthy = true;
    this.rateHistory = [];
  }
}
