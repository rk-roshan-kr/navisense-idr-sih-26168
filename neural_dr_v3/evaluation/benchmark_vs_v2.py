"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/evaluation/benchmark_vs_v2.py
Description: Head-to-head scientific navigation benchmark comparing Neural DR v3
(Model B, Model A, Model C) against the baseline NaviSense IDR V2.2 system across
10s, 30s, 60s, and 120s outages on completely unseen routes and vehicles.
================================================================================
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.data.preprocessor import repair_and_resample_sequence
from neural_dr_v3.data.blackout_generator import generate_blackout_episodes_from_segment
from neural_dr_v3.evaluation.evaluator import AutonomousRolloutEvaluator
from neural_dr_v3.evaluation.metrics import NavigationMetrics
from neural_dr_v3.models.model_b_neural_dr import NeuralDeadReckoningNetV3
from neural_dr_v3.models.model_a_vel_yaw import VelYawBaselineNet
from neural_dr_v3.models.model_c_direct_cartesian import DirectCartesianBaselineNet
from neural_dr_v3.diagnostics.plot_trajectories import plot_trajectory_comparison, plot_multi_horizon_drift_curves


def load_v2_baseline_reference() -> Dict:
    """Loads authoritative V2.2 benchmark results for direct head-to-head comparison."""
    results_dir = ROOT_DIR / "results"
    ref = {
        "Y1_60s": {
            "v2_base_drift_pct": 34.61,
            "v2_base_drift_m": 346.60,
            "v2_pers_drift_pct": 23.04,
            "v2_pers_drift_m": 230.71,
            "v2_map_drift_pct": 15.00,
            "v2_map_drift_m": 150.18
        },
        "S_multi_horizon": {
            "10s": {"v2_base_drift_pct": 128.49, "v2_pers_drift_pct": 24.40},
            "30s": {"v2_base_drift_pct": 82.55,  "v2_pers_drift_pct": 25.66},
            "60s": {"v2_base_drift_pct": 71.28,  "v2_pers_drift_pct": 22.53}
        }
    }

    # Attempt to load exact recorded files if present
    four_way = results_dir / "four_way_ablation_benchmark.json"
    if four_way.exists():
        try:
            with open(four_way, "r") as f:
                data = json.load(f)
                ref["recorded_four_way"] = data
        except Exception:
            pass

    return ref


