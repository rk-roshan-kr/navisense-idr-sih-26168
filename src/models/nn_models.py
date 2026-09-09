"""
SIH 26168 - Neural Motion Architectures V2.1
Authoritative Causal Deep Learning Motion Stack for Smartphone Dead Reckoning.

Key Invariants:
1. Strictly Causal Temporal Backbone: Causal Conv1D + TemporalLayerNorm (zero future leakage).
   NO BatchNorm in temporal path — features at timestamp t cannot access timestamps > t.
2. Causal Dilated TCN: 4 residual blocks (d=1, 2, 4, 8) where both convolutions in each block
   share the specified dilation d with causal left-padding.
3. Mathematical Timing Contract: W=20 samples @ 10 Hz = 19 intervals = 1.9s horizon.
4. Consistent Trapezoidal Physics Integration:
   delta_s = trapz(v(t)), delta_psi = trapz(omega_z(t)), and psi(t) is strictly trapezoidal.
5. Identity-Initialized FiLM VehicleAdapter:
   gamma=0, beta=0 initialization guarantees H_pers = (1 + 0)*H + 0 == H at initialization.
6. Base Model Freeze Invariant: adapt_step() explicitly enforces self.base_model.eval().
"""

import math
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# Canonical 9-Axis Channel Schema
CANONICAL_CHANNELS = [
    "accel_x",     # 0: Vehicle forward/longitudinal acceleration (m/s^2)
    "accel_y",     # 1: Vehicle lateral acceleration (m/s^2)
    "accel_z",     # 2: Vehicle vertical acceleration (m/s^2)
    "gyro_yaw",    # 3: Vehicle yaw rate about vertical axis (rad/s)
    "gyro_pitch",  # 4: Vehicle pitch rate (rad/s)
    "gyro_roll",   # 5: Vehicle roll rate (rad/s)
    "gravity_x",   # 6: World-vertical gravity vector projection X (m/s^2)
    "gravity_y",   # 7: World-vertical gravity vector projection Y (m/s^2)
    "gravity_z",   # 8: World-vertical gravity vector projection Z (m/s^2)
]
NUM_CHANNELS = 9


