export type AppMode = 'CANONICAL_DATASET' | 'CUSTOM_ROUTE';
export type ViewMode = 'SIMPLIFIED' | 'DETAILED';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GroundTruthTelemetry {
  lat: number;
  lon: number;
  speed_kmh: number;
  heading_deg: number;
}

export interface TechnicalProof {
  accel_mps2: [number, number, number];
  gyro_rads: [number, number, number];
  pred_v_mps: number;
  pred_wz_rads: number;
  pred_stop_prob: number;
  uncertainty_m: number;
  mount_euler_deg: [number, number, number];
  speed_scale: number;
  yaw_scale: number;
  map_best_prob: number;
  map_accepted: boolean;
  map_cross_track_m: number;
  map_heading_diff_deg: number;
  chunk_working_set_kb?: number;
  chunk_active_tiles?: number;
  off_road_prob?: number;
  road_layer?: number;
  is_on_service?: boolean;
}

export interface TelemetryPacket {
  timestamp_s: number;
  mode: 'NORMAL_GNSS' | 'PSEUDO_GNSS' | 'RECONVERGED';
  gnss_available: boolean;
  blackout_active: boolean;
  blackout_elapsed_s: number;
  
  gnss_position: LatLon | null;
  idr_position: LatLon;
  ground_truth: GroundTruthTelemetry;
  
  speed_kmh: number;
  speed_mps: number;
  heading_deg: number;
  drift_m: number;
  drift_pct: number;
  distance_traveled_m: number;
  point_error_m?: number;
  calibrated_pct?: number;
  
  technical_proof: TechnicalProof;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  duration_s: number;
  distance_m: number;
  canonical_metrics: Record<string, string>;
  road_polyline: [number, number][];
}
