"""
SIH 26168 - Uncertainty-Aware Road-Corridor Constraint (Machine 3)
Applies soft Kalman-constrained road-corridor updates:
  - Lateral cross-track error: r_y = d_perp(p, road)
  - Heading alignment error:   r_psi = wrap(psi_vehicle - psi_road)
  - Kalman state update:      x_corr = x_inertial + K [r_y, r_psi]^T
Governed strictly by state error covariance P and road corridor covariance R_map.
Avoids hard snapping and teleports.
"""

import numpy as np

def wrap_angle(rad):
    return np.arctan2(np.sin(rad), np.cos(rad))

class RoadCorridorNetwork:
    """
    Maintains road centerline geometry in local ENU coordinates.
    Provides nearest road segment candidate, cross-track distance, and road heading.
    """
    def __init__(self, enu_waypoints: np.ndarray, max_corridor_width_m: float = 35.0, max_heading_diff_deg: float = 45.0):
        """
        enu_waypoints: (M, 2) array of [East, North] centerline vertices.
        """
        self.waypoints = np.asarray(enu_waypoints, dtype=np.float64)
        self.max_width = float(max_corridor_width_m)
        self.max_heading_diff = np.radians(float(max_heading_diff_deg))
        
        # Precompute segment vectors and bearings
        self.diffs = np.diff(self.waypoints, axis=0) # (M-1, 2)
        self.lengths = np.linalg.norm(self.diffs, axis=1) # (M-1,)
        # Avoid zero-length segments
        valid = self.lengths > 0.5
        self.diffs = self.diffs[valid]
        self.lengths = self.lengths[valid]
        self.seg_starts = self.waypoints[:-1][valid]
        self.seg_ends   = self.waypoints[1:][valid]
        
        # Segment bearing clockwise from North (psi_road in [0, 2*pi))
        self.seg_bearings = np.arctan2(self.diffs[:, 0], self.diffs[:, 1]) % (2.0 * np.pi)

    def query_candidate(self, pos_enu: np.ndarray, vehicle_psi: float):
        """
        Finds the most plausible road segment candidate for current position and heading.
        Returns:
          - match_found: bool
          - r_y: signed lateral cross-track error (metres)
          - r_psi: angular heading residual (radians)
          - psi_road: road heading (radians)
          - normal_unit: 2D lateral unit vector [n_E, n_N]
        """
        p = np.asarray(pos_enu, dtype=np.float64)
        
        # Vector from start of each segment to p
        v_to_p = p - self.seg_starts # (K, 2)
        
        # Projection factor along each segment: u in [0, 1]
        dot = np.sum(v_to_p * self.diffs, axis=1)
        u = np.clip(dot / (self.lengths ** 2), 0.0, 1.0)
        
        # Closest points on segments
        closest_pts = self.seg_starts + u[:, None] * self.diffs
        
        # Perpendicular distance to each segment
        dist_vecs = p - closest_pts
        dists = np.linalg.norm(dist_vecs, axis=1)
        
        # Heading compatibility
        heading_diffs = np.abs(wrap_angle(vehicle_psi - self.seg_bearings))
        
        # Candidate score: penalize distance + angular mismatch
        # Only consider segments within corridor width and reasonable heading
        valid_mask = (dists < self.max_width) & (heading_diffs < self.max_heading_diff)
        
        if not np.any(valid_mask):
            return False, 0.0, 0.0, 0.0, np.zeros(2)
            
        valid_indices = np.where(valid_mask)[0]
        # Score combines distance and angular alignment
        scores = dists[valid_indices] + 15.0 * heading_diffs[valid_indices]
        best_idx = valid_indices[np.argmin(scores)]
        
        best_psi_road = self.seg_bearings[best_idx]
        best_d_vec = dist_vecs[best_idx]
        
        # Unit lateral normal (perpendicular to road bearing: 90 deg right)
        # road_dir = [sin(psi), cos(psi)], right_normal = [cos(psi), -sin(psi)]
        normal_unit = np.array([np.cos(best_psi_road), -np.sin(best_psi_road)], dtype=np.float64)
        
        # Signed lateral error (positive if vehicle is to the right of road)
        r_y = float(np.dot(best_d_vec, normal_unit))
        r_psi = float(wrap_angle(vehicle_psi - best_psi_road))
        
        return True, r_y, r_psi, best_psi_road, normal_unit

