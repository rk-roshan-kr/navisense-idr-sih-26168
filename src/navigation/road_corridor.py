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
        self.active_idx = 0

    def sync_progress(self, pos_enu: np.ndarray):
        """Synchronize active_idx to closest waypoint when GNSS is locked."""
        p = np.asarray(pos_enu, dtype=np.float64)
        N = len(self.seg_starts)
        if N > 0:
            if N > 500 and self.active_idx > 0:
                # Fast local window search (+- 150 waypoints around active progress)
                w_start = max(0, self.active_idx - 50)
                w_end = min(N, self.active_idx + 150)
                local_dists = np.linalg.norm(self.seg_starts[w_start:w_end] - p, axis=1)
                min_idx = int(np.argmin(local_dists))
                if local_dists[min_idx] < 60.0:
                    self.active_idx = w_start + min_idx
                    return
            dists = np.linalg.norm(self.seg_starts - p, axis=1)
            self.active_idx = int(np.argmin(dists))

    def reset(self):
        """Reset progress tracker for new scenario or rewind."""
        self.active_idx = 0

    def query_candidate(self, pos_enu: np.ndarray, vehicle_psi: float, window_ahead: int = 25, window_behind: int = 6):
        """
        Finds the most plausible road segment candidate for current position and heading.
        Restricts candidate search to a local forward window around active_idx to
        enforce monotonic route progression and eliminate loop cross-talk / spikes.
        Returns:
          - match_found: bool
          - r_y: signed lateral cross-track error (metres)
          - r_psi: angular heading residual (radians)
          - psi_road: road heading (radians)
          - normal_unit: 2D lateral unit vector [n_E, n_N]
        """
        p = np.asarray(pos_enu, dtype=np.float64)
        K = len(self.diffs)
        if K == 0:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0

        # Monotonic windowed candidate search: strictly excludes old loops / distant segments
        start_k = max(0, self.active_idx - window_behind)
        end_k = min(K, self.active_idx + window_ahead)
        slice_indices = np.arange(start_k, end_k)

        diffs_sub = self.diffs[slice_indices]
        lengths_sub = self.lengths[slice_indices]
        seg_starts_sub = self.seg_starts[slice_indices]
        seg_bearings_sub = self.seg_bearings[slice_indices]

        # Vector from start of each segment to p
        v_to_p = p - seg_starts_sub
        dot = np.sum(v_to_p * diffs_sub, axis=1)
        u = np.clip(dot / (lengths_sub ** 2), 0.0, 1.0)
        closest_pts = seg_starts_sub + u[:, None] * diffs_sub
        dist_vecs = p - closest_pts
        dists = np.linalg.norm(dist_vecs, axis=1)

        heading_diffs = np.abs(wrap_angle(vehicle_psi - seg_bearings_sub))
        valid_mask = (dists < self.max_width) & (heading_diffs < self.max_heading_diff)
        if not np.any(valid_mask):
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0

        valid_local_indices = np.where(valid_mask)[0]
        sigma_p_sq = 4.0 ** 2
        sigma_psi_sq = np.radians(10.0) ** 2

        scores = (dists[valid_local_indices] ** 2) / sigma_p_sq + (heading_diffs[valid_local_indices] ** 2) / sigma_psi_sq
        min_s = np.min(scores)
        exp_neg = np.exp(-0.5 * (scores - min_s))
        probs = exp_neg / np.sum(exp_neg)

        best_sub_idx = int(np.argmax(probs))
        best_prob = float(probs[best_sub_idx])
        best_score = float(scores[best_sub_idx])
        best_local_idx = valid_local_indices[best_sub_idx]
        best_global_idx = int(slice_indices[best_local_idx])

        if best_score > 15.0:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0

        # Advance active progress monotonically
        self.active_idx = max(self.active_idx, best_global_idx)

        best_psi_road = seg_bearings_sub[best_local_idx]
        best_d_vec = dist_vecs[best_local_idx]
        normal_unit = np.array([np.cos(best_psi_road), -np.sin(best_psi_road)], dtype=np.float64)
        r_y = float(np.dot(best_d_vec, normal_unit))
        r_psi = float(wrap_angle(vehicle_psi - best_psi_road))

        return True, r_y, r_psi, best_psi_road, normal_unit, best_prob


    def emergency_recovery_query(self, pos_enu: np.ndarray, vehicle_psi: float, max_dist_m: float = 80.0):
        """
        Emergency road recovery with NO heading gate.
        Used when normal query_candidate fails at sharp turns (heading >45° from road).
        Finds the absolute nearest route segment regardless of vehicle heading.
        Returns gentle corrections proportional to lateral error, capped to avoid snapping.
        """
        start_k = max(0, self.active_idx - 5)
        p = pos_enu[:2]
        v_to_p = p - self.seg_starts[start_k:]
        dot = np.sum(v_to_p * self.diffs[start_k:], axis=1)
        u = np.clip(dot / (self.lengths[start_k:] ** 2), 0.0, 1.0)
        closest_pts = self.seg_starts[start_k:] + u[:, None] * self.diffs[start_k:]
        dist_vecs = p - closest_pts
        dists = np.linalg.norm(dist_vecs, axis=1)

        best_rel_idx = int(np.argmin(dists))
        best_idx = start_k + best_rel_idx
        min_dist = float(dists[best_rel_idx])

        if min_dist > max_dist_m:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0

        self.active_idx = max(self.active_idx, best_idx)
        best_psi_road = float(self.seg_bearings[best_idx])
        normal_unit = np.array([np.cos(best_psi_road), -np.sin(best_psi_road)], dtype=np.float64)
        r_y = float(np.dot(dist_vecs[best_rel_idx], normal_unit))
        r_psi = float(wrap_angle(vehicle_psi - best_psi_road))
        # Confidence: decays with distance (0→max_dist_m → prob 1.0→0)
        prob = float(np.exp(-min_dist / 25.0))

        return True, r_y, r_psi, best_psi_road, normal_unit, prob