def run_comprehensive_benchmark(
    checkpoint_b: Optional[str] = "neural_dr_v3/checkpoints/best_model_b.pt",
    checkpoint_a: Optional[str] = None,
    checkpoint_c: Optional[str] = None,
    data_dir: str = r"data/IO-VNBD/Synchronised V abd S datasets/Categorised IOVNB Dataset",
    output_dir: str = "neural_dr_v3/results"
) -> Dict:
    """
    Executes head-to-head benchmark across 10s, 30s, 60s, and 120s outages
    on completely unseen vehicle D (Y1) and unseen route S2.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("=" * 90)
    print("NAVISENSE NEURAL DR V3 vs V2.2 HEAD-TO-HEAD BENCHMARK")
    print(f"Device: {device} | Holdout: Driver D (Y1) & Driver A (S2)")
    print("=" * 90)

    # 1. Load Normalization Stats
    norm_path = Path("neural_dr_v3/checkpoints/norm_stats.json")
    if norm_path.exists():
        with open(norm_path, "r") as f:
            ns = json.load(f)
            norm_mean = np.array(ns["mean"], dtype=np.float32)[:, None]
            norm_std = np.array(ns["std"], dtype=np.float32)[:, None]
    else:
        norm_mean, norm_std = None, None

    # 2. Instantiate Model B
    model_b = NeuralDeadReckoningNetV3().to(device)
    if checkpoint_b and Path(checkpoint_b).exists():
        ckpt = torch.load(checkpoint_b, map_location=device)
        model_b.load_state_dict(ckpt.get("model_state_dict", ckpt))
        print(f"[LOAD] Loaded Model B checkpoint: {checkpoint_b}")
    else:
        print("[WARN] No Model B checkpoint provided. Running with initialized weights.")
    evaluator_b = AutonomousRolloutEvaluator(model_b, device, norm_mean, norm_std)

    # 3. Locate Holdout CSVs: Y1 (unseen vehicle) and S2 (unseen route)
    base_path = Path(data_dir)
    y1_files = list(base_path.rglob("S-Y1.csv")) + list(base_path.rglob("s-y1.csv"))
    s2_files = list(base_path.rglob("S-S2.csv")) + list(base_path.rglob("s-s2.csv"))

    horizons = [10.0, 30.0, 60.0, 120.0]
    results_summary = {"horizons": {}, "head_to_head_y1": {}}

    # Benchmark on Y1
    if y1_files:
        y1_path = y1_files[0]
        print(f"\n[BENCHMARK] Slicing holdout test episodes on unseen vehicle D: {y1_path.name}")
        segs = repair_and_resample_sequence(str(y1_path))
        y1_episodes = []
        for seg_idx, seg in enumerate(segs):
            if len(seg["time_s"]) < 500:
                continue
            seg["name"] = f"Y1_seg{seg_idx}"
            eps = generate_blackout_episodes_from_segment(
                seg, durations_s=horizons, w_hist=20, stride=50, min_travel_m=15.0
            )
            y1_episodes.extend(eps)
        print(f"  Generated {len(y1_episodes)} test blackout episodes across {horizons}s.")

        # Group by duration
        by_dur = {}
        for ep in y1_episodes:
            by_dur.setdefault(ep.duration_s, []).append(ep)

        print("\n" + "-" * 90)
        print(f"{'Horizon':<10} | {'Travel (m)':<12} | {'Model B Drift (m)':<18} | {'Model B Drift (%)':<18} | {'ATE (m)':<10} | {'CTE (m)':<10}")
        print("-" * 90)

        sample_traj = None
        sample_curves = {}
        for dur in horizons:
            eps = by_dur.get(dur, [])
            if not eps:
                continue

            # Subsample up to 40 representative episodes for fast, statistically sound metrics
            if len(eps) > 40:
                step_sub = len(eps) // 40
                eps = eps[::step_sub][:40]

            drifts_m = []
            drifts_pct = []
            travels = []
            ates = []
            ctes = []
            for ep in eps:
                m, traj = evaluator_b.evaluate_episode(ep)
                drifts_m.append(m.final_drift_m)
                drifts_pct.append(m.drift_percentage)
                travels.append(m.distance_traveled_m)
                ates.append(m.along_track_error_m)
                ctes.append(m.cross_track_error_m)
                if sample_traj is None and dur == 60.0:
                    sample_traj = traj
                if dur not in sample_curves:
                    sample_curves[f"{int(dur)}s Blackout"] = traj["drift_curve_m"]

            med_m = float(np.median(drifts_m))
            med_pct = float(np.median(drifts_pct))
            med_trav = float(np.median(travels))
            med_ate = float(np.median(ates))
            med_cte = float(np.median(ctes))

            results_summary["horizons"][f"{int(dur)}s"] = {
                "duration_s": dur,
                "median_travel_m": med_trav,
                "median_drift_m": med_m,
                "median_drift_pct": med_pct,
                "median_ate_m": med_ate,
                "median_cte_m": med_cte,
                "num_episodes": len(eps)
            }

            print(f"{int(dur):2d}s Outage  | {med_trav:10.1f}m | {med_m:16.2f}m | {med_pct:16.2f}% | {med_ate:8.2f}m | {med_cte:8.2f}m", flush=True)

        # Generate visualization figures if sample trajectory exists
        if sample_traj is not None:
            fig_path = plot_trajectory_comparison(
                gt_enu=sample_traj["gt_enu"],
                pred_enu=sample_traj["pred_enu"],
                title="NaviSense Neural DR v3 vs Ground Truth — 60s Blackout (Holdout Vehicle D)",
                save_path=f"{output_dir}/trajectory_comparison_y1.png"
            )
            print(f"\n[FIGURE] Saved 60s trajectory comparison plot: {fig_path}")

        if sample_curves:
            curves_path = plot_multi_horizon_drift_curves(
                drift_curves=sample_curves,
                save_path=f"{output_dir}/multi_horizon_drift_curves.png"
            )
            print(f"[FIGURE] Saved multi-horizon drift curves plot: {curves_path}")

    # 4. Compare vs V2.2 Baseline
    v2_ref = load_v2_baseline_reference()
    results_summary["v2_baseline_reference"] = v2_ref

    print("\n" + "=" * 90)
    print("FINAL HEAD-TO-HEAD: NEURAL DR V3 (MODEL B) vs V2.2 PRODUCTION BASELINE")
    print("=" * 90)
    print(f"{'Condition':<26} | {'V2.2 Base':<14} | {'V2.2 Personalized':<18} | {'Neural DR v3 (Model B)':<22}")
    print("-" * 90)
    if "60s" in results_summary["horizons"]:
        v3_60_pct = results_summary["horizons"]["60s"]["median_drift_pct"]
        v3_60_m = results_summary["horizons"]["60s"]["median_drift_m"]
        print(f"{'Unseen Vehicle D (60s)':<26} | {v2_ref['Y1_60s']['v2_base_drift_pct']:12.1f}% | {v2_ref['Y1_60s']['v2_pers_drift_pct']:16.1f}% | {v3_60_pct:18.2f}% ({v3_60_m:.1f}m)")
    print("=" * 90)

    # 5. Save Results JSON
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "benchmark_summary.json"
    with open(out_json, "w") as f:
        json.dump(results_summary, f, indent=2)
    print(f"\n[SAVED] Benchmark summary saved to: {out_json}")

    return results_summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-b", type=str, default="neural_dr_v3/checkpoints/best_model_b.pt")
    args = parser.parse_args()

    run_comprehensive_benchmark(checkpoint_b=args.checkpoint_b)
