"""
Personalization & Device Calibration Adapters for NaviSense IDR.

Allows calibrating NaviSense PDR-Net V1 to a specific new physical device or individual
walking gait using a short calibration walk while keeping the core base network frozen.
"""

import torch
import torch.nn as nn
from .pdr_net import NaviSensePDRNetV1


class ResidualAdapter(nn.Module):
    """
    Bottleneck residual adapter inserted between shared latent and prediction heads.
    Params: hidden_dim * bottleneck * 2 << base network size.
    """
    def __init__(self, hidden_dim: int = 128, bottleneck_dim: int = 32):
        super().__init__()
        self.down = nn.Linear(hidden_dim, bottleneck_dim)
        self.act = nn.LeakyReLU(0.1)
        self.up = nn.Linear(bottleneck_dim, hidden_dim)
        # Initialize up projection near zero for identity initialization
        nn.init.zeros_(self.up.weight)
        nn.init.zeros_(self.up.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.up(self.act(self.down(x)))


class PersonalizedPDRNet(nn.Module):
    """
    Personalized wrapper that freezes the base network and trains only the adapter.
    """
    def __init__(self, base_model: NaviSensePDRNetV1, bottleneck_dim: int = 32):
        super().__init__()
        self.base_model = base_model
        # Freeze base network
        for param in self.base_model.parameters():
            param.requires_grad = False

        self.adapter = ResidualAdapter(
            hidden_dim=base_model.gru.hidden_size,
            bottleneck_dim=bottleneck_dim
        )

        # Clone prediction heads to allow fine-tuning
        self.head_disp = base_model.head_disp
        self.head_heading = base_model.head_heading
        self.head_uncertainty = base_model.head_uncertainty
        self.head_regime = base_model.head_regime

    def forward(self, imu_seq: torch.Tensor, h_prev: torch.Tensor = None):
        with torch.no_grad():
            if imu_seq.dim() == 3 and imu_seq.shape[-1] == 13:
                imu_seq = imu_seq.transpose(1, 2)
            x_20hz = self.base_model.strided_stem(imu_seq)
            feats_tcn = self.base_model.tcn(x_20hz)
            feats_seq = feats_tcn.transpose(1, 2)
            gru_out, h_next = self.base_model.gru(feats_seq, h_prev)
            latent = self.base_model.latent_proj(gru_out)

        # Apply personalized adapter
        adapted_latent = self.adapter(latent)

        disp = self.head_disp(adapted_latent)
        delta_yaw = self.head_heading(adapted_latent).squeeze(-1)
        log_var = self.head_uncertainty(adapted_latent).squeeze(-1)
        regime_logits = self.head_regime(adapted_latent)

        return {
            'disp': disp,
            'delta_yaw': delta_yaw,
            'log_var': log_var,
            'regime_logits': regime_logits,
            'latent': adapted_latent,
            'h_next': h_next
        }
