"""
Lightweight Mobile Student Model: NaviSense PDR-Mobile V1.

Architected for Ultra-Low Latency, Low Power ExecuTorch Inference on Mobile ARM CPUs.

Backbone:
- 5-Stage Compact Causal Dilated TCN (32 -> 48 -> 64 -> 96 -> 128)
  Dilations: [1, 2, 4, 8, 16], kernel = 3 -> Receptive field = 63 steps @ 20 Hz = 3.15 seconds
- 2-Layer Causal GRU (hidden size = 128)
- Distillation Adapter: projects 128-dim student latent to 256-dim teacher space

Output Heads:
1. Δdisp:        [Δforward, Δlateral, Δvertical] (3 dims)
2. Δyaw:         Signed heading increment Δψ_t (1 dim, + left, - right)
3. log_var_4d:   4D uncertainty [log σ_E^2, log σ_N^2, log σ_U^2, log σ_ψ^2] (4 dims)
4. regime_logits: 5-class motion regime logits (5 dims)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class CausalConv1d(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 3, dilation: int = 1):
        super().__init__()
        self.padding = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, dilation=dilation, padding=0)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x_padded = F.pad(x, (self.padding, 0))
        return self.conv(x_padded)


class CompactCausalBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 3, dilation: int = 1, dropout: float = 0.1):
        super().__init__()
        self.conv1 = CausalConv1d(in_channels, out_channels, kernel_size, dilation)
        self.bn1 = nn.BatchNorm1d(out_channels)
        self.conv2 = CausalConv1d(out_channels, out_channels, kernel_size, dilation)
        self.bn2 = nn.BatchNorm1d(out_channels)
        self.dropout = nn.Dropout(dropout)
        self.downsample = nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else None

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        res = x if self.downsample is None else self.downsample(x)
        out = F.leaky_relu(self.bn1(self.conv1(x)), 0.1)
        out = self.dropout(out)
        out = F.leaky_relu(self.bn2(self.conv2(out)), 0.1)
        out = self.dropout(out)
        return F.leaky_relu(out + res, 0.1)


class NaviSensePDRMobile(nn.Module):
    """
    Lightweight Mobile Model for Mobile On-Device Deployment.
    """
    def __init__(
        self,
        in_channels: int = 13,
        tcn_channels: list = None,
        kernel_size: int = 3,
        gru_hidden_dim: int = 128,
        gru_layers: int = 2,
        teacher_latent_dim: int = 256,
        num_regimes: int = 5,
        ratio_imu_to_pred: int = 5
    ):
        super().__init__()
        if tcn_channels is None:
            # 5 stages with dilations [1, 2, 4, 8, 16] = 63 steps (3.15s @ 20 Hz)
            tcn_channels = [32, 48, 64, 96, 128]

        self.ratio = ratio_imu_to_pred
        self.gru_hidden_dim = gru_hidden_dim
        self.gru_layers = gru_layers

        # 1. 100 Hz -> 20 Hz strided stem
        self.stem = nn.Sequential(
            nn.Conv1d(in_channels, tcn_channels[0], kernel_size=self.ratio, stride=self.ratio),
            nn.BatchNorm1d(tcn_channels[0]),
            nn.LeakyReLU(0.1)
        )

        # 2. 5-Stage Causal Dilated TCN Backbone
        dilations = [1, 2, 4, 8, 16]
        tcn_layers = []
        curr_ch = tcn_channels[0]
        for i, out_ch in enumerate(tcn_channels):
            tcn_layers.append(
                CompactCausalBlock(curr_ch, out_ch, kernel_size, dilations[i], dropout=0.1)
            )
            curr_ch = out_ch
        self.tcn = nn.Sequential(*tcn_layers)

        # 3. Stacked Causal GRU (128-dim hidden)
        self.gru = nn.GRU(
            input_size=curr_ch,
            hidden_size=gru_hidden_dim,
            num_layers=gru_layers,
            batch_first=True,
            dropout=0.1 if gru_layers > 1 else 0.0
        )

        # 4. Latent Projection
        self.latent_proj = nn.Sequential(
            nn.Linear(gru_hidden_dim, gru_hidden_dim),
            nn.LayerNorm(gru_hidden_dim),
            nn.LeakyReLU(0.1)
        )

        # 5. Distillation Adapter (projects 128-dim student latent to 256-dim teacher space)
        self.distill_adapter = nn.Sequential(
            nn.Linear(gru_hidden_dim, teacher_latent_dim),
            nn.LayerNorm(teacher_latent_dim)
        )

        # 6. Mobile Prediction Heads
        # Head 1: 3D Local motion displacement [Δforward, Δlateral, Δvertical]
        self.head_disp = nn.Sequential(
            nn.Linear(gru_hidden_dim, 64),
            nn.LeakyReLU(0.1),
            nn.Linear(64, 3)
        )

        # Head 2: Signed heading increment Δψ_t (radians, + left, - right)
        self.head_heading = nn.Sequential(
            nn.Linear(gru_hidden_dim, 32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, 1)
        )

        # Head 3: 4D Vector Uncertainty [log σ_E^2, log σ_N^2, log σ_U^2, log σ_ψ^2]
        self.head_uncertainty_4d = nn.Sequential(
            nn.Linear(gru_hidden_dim, 32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, 4)
        )

        # Head 4: Motion regime classification logits (5 classes)
        self.head_regime = nn.Sequential(
            nn.Linear(gru_hidden_dim, 32),
            nn.LeakyReLU(0.1),
            nn.Linear(32, num_regimes)
        )

    def forward(self, imu_seq: torch.Tensor, h_prev: torch.Tensor = None):
        """
        Forward pass for training and ExecuTorch inference.
        """
        if imu_seq.dim() == 3 and imu_seq.shape[-1] == 13:
            imu_seq = imu_seq.transpose(1, 2)

        x_20hz = self.stem(imu_seq)
        feats_tcn = self.tcn(x_20hz)
        feats_seq = feats_tcn.transpose(1, 2)
        gru_out, h_next = self.gru(feats_seq, h_prev)

        latent = self.latent_proj(gru_out)
        projected_latent = self.distill_adapter(latent)

        disp = self.head_disp(latent)
        delta_yaw = self.head_heading(latent).squeeze(-1)
        log_var_4d = self.head_uncertainty_4d(latent)
        regime_logits = self.head_regime(latent)

        return {
            'disp': disp,
            'delta_yaw': delta_yaw,
            'log_var_4d': log_var_4d,
            'log_var': log_var_4d[:, :, 0:2].mean(dim=-1),  # scalar backward compatibility
            'regime_logits': regime_logits,
            'latent': latent,
            'projected_latent': projected_latent,
            'h_next': h_next
        }
