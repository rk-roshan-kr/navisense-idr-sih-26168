export type MovementMode =
  | 'Walking'
  | 'Running'
  | 'Vehicle - Windshield'
  | 'Vehicle - Dashboard'
  | 'Vehicle - Cupholder';

export type SessionRole = 'COLLECT' | 'REFERENCE_PHONE' | 'IDR_TEST_PHONE';

export type BlackoutLifecycle =
  | 'IDLE'
  | 'ARMED'
  | 'GNSS_ACTIVE'
  | 'ACQUIRING_LOCK'
  | 'READY_TO_TEST'
  | 'BLACKOUT_ACTIVE'
  | 'RECONVERGING'
  | 'TEST_COMPLETE';

export type MotionRegime =
  | 'stationary'
  | 'steady_walk'
  | 'turning'
  | 'acceleration_braking'
  | 'irregular';

export type EngineType = 'MOCK' | 'EXECUTORCH';

export type MockScenario =
  | 'MOCK_STRAIGHT'
  | 'MOCK_LEFT_TURN'
  | 'MOCK_RIGHT_TURN'
  | 'MOCK_CURVE'
  | 'MOCK_STOP'
  | 'MOCK_S_CURVE'
  | 'MOCK_40M';

export interface SensorTelemetry {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  normA: number;
  actualRateHz: number;
  sampleCount: number;
  unixTimeMs: number;
}

export interface LocationFix {
  latitude: number;
  longitude: number;
  altitude: number;
  speedMps: number;
  bearingDeg: number;
  accuracyM: number;
  unixTimeMs: number;
  elapsedRealtimeNanos: number;
}

export interface NavigationAnchor {
  latitude: number;
  longitude: number;
  altitude: number;
  initialHeadingDeg: number;
  initialSpeedMps: number;
  anchorAccuracyM: number;
  anchorUnixTimeMs: number;
  anchorElapsedRealtimeNanos: number;
}

export interface IdrState {
  latitude: number;
  longitude: number;
  eastOffsetM: number;
  northOffsetM: number;
  headingDeg: number;
  speedMps: number;
  cumulativeDistanceM: number;
  uncertaintyM: number;
  isStationary: boolean;
  speed?: number;
  heading?: number;
  uncertainty?: number;
  mode?: string;
  gnssAvailable?: boolean;
  regime?: MotionRegime;
  stepCount?: number;
}

export interface TrajectoryPoint {
  elapsedRealtimeNanos: number;
  unixTimeMs: number;
  latitude: number;
  longitude: number;
  eastOffsetM?: number;
  northOffsetM?: number;
  headingDeg?: number;
  speedMps?: number;
  cumulativeDistanceM?: number;
  uncertaintyM?: number;
}

export interface SessionInfo {
  sessionId: string;
  role: SessionRole;
  deviceModel: string;
  androidVersion: string;
  participant: string;
  movementMode: MovementMode;
  startElapsedRealtimeNanos: number;
  startUnixTimeMs: number;
  endElapsedRealtimeNanos?: number;
  endUnixTimeMs?: number;
  requestedRateHz?: number;
  actualRateHz?: number;
  imuSampleCount?: number;
  gnssSampleCount?: number;
  folderPath?: string;
  imuFileSize?: number;
  gnssFileSize?: number;
}

export interface EvaluationMetrics {
  totalReferenceDistanceM: number;
  totalIdrDistanceM: number;
  finalErrorM: number;
  maxPointwiseErrorM: number;
  meanPointwiseErrorM: number;
  p95PointwiseErrorM: number;
  finalDriftPercent: number;
  maxDriftPercent: number;
  meanAlongTrackErrorM: number;
  meanCrossTrackErrorM: number;
  isTargetMet: boolean; // drift < 20% for pedestrian internal prototype
  pointwiseErrors: {
    unixTimeMs: number;
    referenceDistanceM: number;
    errorM: number;
    driftPercent: number;
  }[];
}

export interface ModelMetadata {
  model_name: string;
  model_version: string;
  sample_rate_hz: number;
  window_length: number;
  in_channels: number;
  channel_names: string[];
  validated_40m_drift_pct: number;
  quality_gate_passed: boolean;
  approved_for_deployment: boolean;
}
