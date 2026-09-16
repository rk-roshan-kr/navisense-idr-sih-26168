"""
Large Research Teacher Model: NaviSense PDR-Teacher V1.

Architected for High-End Workstations (RTX 5070 Ti 16 GB + AMD Ryzen 9 9950X).

Backbone:
- 5-Stage Deep Causal Dilated TCN (64 -> 128 -> 192 -> 256 -> 256)
  Dilations: [1, 2, 4, 8, 16], kernel = 3 -> Receptive Field = 63 steps @ 20 Hz = 3.15 seconds of causal gait dynamics
- 3-Layer Deep Causal GRU (hidden size = 256)
- Temporal Latent Self-Attention & Gating (256-dim)
- Gradient Checkpointing support for memory-safe 120s rollouts

Comprehensive Prediction Heads:
1. Δdisp:        [Δforward, Δlateral, Δvertical] 3D displacement
2. Δyaw:         Signed heading increment Δψ_t (+ left, - right)
3. velocity:     Linear speed auxiliary ||v_t|| >= 0
4. angular_rate: Signed turn rate ω_z (rad/s)
5. log_var_4d:   4D uncertainty [log σ_E^2, log σ_N^2, log σ_U^2, log σ_ψ^2]
6. regime_logits: 5-class motion state logits
7. latent:       256-dim temporal latent vector for distillation
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.checkpoint import checkpoint


class CausalConv1d(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 3, dilation: int = 1):
        super().__init__()
        self.padding = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, dilation=dilation, padding=0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x_padded = F.pad(x, (self.padding, 0))
        return self.conv(x_padded)


class ResidualCausalBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 3, dilation: int = 1, dropout: float = 0.15):
        super().__init__()
        self.conv1 = CausalConv1d(in_channels, out_channels, kernel_size, dilation)
        self.norm1 = nn.GroupNorm(min(8, out_channels), out_channels)
        self.conv2 = CausalConv1d(out_channels, out_channels, kernel_size, dilation)
        self.norm2 = nn.GroupNorm(min(8, out_channels), out_channels)
        self.dropout = nn.Dropout(dropout)
        self.downsample = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        res = x if self.downsample is None else self.downsample(x)
        out = F.gelu(self.norm1(self.conv1(x)))
        out = self.dropout(out)
        out = F.gelu(self.norm2(self.conv2(out)))
        out = self.dropout(out)
        return F.gelu(out + res)


class TemporalLatentAttention(nn.Module):
    """
    Causal multi-head self-attention over temporal sequence representations.
    Focuses on critical kinematic transition points (turns, stops, sudden acceleration).
    """
    def __init__(self, dim: int = 256, num_heads: int = 4):
        super().__init__()
        self.mha = nn.MultiheadAttention(embed_dim=dim, num_heads=num_heads, batch_first=True)
        self.norm = nn.LayerNorm(dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        T = x.size(1)
        causal_mask = torch.triu(torch.full((T, T), float('-inf'), device=x.device), diagonal=1)
        attn_out, _ = self.mha(x, x, x, attn_mask=causal_mask)
        return self.norm(x + attn_out)


class NaviSensePDRTeacher(nn.Module):
    """
    Large Workstation Teacher Model with 3.15s Causal Receptive Field and 4D Uncertainty.
    """
    def __init__(
        self,
        in_channels: int = 13,
        tcn_channels: list = None,
        kernel_size: int = 3,
        gru_hidden_dim: int = 256,
        gru_layers: int = 3,
        dropout: float = 0.15,
        num_regimes: int = 5,
        ratio_imu_to_pred: int = 5,
        use_checkpointing: bool = False
    ):
        super().__init__()
        if tcn_channels is None:
            # 5 stages with dilations [1, 2, 4, 8, 16] -> Receptive Field = 1 + 2*(1+2+4+8+16) = 63 steps
            # 63 steps @ 20 Hz = 3.15 seconds of causal gait dynamics
            tcn_channels = [64, 128, 192, 256, 256]

        self.ratio = ratio_imu_to_pred
        self.use_checkpointing = use_checkpointing
        self.gru_hidden_dim = gru_hidden_dim
        self.gru_layers = gru_layers

        # 1. Multi-scale input stem (100 Hz -> 20 Hz strided convolution)
        self.stem = nn.Sequential(
            nn.Conv1d(in_channels, tcn_channels[0], kernel_size=self.ratio, stride=self.ratio),
            nn.GroupNorm(8, tcn_channels[0]),
            nn.GELU()
        )

        # 2. 5-Stage Deep Causal Dilated TCN
        dilations = [1, 2, 4, 8, 16]
        tcn_layers = []
        curr_ch = tcn_channels[0]
        for i, out_ch in enumerate(tcn_channels):
            tcn_layers.append(
                ResidualCausalBlock(curr_ch, out_ch, kernel_size, dilations[i], dropout)
            )
            curr_ch = out_ch
        self.tcn = nn.Sequential(*tcn_layers)

        # 3. Stacked Deep Causal GRU
        self.gru = nn.GRU(
            input_size=curr_ch,
            hidden_size=gru_hidden_dim,
            num_layers=gru_layers,
            batch_first=True,
            dropout=dropout if gru_layers > 1 else 0.0
        )

        # 4. Temporal Latent Self-Attention
        self.attention = TemporalLatentAttention(dim=gru_hidden_dim, num_heads=4)

        # 5. Latent Representation Projection (256-dim)
        self.latent_proj = nn.Sequential(
            nn.Linear(gru_hidden_dim, gru_hidden_dim),
            nn.LayerNorm(gru_hidden_dim),
            nn.GELU()
        )

        # 6. Comprehensive Multi-Task Prediction Heads
        # Head 1: 3D Local displacement [Δforward, Δlateral, Δvertical]
        self.head_disp = nn.Sequential(
            nn.Linear(gru_hidden_dim, 128),
            nn.GELU(),
            nn.Linear(128, 3)
        )

        # Head 2: Signed heading increment Δψ_t (radians, + left, - right)
        self.head_heading = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.GELU(),
            nn.Linear(64, 1)
        )

        # Head 3: Linear speed auxiliary ||v_t|| >= 0 (m/s)
        self.head_velocity = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.GELU(),
            nn.Linear(64, 1),
            nn.Softplus()
        )

        # Head 4: Signed angular turn rate ω_z (rad/s, signed!)
        self.head_angular_rate = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.GELU(),
            nn.Linear(64, 1)
        )

        # Head 5: 4D Vector Uncertainty [log σ_E^2, log σ_N^2, log σ_U^2, log σ_ψ^2]
        self.head_uncertainty_4d = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.GELU(),
            nn.Linear(64, 4)
        )

        # Head 6: Motion regime classification logits (5 classes)
        self.head_regime = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.GELU(),
            nn.Linear(64, num_regimes)
        )

    def forward(self, imu_seq: torch.Tensor, h_prev: torch.Tensor = None):
        """
        Forward pass.
        imu_seq: (Batch, Channels=13, Length) or (Batch, Length, Channels=13) @ 100 Hz
        """
        if imu_seq.dim() == 3 and imu_seq.shape[-1] == 13:
            imu_seq = imu_seq.transpose(1, 2)

        x_20hz = self.stem(imu_seq)

        if self.use_checkpointing and self.training:
            feats_tcn = checkpoint(self.tcn, x_20hz, use_reentrant=False)
        else:
            feats_tcn = self.tcn(x_20hz)

        feats_seq = feats_tcn.transpose(1, 2)
        gru_out, h_next = self.gru(feats_seq, h_prev)

        attn_out = self.attention(gru_out)
        latent = self.latent_proj(attn_out)

        disp = self.head_disp(latent)
        delta_yaw = self.head_heading(latent).squeeze(-1)
        velocity = self.head_velocity(latent).squeeze(-1)
        angular_rate = self.head_angular_rate(latent).squeeze(-1)
        log_var_4d = self.head_uncertainty_4d(latent)
        regime_logits = self.head_regime(latent)

        return {
            'disp': disp,
            'delta_yaw': delta_yaw,
            'velocity': velocity,
            'angular_rate': angular_rate,
            'log_var_4d': log_var_4d,
            'log_var': log_var_4d[:, :, 0:2].mean(dim=-1),  # backward compatibility scalar
            'regime_logits': regime_logits,
            'latent': latent,
            'h_next': h_next
        }
