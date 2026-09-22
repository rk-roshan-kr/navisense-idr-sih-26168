// Output Validator & Innovation Gate — Safety Sanity Layer

export interface ValidationResult {
  valid: boolean;
  sanitizedVelocityMps: number;
  sanitizedYawRateRads: number;
  sanitizedUncertaintyM: number;
  rejectionReason: string | null;
}

export class OutputValidator {
  private prevVelocityMps = 0;
  private maxVelocityMps = 65.0; // ~234 km/h max vehicle limit
  private maxYawRateRads = 1.5;   // ~86 deg/s maximum plausible turn
  private maxDeltaVMps = 12.0;    // Maximum speed change in 100ms (120 m/s^2 is crash-level)

  validateNeuralOutput(
    rawVelocityMps: number,
    rawYawRateRads: number,
    rawUncertaintyM: number
  ): ValidationResult {
    // 1. Check for NaN or Inf
    if (isNaN(rawVelocityMps) || !isFinite(rawVelocityMps)) {
      return {
        valid: false,
        sanitizedVelocityMps: this.prevVelocityMps,
        sanitizedYawRateRads: 0,
        sanitizedUncertaintyM: Math.max(10.0, rawUncertaintyM || 10.0),
        rejectionReason: 'REJECTED: Model output NaN / Inf velocity',
      };
    }

    if (isNaN(rawYawRateRads) || !isFinite(rawYawRateRads)) {
      return {
        valid: false,
        sanitizedVelocityMps: this.prevVelocityMps,
        sanitizedYawRateRads: 0,
        sanitizedUncertaintyM: Math.max(10.0, rawUncertaintyM || 10.0),
        rejectionReason: 'REJECTED: Model output NaN / Inf yaw rate',
      };
    }

    // 2. Physical range limits
    let v = rawVelocityMps;
    if (v < 0) {
      v = 0; // Forward velocity model cannot be negative
    }
    if (v > this.maxVelocityMps) {
      return {
        valid: false,
        sanitizedVelocityMps: this.prevVelocityMps,
        sanitizedYawRateRads: rawYawRateRads,
        sanitizedUncertaintyM: 15.0,
        rejectionReason: `REJECTED: Unphysical velocity (${(v * 3.6).toFixed(0)} km/h > 230 km/h)`,
      };
    }

    // 3. Temporal continuity check (prevents sudden 40 -> 900 km/h spikes)
    const deltaV = Math.abs(v - this.prevVelocityMps);
    if (deltaV > this.maxDeltaVMps && this.prevVelocityMps > 0) {
      return {
        valid: false,
        sanitizedVelocityMps: this.prevVelocityMps,
        sanitizedYawRateRads: rawYawRateRads,
        sanitizedUncertaintyM: 12.0,
        rejectionReason: `REJECTED: Sudden velocity discontinuity (Δv = ${(deltaV * 3.6).toFixed(0)} km/h in 100ms)`,
      };
    }

    // 4. Clamped Yaw Rate
    const clampedYaw = Math.max(-this.maxYawRateRads, Math.min(this.maxYawRateRads, rawYawRateRads));

    // 5. Positive uncertainty
    const sigma = Math.max(0.1, isFinite(rawUncertaintyM) ? rawUncertaintyM : 1.0);

    this.prevVelocityMps = v;

    return {
      valid: true,
      sanitizedVelocityMps: v,
      sanitizedYawRateRads: clampedYaw,
      sanitizedUncertaintyM: sigma,
      rejectionReason: null,
    };
  }

  // Kalman Innovation Gate on GNSS Updates: rejects sudden > 25m teleport jumps
  validateGnssSample(
    currentFusedLat: number,
    currentFusedLon: number,
    candidateGnssLat: number,
    candidateGnssLon: number,
    maxPlausibleJumpM = 25.0
  ): { accept: boolean; innovationDistM: number; reason: string | null } {
    const distM = this.haversineM(currentFusedLat, currentFusedLon, candidateGnssLat, candidateGnssLon);

    if (distM > maxPlausibleJumpM) {
      return {
        accept: false,
        innovationDistM: Number(distM.toFixed(1)),
        reason: `REJECTED: GNSS jump of ${distM.toFixed(1)}m exceeds physical innovation gate (max ${maxPlausibleJumpM}m)`,
      };
    }

    return {
      accept: true,
      innovationDistM: Number(distM.toFixed(1)),
      reason: null,
    };
  }

  private haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  reset() {
    this.prevVelocityMps = 0;
  }
}
