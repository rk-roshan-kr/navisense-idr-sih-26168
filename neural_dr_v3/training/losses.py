"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/training/losses.py
Description: Multi-horizon trajectory rollout loss function combining step-wise,
cumulative trajectory, endpoint, heading, speed, and uncertainty penalties.
================================================================================
"""

from typing import Dict
import torch
import torch.nn as nn
import torch.nn.functional as F


class MultiHorizonTrajectoryLoss(nn.Module):
    """
    Multi-Horizon Trajectory Rollout Loss:
      L = lambda_1 * L_step
        + lambda_2 * L_traj
        + lambda_3 * L_final
        + lambda_4 * L_heading
        + lambda_5 * L_speed
        + lambda_6 * L_stop
        + lambda_7 * L_nll
    """
    def __init__(
        self,
        lambda_step: float = 1.0,
        lambda_traj: float = 2.0,
        lambda_final: float = 3.0,
        lambda_heading: float = 1.5,
        lambda_speed: float = 1.0,
        lambda_stop: float = 1.0,
        lambda_nll: float = 0.1
    ):
        super().__init__()
        self.lambda_step = lambda_step
        self.lambda_traj = lambda_traj
        self.lambda_final = lambda_final
        self.lambda_heading = lambda_heading
        self.lambda_speed = lambda_speed
        self.lambda_stop = lambda_stop
        self.lambda_nll = lambda_nll

        self.huber = nn.HuberLoss(delta=1.0)
        self.bce = nn.BCELoss()

    def forward(
        self,
        preds: Dict[str, torch.Tensor],
        targets: Dict[str, torch.Tensor]
    ) -> Dict[str, torch.Tensor]:
        """
        Computes composite trajectory loss.
        """
        pred_ds = preds["step_ds"]                    # (B, T)
        gt_ds = targets["gt_step_ds"]                 # (B, T)
        pred_dpsi = preds["step_dpsi"]                # (B, T)
        gt_dpsi = targets["gt_step_dpsi"]             # (B, T)

        pred_e = preds["pred_delta_e"]                # (B, T)
        gt_e = targets["gt_delta_east"]               # (B, T)
        pred_n = preds["pred_delta_n"]                # (B, T)
        gt_n = targets["gt_delta_north"]              # (B, T)

        pred_spd = preds["pred_speed"]                # (B, T)
        gt_spd = targets["gt_speed"]                  # (B, T)

        pred_stop = preds["p_stop"]                   # (B, T)
        gt_stop = targets["gt_p_stop"]                # (B, T)

        # 1. Step-wise incremental motion loss
        l_step_s = self.huber(pred_ds, gt_ds)
        l_step_psi = self.huber(pred_dpsi, gt_dpsi)
        l_step = l_step_s + 0.5 * l_step_psi

        # 2. Cumulative 2D trajectory Euclidean displacement error
        err_e = pred_e - gt_e
        err_n = pred_n - gt_n
        pointwise_drift = torch.sqrt(err_e**2 + err_n**2 + 1e-6)  # (B, T)
        l_traj = torch.mean(pointwise_drift)

        # 3. Terminal endpoint drift error at t=T
        l_final = torch.mean(pointwise_drift[:, -1])

        # 4. Heading angular consistency loss (cosine distance)
        pred_cum_psi = preds["pred_delta_psi"]
        gt_cum_psi = targets["gt_delta_psi"]
        l_heading = torch.mean(1.0 - torch.cos(pred_cum_psi - gt_cum_psi))

        # 5. Speed tracking loss
        l_speed = self.huber(pred_spd, gt_spd)

        # 6. Standstill stop detection loss
        l_stop = self.bce(torch.clamp(pred_stop, 1e-6, 1.0 - 1e-6), gt_stop)

        # 7. Heteroscedastic NLL uncertainty calibration loss
        log_var_s = preds.get("log_var_s", torch.zeros_like(pred_ds))
        var_s = torch.exp(log_var_s)
        sq_err_s = (pred_ds - gt_ds)**2
        l_nll = 0.5 * torch.mean(sq_err_s / (var_s + 1e-6) + log_var_s)

        # Total combined loss
        total_loss = (
            self.lambda_step * l_step +
            self.lambda_traj * l_traj +
            self.lambda_final * l_final +
            self.lambda_heading * l_heading +
            self.lambda_speed * l_speed +
            self.lambda_stop * l_stop +
            self.lambda_nll * l_nll
        )

        return {
            "total_loss": total_loss,
            "loss_step": l_step,
            "loss_traj": l_traj,
            "loss_final": l_final,
            "loss_heading": l_heading,
            "loss_speed": l_speed,
            "loss_stop": l_stop,
            "loss_nll": l_nll,
            "endpoint_drift_m": l_final.detach()
        }
