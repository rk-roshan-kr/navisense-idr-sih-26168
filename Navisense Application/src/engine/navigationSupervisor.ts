// Navigation State Supervisor — Authoritative Fusion & State Decision Engine

import type {
  NavigationState,
  PositionSource,
  ModelHealth,
  MapState,
  VehicleMotionState,
} from './stateMachines';
import type { WatchdogReport } from './sensorWatchdog';

export interface SupervisoryStatus {
  navigationState: NavigationState;
  positionSource: PositionSource;
  modelHealth: ModelHealth;
  mapState: MapState;
  motionState: VehicleMotionState;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL';
  userFacingBanner: string;
  userFacingStatus: string;
  activeFailureNotification: string | null;
}

export class NavigationSupervisor {
  private navState: NavigationState = 'IDLE';
  private posSource: PositionSource = 'GNSS';
  private modelHealth: ModelHealth = 'READY';
  private mapState: MapState = 'CACHED';
  private motionState: VehicleMotionState = 'MOVING';

  evaluate(
    isNavigating: boolean,
    isBlackout: boolean,
    gnssAccuracyM: number,
    watchdogReport: WatchdogReport,
    modelValid: boolean,
    mapCandidatesCount: number,
    speedKmh: number,
    reconverging: boolean
  ): SupervisoryStatus {
    // 1. Navigation State
    if (!isNavigating) {
      this.navState = 'IDLE';
    } else {
      this.navState = 'NAVIGATING';
    }

    // 2. Vehicle Motion State
    if (speedKmh < 1.0) {
      this.motionState = 'STATIONARY'; // ZUPT (Zero-velocity update active)
    } else if (speedKmh > 80.0) {
      this.motionState = 'MOVING';
    } else {
      this.motionState = 'MOVING';
    }

    // 3. Model Health
    if (!modelValid) {
      this.modelHealth = 'INVALID';
    } else {
      this.modelHealth = 'RUNNING';
    }

    // 4. Map State
    if (mapCandidatesCount > 0) {
      this.mapState = 'CACHED';
    } else {
      this.mapState = 'PARTIAL';
    }

    // 5. Position Source Evaluation (Core Supervisor Decision)
    let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'CRITICAL' = 'HIGH';
    let userFacingBanner = 'GNSS: Connected';
    let userFacingStatus = 'Normal Satellite Navigation';
    let activeFailureNotification: string | null = null;

    if (isBlackout) {
      this.posSource = 'NIDR';
      confidenceLevel = 'HIGH'; // NIDR road-locked is high confidence dead reckoning
      userFacingBanner = 'GNSS SIGNAL LOST — NIDR ACTIVE';
      userFacingStatus = 'NIDR Dead Reckoning Active';

      if (!watchdogReport.healthy) {
        confidenceLevel = 'MEDIUM';
        userFacingBanner = 'NIDR ACTIVE (SENSOR DEGRADED)';
        activeFailureNotification = watchdogReport.warning;
      }
    } else if (reconverging) {
      this.posSource = 'GNSS_REACQUIRED';
      confidenceLevel = 'HIGH';
      userFacingBanner = 'GNSS RESTORED (RECONVERGING)';
      userFacingStatus = 'Smooth Exponential Reconvergence';
    } else if (gnssAccuracyM > 15.0) {
      this.posSource = 'GNSS_DEGRADED';
      confidenceLevel = 'MEDIUM';
      userFacingBanner = 'GNSS DEGRADED (LOW ACCURACY)';
      userFacingStatus = 'Multipath Dilution (Fusing NIDR)';
      activeFailureNotification = `High dilution of precision (±${gnssAccuracyM.toFixed(1)}m)`;
    } else if (!watchdogReport.healthy) {
      this.posSource = 'GNSS';
      confidenceLevel = 'MEDIUM';
      userFacingBanner = 'GNSS ACTIVE (SENSOR WARNING)';
      activeFailureNotification = watchdogReport.warning;
    } else {
      this.posSource = 'GNSS';
      confidenceLevel = 'HIGH';
      userFacingBanner = 'GNSS: Connected';
      userFacingStatus = 'High Precision Satellite Lock';
    }

    return {
      navigationState: this.navState,
      positionSource: this.posSource,
      modelHealth: this.modelHealth,
      mapState: this.mapState,
      motionState: this.motionState,
      confidenceLevel,
      userFacingBanner,
      userFacingStatus,
      activeFailureNotification,
    };
  }

  setNavigationState(state: NavigationState) {
    this.navState = state;
  }
}
