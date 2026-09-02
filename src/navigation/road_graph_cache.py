"""
SIH 26168 - Compact Branch-Aware Vector Road Graph & Rolling Corridor Cache
Implements:
  1. RoadGraph: Topological Vector Graph (Nodes, Edges, Connectivity, Polylines).
  2. RollingCorridorCache: L0 (Immediate), L1 (Corridor), L2 (Branches), L3 (Disk Store).
     Prefetches network distance d_graph ahead while connected; evicts trailing road chunks.
  3. MultiHypothesisMapMatcher: Branch-aware hypothesis scoring:
     S_i = w_p * d_perp + w_psi * d_psi + w_topo * C_i + w_motion * M_i.
  4. Honest Failure Policy: Emits confidence state (HIGH -> MEDIUM -> LOW/INERTIAL_FALLBACK).
"""

from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional
import numpy as np

def wrap_angle(rad: float) -> float:
    return float(np.arctan2(np.sin(rad), np.cos(rad)))

@dataclass
class RoadNode:
    node_id: str
    lat: float
    lon: float
    east: float
    north: float
    connected_edges: List[str] = field(default_factory=list)

@dataclass
class RoadEdge:
    edge_id: str
    start_node: str
    end_node: str
    polyline_enu: np.ndarray        # (K, 2) [East, North] centerline vertices
    length_m: float
    heading_rad: float              # nominal bearing in radians [0, 2*pi)
    road_class: str = "primary"     # "motorway", "primary", "secondary", "residential"
    is_oneway: bool = False
    speed_limit_mps: float = 13.9   # default 50 km/h

class RoadGraph:
    """
    Topological vector graph maintaining network connectivity and geometry.
    Memory footprint: ~15-25 KB per kilometer of road network.
    """
    def __init__(self):
        self.nodes: Dict[str, RoadNode] = {}
        self.edges: Dict[str, RoadEdge] = {}
        self.adjacency: Dict[str, List[str]] = {} # edge_id -> [connected_edge_id, ...]
        
    def add_node(self, node: RoadNode):
        self.nodes[node.node_id] = node

    def add_edge(self, edge: RoadEdge):
        self.edges[edge.edge_id] = edge
        if edge.start_node in self.nodes:
            self.nodes[edge.start_node].connected_edges.append(edge.edge_id)
        if edge.end_node in self.nodes:
            self.nodes[edge.end_node].connected_edges.append(edge.edge_id)

    def build_adjacency(self):
        """Builds directed edge-to-edge topological connectivity."""
        self.adjacency = {eid: [] for eid in self.edges}
        for eid, edge in self.edges.items():
            end_node = self.nodes.get(edge.end_node)
            if end_node:
                for next_eid in end_node.connected_edges:
                    if next_eid != eid:
                        next_edge = self.edges[next_eid]
                        # If starting from end_node or bidirectional
                        if next_edge.start_node == edge.end_node or not next_edge.is_oneway:
                            self.adjacency[eid].append(next_eid)

    def get_reachable_subgraph(self, start_edge_id: str, max_graph_dist_m: float = 4000.0) -> Dict[str, float]:
        """
        Dijkstra search computing shortest network distance d_graph to reachable edges.
        Returns: {edge_id: shortest_network_distance_m}
        """
        if start_edge_id not in self.edges:
            return {}
            
        distances: Dict[str, float] = {start_edge_id: 0.0}
        queue = [(0.0, start_edge_id)]
        
        while queue:
            # Sort by distance
            queue.sort(key=lambda x: x[0])
            d_curr, u_eid = queue.pop(0)
            
            if d_curr > distances.get(u_eid, float('inf')):
                continue
                
            u_len = self.edges[u_eid].length_m
            for v_eid in self.adjacency.get(u_eid, []):
                new_d = d_curr + u_len
                if new_d <= max_graph_dist_m and new_d < distances.get(v_eid, float('inf')):
                    distances[v_eid] = new_d
                    queue.append((new_d, v_eid))
                    
        return distances

