"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/model_b_neural_dr.py
Description: Model B (Primary Architecture): Closed-loop neural dead reckoning
predicting incremental motion [delta_s, delta_psi, uncertainty, p_stop] relative
to the last trusted GNSS anchor, integrated via a deterministic kinematic layer.
================================================================================
"""

from typing import Dict, Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F

from .causal_backbone import CausalTCNBackbone
from .kinematic_integrator import KinematicIntegrator


class NeuralDeadReckoningNetV3(nn.Module):
    """
    Primary Model B: Causal Neural Dead Reckoning Network.
    
    Given:
      - IMU history stream (9 channels, W=20)
      - Previous state feedback [delta_E, delta_N, v, delta_psi, elapsed_s]
      - Anchor context (anchor speed v_0)
    
    Predicts:
      - delta_s: incremental scalar forward displacement (m)
      - delta_psi: incremental heading change (rad)
      - p_stop: standstill probability [0, 1]
      - log_var_s, log_var_psi: heteroscedastic log-uncertainties
    """
    def __init__(
        self,
        in_channels: int = 9,
        state_dim: int = 4,           # [v_norm, ds_norm, prev_dpsi, p_stop]
        hidden_dim: int = 64,
        gru_dim: int = 128,
        dt: float = 0.1
    ):
        super().__init__()
        self.in_channels = in_channels
        self.state_dim = state_dim
        self.hidden_dim = hidden_dim
        self.gru_dim = gru_dim
        self.dt = dt

        # 1. Causal Dilated TCN + GRU Backbone
        self.backbone = CausalTCNBackbone(
            in_channels=in_channels,
            hidden_dim=hidden_dim,
            gru_dim=gru_dim,
            num_gru_layers=2
        )

        # 2. State Feedback & Anchor Context Conditioning MLP
        # state (4) + anchor_v0_norm (1) = 5
        self.context_proj = nn.Sequential(
            nn.Linear(state_dim + 1, 32),
            nn.GELU(),
            nn.Linear(32, 32),
            nn.GELU()
        )

        # Combined latent dimension
        fused_dim = gru_dim + 32

        # 3. Multi-Task Trajectory Heads
        # 3a. Incremental Forward Distance Head (Softplus for non-negativity)
        self.delta_s_head = nn.Sequential(
            nn.Linear(fused_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        nn.init.xavier_uniform_(self.delta_s_head[2].weight, gain=0.1)
        nn.init.constant_(self.delta_s_head[2].bias, 0.5)  # initial ~0.5m per 0.1s step (18 km/h)

        # 3b. Incremental Heading Change Head
        self.delta_psi_head = nn.Sequential(
            nn.Linear(fused_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        nn.init.xavier_uniform_(self.delta_psi_head[2].weight, gain=0.05)
        nn.init.zeros_(self.delta_psi_head[2].bias)

        # 3c. Stationary Stop Probability Head
        self.stop_head = nn.Sequential(
            nn.Linear(fused_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        # 3d. Heteroscedastic Uncertainty Heads
        self.var_s_head = nn.Sequential(
            nn.Linear(fused_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )
        self.var_psi_head = nn.Sequential(
            nn.Linear(fused_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )

        # 4. Deterministic Kinematic Integrator
        self.integrator = KinematicIntegrator(dt=dt)

    def forward_step(
        self,
        imu_window: torch.Tensor,       # (B, 9, W)
        prev_state: torch.Tensor,       # (B, 5) [delta_E, delta_N, v, delta_psi, t_elapsed]
        anchor_v0: torch.Tensor,        # (B,) or (B, 1)
        hx: Optional[torch.Tensor] = None
    ) -> Tuple[Dict[str, torch.Tensor], torch.Tensor]:
        """
        Executes a single-step closed-loop prediction.
        """
        B = imu_window.shape[0]
        if anchor_v0.dim() == 1:
            anchor_v0 = anchor_v0.unsqueeze(-1)

        # 1. Feature extraction from IMU history
        H, hx_new = self.backbone(imu_window, hx)
        h_t = H[:, -1, :]  # terminal timestep latent (B, gru_dim)

        # 2. Context conditioning from feedback state
        ctx_in = torch.cat([prev_state, anchor_v0], dim=-1)  # (B, 6)
        ctx_feat = self.context_proj(ctx_in)                 # (B, 32)

        # 3. Fused feature
        fused = torch.cat([h_t, ctx_feat], dim=-1)           # (B, gru_dim + 32)

        # 4. Multi-task predictions
        delta_s = F.softplus(self.delta_s_head(fused)).squeeze(-1)       # (B,)
        delta_psi = self.delta_psi_head(fused).squeeze(-1)               # (B,)
        p_stop = self.stop_head(fused).squeeze(-1)                       # (B,)

        log_var_s = torch.clamp(self.var_s_head(fused).squeeze(-1), min=-4.0, max=4.0)
        log_var_psi = torch.clamp(self.var_psi_head(fused).squeeze(-1), min=-4.0, max=4.0)

        out_dict = {
            "delta_s": delta_s,
            "delta_psi": delta_psi,
            "p_stop": p_stop,
            "log_var_s": log_var_s,
            "log_var_psi": log_var_psi,
            "latent": h_t
        }
        return out_dict, hx_new

    def forward_rollout(
        self,
        imu_full: torch.Tensor,         # (B, 9, W_hist + T)
        anchor_v0: torch.Tensor,        # (B,)
        anchor_psi0: torch.Tensor,      # (B,)
        w_hist: int = 20,
        scheduled_sample_prob: float = 0.0,
        gt_states: Optional[torch.Tensor] = None # (B, T, 5) for scheduled sampling
    ) -> Dict[str, torch.Tensor]:
        """
        Executes a closed-loop multi-step rollout across T timestamps.
        """
        B, C, total_len = imu_full.shape
        T = total_len - w_hist
        device = imu_full.device

        # Initial state at t=0 relative to anchor: [0.0, 0.0, v_0, 0.0, 0.0]
        cur_e = torch.zeros(B, device=device)
        cur_n = torch.zeros(B, device=device)
        cur_v = anchor_v0.clone()
        prev_ds = torch.clamp(anchor_v0 * self.dt, 0.0, 3.0)
        prev_dpsi = torch.zeros(B, device=device)
        prev_p_stop = torch.zeros(B, device=device)
        cur_dpsi = torch.zeros(B, device=device)
        cur_psi = anchor_psi0.clone()

        step_ds_list = []
        step_dpsi_list = []
        pred_e_list = []
        pred_n_list = []
        pred_psi_list = []
        pred_spd_list = []
        p_stop_list = []
        log_var_s_list = []
        log_var_psi_list = []

        hx = None
        norm_anchor_v0 = torch.clamp(anchor_v0 / 15.0, 0.0, 3.0)

        for t in range(T):
            # Sliding window of IMU: [t : t + w_hist]
            win = imu_full[:, :, t:t + w_hist]

            # Assemble dimensionless translational feedback state: [v/15, ds/1.5, prev_dpsi, p_stop]
            pred_state = torch.stack([
                torch.clamp(cur_v / 15.0, -1.0, 3.0),
                torch.clamp(prev_ds / 1.5, 0.0, 3.0),
                torch.clamp(prev_dpsi, -1.0, 1.0),
                torch.clamp(prev_p_stop, 0.0, 1.0)
            ], dim=-1)

            # Scheduled sampling: mix predicted state with ground truth state during training
            if self.training and gt_states is not None and scheduled_sample_prob < 1.0:
                use_gt = (torch.rand(B, 1, device=device) >= scheduled_sample_prob)
                state_in = torch.where(use_gt, gt_states[:, t, :], pred_state)
            else:
                state_in = pred_state

            # Forward step
            out, hx = self.forward_step(win, state_in, norm_anchor_v0, hx)

            ds = out["delta_s"]
            dpsi = out["delta_psi"]
            p_stop = out["p_stop"]

            # Kinematic integration
            new_e, new_n, new_psi, new_v = self.integrator.step(
                prev_e=cur_e,
                prev_n=cur_n,
                prev_psi=cur_psi,
                delta_s=ds,
                delta_psi=dpsi,
                p_stop=p_stop
            )

            # Update loop state
            cur_e = new_e
            cur_n = new_n
            cur_psi = new_psi
            cur_dpsi = cur_psi - anchor_psi0
            cur_v = new_v
            prev_ds = ds
            prev_dpsi = dpsi
            prev_p_stop = p_stop

            step_ds_list.append(ds)
            step_dpsi_list.append(dpsi)
            pred_e_list.append(cur_e)
            pred_n_list.append(cur_n)
            pred_psi_list.append(cur_dpsi)
            pred_spd_list.append(cur_v)
            p_stop_list.append(p_stop)
            log_var_s_list.append(out["log_var_s"])
            log_var_psi_list.append(out["log_var_psi"])

        return {
            "step_ds": torch.stack(step_ds_list, dim=1),            # (B, T)
            "step_dpsi": torch.stack(step_dpsi_list, dim=1),        # (B, T)
            "pred_delta_e": torch.stack(pred_e_list, dim=1),        # (B, T)
            "pred_delta_n": torch.stack(pred_n_list, dim=1),        # (B, T)
            "pred_delta_psi": torch.stack(pred_psi_list, dim=1),    # (B, T)
            "pred_speed": torch.stack(pred_spd_list, dim=1),        # (B, T)
            "p_stop": torch.stack(p_stop_list, dim=1),              # (B, T)
            "log_var_s": torch.stack(log_var_s_list, dim=1),        # (B, T)
            "log_var_psi": torch.stack(log_var_psi_list, dim=1)     # (B, T)
        }
