"""
SIH 26168 - Map Registration / Datum Offset Compensation Layer (Component 4)
Rigorously separates map-registration error (physical lane/antenna offset) from
navigation/DR dead-reckoning drift.

Models:
    p_aligned = p_OSM + [t_E, t_N]^T

Estimates [t_E, t_N] robustly using Huber M-estimation over trusted GNSS calibration
intervals (K >= 100), rejecting GPS multipath outliers without single-point contamination.
Maintains 3 distinct coordinate tracks:
    1. GT: Ground-truth reference trajectory
    2. OSM_raw: Downloaded raw OSM vector road geometry
    3. OSM_aligned: Map geometry shifted by estimated registration offset [t_E, t_N]^T
"""

import time
from typing import Dict, List, Optional, Tuple
import numpy as np
from scipy.optimize import minimize


def _huber_loss(r: np.ndarray, delta: float = 2.5) -> float:
    """Huber M-estimator loss function."""
    abs_r = np.abs(r)
    quadratic = np.minimum(abs_r, delta)
    linear = abs_r - quadratic
    return float(np.sum(0.5 * quadratic**2 + delta * linear))


def _dist_to_segments(
    pts: np.ndarray,
    seg_starts: np.ndarray,
    seg_diffs: np.ndarray,
    seg_lens_sq: np.ndarray
) -> np.ndarray:
    """
    Computes shortest perpendicular distance from a set of (K, 2) points
    to a set of (M, 2) road segments.
    Returns (K,) array of min distances.
    """
    K = len(pts)
    M = len(seg_starts)
    if K == 0 or M == 0:
        return np.zeros(K, dtype=np.float64)

    # For memory efficiency, compute in batches if K * M is very large
    min_dists = np.empty(K, dtype=np.float64)
    batch_size = 200
    for b in range(0, K, batch_size):
        sub_pts = pts[b : b + batch_size]  # (B, 2)
        # (B, 1, 2) - (1, M, 2) -> (B, M, 2)
        v_to_p = sub_pts[:, None, :] - seg_starts[None, :, :]
        # dot product with seg_diffs (1, M, 2) -> (B, M)
        dot = np.sum(v_to_p * seg_diffs[None, :, :], axis=2)
        u = np.clip(dot / np.maximum(seg_lens_sq[None, :], 1e-6), 0.0, 1.0)
        closest = seg_starts[None, :, :] + u[:, :, None] * seg_diffs[None, :, :]
        dists = np.linalg.norm(sub_pts[:, None, :] - closest, axis=2)
        min_dists[b : b + batch_size] = np.min(dists, axis=1)

    return min_dists