class RollingCorridorCache:
    """
    Rolling corridor cache implementing L0/L1/L2/L3 memory hierarchy.
    Prefetches upcoming road corridors ahead of vehicle; evicts trailing road chunks.
    """
    def __init__(
        self,
        full_graph: RoadGraph,
        corridor_ahead_m: float = 4000.0,  # L1 horizon: 4 km ahead
        corridor_behind_m: float = 1500.0, # Evict older than 1.5 km behind
        branch_depth_m: float = 1200.0     # L2 lateral branch expansion
    ):
        self.full_graph = full_graph
        self.corridor_ahead = float(corridor_ahead_m)
        self.corridor_behind = float(corridor_behind_m)
        self.branch_depth = float(branch_depth_m)
        
        # Active hierarchy
        self.L0_immediate_edges: List[str] = [] # Current + immediate neighbors
        self.L1_active_corridor: List[str] = [] # Forward 4 km corridor
        self.L2_branch_edges: List[str] = []    # Lateral branches at intersections
        self.current_edge_id: Optional[str] = None
        
        # State & Connectivity
        self.is_connected = True  # Network connectivity flag
        self.cache_confidence = "HIGH" # "HIGH", "MEDIUM", "LOW_INERTIAL"
        self.distance_to_cache_exit_m = corridor_ahead_m

    def update_vehicle_position(self, current_pos_enu: np.ndarray, vehicle_heading_rad: float, best_edge_id: Optional[str]):
        """
        Updates cache window as vehicle moves. Prefetches if connected; evicts trailing edges.
        """
        if best_edge_id and best_edge_id in self.full_graph.edges:
            self.current_edge_id = best_edge_id
            
        if not self.current_edge_id:
            # Fallback: query nearest edge in full graph if connected
            if self.is_connected:
                self._bootstrap_initial_edge(current_pos_enu, vehicle_heading_rad)

        if not self.current_edge_id:
            self.cache_confidence = "LOW_INERTIAL"
            return

        # If network is available, prefetch ahead
        if self.is_connected:
            self._prefetch_and_evict(current_pos_enu)
        else:
            # Under network outage, operate strictly from local cache
            self._evaluate_offline_boundary(current_pos_enu)

    def _bootstrap_initial_edge(self, pos_enu: np.ndarray, heading_rad: float):
        min_dist = float('inf')
        best_id = None
        for eid, edge in self.full_graph.edges.items():
            pts = edge.polyline_enu
            dists = np.linalg.norm(pts - pos_enu, axis=1)
            d_min = float(np.min(dists))
            h_diff = abs(wrap_angle(heading_rad - edge.heading_rad))
            if d_min < 30.0 and h_diff < np.radians(45.0):
                if d_min < min_dist:
                    min_dist = d_min
                    best_id = eid
        self.current_edge_id = best_id

    def _prefetch_and_evict(self, current_pos_enu: np.ndarray):
        """Expands forward graph corridor (L1) and branches (L2)."""
        reachable = self.full_graph.get_reachable_subgraph(self.current_edge_id, self.corridor_ahead)
        
        self.L0_immediate_edges = [self.current_edge_id] + self.full_graph.adjacency.get(self.current_edge_id, [])
        self.L1_active_corridor = list(reachable.keys())
        
        # L2: find branches with d_graph <= branch_depth
        self.L2_branch_edges = [eid for eid, d in reachable.items() if d <= self.branch_depth and eid != self.current_edge_id]
        
        # Cache confidence is HIGH while connected and corridor loaded
        self.cache_confidence = "HIGH"
        # Estimate remaining distance to end of cached corridor
        max_dist = max(reachable.values()) if reachable else 0.0
        self.distance_to_cache_exit_m = max_dist

    def _evaluate_offline_boundary(self, current_pos_enu: np.ndarray):
        """Monitors remaining corridor distance when network is dead."""
        if not self.L1_active_corridor:
            self.cache_confidence = "LOW_INERTIAL"
            return

        # Find closest point among all cached edges
        min_d = float('inf')
        for eid in self.L1_active_corridor:
            edge = self.full_graph.edges[eid]
            d = float(np.min(np.linalg.norm(edge.polyline_enu - current_pos_enu, axis=1)))
            if d < min_d:
                min_d = d

        if min_d > 40.0:
            # Left cached corridor!
            self.cache_confidence = "LOW_INERTIAL"
        elif self.distance_to_cache_exit_m < 500.0:
            self.cache_confidence = "MEDIUM"
        else:
            self.cache_confidence = "HIGH"

    def get_active_cache_edges(self) -> List[RoadEdge]:
        """Returns union of L0, L1, L2 active edges stored in local memory."""
        all_eids = set(self.L0_immediate_edges + self.L1_active_corridor + self.L2_branch_edges)
        return [self.full_graph.edges[eid] for eid in all_eids if eid in self.full_graph.edges]

    def get_memory_footprint_kb(self) -> float:
        """Estimates RAM footprint of cached vector graph."""
        active_edges = self.get_active_cache_edges()
        total_pts = sum(len(e.polyline_enu) for e in active_edges)
        # 16 bytes per 2D float64 point + 200 bytes metadata per edge
        bytes_total = total_pts * 16 + len(active_edges) * 200
        return bytes_total / 1024.0

