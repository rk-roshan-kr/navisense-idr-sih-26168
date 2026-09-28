"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/diagnostics/plot_trajectories.py
Description: Trajectory plotting tools producing publication-quality 2D
trajectory comparisons, anchor markers, and multi-horizon drift curves.
================================================================================
"""

from pathlib import Path
from typing import Dict, List, Optional

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def plot_trajectory_comparison(
    gt_enu: np.ndarray,
    pred_enu: np.ndarray,
    title: str = "NaviSense Neural DR v3 Blackout Trajectory",
    save_path: str = "neural_dr_v3/results/trajectory_comparison.png",
    anchor_label: str = "Last Trusted GNSS (Anchor P0)"
) -> str:
    """
    Plots 2D Cartesian trajectory comparison with anchor marker.
    """
    fig, ax = plt.subplots(figsize=(8, 7), dpi=300)

    # 1. Ground Truth Path
    ax.plot(gt_enu[:, 0], gt_enu[:, 1], color="#10B981", linewidth=2.5, label="True Vehicle Path (CAN GT)", zorder=3)

    # 2. Predicted Path
    ax.plot(pred_enu[:, 0], pred_enu[:, 1], color="#3B82F6", linewidth=2.5, linestyle="--", label="Neural DR v3 Estimate", zorder=4)

    # 3. Anchor Marker
    ax.scatter([0.0], [0.0], color="#F59E0B", s=140, marker="*", edgecolors="black", linewidths=1.2, label=anchor_label, zorder=5)

    # 4. Final Points
    ax.scatter(gt_enu[-1, 0], gt_enu[-1, 1], color="#059669", s=70, marker="o", edgecolors="black", label="True Endpoint", zorder=5)
    ax.scatter(pred_enu[-1, 0], pred_enu[-1, 1], color="#1D4ED8", s=70, marker="x", linewidths=2.0, label="Estimated Endpoint", zorder=5)

    # Error line at endpoint
    ax.plot([gt_enu[-1, 0], pred_enu[-1, 0]], [gt_enu[-1, 1], pred_enu[-1, 1]], color="#EF4444", linestyle=":", linewidth=1.5, label="Terminal Drift")

    ax.set_title(title, fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel("Relative East Displacement (m)", fontsize=10)
    ax.set_ylabel("Relative North Displacement (m)", fontsize=10)
    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend(loc="best", framealpha=0.9, fontsize=9)
    ax.set_aspect("equal", adjustable="datalim")

    out_file = Path(save_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(out_file)
    plt.close()
    return str(out_file)


def plot_multi_horizon_drift_curves(
    drift_curves: Dict[str, np.ndarray],
    dt: float = 0.1,
    save_path: str = "neural_dr_v3/results/multi_horizon_drift_curves.png"
) -> str:
    """
    Plots cumulative drift error in meters vs time elapsed for multiple blackout episodes.
    """
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=300)

    colors = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981"]
    for idx, (label, curve) in enumerate(drift_curves.items()):
        t = np.arange(len(curve)) * dt
        color = colors[idx % len(colors)]
        ax.plot(t, curve, label=label, color=color, linewidth=2.0)

    # Draw 10m threshold warning line
    ax.axhline(10.0, color="#EF4444", linestyle="--", alpha=0.7, label="10m Critical Alert Threshold")

    ax.set_title("Drift Error Accumulation Over Blackout Duration", fontsize=12, fontweight="bold", pad=12)
    ax.set_xlabel("Elapsed Blackout Time (seconds)", fontsize=10)
    ax.set_ylabel("Pointwise Position Error (meters)", fontsize=10)
    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend(loc="upper left", framealpha=0.9, fontsize=9)

    out_file = Path(save_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    plt.tight_layout()
    plt.savefig(out_file)
    plt.close()
    return str(out_file)