def apply_road_corridor_constraint(
    estimator,
    road_network: RoadCorridorNetwork,
    sigma_lane: float = 2.0,            # 1-sigma lane corridor width (metres)
    sigma_psi_road: float = np.radians(4.0) # 1-sigma road heading alignment (radians)
):
    """
    Applies uncertainty-aware Kalman road-corridor constraint update to NavigationStateEstimator.
    x_corrected = x_inertial + K [r_y, r_psi]^T
    """
    pos_enu = estimator.x[:2]
    veh_psi = estimator.x[3]
    
    found, r_y, r_psi, psi_road, n_unit = road_network.query_candidate(pos_enu, veh_psi)
    if not found:
        return False, 0.0, 0.0
        
    # Observation vector y = [ -r_y, -r_psi ] (driving residual to zero)
    # y = z_map - h(x) = 0 - [r_y, r_psi]
    y = np.array([-r_y, -r_psi], dtype=np.float64)
    
    # Observation matrix H (2 x 10)
    H = np.zeros((2, 10), dtype=np.float64)
    # Row 0: Lateral position constraint
    H[0, 0] = n_unit[0] # East
    H[0, 1] = n_unit[1] # North
    # Row 1: Heading constraint
    H[1, 3] = 1.0       # Heading psi
    
    # Measurement noise R_map
    R_map = np.diag([
        sigma_lane ** 2,
        sigma_psi_road ** 2
    ])
    
    # Kalman update
    P = estimator.P
    S = H @ P @ H.T + R_map
    K = P @ H.T @ np.linalg.inv(S)
    
    # State correction
    dx = K @ y
    estimator.x += dx
    estimator.x[3] = estimator.x[3] % (2.0 * np.pi)
    
    # Covariance update: P = (I - K H) P
    estimator.P = (np.eye(10) - K @ H) @ P
    
    return True, r_y, r_psi

def apply_graph_corridor_constraint(
    estimator,
    matcher,
    sigma_lane: float = 2.0,                # 1-sigma lane corridor width (metres)
    sigma_psi_road: float = np.radians(4.0),    # 1-sigma road heading alignment (radians)
    veh_yaw_rate_rads: float = 0.0
):
    """
    Applies uncertainty-aware Kalman road-corridor constraint using MultiHypothesisMapMatcher.
    Maintains hypothesis scoring across intersection branches.
    """
    pos_enu = estimator.x[:2]
    veh_psi = estimator.x[3]
    
    found, edge_id, r_y, r_psi, psi_road, n_unit = matcher.match(pos_enu, veh_psi, veh_yaw_rate_rads)
    if not found:
        return False, None, 0.0, 0.0
        
    y = np.array([-r_y, -r_psi], dtype=np.float64)
    
    H = np.zeros((2, 10), dtype=np.float64)
    H[0, 0] = n_unit[0] # East
    H[0, 1] = n_unit[1] # North
    H[1, 3] = 1.0       # Heading psi
    
    R_map = np.diag([
        sigma_lane ** 2,
        sigma_psi_road ** 2
    ])
    
    P = estimator.P
    S = H @ P @ H.T + R_map
    K = P @ H.T @ np.linalg.inv(S)
    
    dx = K @ y
    estimator.x += dx
    estimator.x[3] = estimator.x[3] % (2.0 * np.pi)
    estimator.P = (np.eye(10) - K @ H) @ P
    
    return True, edge_id, r_y, r_psi
