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

class TechnicalProof(BaseModel):
    # Raw 10 Hz physical sensor measurements
    accel_mps2: List[float]  # [ax, ay, az]
    gyro_rads: List[float]   # [roll, pitch, yaw]
    # Learned model inference
    pred_v_mps: float
    pred_wz_rads: float
    pred_stop_prob: float
    uncertainty_m: float
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
    drift_pct: float
    distance_traveled_m: float
    point_error_m: Optional[float] = 0.0
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