def apply_road_corridor_constraint(
    estimator,
    road_network: RoadCorridorNetwork,
    sigma_lane: float = 2.0,            # 1-sigma lane corridor width (metres)
    sigma_psi_road: float = np.radians(4.0) # 1-sigma road heading alignment (radians)
):
    """
    Applies uncertainty-aware Kalman road-corridor constraint update to NavigationStateEstimator.
    x_corrected = x_inertial + K_eff [r_y, r_psi]^T
    K_eff = confidence * K_kalman (soft weighting).
    """
    pos_enu = estimator.x[:2]
    veh_psi = estimator.x[3]
    
    res = road_network.query_candidate(pos_enu, veh_psi)
    found, r_y, r_psi, psi_road, n_unit, confidence = res
    if not found:
        return False, 0.0, 0.0
        
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
    
    # Scale correction by confidence score (gentle guidance when confidence is moderate)
    K_eff = confidence * K
    dx = K_eff @ y
    estimator.x += dx
    # C015 FIX: use arctan2 wrap (consistent with runtime.py road lock)
    estimator.x[3] = float(np.arctan2(np.sin(estimator.x[3]), np.cos(estimator.x[3])))

    # C016 FIX: Joseph form for numerical stability (was simplified (I-KH)P)
    IKH = np.eye(10) - K_eff @ H
    estimator.P = IKH @ estimator.P @ IKH.T + K_eff @ R_map @ K_eff.T
    estimator.P = 0.5 * (estimator.P + estimator.P.T)  # enforce symmetry

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
    # BUG-8a FIX: use arctan2 wrap (not %) to avoid discontinuity spike at heading=0°(North)/360°
    estimator.x[3] = float(np.arctan2(np.sin(estimator.x[3]), np.cos(estimator.x[3])))
    # BUG-8b FIX: Joseph form for numerical stability: was simplified (I-KH)P which goes
    # asymmetric/negative-definite after ~200 steps. Use (I-KH)P(I-KH)^T + KRK^T.
    IKH = np.eye(10) - K @ H
    estimator.P = IKH @ P @ IKH.T + K @ R_map @ K.T
    estimator.P = 0.5 * (estimator.P + estimator.P.T)  # enforce symmetry
    
    return True, edge_id, r_y, r_psi
