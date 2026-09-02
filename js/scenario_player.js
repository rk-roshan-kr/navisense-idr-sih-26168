/**
 * NAVISENSE — Scenario World Provider
 * Ingests authoritative IO-VNBD ScenarioWorld payloads (real roads, real sensors, real GNSS).
 */

class ScenarioPlayer {
  constructor() {
    this.scenarios = {};
    this.currentScenarioKey = 'driver_a_s2';
    this.currentWorld = null;
    this.metadata = {};
  }

  async init() {
    try {
      const resp = await fetch('js/iovnbd_benchmark_data.json');
      if (resp.ok) {
        const payload = await resp.json();
        this.metadata = payload.metadata || {};
        this.scenarios = payload.scenarios || {};
        console.log("[ScenarioWorld] Loaded authoritative datasets:", Object.keys(this.scenarios));
      }
    } catch (e) {
      console.error("[ScenarioWorld] Failed to load iovnbd_benchmark_data.json", e);
    }

    this.currentWorld = this.scenarios[this.currentScenarioKey] || Object.values(this.scenarios)[0];
    return this.currentWorld;
  }

  setScenario(key) {
    if (this.scenarios[key]) {
      this.currentScenarioKey = key;
      this.currentWorld = this.scenarios[key];
    }
    return this.currentWorld;
  }

  getCalibrationMetadata() {
    return this.metadata.calibration_parameters || {
      mount_pitch_deg: 0.08,
      mount_roll_deg: 0.31,
      accel_scale: 1.0,
      convergence_score: 1.0
    };
  }
}

window.ScenarioPlayer = ScenarioPlayer;