class MapRegistrator:
    """
    Estimates and applies static map registration transforms to OSM vector geometry.
    Maintains provenance and metrics for raw vs aligned error tracks.
    """

    def __init__(self, polylines_raw_enu: Optional[List[np.ndarray]] = None):
        self.raw_polylines: List[np.ndarray] = []
        self.seg_starts: np.ndarray = np.zeros((0, 2), dtype=np.float64)
        self.seg_diffs: np.ndarray = np.zeros((0, 2), dtype=np.float64)
        self.seg_lens_sq: np.ndarray = np.zeros(0, dtype=np.float64)

        self.offset_e: float = 0.0
        self.offset_n: float = 0.0
        self.is_calibrated: bool = False
        self.num_points: int = 0
        self.raw_rmse: float = 0.0
        self.residual_rmse: float = 0.0
        self.estimated_at: str = ""

        if polylines_raw_enu:
            self.set_raw_polylines(polylines_raw_enu)

    def set_raw_polylines(self, polylines_raw_enu: List[np.ndarray]) -> None:
        """Stores raw OSM polylines and precomputes segment geometry."""
        self.raw_polylines = [np.asarray(p, dtype=np.float64) for p in polylines_raw_enu if len(p) >= 2]
        starts = []
        diffs = []
        lens_sq = []
        for p in self.raw_polylines:
            d = np.diff(p, axis=0)
            l_sq = np.sum(d**2, axis=1)
            valid = l_sq > 0.25  # ignore micro-segments < 0.5m
            if np.any(valid):
                starts.append(p[:-1][valid])
                diffs.append(d[valid])
                lens_sq.append(l_sq[valid])

        if starts:
            self.seg_starts = np.vstack(starts)
            self.seg_diffs = np.vstack(diffs)
            self.seg_lens_sq = np.concatenate(lens_sq)
        else:
            self.seg_starts = np.zeros((0, 2), dtype=np.float64)
            self.seg_diffs = np.zeros((0, 2), dtype=np.float64)
            self.seg_lens_sq = np.zeros(0, dtype=np.float64)

    def calibrate_from_gnss(
        self,
        gnss_enu_pts: np.ndarray,
        min_points: int = 100,
        huber_delta: float = 2.5
    ) -> Dict:
        """
        Robustly estimates static map translation [t_E, t_N]^T using trusted GNSS points.
        Minimizes sum_k rho( d_perp(p_k^GNSS, OSM + t) ).
        """
        pts = np.asarray(gnss_enu_pts, dtype=np.float64)
        if len(pts) < min_points:
            raise ValueError(f"Need at least {min_points} GNSS calibration points, got {len(pts)}")
        if len(self.seg_starts) == 0:
            raise ValueError("No raw OSM segments available for calibration.")

        # Filter segments to calibration region bounding box (+ 80m margin)
        min_e = float(np.min(pts[:, 0])) - 80.0
        max_e = float(np.max(pts[:, 0])) + 80.0
        min_n = float(np.min(pts[:, 1])) - 80.0
        max_n = float(np.max(pts[:, 1])) + 80.0

        in_box = (
            (self.seg_starts[:, 0] >= min_e) & (self.seg_starts[:, 0] <= max_e) &
            (self.seg_starts[:, 1] >= min_n) & (self.seg_starts[:, 1] <= max_n)
        )
        if np.sum(in_box) >= 10:
            calib_starts = self.seg_starts[in_box]
            calib_diffs = self.seg_diffs[in_box]
            calib_lens_sq = self.seg_lens_sq[in_box]
        else:
            calib_starts = self.seg_starts
            calib_diffs = self.seg_diffs
            calib_lens_sq = self.seg_lens_sq

        # Baseline distance on raw OSM (t = [0, 0])
        raw_dists = _dist_to_segments(pts, calib_starts, calib_diffs, calib_lens_sq)
        # Filter extreme GPS outliers (> 35m away from any road)
        valid = raw_dists < 35.0
        calib_pts = pts[valid]
        if len(calib_pts) < min_points // 2:
            calib_pts = pts

        raw_dists_valid = raw_dists[valid] if np.any(valid) else raw_dists
        self.raw_rmse = float(np.sqrt(np.mean(raw_dists_valid**2)))

        # Objective function for Huber loss:
        def loss_fn(t: np.ndarray) -> float:
            shifted_starts = calib_starts + t[None, :]
            dists = _dist_to_segments(calib_pts, shifted_starts, calib_diffs, calib_lens_sq)
            return _huber_loss(dists, delta=huber_delta)

        init_guess = np.array([0.0, 0.0], dtype=np.float64)
        res = minimize(loss_fn, init_guess, method="Powell", options={"maxiter": 80, "ftol": 1e-3})

        self.offset_e = float(res.x[0])
        self.offset_n = float(res.x[1])
        self.is_calibrated = True
        self.num_points = len(calib_pts)
        self.estimated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # Evaluate aligned RMSE
        aligned_starts = calib_starts + res.x[None, :]
        aligned_dists = _dist_to_segments(calib_pts, aligned_starts, calib_diffs, calib_lens_sq)
        self.residual_rmse = float(np.sqrt(np.mean(aligned_dists**2)))

        print(
            f"[MapRegistration] Robust Alignment: t = [{self.offset_e:+.2f}, {self.offset_n:+.2f}] m | "
            f"Norm = {np.hypot(self.offset_e, self.offset_n):.2f}m | "
            f"RMSE: {self.raw_rmse:.2f}m -> {self.residual_rmse:.2f}m (K={self.num_points})"
        )

        return self.get_provenance_record()

    def get_aligned_polylines(self) -> List[np.ndarray]:
        """Returns OSM polylines with registration offset [t_E, t_N] applied."""
        t = np.array([self.offset_e, self.offset_n], dtype=np.float64)
        return [p + t for p in self.raw_polylines]

    def compute_cross_track(self, pt_enu: np.ndarray, aligned: bool = True) -> float:
        """Computes shortest perpendicular distance from pt_enu to raw or aligned OSM."""
        if len(self.seg_starts) == 0:
            return 0.0
        p = np.asarray(pt_enu[:2], dtype=np.float64)
        offset = np.array([self.offset_e, self.offset_n]) if aligned else np.zeros(2)
        starts = self.seg_starts + offset
        in_box = (
            (starts[:, 0] >= p[0] - 80.0) & (starts[:, 0] <= p[0] + 80.0) &
            (starts[:, 1] >= p[1] - 80.0) & (starts[:, 1] <= p[1] + 80.0)
        )
        if np.any(in_box):
            dists = _dist_to_segments(p.reshape(1, 2), starts[in_box], self.seg_diffs[in_box], self.seg_lens_sq[in_box])
        else:
            dists = _dist_to_segments(p.reshape(1, 2), starts, self.seg_diffs, self.seg_lens_sq)
        return float(dists[0])

    def get_provenance_record(self) -> Dict:
        """Returns canonical JSON provenance dictionary for OSM cache metadata."""
        norm_m = float(np.hypot(self.offset_e, self.offset_n))
        return {
            "map_registration": {
                "method": "robust_gnss_to_osm_alignment",
                "offset_e_m": round(self.offset_e, 4),
                "offset_n_m": round(self.offset_n, 4),
                "offset_norm_m": round(norm_m, 4),
                "rotation_deg": 0.0,
                "num_calibration_points": int(self.num_points),
                "raw_rmse_m": round(self.raw_rmse, 4),
                "residual_rmse_m": round(self.residual_rmse, 4),
                "estimated_at": self.estimated_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        }

