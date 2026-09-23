// 3-Layer Error Architecture & Native Kotlin Error Mapper
// Ensures driver never sees raw Java/Kotlin exception strings or malformed stack traces

export interface TriLayerError {
  userMessage: string;
  userDescription: string;
  recoveryActionLabel: string;
  technicalDiagnosticCode: string;
  isRecoverable: boolean;
  recoveryActionType: 'RETRY' | 'OPEN_SETTINGS' | 'CALIBRATE' | 'SELECT_CORRIDOR' | 'RESTART_APP';
}

export type NativeErrorCode =
  | 'ROUTE_FETCH_TIMEOUT'
  | 'MODEL_LOAD_FAILED'
  | 'SENSOR_UNAVAILABLE'
  | 'GNSS_PERMISSION_REVOKED'
  | 'MAP_INIT_FAILED'
  | 'STORAGE_FULL'
  | 'IMU_SAMPLE_GAP_200MS'
  | 'GNSS_INNOVATION_GATE_REJECTED'
  | 'UNKNOWN_NATIVE_EXCEPTION';

const ERROR_REGISTRY: Record<NativeErrorCode, TriLayerError> = {
  ROUTE_FETCH_TIMEOUT: {
    userMessage: 'Unable to Load Route Corridor',
    userDescription: 'Routing network request timed out. You can retry or use a pre-cached offline corridor.',
    recoveryActionLabel: 'RETRY ROUTE',
    technicalDiagnosticCode: 'ERR_NET_ROUTE_FETCH_TIMEOUT_504',
    isRecoverable: true,
    recoveryActionType: 'RETRY',
  },
  MODEL_LOAD_FAILED: {
    userMessage: 'Neural Dead Reckoning Offline',
    userDescription: 'The onboard Universal Motion Net weights could not be initialized in GPU memory. Using kinematic fallback.',
    recoveryActionLabel: 'RELOAD MODEL',
    technicalDiagnosticCode: 'ERR_KOTLIN_TFLITE_MODEL_LOAD_FAILED',
    isRecoverable: true,
    recoveryActionType: 'RETRY',
  },
  SENSOR_UNAVAILABLE: {
    userMessage: 'Vehicle Motion Sensor Disconnected',
    userDescription: 'Phone accelerometer and gyroscope stream was interrupted. Check physical mount firmness.',
    recoveryActionLabel: 'RECALIBRATE IMU',
    technicalDiagnosticCode: 'ERR_NATIVE_SENSOR_HAL_UNAVAILABLE',
    isRecoverable: true,
    recoveryActionType: 'CALIBRATE',
  },
  GNSS_PERMISSION_REVOKED: {
    userMessage: 'Location Permission Required',
    userDescription: 'Precise location permission is required for initial corridor alignment and reconvergence.',
    recoveryActionLabel: 'ENABLE LOCATION',
    technicalDiagnosticCode: 'ERR_ANDROID_PERMISSION_ACCESS_FINE_LOCATION_REVOKED',
    isRecoverable: true,
    recoveryActionType: 'OPEN_SETTINGS',
  },
  MAP_INIT_FAILED: {
    userMessage: 'Offline Map Renderer Failed',
    userDescription: 'Local vector tile rendering encountered a GPU context loss. Fallback schematic mode active.',
    recoveryActionLabel: 'RELOAD MAP',
    technicalDiagnosticCode: 'ERR_WEBVIEW_GL_CONTEXT_LOST',
    isRecoverable: true,
    recoveryActionType: 'RETRY',
  },
  STORAGE_FULL: {
    userMessage: 'Device Storage Full',
    userDescription: 'Insufficient free space to write temporary dead reckoning telemetry buffers.',
    recoveryActionLabel: 'FREE STORAGE',
    technicalDiagnosticCode: 'ERR_IO_DISK_FULL_ENOSPC',
    isRecoverable: false,
    recoveryActionType: 'RESTART_APP',
  },
  IMU_SAMPLE_GAP_200MS: {
    userMessage: 'Sensor Stream Degraded',
    userDescription: 'Detected a sensor sample gap exceeding 200ms. EKF covariance bounds expanded safely.',
    recoveryActionLabel: 'RESYNC SENSORS',
    technicalDiagnosticCode: 'WARN_WATCHDOG_IMU_DROP_200MS',
    isRecoverable: true,
    recoveryActionType: 'CALIBRATE',
  },
  GNSS_INNOVATION_GATE_REJECTED: {
    userMessage: 'GNSS Multipath Anomaly Rejected',
    userDescription: 'Sudden >25m GPS position jump detected and rejected by innovation gate to prevent map snapping distortion.',
    recoveryActionLabel: 'CONTINUE NIDR',
    technicalDiagnosticCode: 'INFO_EKF_INNOVATION_GATE_OUTLIER_REJECTED',
    isRecoverable: true,
    recoveryActionType: 'RETRY',
  },
  UNKNOWN_NATIVE_EXCEPTION: {
    userMessage: 'System Diagnostic Notice',
    userDescription: 'An unexpected native module event occurred. The dead reckoning supervisor isolated the fault.',
    recoveryActionLabel: 'DISMISS',
    technicalDiagnosticCode: 'ERR_RUNTIME_EXCEPTION_ISOLATED',
    isRecoverable: true,
    recoveryActionType: 'RETRY',
  },
};

/**
 * Maps any raw exception (Java/Kotlin or JavaScript) to a controlled 3-layer error object.
 * Guaranteed to never expose raw technical stack traces to the driver.
 */
export function mapToTriLayerError(errorOrCode: any): TriLayerError {
  if (typeof errorOrCode === 'string' && errorOrCode in ERROR_REGISTRY) {
    return ERROR_REGISTRY[errorOrCode as NativeErrorCode];
  }

  const rawMessage = String(errorOrCode?.message || errorOrCode || '');

  // Detect known keywords in raw errors without exposing them
  if (rawMessage.includes('Timeout') || rawMessage.includes('Network') || rawMessage.includes('fetch')) {
    return ERROR_REGISTRY.ROUTE_FETCH_TIMEOUT;
  }
  if (rawMessage.includes('model') || rawMessage.includes('tflite') || rawMessage.includes('neural')) {
    return ERROR_REGISTRY.MODEL_LOAD_FAILED;
  }
  if (rawMessage.includes('sensor') || rawMessage.includes('imu') || rawMessage.includes('accelerometer')) {
    return ERROR_REGISTRY.SENSOR_UNAVAILABLE;
  }
  if (rawMessage.includes('permission') || rawMessage.includes('denied') || rawMessage.includes('revoked')) {
    return ERROR_REGISTRY.GNSS_PERMISSION_REVOKED;
  }
  if (rawMessage.includes('storage') || rawMessage.includes('disk') || rawMessage.includes('space')) {
    return ERROR_REGISTRY.STORAGE_FULL;
  }

  return {
    ...ERROR_REGISTRY.UNKNOWN_NATIVE_EXCEPTION,
    technicalDiagnosticCode: `ERR_${rawMessage.slice(0, 32).replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase() || 'UNKNOWN'}`,
  };
}
