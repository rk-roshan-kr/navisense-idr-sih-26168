"""
SIH 26168 - Junction-Aware Road Graph & Multi-Branch Scorer (Component 2 & 3)
Replaces unorganized cloud nearest-neighbor matching with a topological road graph
and a 5-term joint branch scorer:
    S_i = w_d S_dist + w_psi S_heading + w_omega S_turn + w_v S_continuity + w_g S_geom

Distinguishes between outgoing branches at junctions/roundabouts (e.g. LEFT vs. RIGHT)
and exposes an auditable Top-K candidate decision table at every step.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
import numpy as np


def wrap_angle(rad: float) -> float:
    """Wraps angle to [-pi, pi]."""
    return float(np.arctan2(np.sin(rad), np.cos(rad)))


@dataclass
class RoadEdge:
    edge_id: str
    osm_id: int
    name: str
    highway: str
    is_oneway: bool
    vertices: np.ndarray          # (N, 2) in local ENU
    seg_starts: np.ndarray        # (N-1, 2)
    seg_ends: np.ndarray          # (N-1, 2)
    seg_diffs: np.ndarray         # (N-1, 2)
    seg_lens: np.ndarray          # (N-1,)
    seg_bearings: np.ndarray      # (N-1,) bearings in [0, 2*pi)
    start_node_id: Optional[str] = None
    end_node_id: Optional[str] = None
    min_e: float = 0.0
    min_n: float = 0.0
    max_e: float = 0.0
    max_n: float = 0.0


try:
    from backend.engine.telemetry_schema import CandidateBranch
except ImportError:
    @dataclass
    class CandidateBranch:
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



class RoadGraph:
    """
    Topological road graph built from OpenStreetMap vector ways.
    Preserves individual road edges, connectivity at shared nodes/junctions,
    and performs 5-term junction-aware branch scoring.
    """

    def __init__(self, max_corridor_width_m: float = 35.0):
        self.edges: Dict[str, RoadEdge] = {}
        self.node_outgoing_edges: Dict[str, List[str]] = {}
        self.max_width = float(max_corridor_width_m)

        # Fast 2D Spatial Grid Index (O(1) localized edge querying)
        self.grid_cell_size: float = 80.0
        self.spatial_grid: Dict[Tuple[int, int], List[str]] = {}

        # Tracking state
        self.current_edge_id: Optional[str] = None
        self.current_seg_idx: int = 0
        self.last_selected_pos: Optional[np.ndarray] = None
        self.approach_bearing: Optional[float] = None
        self.recent_headings: List[float] = []

    def _add_edge_to_grid(self, edge: RoadEdge) -> None:
        min_gx = int(np.floor((edge.min_e - 5.0) / self.grid_cell_size))
        max_gx = int(np.floor((edge.max_e + 5.0) / self.grid_cell_size))
        min_gy = int(np.floor((edge.min_n - 5.0) / self.grid_cell_size))
        max_gy = int(np.floor((edge.max_n + 5.0) / self.grid_cell_size))
        for gx in range(min_gx, max_gx + 1):
            for gy in range(min_gy, max_gy + 1):
                self.spatial_grid.setdefault((gx, gy), []).append(edge.edge_id)

    def get_candidate_edge_ids(self, p: np.ndarray, radius_m: float) -> List[str]:
        min_gx = int(np.floor((p[0] - radius_m) / self.grid_cell_size))
        max_gx = int(np.floor((p[0] + radius_m) / self.grid_cell_size))
        min_gy = int(np.floor((p[1] - radius_m) / self.grid_cell_size))
        max_gy = int(np.floor((p[1] + radius_m) / self.grid_cell_size))
        seen = set()
        candidates = []
        for gx in range(min_gx, max_gx + 1):
            for gy in range(min_gy, max_gy + 1):
                cell_edges = self.spatial_grid.get((gx, gy))
                if cell_edges:
                    for eid in cell_edges:
                        if eid not in seen:
                            seen.add(eid)
                            candidates.append(eid)
        return candidates

    def build_from_osm_ways(
        self,
        osm_ways: List[dict],
        projector,
        map_registrator=None
    ) -> None:
        """
        Ingests OSM way elements, projects into local ENU, applies registration offset,
        and constructs connected RoadEdges and junction node mappings.
        """
        self.edges.clear()
        self.node_outgoing_edges.clear()
        self.spatial_grid.clear()

        # Registration translation [t_E, t_N]
        offset = np.array([0.0, 0.0], dtype=np.float64)
        if map_registrator and getattr(map_registrator, "is_calibrated", False):
            offset = np.array([map_registrator.offset_e, map_registrator.offset_n], dtype=np.float64)

        for way in osm_ways:
            geom = way.get("geometry", [])
            if len(geom) < 2:
                continue

            lats = [pt["lat"] for pt in geom]
            lons = [pt["lon"] for pt in geom]
            e, n = projector.geodetic_to_enu(np.array(lats), np.array(lons))
            pts = np.column_stack([e, n]) + offset

            # Filter adjacent duplicate vertices
            diffs_init = np.diff(pts, axis=0)
            lens_init = np.linalg.norm(diffs_init, axis=1)
            valid_pts_mask = np.concatenate([[True], lens_init > 0.3])
            pts = pts[valid_pts_mask]
            if len(pts) < 2:
                continue

            diffs = np.diff(pts, axis=0)
            lens = np.linalg.norm(diffs, axis=1)
            valid_segs = lens > 0.3
            if not np.any(valid_segs):
                continue

            seg_starts = pts[:-1][valid_segs]
            seg_ends = pts[1:][valid_segs]
            seg_diffs = diffs[valid_segs]
            seg_lens = lens[valid_segs]
            seg_bearings = np.arctan2(seg_diffs[:, 0], seg_diffs[:, 1]) % (2.0 * np.pi)

            way_id = str(way.get("id", len(self.edges)))
            tags = way.get("tags", {})
            name = tags.get("name", tags.get("ref", f"Way_{way_id}"))
            highway = tags.get("highway", "road")
            oneway = tags.get("oneway", "no") in ["yes", "1", "true"]

            nodes = way.get("nodes", [])
            start_nid = str(nodes[0]) if nodes else f"start_{way_id}"
            end_nid = str(nodes[-1]) if nodes else f"end_{way_id}"

            edge = RoadEdge(
                edge_id=way_id,
                osm_id=int(way.get("id", 0)),
                name=name,
                highway=highway,
                is_oneway=oneway,
                vertices=pts,
                seg_starts=seg_starts,
                seg_ends=seg_ends,
                seg_diffs=seg_diffs,
                seg_lens=seg_lens,
                seg_bearings=seg_bearings,
                start_node_id=start_nid,
                end_node_id=end_nid,
                min_e=float(np.min(pts[:, 0])),
                min_n=float(np.min(pts[:, 1])),
                max_e=float(np.max(pts[:, 0])),
                max_n=float(np.max(pts[:, 1])),
            )
            self.edges[way_id] = edge
            self._add_edge_to_grid(edge)

            # Record outgoing connectivity
            self.node_outgoing_edges.setdefault(start_nid, []).append(way_id)
            if not oneway:
                self.node_outgoing_edges.setdefault(end_nid, []).append(way_id)

    def reset(self) -> None:
        """Resets route progress tracking state."""
        self.current_edge_id = None
        self.current_seg_idx = 0
        self.last_selected_pos = None
        self.approach_bearing = None
        self.recent_headings.clear()

    def sync_progress(self, pos_enu: np.ndarray, vehicle_psi: Optional[float] = None) -> None:
        """Synchronizes tracked edge and segment during GNSS-locked operation."""
        p = np.asarray(pos_enu[:2], dtype=np.float64)
        best_edge = None
        best_seg = 0
        min_dist = float("inf")

        candidate_eids = self.get_candidate_edge_ids(p, 60.0)
        for eid in candidate_eids:
            edge = self.edges[eid]
            if p[0] < edge.min_e - 60.0 or p[0] > edge.max_e + 60.0 or \
               p[1] < edge.min_n - 60.0 or p[1] > edge.max_n + 60.0:
                continue

            v_to_p = p - edge.seg_starts
            dot = np.sum(v_to_p * edge.seg_diffs, axis=1)
            u = np.clip(dot / (edge.seg_lens ** 2), 0.0, 1.0)
            closest = edge.seg_starts + u[:, None] * edge.seg_diffs
            dists = np.linalg.norm(p - closest, axis=1)
            seg_min_idx = int(np.argmin(dists))
            seg_min_dist = float(dists[seg_min_idx])

            if vehicle_psi is not None:
                b_raw = edge.seg_bearings[seg_min_idx]
                h_diff = abs(wrap_angle(vehicle_psi - b_raw))
                if not edge.is_oneway:
                    h_diff_rev = abs(wrap_angle(vehicle_psi - (b_raw + np.pi)))
                    h_diff = min(h_diff, h_diff_rev)
                if h_diff > np.radians(60.0):
                    seg_min_dist += 15.0

            if seg_min_dist < min_dist:
                min_dist = seg_min_dist
                best_edge = eid
                best_seg = seg_min_idx

        if best_edge is not None:
            self.current_edge_id = best_edge
            self.current_seg_idx = best_seg
            self.last_selected_pos = p.copy()
            b_selected = float(self.edges[best_edge].seg_bearings[best_seg])
            if vehicle_psi is not None and not self.edges[best_edge].is_oneway:
                diff_fwd = abs(wrap_angle(vehicle_psi - b_selected))
                diff_rev = abs(wrap_angle(vehicle_psi - (b_selected + np.pi)))
                if diff_rev < diff_fwd:
                    b_selected = float((b_selected + np.pi) % (2.0 * np.pi))
            self.approach_bearing = b_selected

    def query_candidate_branches(
        self,
        pos_enu: np.ndarray,
        vehicle_psi: float,
        turn_history_dpsi: float = 0.0,
        search_radius_m: float = 45.0,
        max_candidates: int = 5
    ) -> Tuple[bool, float, float, float, np.ndarray, float, List[CandidateBranch]]:
        """
        Executes the 5-term junction-aware branch scoring algorithm.
        Returns:
            - match_found: bool
            - r_y: signed lateral cross-track error (metres)
            - r_psi: angular heading residual (radians)
            - psi_road: road heading tangent (radians)
            - normal_unit: 2D lateral normal [n_E, n_N]
            - confidence: float score of best branch
            - top_candidates: list of CandidateBranch objects for audit/logging
        """
        p = np.asarray(pos_enu[:2], dtype=np.float64)

        approach_psi = self.approach_bearing if self.approach_bearing is not None else vehicle_psi

        # Dynamic weights: when turning, turn & heading compatibility dominate distance
        is_turning_action = abs(turn_history_dpsi) > np.radians(6.0)
        if is_turning_action:
            w_d, w_psi, w_omega, w_v, w_g = 0.15, 0.35, 0.30, 0.15, 0.05
            # Anticipate turn branch orientation from turn delta
            target_eval_psi = wrap_angle(approach_psi + turn_history_dpsi)
            sigma_d = 16.0  # Wider distance tolerance at junctions
        else:
            w_d, w_psi, w_omega, w_v, w_g = 0.30, 0.30, 0.10, 0.20, 0.10
            target_eval_psi = vehicle_psi
            sigma_d = 6.0

        sigma_psi = np.radians(30.0)
        sigma_omega = np.radians(35.0)

        candidate_list = []

        candidate_eids = self.get_candidate_edge_ids(p, search_radius_m)
        for eid in candidate_eids:
            edge = self.edges[eid]
            if p[0] < edge.min_e - search_radius_m or p[0] > edge.max_e + search_radius_m or \
               p[1] < edge.min_n - search_radius_m or p[1] > edge.max_n + search_radius_m:
                continue

            v_to_p = p - edge.seg_starts
            dot = np.sum(v_to_p * edge.seg_diffs, axis=1)
            u = np.clip(dot / (edge.seg_lens ** 2), 0.0, 1.0)
            closest = edge.seg_starts + u[:, None] * edge.seg_diffs
            dist_vecs = p - closest
            dists = np.linalg.norm(dist_vecs, axis=1)

            close_mask = dists < search_radius_m
            if not np.any(close_mask):
                continue

            close_indices = np.where(close_mask)[0]
            for s_idx in close_indices:
                d_i = float(dists[s_idx])
                psi_road_raw = float(edge.seg_bearings[s_idx])
                u_i = float(u[s_idx])

                # Determine effective road bearing for two-way streets
                if not edge.is_oneway:
                    diff_fwd = abs(wrap_angle(target_eval_psi - psi_road_raw))
                    diff_rev = abs(wrap_angle(target_eval_psi - (psi_road_raw + np.pi)))
                    if diff_rev < diff_fwd:
                        psi_road_i = float((psi_road_raw + np.pi) % (2.0 * np.pi))
                    else:
                        psi_road_i = psi_road_raw
                else:
                    psi_road_i = psi_road_raw

                # 1. Distance Compatibility
                s_dist = float(np.exp(-0.5 * (d_i / sigma_d) ** 2))

                # 2. Heading Compatibility (evaluated against expected target heading)
                delta_psi_i = float(wrap_angle(target_eval_psi - psi_road_i))
                abs_delta_psi = abs(delta_psi_i)
                s_heading = float(np.exp(-0.5 * (abs_delta_psi / sigma_psi) ** 2))

                # 3. Turn Compatibility (Vehicle turning history vs branch turn angle)
                delta_branch_i = float(wrap_angle(psi_road_i - approach_psi))
                turn_err_i = float(wrap_angle(turn_history_dpsi - delta_branch_i))
                s_turn = float(np.exp(-0.5 * (abs(turn_err_i) / sigma_omega) ** 2))

                # 4. Motion Continuity & Topological Connectivity
                veh_h_diff = abs(wrap_angle(vehicle_psi - psi_road_i))
                forward_proj = np.cos(veh_h_diff)
                if forward_proj < -0.3 and not is_turning_action:
                    s_continuity = 0.0
                else:
                    is_connected = False
                    if self.current_edge_id is not None:
                        curr_edge = self.edges.get(self.current_edge_id)
                        if curr_edge and (
                            curr_edge.end_node_id == edge.start_node_id or
                            curr_edge.start_node_id == edge.start_node_id or
                            curr_edge.end_node_id == edge.end_node_id or
                            curr_edge.start_node_id == edge.end_node_id
                        ):
                            is_connected = True

                    if eid == self.current_edge_id:
                        if is_turning_action and abs(turn_err_i) > np.radians(25.0):
                            s_continuity = 0.30
                        else:
                            s_continuity = 1.00
                    elif is_connected:
                        if is_turning_action and abs(turn_err_i) < np.radians(35.0):
                            s_continuity = 1.25  # Connected branch matching turn direction!
                        else:
                            s_continuity = 0.85
                    else:
                        # Unconnected road: heavily penalize transitioning across empty space
                        s_continuity = 0.10

                # 5. Road Geometry (endpoint penalty)
                s_geom = 1.0 - 0.5 * (abs(u_i - 0.5) * 2.0) ** 2

                # Total Joint Score
                total_score = (
                    w_d * s_dist +
                    w_psi * s_heading +
                    w_omega * s_turn +
                    w_v * s_continuity +
                    w_g * s_geom
                )

                candidate_list.append({
                    "edge_id": eid,
                    "seg_idx": s_idx,
                    "road_name": edge.name,
                    "d_vec": dist_vecs[s_idx],
                    "distance_m": d_i,
                    "road_heading": psi_road_i,
                    "heading_err_rad": delta_psi_i,
                    "turn_angle_rad": delta_branch_i,
                    "turn_err_rad": turn_err_i,
                    "s_continuity": s_continuity,
                    "total_score": total_score,
                })

        if not candidate_list:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0, []

        # Sort by total score descending
        candidate_list.sort(key=lambda x: x["total_score"], reverse=True)

        top_candidates: List[CandidateBranch] = []
        for rank, c in enumerate(candidate_list[:max_candidates]):
            c_branch = CandidateBranch(
                candidate_id=f"{c['edge_id']}_{c['seg_idx']}",
                road_name=c["road_name"],
                distance_m=round(c["distance_m"], 2),
                road_heading_deg=round(np.degrees(c["road_heading"]) % 360, 1),
                heading_error_deg=round(np.degrees(c["heading_err_rad"]), 1),
                turn_angle_deg=round(np.degrees(c["turn_angle_rad"]), 1),
                turn_error_deg=round(np.degrees(c["turn_err_rad"]), 1),
                continuity_score=round(c["s_continuity"], 2),
                total_score=round(c["total_score"], 3),
                is_selected=(rank == 0 and c["total_score"] >= 0.20),
            )
            top_candidates.append(c_branch)

        best = candidate_list[0]
        if best["total_score"] < 0.20:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0, top_candidates

        # Update tracking state
        self.current_edge_id = best["edge_id"]
        self.current_seg_idx = best["seg_idx"]
        self.last_selected_pos = p.copy()

        # Only update approach bearing when NOT actively turning
        if not is_turning_action:
            self.approach_bearing = best["road_heading"]

        best_psi_road = best["road_heading"]
        normal_unit = np.array([np.cos(best_psi_road), -np.sin(best_psi_road)], dtype=np.float64)
        r_y = float(np.dot(best["d_vec"], normal_unit))
        # Heading residual between vehicle heading and road heading
        r_psi = float(wrap_angle(vehicle_psi - best_psi_road))
        confidence = float(best["total_score"])

        self.last_top_candidates = top_candidates
        return True, r_y, r_psi, best_psi_road, normal_unit, confidence, top_candidates

    def query_candidate(
        self,
        pos_enu: np.ndarray,
        vehicle_psi: float,
        turn_history_dpsi: float = 0.0,
        **kwargs
    ) -> Tuple[bool, float, float, float, np.ndarray, float]:
        """Drop-in query candidate method returning the 6 standard corridor outputs."""
        found, r_y, r_psi, psi_road, n_unit, prob, top_candidates = self.query_candidate_branches(
            pos_enu, vehicle_psi, turn_history_dpsi=turn_history_dpsi
        )
        self.last_top_candidates = top_candidates
        return found, r_y, r_psi, psi_road, n_unit, prob

    def emergency_recovery_query(
        self,
        pos_enu: np.ndarray,
        vehicle_psi: float,
        max_dist_m: float = 60.0
    ) -> Tuple[bool, float, float, float, np.ndarray, float]:
        """Emergency road recovery when standard heading-gated query yields no match."""
        p = np.asarray(pos_enu[:2], dtype=np.float64)
        min_dist = float("inf")
        best_d_vec = np.zeros(2)
        best_psi = vehicle_psi

        candidate_eids = self.get_candidate_edge_ids(p, max_dist_m)
        for eid in candidate_eids:
            edge = self.edges[eid]
            if p[0] < edge.min_e - max_dist_m or p[0] > edge.max_e + max_dist_m or \
               p[1] < edge.min_n - max_dist_m or p[1] > edge.max_n + max_dist_m:
                continue
            v_to_p = p - edge.seg_starts
            dot = np.sum(v_to_p * edge.seg_diffs, axis=1)
            u = np.clip(dot / (edge.seg_lens ** 2), 0.0, 1.0)
            closest = edge.seg_starts + u[:, None] * edge.seg_diffs
            dist_vecs = p - closest
            dists = np.linalg.norm(dist_vecs, axis=1)
            s_min = int(np.argmin(dists))
            if dists[s_min] < min_dist:
                min_dist = float(dists[s_min])
                best_d_vec = dist_vecs[s_min]
                psi_raw = float(edge.seg_bearings[s_min])
                if not edge.is_oneway:
                    diff_fwd = abs(wrap_angle(vehicle_psi - psi_raw))
                    diff_rev = abs(wrap_angle(vehicle_psi - (psi_raw + np.pi)))
                    if diff_rev < diff_fwd:
                        best_psi = float((psi_raw + np.pi) % (2.0 * np.pi))
                    else:
                        best_psi = psi_raw
                else:
                    best_psi = psi_raw

        if min_dist > max_dist_m:
            return False, 0.0, 0.0, 0.0, np.zeros(2), 0.0

        normal_unit = np.array([np.cos(best_psi), -np.sin(best_psi)], dtype=np.float64)
        r_y = float(np.dot(best_d_vec, normal_unit))
        r_psi = float(wrap_angle(vehicle_psi - best_psi))
        prob = float(np.exp(-min_dist / 20.0))
        return True, r_y, r_psi, best_psi, normal_unit, prob
