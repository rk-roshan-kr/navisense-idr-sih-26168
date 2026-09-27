// Independent, Decoupled State Machines for Fault-Tolerant Vehicle Dead Reckoning

export type NavigationState =
  | 'IDLE'
  | 'PRECHECK'
  | 'ROUTE_READY'
  | 'NAVIGATING'
  | 'ARRIVED';

export type PositionSource =
  | 'GNSS'             // Good satellite fix
  | 'GNSS_DEGRADED'    // High dilution of precision / multipath / low accuracy
  | 'NIDR'             // GNSS blackout — autonomous dead reckoning active
  | 'GNSS_REACQUIRED'  // Satellite returned, confidence-weighted reconvergence in progress
  | 'FUSED';           // High-confidence blended filter

export type ModelHealth =
  | 'NOT_LOADED'
  | 'LOADING'
  | 'READY'
  | 'RUNNING'
  | 'INVALID';

export type MapState =
  | 'ONLINE'
  | 'CACHED'
  | 'PARTIAL'
  | 'UNAVAILABLE';

export type VehicleMotionState =
  | 'STATIONARY'     // ZUPT active (Zero Velocity Update)
  | 'MOVING'         // Standard cruise
  | 'ACCELERATING'   // Positive forward longitudinal force
  | 'BRAKING'        // Deceleration / brake event separated from pothole
  | 'TURNING'        // High yaw rate maneuver
  | 'REVERSING'      // Negative velocity / reverse gear motion
  | 'IRREGULAR';     // Pothole, speed bump, rough road vibration

export interface PreflightItem {
  id: string;
  name: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

export interface PreflightChecklist {
  allPassed: boolean;
  canNavigate: boolean;
  items: PreflightItem[];
}

export interface FailureMatrixEntry {
  failure: string;
  expectedState: PositionSource | string;
  userFacingStatus: string;
  userAction: string;
}

export const FAILURE_MATRIX: FailureMatrixEntry[] = [
  {
    failure: 'GNSS Signal Lost (Tunnel / Underpass)',
    expectedState: 'NIDR',
    userFacingStatus: 'GNSS SIGNAL LOST — NIDR ACTIVE',
    userAction: 'None (Automatic handoff)',
  },
  {
    failure: 'GNSS Jump +25m (Multipath in Urban Canyon)',
    expectedState: 'FUSED / NIDR',
    userFacingStatus: 'GNSS DEGRADED (Rejecting Implausible Jump)',
    userAction: 'None (Kalman innovation gate rejects jump)',
  },
  {
    failure: 'Network / Cellular Lost (Airplane Mode)',
    expectedState: 'NIDR / GNSS',
    userFacingStatus: 'OFFLINE MODE (Using Cached Route & Map)',
    userAction: 'None (Offline road cache active)',
  },
  {
    failure: 'Severe Road Vibration / Pothole',
    expectedState: 'NIDR',
    userFacingStatus: 'IRREGULAR SURFACE (ML Filter Active)',
    userAction: 'None (Separating shock from forward velocity)',
  },
  {
    failure: 'Phone Mount Slipped / Shifted Angle',
    expectedState: 'RECALIBRATING',
    userFacingStatus: 'ALIGNMENT SHIFT DETECTED (Re-anchoring)',
    userAction: 'Keep vehicle steady for 2s',
  },
  {
    failure: 'Vehicle Stopped at Red Light',
    expectedState: 'STATIONARY',
    userFacingStatus: 'STATIONARY (Zero-Velocity Lock / ZUPT)',
    userAction: 'None (Accumulated drift prevented)',
  },
  {
    failure: 'Y-Junction / Flyover Road Ambiguity',
    expectedState: 'NIDR',
    userFacingStatus: 'MULTI-HYPOTHESIS RESOLUTION',
    userAction: 'None (Topology consistency resolves branch)',
  },
  {
    failure: 'GNSS Restored After Long Blackout',
    expectedState: 'GNSS_REACQUIRED',
    userFacingStatus: 'GNSS RESTORED (Smooth Reconvergence)',
    userAction: 'None (Zero teleport jump)',
  },
  {
    failure: 'Gyroscope Hardware Dropout (>200ms)',
    expectedState: 'DEGRADED',
    userFacingStatus: 'SENSOR STREAM DEGRADED (Watchdog Alert)',
    userAction: 'Maintain caution, single-sensor dead reckoning',
  },
];
