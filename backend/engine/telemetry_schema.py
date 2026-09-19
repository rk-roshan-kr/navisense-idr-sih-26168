"""
Navisense IDR - Telemetry Packet Schema
Canonical contract for real-time WebSocket streaming.
"""

from typing import List, Optional
from pydantic import BaseModel, Field

class LatLon(BaseModel):
    lat: float
    lon: float

class GroundTruthTelemetry(BaseModel):
    lat: float
    lon: float
    speed_kmh: float
    heading_deg: float

class CandidateBranch(BaseModel):
    candidate_id: str
    road_name: str
    distance_m: float
    road_heading_deg: float
    heading_error_deg: float
    turn_angle_deg: float
    turn_error_deg: float
    continuity_score: float
    total_score: float
    is_selected: bool

class TechnicalProof(BaseModel):
    # Raw 10 Hz physical sensor measurements
    accel_mps2: List[float]  # [ax, ay, az]
    gyro_rads: List[float]   # [roll, pitch, yaw]
    # Learned model inference
    pred_v_mps: float
    pred_wz_rads: float
    pred_stop_prob: float
    uncertainty_m: float
    yaw_residual_rads: Optional[float] = 0.0
    # Online personalization state
    mount_euler_deg: List[float] # [roll, pitch, yaw]
    speed_scale: float
    yaw_scale: float
    # Map hypothesis gating
    map_best_prob: float
    map_accepted: bool
    map_cross_track_m: float
    map_heading_diff_deg: float
    # Dynamic Spatial Chunk Cache Telemetry
    chunk_working_set_kb: Optional[float] = 28.4
    chunk_active_tiles: Optional[int] = 9
    off_road_prob: Optional[float] = 0.0
    road_layer: Optional[int] = 0
    is_on_service: Optional[bool] = False
    # B1 vs B5 Benchmark Scorecard (populated during blackout)
    b1_drift_m: Optional[float] = 0.0          # Raw INS drift vs ground truth
    b5_drift_m: Optional[float] = 0.0          # NaviSense B5 drift vs ground truth
    improvement_factor: Optional[float] = 1.0  # b1_drift_m / b5_drift_m
    # ManeuverSpecialistNet Residual Expert Diagnostics
    specialist_turn_prob: Optional[float] = 0.0
    specialist_stop_prob: Optional[float] = 0.0
    specialist_alpha_t: Optional[float] = 0.0
    specialist_beta_t: Optional[float] = 0.0

    # Along/Cross Track Decomposition & Growth Rate
    along_track_error_m: Optional[float] = 0.0
    cross_track_error_m: Optional[float] = 0.0
    error_growth_rate_mps: Optional[float] = 0.0
    step_error_m: Optional[float] = 0.0
    speed_error_mps: Optional[float] = 0.0
    heading_error_deg: Optional[float] = 0.0

    # Map Registration & Multi-Coordinate Tracks
    map_raw_cross_track_m: Optional[float] = 0.0
    map_aligned_cross_track_m: Optional[float] = 0.0
    map_offset_e_m: Optional[float] = 0.0
    map_offset_n_m: Optional[float] = 0.0
    map_offset_norm_m: Optional[float] = 0.0
    map_rotation_deg: Optional[float] = 0.0
    map_correction_m: Optional[float] = 0.0
    neural_pos_enu: Optional[List[float]] = None
    ekf_pre_map_enu: Optional[List[float]] = None

    # Top-K Candidate Decision Table at Junctions
    top_candidates: List[CandidateBranch] = []
    junction_detected: Optional[bool] = False
    selected_branch_id: Optional[str] = None



class TelemetryPacket(BaseModel):
    timestamp_s: float
    mode: str = Field(description="NORMAL_GNSS | PSEUDO_GNSS | RECONVERGED")
    gnss_available: bool
    blackout_active: bool
    blackout_elapsed_s: float
    
    # Coordinates
    gnss_position: Optional[LatLon] = None  # None during blackout!
    idr_position: LatLon
    ground_truth: GroundTruthTelemetry
    b1_position: Optional[LatLon] = None    # Raw INS (B1 baseline) — None during GNSS active
    
    # Primary Navigation Numbers (Instant 3-Second Comprehension)
    speed_kmh: float
    speed_mps: float
    heading_deg: float
    drift_m: float
    drift_pct: Optional[float] = None          # None when D_outage < 25m or standstill
    normalized_drift_pct: Optional[float] = None  # 100m-normalized stability metric for reference
    outage_distance_m: Optional[float] = 0.0      # Physical travel distance during blackout
    distance_traveled_m: float
    point_error_m: Optional[float] = 0.0
    is_standstill: Optional[bool] = False
    calibrated_pct: Optional[float] = 0.0
    b1_drift_m: Optional[float] = 0.0      # B1 Raw INS drift from ground truth

    
    # Technical Proof Drawer
    technical_proof: TechnicalProof

class ScenarioInfo(BaseModel):
    id: str
    name: str
    description: str
    duration_s: float
    distance_m: float
    canonical_metrics: dict
    road_polyline: List[List[float]] # [[lat, lon], ...]
