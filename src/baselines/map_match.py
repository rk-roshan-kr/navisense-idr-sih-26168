"""
SIH 26168 - Baseline B3: Map-Constrained Dead Reckoning (Map Matching + NHC)
"""

import numpy as np


class SimpleRoadGraph:
    def __init__(self, waypoints_enu):
        self.nodes = np.array(waypoints_enu)[:, :2]
        self.segments = []
        for i in range(len(self.nodes) - 1):
            p1 = self.nodes[i]
            p2 = self.nodes[i + 1]
            seg_vec = p2 - p1
            seg_len = np.linalg.norm(seg_vec)
            if seg_len > 1e-3:
                heading = np.arctan2(seg_vec[0], seg_vec[1])
                self.segments.append({
                    "p1": p1, "p2": p2, "vec": seg_vec, "len": seg_len, "unit": seg_vec / seg_len, "heading": heading
                })

    def snap_to_road(self, point_enu_2d):
        if not self.segments:
            return point_enu_2d, 0.0
            
        p = np.array(point_enu_2d)[:2]
        min_dist = float('inf')
        best_proj = p
        best_heading = 0.0
        
        for seg in self.segments:
            v = seg["vec"]
            w = p - seg["p1"]
            c1 = np.dot(w, v)
            if c1 <= 0:
                proj = seg["p1"]
            else:
                c2 = np.dot(v, v)
                if c2 <= c1:
                    proj = seg["p2"]
                else:
                    b = c1 / c2
                    proj = seg["p1"] + b * v
                    
            dist = np.linalg.norm(p - proj)
            if dist < min_dist:
                min_dist = dist
                best_proj = proj
                best_heading = seg["heading"]
                
        return best_proj, best_heading


def run_map_match_idr(sequence, base_pos_est, road_graph):
    n_steps = len(base_pos_est)
    snapped_pos = np.zeros_like(base_pos_est)
    
    for i in range(n_steps):
        raw_p = base_pos_est[i, :2]
        snapped_2d, _ = road_graph.snap_to_road(raw_p)
        snapped_pos[i, 0] = snapped_2d[0]
        snapped_pos[i, 1] = snapped_2d[1]
        snapped_pos[i, 2] = base_pos_est[i, 2]
        
    return snapped_pos
