"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/model_c_direct_cartesian.py
Description: Model C Baseline: Directly regresses Cartesian displacements
[delta_E, delta_N] without an explicit kinematic integration layer.
================================================================================
"""

from typing import Dict, Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F

from .causal_backbone import CausalTCNBackbone


class DirectCartesianBaselineNet(nn.Module):
    """
    Model C Baseline:
      IMU sequence + Anchor Context -> [delta_E, delta_N] directly regressed.
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

        self.cartesian_head = nn.Sequential(
            nn.Linear(gru_dim, 32),
            nn.GELU(),
            nn.Linear(32, 2)  # [delta_E_step, delta_N_step]
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

        step_de_list = []
        step_dn_list = []
        p_stop_list = []

        hx = None
        for t in range(T):
            win = imu_full[:, :, t:t + w_hist]
            H, hx = self.backbone(win, hx)
            h_t = H[:, -1, :]

            d_en = self.cartesian_head(h_t)  # (B, 2)
            p_s = self.stop_head(h_t).squeeze(-1)

            step_de_list.append(d_en[:, 0])
            step_dn_list.append(d_en[:, 1])
            p_stop_list.append(p_s)

        step_de = torch.stack(step_de_list, dim=1)      # (B, T)
        step_dn = torch.stack(step_dn_list, dim=1)      # (B, T)
        p_stop = torch.stack(p_stop_list, dim=1)        # (B, T)

        pred_e = torch.cumsum(step_de, dim=1)
        pred_n = torch.cumsum(step_dn, dim=1)
        step_ds = torch.sqrt(step_de**2 + step_dn**2)
        pred_spd = step_ds / self.dt
        pred_psi = torch.atan2(step_de, step_dn + 1e-6)

        return {
            "step_ds": step_ds,
            "step_dpsi": torch.zeros_like(step_ds),
            "pred_delta_e": pred_e,
            "pred_delta_n": pred_n,
            "pred_delta_psi": pred_psi,
            "pred_speed": pred_spd,
            "p_stop": p_stop,
            "log_var_s": torch.zeros_like(step_ds),
            "log_var_psi": torch.zeros_like(step_ds)
        }
