"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/causal_backbone.py
Description: Strictly causal dilated TCN + GRU feature extraction backbone.
Guarantees zero future temporal leakage.
================================================================================
"""

from typing import Optional, Tuple
import torch
import torch.nn as nn
import torch.nn.functional as F


class TemporalLayerNorm(nn.Module):
    """
    Layer Normalization applied across feature channels independently per timestep.
    Strictly causal: no statistics are shared across timestamps.
    Input: (B, C, W) -> Output: (B, C, W).
    """
    def __init__(self, channels: int):
        super().__init__()
        self.ln = nn.LayerNorm(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # (B, C, W) -> (B, W, C) -> LN -> (B, C, W)
        return self.ln(x.permute(0, 2, 1)).permute(0, 2, 1)


class CausalConv1d(nn.Module):
    """1D Convolution with exact causal left-padding to prevent future information leakage."""
    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int = 1):
        super().__init__()
        self.kernel_size = kernel_size
        self.dilation = dilation
        self.pad = (kernel_size - 1) * dilation
        self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, padding=0, dilation=dilation)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x_padded = F.pad(x, (self.pad, 0))
        return self.conv(x_padded)


class CausalResidualBlock1D(nn.Module):
    """Causal dilated residual block with TemporalLayerNorm."""
    def __init__(self, channels: int, kernel_size: int = 3, dilation: int = 1):
        super().__init__()
        self.conv1 = CausalConv1d(channels, channels, kernel_size, dilation=dilation)
        self.ln1 = TemporalLayerNorm(channels)
        self.conv2 = CausalConv1d(channels, channels, kernel_size, dilation=dilation)
        self.ln2 = TemporalLayerNorm(channels)
        self.act = nn.GELU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        res = x
        out = self.act(self.ln1(self.conv1(x)))
        out = self.ln2(self.conv2(out))
        return self.act(out + res)


class CausalTCNBackbone(nn.Module):
    """
    Authoritative causal backbone combining:
      1. Causal Conv1D Projection
      2. 4-Stage Dilated Causal TCN (dilations = 1, 2, 4, 8)
      3. Unidirectional GRU
    """
    def __init__(
        self,
        in_channels: int = 9,
        hidden_dim: int = 64,
        gru_dim: int = 128,
        num_gru_layers: int = 2
    ):
        super().__init__()
        self.in_channels = in_channels
        self.hidden_dim = hidden_dim
        self.gru_dim = gru_dim

        self.input_proj = nn.Sequential(
            CausalConv1d(in_channels, hidden_dim, kernel_size=3),
            TemporalLayerNorm(hidden_dim),
            nn.GELU()
        )

        self.tcn1 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=1)
        self.tcn2 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=2)
        self.tcn3 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=4)
        self.tcn4 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=8)

        self.gru = nn.GRU(
            input_size=hidden_dim,
            hidden_size=gru_dim,
            num_layers=num_gru_layers,
            batch_first=True,
            bidirectional=False
        )

    def forward(
        self,
        x: torch.Tensor,
        hx: Optional[torch.Tensor] = None
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Forward pass.
        Args:
          x: (B, C, W) IMU temporal sequence
          hx: Optional GRU hidden state (num_layers, B, gru_dim)
        Returns:
          H: (B, W, gru_dim) causal latent sequence
          hx: updated GRU hidden state
        """
        h = self.input_proj(x)
        h = self.tcn1(h)
        h = self.tcn2(h)
        h = self.tcn3(h)
        h = self.tcn4(h)

        gru_in = h.permute(0, 2, 1)  # (B, W, hidden_dim)
        H, hx = self.gru(gru_in, hx)
        return H, hx