class MultiHypothesisMapMatcher:
    """
    Branch-aware road matcher maintaining candidate hypotheses across intersections.
    S_i = w_p * d_perp + w_psi * d_psi + w_topo * C_i + w_motion * M_i
    """
    def __init__(
        self,
        corridor_cache: RollingCorridorCache,
        w_p: float = 1.0,         # weight for perpendicular lateral distance
        w_psi: float = 15.0,      # weight for heading discrepancy (rad)
        w_topo: float = 8.0,      # penalty for non-adjacent topological jump
        w_motion: float = 6.0     # weight for yaw-rate turn consistency
    ):
        self.cache = corridor_cache
        self.w_p = w_p
        self.w_psi = w_psi
        self.w_topo = w_topo
        self.w_motion = w_motion
        self.last_matched_edge: Optional[str] = None

    def match(
        self,
        pos_enu: np.ndarray,
        veh_heading_rad: float,
        veh_yaw_rate_rads: float = 0.0
    ) -> Tuple[bool, Optional[str], float, float, float, np.ndarray]:
        """
        Evaluates candidate edges from local corridor cache.
        Returns:
          - matched: bool
          - best_edge_id: str
          - r_y: signed lateral cross-track error (m)
          - r_psi: angular heading residual (rad)
          - road_heading: road bearing (rad)
          - normal_unit: lateral normal vector [n_E, n_N]
        """
        candidate_edges = self.cache.get_active_cache_edges()
        if not candidate_edges:
            return False, None, 0.0, 0.0, 0.0, np.zeros(2)

        p = np.asarray(pos_enu, dtype=np.float64)
        best_score = float('inf')
        best_result = None
        best_eid = None

        for edge in candidate_edges:
            pts = edge.polyline_enu
            if len(pts) < 2:
                continue

            diffs = np.diff(pts, axis=0)
            lengths = np.linalg.norm(diffs, axis=1)
            valid = lengths > 0.1
            if not np.any(valid):
                continue
            diffs = diffs[valid]
            lengths = lengths[valid]
            starts = pts[:-1][valid]

            v_to_p = p - starts
            dot = np.sum(v_to_p * diffs, axis=1)
            u = np.clip(dot / (lengths ** 2), 0.0, 1.0)
            closest = starts + u[:, None] * diffs
            dists = np.linalg.norm(p - closest, axis=1)

            min_idx = int(np.argmin(dists))
            d_perp = float(dists[min_idx])
            
            # Subsegment bearing
            sub_bearing = float(np.arctan2(diffs[min_idx, 0], diffs[min_idx, 1]) % (2.0 * np.pi))
            d_psi = abs(wrap_angle(veh_heading_rad - sub_bearing))

            # Topological connectivity penalty
            c_topo = 0.0
            if self.last_matched_edge and edge.edge_id != self.last_matched_edge:
                adjacent = self.cache.full_graph.adjacency.get(self.last_matched_edge, [])
                if edge.edge_id not in adjacent:
                    c_topo = 1.0 # Discontinuous jump penalty

            # Motion / Curvature consistency
            # If vehicle is turning sharply right (+yaw), prefer edges that curve right
            m_motion = 0.0
            if abs(veh_yaw_rate_rads) > 0.05:
                # Turn direction: + = right (clockwise in bearing)
                turn_direction = np.sign(veh_yaw_rate_rads)
                heading_change = wrap_angle(sub_bearing - veh_heading_rad)
                if np.sign(heading_change) != turn_direction:
                    m_motion = 0.8 # Inconsistent with active steering

            # Candidate hypothesis score
            score = (
                self.w_p * d_perp +
                self.w_psi * d_psi +
                self.w_topo * c_topo +
                self.w_motion * m_motion
            )

            # Gate: discard candidates farther than 30m or heading mismatch > 45 deg
            if d_perp < 30.0 and d_psi < np.radians(45.0):
                if score < best_score:
                    best_score = score
                    best_eid = edge.edge_id
                    normal_unit = np.array([np.cos(sub_bearing), -np.sin(sub_bearing)], dtype=np.float64)
                    r_y = float(np.dot(p - closest[min_idx], normal_unit))
                    r_psi = float(wrap_angle(veh_heading_rad - sub_bearing))
                    best_result = (r_y, r_psi, sub_bearing, normal_unit)

        if best_eid and best_result:
            self.last_matched_edge = best_eid
            r_y, r_psi, road_h, n_vec = best_result
            return True, best_eid, r_y, r_psi, road_h, n_vec

        return False, None, 0.0, 0.0, 0.0, np.zeros(2)