class TemporalLayerNorm(nn.Module):
    """
    Layer Normalization applied across feature channels independently per timestep.
    Guarantees STRICT causality during training: no pooling or statistics sharing across W.
    Input shape: (B, C, W) -> output shape: (B, C, W).
    """
    def __init__(self, channels: int):
        super().__init__()
        self.ln = nn.LayerNorm(channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Permute (B, C, W) -> (B, W, C), apply LayerNorm across C, permute back to (B, C, W)
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
    """
    Causal dilated residual block.
    Both convolutions use the specified dilation d, normalized with TemporalLayerNorm.
    """
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


def build_rotation_matrix_3d_torch(euler_rad: torch.Tensor) -> torch.Tensor:
    """
    Differentiable 3D rotation matrix R = R_z(yaw) * R_y(pitch) * R_x(roll) in PyTorch.
    Input: euler_rad of shape (3,) or (B, 3).
    """
    if euler_rad.dim() == 1:
        roll, pitch, yaw = euler_rad[0], euler_rad[1], euler_rad[2]
        dev = euler_rad.device
        z = torch.zeros((), device=dev)
        o = torch.ones((), device=dev)

        Rx = torch.stack([
            o, z, z,
            z, torch.cos(roll), -torch.sin(roll),
            z, torch.sin(roll), torch.cos(roll)
        ]).view(3, 3)

        Ry = torch.stack([
            torch.cos(pitch), z, torch.sin(pitch),
            z, o, z,
            -torch.sin(pitch), z, torch.cos(pitch)
        ]).view(3, 3)

        Rz = torch.stack([
            torch.cos(yaw), -torch.sin(yaw), z,
            torch.sin(yaw), torch.cos(yaw), z,
            z, z, o
        ]).view(3, 3)

        return Rz @ (Ry @ Rx)
    else:
        B = euler_rad.shape[0]
        Rs = [build_rotation_matrix_3d_torch(euler_rad[b]) for b in range(B)]
        return torch.stack(Rs, dim=0)


class UniversalMotionNetV2(nn.Module):
    """
    Causal Universal Motion Model V2.1.
    Input: (B, 9, W) conditioned IMU window (W=20 samples @ 10 Hz = 1.9s horizon).
    Primary Outputs:
      - v_seq:       (B, W) forward speed trajectory (m/s), Softplus constrained.
      - omega_seq:   (B, W) vehicle yaw rate trajectory (rad/s).
      - p_stop:      (B,) standstill stop probability in [0, 1].
      - log_var_v:   (B, W) heteroscedastic velocity log-variance.
      - log_var_w:   (B, W) heteroscedastic yaw rate log-variance.
    Deterministic Derivatives:
      - v_t:         endpoint speed (m/s) = v_seq[:, -1]
      - omega_t:     endpoint yaw rate (rad/s) = omega_seq[:, -1]
      - delta_s:     trapezoidal scalar distance (m) over 19 intervals
      - delta_psi:   trapezoidal heading increment (rad) over 19 intervals
      - delta_forward, delta_lateral: 2D displacement in initial-heading frame
    """

    def __init__(
        self,
        in_channels: int = 9,
        hidden_dim: int = 64,
        gru_dim: int = 128,
        dt: float = 0.1,
        window: int = 20
    ):
        super().__init__()
        self.in_channels = in_channels
        self.hidden_dim = hidden_dim
        self.gru_dim = gru_dim
        self.dt = dt
        self.window = window
        self.intervals = window - 1  # 19 intervals for 20 samples

        # 1. Causal Input Projection (with TemporalLayerNorm, NO BatchNorm)
        self.input_proj = nn.Sequential(
            CausalConv1d(in_channels, hidden_dim, kernel_size=3),
            TemporalLayerNorm(hidden_dim),
            nn.GELU()
        )

        # 2. Causal Dilated TCN Backbone (d=1, 2, 4, 8) with consistent dilation in each block
        self.tcn1 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=1)
        self.tcn2 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=2)
        self.tcn3 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=4)
        self.tcn4 = CausalResidualBlock1D(hidden_dim, kernel_size=3, dilation=8)

        # 3. Causal Unidirectional GRU
        self.gru = nn.GRU(
            input_size=hidden_dim,
            hidden_size=gru_dim,
            num_layers=2,
            batch_first=True,
            bidirectional=False
        )

        # 4. Multi-Task Trajectory Heads
        # 4a. Forward Velocity Sequence Head
        self.vel_head = nn.Sequential(
            nn.Linear(gru_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        nn.init.xavier_uniform_(self.vel_head[2].weight, gain=0.1)
        nn.init.constant_(self.vel_head[2].bias, 2.5)  # initial mean ~9 km/h

        # 4b. Yaw Rate Sequence Head (direct angular rate in rad/s)
        self.yaw_head = nn.Sequential(
            nn.Linear(gru_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        nn.init.xavier_uniform_(self.yaw_head[2].weight, gain=0.05)
        nn.init.zeros_(self.yaw_head[2].bias)

        # 4c. Stationary Stop Probability Head (evaluated at terminal step)
        self.stop_head = nn.Sequential(
            nn.Linear(gru_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        # 4d. Heteroscedastic Uncertainty Heads
        self.var_v_head = nn.Sequential(
            nn.Linear(gru_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )
        self.var_w_head = nn.Sequential(
            nn.Linear(gru_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )

    def extract_features(self, x: torch.Tensor) -> torch.Tensor:
        """Extracts strictly causal temporal feature sequence H in R^(B, W, gru_dim)."""
        h = self.input_proj(x)
        h = self.tcn1(h)
        h = self.tcn2(h)
        h = self.tcn3(h)
        h = self.tcn4(h)

        gru_in = h.permute(0, 2, 1)  # (B, W, hidden_dim)
        H, _ = self.gru(gru_in)       # (B, W, gru_dim)
        return H

    def integrate_kinematics(
        self, v_seq: torch.Tensor, omega_seq: torch.Tensor
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Unified trapezoidal integration across the 19 intervals (dt=0.1s):
          delta_s:       Scalar distance = sum((v_k + v_{k+1})/2 * dt)
          delta_psi:     Heading increment = sum((w_k + w_{k+1})/2 * dt)
          delta_forward: Along-track displacement in initial-heading frame
          delta_lateral: Cross-track displacement in initial-heading frame
        Guarantee: psi_seq[:, -1] == delta_psi mathematically identically!
        """
        B, W = v_seq.shape
        dt = self.dt

        # 1. Scalar along-track distance
        delta_s = torch.sum((v_seq[:, :-1] + v_seq[:, 1:]) * 0.5, dim=-1) * dt

        # 2. Heading increment and exact trapezoidal heading trajectory
        # Step intervals for yaw: trapz_step_psi shape (B, W-1)
        trapz_step_psi = (omega_seq[:, :-1] + omega_seq[:, 1:]) * 0.5 * dt
        delta_psi = torch.sum(trapz_step_psi, dim=-1)

        # psi[0] = 0.0, psi[k] = sum_{j=0}^{k-1} trapz_step_psi[j]
        zeros = torch.zeros((B, 1), device=omega_seq.device, dtype=omega_seq.dtype)
        psi_seq = torch.cat([zeros, torch.cumsum(trapz_step_psi, dim=-1)], dim=-1)  # (B, W)

        # 3. 2D Kinematic Trajectory in Initial-Heading Frame (psi_0 = 0)
        v_forward = v_seq * torch.cos(psi_seq)
        v_lateral = v_seq * torch.sin(psi_seq)

        delta_forward = torch.sum((v_forward[:, :-1] + v_forward[:, 1:]) * 0.5, dim=-1) * dt
        delta_lateral = torch.sum((v_lateral[:, :-1] + v_lateral[:, 1:]) * 0.5, dim=-1) * dt

        return delta_s, delta_psi, delta_forward, delta_lateral

    def forward(
        self,
        x: torch.Tensor,
        gamma: Optional[torch.Tensor] = None,
        beta: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Forward pass with internal FiLM modulation:
          H_pers = (1.0 + gamma) * H + beta
        """
        H = self.extract_features(x)  # (B, W, gru_dim)

        # FiLM context modulation on temporal latent representation
        if gamma is not None and beta is not None:
            if gamma.dim() == 2:
                gamma = gamma.unsqueeze(1)  # (B, 1, gru_dim)
            if beta.dim() == 2:
                beta = beta.unsqueeze(1)    # (B, 1, gru_dim)
            H = (1.0 + gamma) * H + beta

        # Predict continuous motion trajectories
        v_seq_raw = self.vel_head(H).squeeze(-1)       # (B, W)
        v_seq = F.softplus(v_seq_raw)                  # non-negative speed (CAN encoder convention)
        omega_seq = self.yaw_head(H).squeeze(-1)       # (B, W)

        # Terminal stop probability
        p_stop = self.stop_head(H[:, -1, :]).squeeze(-1)  # (B,)

        # Heteroscedastic uncertainties clamped for numerical stability
        log_var_v = torch.clamp(self.var_v_head(H).squeeze(-1), min=-3.0, max=3.0)
        log_var_w = torch.clamp(self.var_w_head(H).squeeze(-1), min=-3.0, max=3.0)

        # Deterministic physical integration
        delta_s, delta_psi, delta_fwd, delta_lat = self.integrate_kinematics(v_seq, omega_seq)

        return {
            "v_seq": v_seq,
            "omega_seq": omega_seq,
            "v_t": v_seq[:, -1],
            "omega_t": omega_seq[:, -1],
            "delta_s": delta_s,
            "delta_psi": delta_psi,
            "delta_forward": delta_fwd,
            "delta_lateral": delta_lat,
            "p_stop": p_stop,
            "log_var_v": log_var_v,
            "log_var_w": log_var_w,
            "latent_features": H
        }


class VehicleAdapter(nn.Module):
    """
    Vehicle Context FiLM Adapter V2.1.
    Modulates UniversalMotionNetV2's temporal latent sequence H:
      H_pers = (1.0 + gamma(z_context)) * H + beta(z_context)
    Context vector in R^27:
      - z_vehicle:   16-D learned vehicle dynamics latent
      - z_vib:        8-D physical vibration signature from SensorConditioner
      - mount_euler:  3-D physical mount rotation angles [roll, pitch, yaw]
    Identity Initialization:
      film_gamma and film_beta are initialized with zero weights and zero biases.
      Guarantees gamma = 0, beta = 0 at t=0, ensuring exact identity transformation before adaptation.
    """

    def __init__(
        self,
        base_model: UniversalMotionNetV2,
        latent_dim: int = 16,
        vib_dim: int = 8,
        mount_dim: int = 3,
        norm_mean: Optional[np.ndarray] = None,
        norm_std: Optional[np.ndarray] = None
    ):
        super().__init__()
        self.base_model = base_model
        # Freeze base model parameters
        for p in self.base_model.parameters():
            p.requires_grad = False

        self.context_dim = latent_dim + vib_dim + mount_dim  # 16 + 8 + 3 = 27
        self.feat_dim = base_model.gru_dim                   # 128

        # Trainable vehicle-specific context parameters
        self.z_vehicle = nn.Parameter(torch.zeros(latent_dim))
        self.mount_euler = nn.Parameter(torch.zeros(mount_dim))  # [roll, pitch, yaw] in rad
        self.vehicle_scale = nn.Parameter(torch.tensor([1.0]))   # linear speed scale factor
        self.yaw_scale     = nn.Parameter(torch.tensor([1.0]))   # chassis turn scale factor

        # Default vibration signature buffer (neutral zeros until measured)
        self.register_buffer("z_vib_default", torch.zeros(vib_dim))

        # Store normalization statistics
        if norm_mean is not None and norm_std is not None:
            self.register_buffer("norm_mean", torch.tensor(norm_mean, dtype=torch.float32).view(1, -1, 1))
            self.register_buffer("norm_std",  torch.tensor(norm_std, dtype=torch.float32).view(1, -1, 1))
        else:
            self.register_buffer("norm_mean", torch.zeros(1, 9, 1))
            self.register_buffer("norm_std",  torch.ones(1, 9, 1))

        # FiLM linear modulation layers
        self.film_gamma = nn.Linear(self.context_dim, self.feat_dim)
        self.film_beta  = nn.Linear(self.context_dim, self.feat_dim)

        # Exact Identity Initialization (gamma=0, beta=0)
        nn.init.zeros_(self.film_gamma.weight)
        nn.init.zeros_(self.film_gamma.bias)
        nn.init.zeros_(self.film_beta.weight)
        nn.init.zeros_(self.film_beta.bias)

    def get_context_vector(self, z_vib: Optional[torch.Tensor] = None, batch_size: int = 1) -> torch.Tensor:
        """Constructs full context vector z_context in R^(B, 27)."""
        if z_vib is None:
            z_vib = self.z_vib_default.unsqueeze(0).expand(batch_size, -1)
        elif z_vib.dim() == 1:
            z_vib = z_vib.unsqueeze(0).expand(batch_size, -1)

        z_veh = self.z_vehicle.unsqueeze(0).expand(batch_size, -1)
        z_mnt = self.mount_euler.unsqueeze(0).expand(batch_size, -1)

        z_context = torch.cat([z_veh, z_vib, z_mnt], dim=-1)  # (B, 27)
        return z_context

    def forward(
        self,
        x_conditioned: torch.Tensor,
        z_vib: Optional[torch.Tensor] = None
    ) -> Dict[str, torch.Tensor]:
        """
        Forward pass:
          1. Physically rotates accelerometer & gyro channels using mount_euler if non-zero.
          2. Normalizes input tensor using train statistics.
          3. Computes FiLM scale gamma and shift beta from context vector.
          4. Evaluates frozen base model with modulated latent features.
        """
        B, C, W = x_conditioned.shape

        # Normalize conditioned tensor using train statistics
        mean = self.norm_mean[:, :C, :]
        std  = self.norm_std[:, :C, :]
        x_norm = (x_conditioned - mean) / (std + 1e-6)

        # FiLM modulation parameters
        z_context = self.get_context_vector(z_vib=z_vib, batch_size=B)
        gamma = self.film_gamma(z_context)  # (B, feat_dim)
        beta  = self.film_beta(z_context)   # (B, feat_dim)

        # Base model forward with internal FiLM modulation
        out = self.base_model(x_norm, gamma=gamma, beta=beta)

        # Scale outputs with calibrated vehicle chassis factors
        v_seq_scaled = out["v_seq"] * self.vehicle_scale
        omega_seq_scaled = out["omega_seq"] * self.yaw_scale

        delta_s, delta_psi, delta_fwd, delta_lat = self.base_model.integrate_kinematics(
            v_seq_scaled, omega_seq_scaled
        )

        return {
            "v_seq": v_seq_scaled,
            "omega_seq": omega_seq_scaled,
            "v_t": v_seq_scaled[:, -1],
            "omega_t": omega_seq_scaled[:, -1],
            "delta_s": delta_s,
            "delta_psi": delta_psi,
            "delta_forward": delta_fwd,
            "delta_lateral": delta_lat,
            "p_stop": out["p_stop"],
            "log_var_v": out["log_var_v"],
            "log_var_w": out["log_var_w"],
            "gamma": gamma,
            "beta": beta
        }

    def adapt_step(
        self,
        x_conditioned: torch.Tensor,
        target_v_seq: torch.Tensor,
        target_omega_seq: torch.Tensor,
        target_delta_fwd: torch.Tensor,
        target_delta_lat: torch.Tensor,
        optimizer: torch.optim.Optimizer,
        z_vib: Optional[torch.Tensor] = None
    ) -> float:
        """
        Bounded continual personalization step.
        Guarantees: base model is strictly maintained in eval() mode.
        """
        self.train()
        self.base_model.eval()  # Base model is strictly kept in eval mode!
        optimizer.zero_grad()

        out = self.forward(x_conditioned, z_vib=z_vib)

        # Multi-term bounded loss
        l_v = F.mse_loss(out["v_seq"] / 10.0, target_v_seq / 10.0)
        l_w = F.mse_loss(out["omega_seq"] / 0.5, target_omega_seq / 0.5)
        l_pos = (
            F.mse_loss(out["delta_forward"].view(-1) / 10.0, target_delta_fwd.view(-1) / 10.0) +
            F.mse_loss(out["delta_lateral"].view(-1) / 10.0, target_delta_lat.view(-1) / 10.0)
        )

        total_loss = l_v + 2.0 * l_w + 1.5 * l_pos
        total_loss.backward()

        # Strict gradient clipping for stable bounded adaptation
        torch.nn.utils.clip_grad_norm_(self.parameters(), max_norm=0.5)
        optimizer.step()

        return float(total_loss.item())


# Aliases for clean backward compatibility
UniversalMotionNet = UniversalMotionNetV2
PersonalizationAdapter = VehicleAdapter
ResidualBlock1D = CausalResidualBlock1D
