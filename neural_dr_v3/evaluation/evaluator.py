"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/evaluation/evaluator.py
Description: Pure autonomous blackout rollout engine with strict zero-GNSS
enforcement and sanity verification gates.
================================================================================
"""

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from neural_dr_v3.data.blackout_generator import BlackoutEpisode
from neural_dr_v3.evaluation.metrics import NavigationMetrics, compute_navigation_metrics
from neural_dr_v3.models.causal_backbone import CausalTCNBackbone
from neural_dr_v3.models.kinematic_integrator import KinematicIntegrator, WGS84AnchorProjector
from neural_dr_v3.models.model_b_neural_dr import NeuralDeadReckoningNetV3


class AutonomousRolloutEvaluator:
    """
    Executes pure autonomous dead-reckoning rollouts on blackout episodes.
    Enforces strict isolation from ground truth and GNSS during outage.
    """
    def __init__(
        self,
        model: nn.Module,
        device: torch.device,
        norm_mean: Optional[np.ndarray] = None,
        norm_std: Optional[np.ndarray] = None
    ):
        self.model = model.to(device)
        self.model.eval()
        self.device = device
        self.norm_mean = norm_mean
        self.norm_std = norm_std

    @torch.no_grad()
    def evaluate_episode(self, episode: BlackoutEpisode) -> Tuple[NavigationMetrics, Dict[str, np.ndarray]]:
        """
        Runs an autonomous rollout on a single blackout episode.
        """
        T = episode.num_steps
        w_hist = episode.anchor_imu_history.shape[1]

        # Combine history + blackout IMU stream
        full_imu = np.hstack([episode.anchor_imu_history, episode.imu_stream])
        if self.norm_mean is not None and self.norm_std is not None:
            full_imu = (full_imu - self.norm_mean) / (self.norm_std + 1e-6)

        t_imu = torch.from_numpy(full_imu.astype(np.float32)).unsqueeze(0).to(self.device)
        t_v0 = torch.tensor([episode.anchor_speed_mps], dtype=torch.float32, device=self.device)
        t_psi0 = torch.tensor([episode.anchor_heading_rad], dtype=torch.float32, device=self.device)

        # Execute pure autonomous rollout (zero GT feedback)
        preds = self.model.forward_rollout(
            imu_full=t_imu,
            anchor_v0=t_v0,
            anchor_psi0=t_psi0,
            w_hist=w_hist,
            scheduled_sample_prob=1.0
        )

        pred_de = preds["pred_delta_e"].squeeze(0).cpu().numpy()
        pred_dn = preds["pred_delta_n"].squeeze(0).cpu().numpy()
        pred_spd = preds["pred_speed"].squeeze(0).cpu().numpy()
        pred_dpsi = preds["pred_delta_psi"].squeeze(0).cpu().numpy()
        pred_stop = preds["p_stop"].squeeze(0).cpu().numpy()

        pred_heading = episode.anchor_heading_rad + pred_dpsi

        # Ground truth references
        gt_de = episode.gt_delta_east
        gt_dn = episode.gt_delta_north
        gt_spd = episode.gt_speed
        gt_heading = episode.anchor_heading_rad + episode.gt_delta_psi
        gt_stop = episode.gt_p_stop

        pred_enu = np.stack([pred_de, pred_dn], axis=-1)
        gt_enu = np.stack([gt_de, gt_dn], axis=-1)

        metrics = compute_navigation_metrics(
            pred_enu=pred_enu,
            gt_enu=gt_enu,
            pred_speed=pred_spd,
            gt_speed=gt_spd,
            pred_heading_rad=pred_heading,
            gt_heading_rad=gt_heading,
            pred_stop=pred_stop,
            gt_stop=gt_stop,
            dt=episode.dt
        )

        # Global coordinate reconstruction via WGS84 projector
        projector = WGS84AnchorProjector(episode.anchor_lat, episode.anchor_lon)
        pred_lats = []
        pred_lons = []
        for de, dn in zip(pred_de, pred_dn):
            lat, lon = projector.enu_to_geodetic(de, dn)
            pred_lats.append(lat)
            pred_lons.append(lon)

        trajectories = {
            "pred_enu": pred_enu,
            "gt_enu": gt_enu,
            "pred_lats": np.array(pred_lats),
            "pred_lons": np.array(pred_lons),
            "pred_speed": pred_spd,
            "gt_speed": gt_spd,
            "pred_heading": pred_heading,
            "gt_heading": gt_heading,
            "drift_curve_m": np.sqrt(np.sum((pred_enu - gt_enu)**2, axis=1))
        }

        return metrics, trajectories


def run_unit_sanity_tests() -> bool:
    """
    Executes unit & invariant sanity tests:
      1. Backbone causality: zero future information leakage
      2. Kinematic integrator: exactness of 2D kinematic updates
      3. WGS84 projection: millimeter invertibility
    """
    print("=" * 80)
    print("NAVISENSE NEURAL DR V3: RUNNING SANITY & INVARIANT TESTS")
    print("=" * 80)

    # 1. Backbone Causality Test
    print("[TEST 1] Backbone Temporal Causality Verification...")
    backbone = CausalTCNBackbone(in_channels=9, hidden_dim=32, gru_dim=64)
    backbone.eval()

    x1 = torch.randn(1, 9, 30)
    x2 = x1.clone()
    # Perturb future timestamps > 15
    x2[:, :, 16:] += torch.randn(1, 9, 14) * 5.0

    with torch.no_grad():
        H1, _ = backbone(x1)
        H2, _ = backbone(x2)

    # Past timestamps (0 to 15) must be NUMERICALLY IDENTICAL
    past_diff = torch.max(torch.abs(H1[:, :16, :] - H2[:, :16, :])).item()
    print(f"  Max absolute difference at past timestamps (t <= 15): {past_diff:.8e}")
    assert past_diff < 1e-6, f"CAUSALITY LEAK DETECTED! Past difference = {past_diff}"
    print(">> TEST 1 PASSED: Strict temporal causality verified (zero future leakage).\n")

    # 2. Kinematic Integrator Invariant Test
    print("[TEST 2] Differentiable Kinematics Verification...")
    integrator = KinematicIntegrator(dt=0.1)
    prev_e = torch.tensor([0.0])
    prev_n = torch.tensor([0.0])
    prev_psi = torch.tensor([0.0])  # North
    delta_s = torch.tensor([1.0])    # 1.0 m forward
    delta_psi = torch.tensor([0.0])  # no turn

    new_e, new_n, new_psi, new_v = integrator.step(prev_e, prev_n, prev_psi, delta_s, delta_psi)
    print(f"  Forward 1m along North: new_E = {new_e.item():.4f}m, new_N = {new_n.item():.4f}m, speed = {new_v.item():.1f}m/s")
    assert abs(new_e.item()) < 1e-5 and abs(new_n.item() - 1.0) < 1e-5
    assert abs(new_v.item() - 10.0) < 1e-5

    # Standstill lock test
    p_stop = torch.tensor([1.0])
    lock_e, lock_n, _, lock_v = integrator.step(new_e, new_n, new_psi, delta_s, delta_psi, p_stop=p_stop)
    print(f"  Standstill Lock (p_stop=1.0): moved East = {lock_e.item() - new_e.item():.5f}m, speed = {lock_v.item():.2f}m/s")
    assert abs(lock_e.item() - new_e.item()) < 1e-5 and abs(lock_n.item() - new_n.item()) < 1e-5
    print(">> TEST 2 PASSED: Kinematic exactness and standstill lock verified.\n")

    # 3. WGS84 Projector Roundtrip Test
    print("[TEST 3] WGS84 Anchor Projection Invertibility...")
    lat0, lon0 = 52.3720, -1.2565
    projector = WGS84AnchorProjector(lat0, lon0)

    test_de, test_dn = 125.4, -84.2
    lat, lon = projector.enu_to_geodetic(test_de, test_dn)
    re_de, re_dn = projector.geodetic_to_enu(lat, lon)
    err_proj = math.sqrt((test_de - re_de)**2 + (test_dn - re_dn)**2)
    print(f"  Projection Roundtrip: Target [{test_de}, {test_dn}] -> Reprojected [{re_de:.4f}, {re_dn:.4f}] (Error: {err_proj*1000:.3f} mm)")
    assert err_proj < 1e-3, f"Projection error too large: {err_proj} m"
    print(">> TEST 3 PASSED: Sub-millimeter WGS84 projection verified.\n")

    print("*" * 80)
    print("ALL NAVISENSE NEURAL DR V3 INTEGRITY TESTS PASSED SUCCESSFULLY!")
    print("*" * 80)
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-sanity", action="store_true", help="Run invariant unit tests")
    args = parser.parse_args()

    if args.test_sanity or len(sys.argv) == 1:
        run_unit_sanity_tests()
