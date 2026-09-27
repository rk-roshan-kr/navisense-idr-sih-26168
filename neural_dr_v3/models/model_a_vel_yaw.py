"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/model_a_vel_yaw.py
Description: Model A Baseline: Predicts forward velocity v(t) and yaw rate omega(t),
then integrates deterministically into trajectory position.
================================================================================
"""

from typing import Dict, Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F

from .causal_backbone import CausalTCNBackbone


class VelYawBaselineNet(nn.Module):
    """
    Model A Baseline:
      IMU sequence -> [v(t), omega(t), p_stop] -> Trapezoidal Integration -> [delta_E, delta_N]
    """
    def __init__(
        self,
        in_channels: int = 9,
        hidden_dim: int = 64,
        gru_dim: int = 128,
        dt: float = 0.1
    ):
        super().__init__()
        self.dt = dt
        self.backbone = CausalTCNBackbone(
            in_channels=in_channels,
            hidden_dim=hidden_dim,
            gru_dim=gru_dim,
            num_gru_layers=2
        )

        self.vel_head = nn.Sequential(
            nn.Linear(gru_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        self.yaw_head = nn.Sequential(
            nn.Linear(gru_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        self.stop_head = nn.Sequential(
            nn.Linear(gru_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

    def forward_rollout(
        self,
        imu_full: torch.Tensor,         # (B, 9, W_hist + T)
        anchor_v0: torch.Tensor,        # (B,)
        anchor_psi0: torch.Tensor,      # (B,)
        w_hist: int = 20,
        **kwargs
    ) -> Dict[str, torch.Tensor]:
        B, C, total_len = imu_full.shape
        T = total_len - w_hist
        device = imu_full.device

        pred_spd_list = []
        pred_yaw_list = []
        p_stop_list = []

        hx = None
        for t in range(T):
            win = imu_full[:, :, t:t + w_hist]
            H, hx = self.backbone(win, hx)
            h_t = H[:, -1, :]

            v = F.softplus(self.vel_head(h_t)).squeeze(-1)
            w = self.yaw_head(h_t).squeeze(-1)
            p_s = self.stop_head(h_t).squeeze(-1)

            pred_spd_list.append(v)
            pred_yaw_list.append(w)
            p_stop_list.append(p_s)

        pred_v = torch.stack(pred_spd_list, dim=1)      # (B, T)
        pred_w = torch.stack(pred_yaw_list, dim=1)      # (B, T)
        p_stop = torch.stack(p_stop_list, dim=1)        # (B, T)

        # Trapezoidal integration of heading: psi[t] = psi_0 + trapz(omega)
        dpsi_step = pred_w * self.dt
        cum_dpsi = torch.cumsum(dpsi_step, dim=1)
        if anchor_psi0.dim() == 1:
            anchor_psi0 = anchor_psi0.unsqueeze(-1)
        traj_psi = anchor_psi0 + cum_dpsi

        # Scalar step distance: ds = v * dt
        step_ds = pred_v * self.dt

        # Planar displacement integration
        de_step = step_ds * torch.sin(traj_psi)
        dn_step = step_ds * torch.cos(traj_psi)
        pred_e = torch.cumsum(de_step, dim=1)
        pred_n = torch.cumsum(dn_step, dim=1)

        return {
            "step_ds": step_ds,
            "step_dpsi": dpsi_step,
            "pred_delta_e": pred_e,
            "pred_delta_n": pred_n,
            "pred_delta_psi": cum_dpsi,
            "pred_speed": pred_v,
            "p_stop": p_stop,
            "log_var_s": torch.zeros_like(pred_v),
            "log_var_psi": torch.zeros_like(pred_w)
        }
