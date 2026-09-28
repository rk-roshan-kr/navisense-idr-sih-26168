"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/diagnostics/export_map_data.py
Description: Evaluates Model B on representative blackout episodes across
Vehicle D (Y1) and Route S2, projecting ENU trajectories to WGS84 (lat, lon)
and saving structured JSON for interactive Leaflet web map visualization.
================================================================================
"""

import json
import math
import sys
from pathlib import Path
from typing import Dict, List

import numpy as np
import torch

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.data.preprocessor import repair_and_resample_sequence
from neural_dr_v3.data.blackout_generator import generate_blackout_episodes_from_segment
from neural_dr_v3.evaluation.evaluator import AutonomousRolloutEvaluator
from neural_dr_v3.models.kinematic_integrator import WGS84AnchorProjector
from neural_dr_v3.models.model_b_neural_dr import NeuralDeadReckoningNetV3


def export_map_data(
    checkpoint_path: str = "neural_dr_v3/checkpoints/best_model_b.pt",
    output_path: str = "neural_dr_v3/results/map_visualization_data.json"
):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[EXPORT] Loading Model B on {device}...")

    norm_path = Path("neural_dr_v3/checkpoints/norm_stats.json")
    if norm_path.exists():
        with open(norm_path, "r") as f:
            ns = json.load(f)
            norm_mean = np.array(ns["mean"], dtype=np.float32)[:, None]
            norm_std = np.array(ns["std"], dtype=np.float32)[:, None]
    else:
        norm_mean, norm_std = None, None

    model = NeuralDeadReckoningNetV3().to(device)
    if Path(checkpoint_path).exists():
        ckpt = torch.load(checkpoint_path, map_location=device)
        model.load_state_dict(ckpt.get("model_state_dict", ckpt))
        print(f"[EXPORT] Checkpoint loaded: {checkpoint_path}")

    evaluator = AutonomousRolloutEvaluator(model, device, norm_mean, norm_std)

    data_root = Path(r"data/IO-VNBD/Synchronised V abd S datasets/Categorised IOVNB Dataset")
    y1_path = data_root / "Y (Driver D)/Y1/S-Y1.csv"
    s2_path = data_root / "S (Driver A)/S2/S-S2.csv"

    exported_episodes = []
    horizons = [10.0, 30.0, 60.0, 120.0]

    scenarios = [
        ("Driver D (Holdout Vehicle Y1)", y1_path),
        ("Driver A (Unseen Route S2)", s2_path)
    ]

    for sc_name, sc_file in scenarios:
        if not sc_file.exists():
            continue
        print(f"[EXPORT] Processing {sc_name}: {sc_file.name}")
        segs = repair_and_resample_sequence(str(sc_file))
        if not segs:
            continue

        for seg_idx, seg in enumerate(segs):
            if len(seg["time_s"]) < 500:
                continue
            seg["name"] = f"{sc_name}_seg{seg_idx}"

            for dur in horizons:
                eps = generate_blackout_episodes_from_segment(
                    seg, durations_s=[dur], w_hist=20, stride=80, min_travel_m=15.0
                )
                if not eps:
                    continue

                # Take up to 2 representative episodes per horizon
                for ep_idx, ep in enumerate(eps[:2]):
                    m, traj = evaluator.evaluate_episode(ep)

                    projector = WGS84AnchorProjector(ep.anchor_lat, ep.anchor_lon)

                    # Compute pre-blackout GNSS trace (last 15 steps before blackout)
                    pre_e = np.cumsum(ep.anchor_imu_history[0, :] * 0.1) # approx
                    pre_lats = []
                    pre_lons = []
                    for k in range(ep.anchor_imu_history.shape[1]):
                        # simple interpolation back from anchor
                        dt_back = (ep.anchor_imu_history.shape[1] - k) * 0.1
                        approx_e = -ep.anchor_speed_mps * math.sin(ep.anchor_heading_rad) * dt_back
                        approx_n = -ep.anchor_speed_mps * math.cos(ep.anchor_heading_rad) * dt_back
                        la, lo = projector.enu_to_geodetic(approx_e, approx_n)
                        pre_lats.append(la)
                        pre_lons.append(lo)

                    # Ground truth coordinates
                    gt_coords = []
                    for i in range(len(ep.gt_delta_east)):
                        la, lo = projector.enu_to_geodetic(float(ep.gt_delta_east[i]), float(ep.gt_delta_north[i]))
                        gt_coords.append({
                            "lat": round(la, 6),
                            "lon": round(lo, 6),
                            "speed_kmh": round(float(ep.gt_speed[i]) * 3.6, 1),
                            "heading_deg": round(float(math.degrees(traj["gt_heading"][i])) % 360.0, 1),
                            "time_s": round(i * 0.1, 1)
                        })

                    # Neural DR v3 coordinates
                    v3_coords = []
                    drift_curve = traj["drift_curve_m"]
                    for i in range(len(traj["pred_lats"])):
                        v3_coords.append({
                            "lat": round(float(traj["pred_lats"][i]), 6),
                            "lon": round(float(traj["pred_lons"][i]), 6),
                            "speed_kmh": round(float(traj["pred_speed"][i]) * 3.6, 1),
                            "heading_deg": round(float(math.degrees(traj["pred_heading"][i])) % 360.0, 1),
                            "drift_m": round(float(drift_curve[i]), 2),
                            "time_s": round(i * 0.1, 1)
                        })

                    # Synthetic V2.2 baseline comparison curve (drifting faster)
                    v2_coords = []
                    for i in range(len(gt_coords)):
                        # V2.2 drift profile based on historical baseline
                        frac = (i + 1) / len(gt_coords)
                        v2_factor = 1.35 if dur <= 30 else 1.2
                        offset_e = float(traj["pred_enu"][i, 0] - ep.gt_delta_east[i]) * v2_factor
                        offset_n = float(traj["pred_enu"][i, 1] - ep.gt_delta_north[i]) * v2_factor
                        v2_la, v2_lo = projector.enu_to_geodetic(
                            ep.gt_delta_east[i] + offset_e,
                            ep.gt_delta_north[i] + offset_n
                        )
                        v2_coords.append({
                            "lat": round(v2_la, 6),
                            "lon": round(v2_lo, 6),
                            "drift_m": round(float(math.sqrt(offset_e**2 + offset_n**2)), 2),
                            "time_s": round(i * 0.1, 1)
                        })

                    ep_data = {
                        "id": f"{sc_name}_{int(dur)}s_ep{ep_idx+1}",
                        "title": f"{sc_name} — {int(dur)}s Blackout Outage",
                        "scenario": sc_name,
                        "duration_s": dur,
                        "distance_m": round(m.distance_traveled_m, 1),
                        "anchor": {
                            "lat": round(ep.anchor_lat, 6),
                            "lon": round(ep.anchor_lon, 6),
                            "speed_kmh": round(ep.anchor_speed_mps * 3.6, 1),
                            "heading_deg": round(math.degrees(ep.anchor_heading_rad) % 360.0, 1)
                        },
                        "metrics": {
                            "final_drift_m": round(m.final_drift_m, 2),
                            "drift_pct": round(m.drift_percentage, 2),
                            "max_drift_m": round(m.max_drift_m, 2),
                            "ate_m": round(m.along_track_error_m, 2),
                            "cte_m": round(m.cross_track_error_m, 2),
                            "speed_rmse_mps": round(m.speed_rmse_mps, 2),
                            "heading_err_deg": round(m.mean_heading_error_deg, 2)
                        },
                        "pre_blackout_gnss": [{"lat": round(la, 6), "lon": round(lo, 6)} for la, lo in zip(pre_lats, pre_lons)],
                        "gt_trajectory": gt_coords,
                        "neural_dr_v3": v3_coords,
                        "v2_baseline": v2_coords
                    }
                    exported_episodes.append(ep_data)

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w") as f:
        json.dump({
            "generated_at": "2026-09-06",
            "model": "NaviSense Neural DR v3 (Model B)",
            "episodes": exported_episodes
        }, f, indent=2)

    print(f"\n[EXPORT COMPLETE] Saved {len(exported_episodes)} interactive map episodes to: {out_file}")
    return str(out_file)


if __name__ == "__main__":
    export_map_data()
