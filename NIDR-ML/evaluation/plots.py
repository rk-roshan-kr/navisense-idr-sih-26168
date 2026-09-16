"""
Trajectory Visualization & Metric Plotting for NaviSense IDR.

Generates:
1. 2D Horizontal ENU Trajectory Comparison (Reference vs PDR-Net vs Baselines)
2. Cumulative Drift vs Distance Curve (10m, 20m, 30m, 40m milestones)
3. Along-Track vs Cross-Track Error Breakdown
"""

import os
import matplotlib.pyplot as plt
import numpy as np


def plot_trajectory_comparison(
    ref_enu: np.ndarray,
    pdr_pred: np.ndarray,
    baseline_weinberg: np.ndarray = None,
    baseline_di: np.ndarray = None,
    save_path: str = "results/trajectory_comparison.png",
    title: str = "NaviSense IDR: Closed-Loop Trajectory Comparison"
):
    """
    Renders 2D top-down trajectory map in local East-North coordinates.
    """
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    plt.figure(figsize=(10, 8), dpi=150)
    plt.style.use('dark_background')

    # 1. Reference Trajectory
    plt.plot(ref_enu[:, 0], ref_enu[:, 1], 'g--', linewidth=2.2, label='Reference Trajectory (Smoothed GNSS)')
    # Anchor point P0
    plt.scatter(ref_enu[0, 0], ref_enu[0, 1], c='#10B981', s=120, marker='o', zorder=5, label='Anchor P₀ (Frozen GNSS)')

    # 2. NaviSense PDR-Net V1
    plt.plot(pdr_pred[:, 0], pdr_pred[:, 1], color='#38BDF8', linewidth=2.4, label='NaviSense PDR-Net V1 (Ours)')
    plt.scatter(pdr_pred[-1, 0], pdr_pred[-1, 1], color='#38BDF8', s=90, marker='*', zorder=5)

    # 3. Weinberg Step-PDR
    if baseline_weinberg is not None:
        plt.plot(baseline_weinberg[:, 0], baseline_weinberg[:, 1], color='#F59E0B', linewidth=1.8, label='Baseline: Weinberg Step-PDR')

    # 4. Double Integration
    if baseline_di is not None:
        # Clip if exploded too far
        max_span = np.max(np.abs(ref_enu)) * 3.0 + 10.0
        di_clipped = np.clip(baseline_di, -max_span, max_span)
        plt.plot(di_clipped[:, 0], di_clipped[:, 1], color='#EF4444', linestyle=':', linewidth=1.5, label='Baseline: Double Integration (Quadratic Drift)')

    plt.title(title, fontsize=14, fontweight='bold', pad=12, color='#F8FAFC')
    plt.xlabel('East Displacement (meters)', fontsize=11, color='#94A3B8')
    plt.ylabel('North Displacement (meters)', fontsize=11, color='#94A3B8')
    plt.grid(True, linestyle='--', alpha=0.3, color='#334155')
    plt.legend(loc='best', framealpha=0.85, facecolor='#0F172A', edgecolor='#334155', fontsize=10)
    plt.axis('equal')
    plt.tight_layout()
    plt.savefig(save_path, bbox_inches='tight')
    plt.close()
    print(f"Trajectory plot saved to: {save_path}")


def plot_drift_benchmark_curve(
    benchmark_report: dict,
    save_path: str = "results/drift_milestones.png"
):
    """
    Plots drift percentage at 10m, 20m, 30m, 40m against the 20% target threshold.
    """
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    plt.figure(figsize=(8, 5), dpi=150)
    plt.style.use('dark_background')

    distances = [10, 20, 30, 40]
    pdr_drifts = []
    wein_drifts = []

    pdr_ms = benchmark_report['navisense_pdr_net']['milestones']
    wein_ms = benchmark_report['baseline_weinberg_pdr']['milestones']

    for d in distances:
        key = f"{d}m"
        pdr_drifts.append(pdr_ms[key]['drift_pct'] if pdr_ms.get(key) else None)
        wein_drifts.append(wein_ms[key]['drift_pct'] if wein_ms.get(key) else None)

    plt.axhline(y=20.0, color='#EF4444', linestyle='--', linewidth=2.0, label='SIH Outage Drift Target (≤ 20%)')

    valid_d = [d for d, v in zip(distances, pdr_drifts) if v is not None]
    valid_pdr = [v for v in pdr_drifts if v is not None]
    if valid_d:
        plt.plot(valid_d, valid_pdr, marker='o', color='#38BDF8', linewidth=2.2, label='NaviSense PDR-Net V1')

    valid_w_d = [d for d, v in zip(distances, wein_drifts) if v is not None]
    valid_w = [v for v in wein_drifts if v is not None]
    if valid_w_d:
        plt.plot(valid_w_d, valid_w, marker='s', color='#F59E0B', linewidth=1.8, label='Baseline: Weinberg Step-PDR')

    plt.title("40m Benchmark: Cumulative Drift % vs. Outage Distance", fontsize=12, fontweight='bold', color='#F8FAFC')
    plt.xlabel("Outage Distance Traveled (meters)", fontsize=10, color='#94A3B8')
    plt.ylabel("Accumulated Drift Error (%)", fontsize=10, color='#94A3B8')
    plt.ylim(0, max(35.0, max(valid_pdr or [25.0]) * 1.3))
    plt.grid(True, linestyle='--', alpha=0.3, color='#334155')
    plt.legend(loc='upper right', framealpha=0.85, facecolor='#0F172A', edgecolor='#334155')
    plt.tight_layout()
    plt.savefig(save_path, bbox_inches='tight')
    plt.close()
    print(f"Drift milestone curve saved to: {save_path}")
