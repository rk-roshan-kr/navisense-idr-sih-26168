"""
SIH 26168 - PyTorch Deep Learning Architectures
1. UniversalMotionNet: Pre-trained deep temporal model learning vehicle motion increments from IMU windows.
   - Outputs instantaneous velocity trajectory across window: v_seq in R^(B, W)
   - Guarantees physical consistency via trapezoidal integration: delta_s = trapz(v_seq, dt), v_t = v_seq[-1]
   - Heteroscedastic uncertainty: log(sigma^2)
   - Heading increment delta_psi and stationary stop probability p_stop
2. PersonalizationAdapter: Vehicle-specific online adapter with physical 3D mount rotation R(alpha, beta, gamma),
   sensor bias correction, train-set normalization pipeline compatibility, 16-D latent vehicle embedding z_vehicle,
   and online GNSS-supervised adapt_step().
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

class ResidualBlock1D(nn.Module):
    def __init__(self, channels, kernel_size=3, dilation=1):
        super().__init__()
        padding = (kernel_size - 1) * dilation // 2
        self.conv1 = nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation)
        self.bn1 = nn.BatchNorm1d(channels)
        self.conv2 = nn.Conv1d(channels, channels, kernel_size, padding=padding, dilation=dilation)
        self.bn2 = nn.BatchNorm1d(channels)
        self.act = nn.GELU()

    def forward(self, x):
        res = x
        out = self.act(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        return self.act(out + res)

class UniversalMotionNet(nn.Module):
    """
    Temporal encoder taking (B, 9, W) normalized IMU + gravity windows.
    Predicts:
      v_seq: (B, W) velocity sequence across the window
      v_t:   scalar endpoint velocity (m/s) = v_seq[:, -1]
      delta_s: scalar distance traveled (m) = trapezoidal integration of v_seq
      delta_psi: heading increment (rad)
      p_stop: stationary probability in [0, 1]
      log_var: heteroscedastic log-variance for uncertainty estimation
    """
    def __init__(self, in_channels=9, hidden_dim=64, rnn_dim=64, dt=0.1):
        super().__init__()
        self.dt = dt
        self.in_channels = in_channels

        self.input_proj = nn.Sequential(
            nn.Conv1d(in_channels, hidden_dim, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU()
        )

        self.res1 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=1)
        self.res2 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=2)
        self.res3 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=4)

        self.gru = nn.GRU(hidden_dim, rnn_dim, num_layers=2, batch_first=True, bidirectional=True)

        feat_dim = rnn_dim * 2  # 128

        # 1. Temporal Velocity Sequence Head: outputs speed at each timestep in the window
        self.vel_step_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        nn.init.xavier_uniform_(self.vel_step_head[2].weight, gain=0.1)
        nn.init.constant_(self.vel_step_head[2].bias, 2.5)  # ~9 km/h initial mean

        # 2. Window Heading Change Head: delta_psi (rad)
        self.yaw_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )

        # 3. Stationary Stop Probability Head: p_stop in [0, 1]
        self.stop_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        # 4. Heteroscedastic Uncertainty Head: log(sigma^2)
        self.var_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )

    def extract_features(self, x):
        conv_out = self.input_proj(x)
        conv_out = self.res1(conv_out)
        conv_out = self.res2(conv_out)
        conv_out = self.res3(conv_out)

        gru_in = conv_out.permute(0, 2, 1)
        gru_out, _ = self.gru(gru_in)  # (B, W, feat_dim)
        return gru_out

    def forward(self, x):
        gru_seq = self.extract_features(x)  # (B, W, 128)
        last_feat = gru_seq[:, -1, :]        # (B, 128)

        # Predict velocity across each step of the window with smooth non-negativity
        v_seq_raw = self.vel_step_head(gru_seq).squeeze(-1)  # (B, W)
        v_seq = F.softplus(v_seq_raw)  # strictly non-negative forward speed

        # Endpoint speed
        v_t = v_seq[:, -1]

        # Trapezoidal integration for exact physical distance
        # delta_s = sum((v_k + v_{k+1})/2 * dt)
        delta_s = torch.sum((v_seq[:, :-1] + v_seq[:, 1:]) * 0.5, dim=-1) * self.dt

        # Heading change over the window
        delta_psi = self.yaw_head(last_feat).squeeze(-1)

        # Stop probability
        p_stop = self.stop_head(last_feat).squeeze(-1)

        # Heteroscedastic log-variance clamped for numerical stability
        log_var = torch.clamp(self.var_head(last_feat).squeeze(-1), min=-2.5, max=2.5)

        return {
            "v_t": v_t,
            "speed": v_t,
            "delta_s": delta_s,
            "delta_psi": delta_psi,
            "yaw_rate": delta_psi,
            "p_stop": p_stop,
            "log_var": log_var,
            "v_seq": v_seq,
            "features": last_feat
        }

def build_rotation_matrix_3d(angles):
    """
    Constructs 3D rotation matrix R = R_z(yaw) * R_y(pitch) * R_x(roll)
    from Euler angles (roll, pitch, yaw) in radians.
    """
    roll, pitch, yaw = angles[0], angles[1], angles[2]

    Rx = torch.stack([
        torch.tensor(1.0, device=angles.device), torch.tensor(0.0, device=angles.device), torch.tensor(0.0, device=angles.device),
        torch.tensor(0.0, device=angles.device), torch.cos(roll), -torch.sin(roll),
        torch.tensor(0.0, device=angles.device), torch.sin(roll),  torch.cos(roll)
    ]).view(3, 3)

    Ry = torch.stack([
        torch.cos(pitch), torch.tensor(0.0, device=angles.device), torch.sin(pitch),
        torch.tensor(0.0, device=angles.device), torch.tensor(1.0, device=angles.device), torch.tensor(0.0, device=angles.device),
        -torch.sin(pitch), torch.tensor(0.0, device=angles.device), torch.cos(pitch)
    ]).view(3, 3)

    Rz = torch.stack([
        torch.cos(yaw), -torch.sin(yaw), torch.tensor(0.0, device=angles.device),
        torch.sin(yaw),  torch.cos(yaw), torch.tensor(0.0, device=angles.device),
        torch.tensor(0.0, device=angles.device), torch.tensor(0.0, device=angles.device), torch.tensor(1.0, device=angles.device)
    ]).view(3, 3)

    return torch.mm(Rz, torch.mm(Ry, Rx))

class PersonalizationAdapter(nn.Module):
    """
    Vehicle-specific online adapter:
    1. Operates on RAW physical sensor units (m/s^2, rad/s).
    2. Physical bias subtraction: a_deb = a_raw - b_a, w_deb = w_raw - b_g.
    3. Physical 3D Mount Rotation: a_cal = R @ a_deb, w_cal = R @ w_deb.
    4. Train-set normalization: x_norm = (x_cal - mu) / sigma.
    5. Frozen Base Model inference.
    6. 16-D Latent Vehicle Embedding: z_vehicle in R^16 + trajectory delta adaptation.
    """
    def __init__(self, base_model, norm_mean=None, norm_std=None, latent_dim=16):
        super().__init__()
        self.base_model = base_model
        for param in self.base_model.parameters():
            param.requires_grad = False

        # Physical calibration parameters in physical units
        self.mount_euler = nn.Parameter(torch.zeros(3))        # [roll, pitch, yaw] in radians
        self.accel_bias  = nn.Parameter(torch.zeros(3))        # DC bias in m/s^2
        self.gyro_bias   = nn.Parameter(torch.zeros(3))        # DC bias in rad/s
        self.vehicle_scale = nn.Parameter(torch.tensor([1.0])) # speed scale factor
        self.yaw_scale     = nn.Parameter(torch.tensor([1.0])) # vehicle chassis turn scale factor

        # Store train-set normalization statistics
        if norm_mean is not None and norm_std is not None:
            self.register_buffer("norm_mean", torch.tensor(norm_mean, dtype=torch.float32).view(1, -1, 1))
            self.register_buffer("norm_std",  torch.tensor(norm_std, dtype=torch.float32).view(1, -1, 1))
        else:
            self.register_buffer("norm_mean", torch.zeros(1, 9, 1))
            self.register_buffer("norm_std",  torch.ones(1, 9, 1))

        # 16-dimensional vehicle dynamic latent embedding
        self.z_vehicle = nn.Parameter(torch.zeros(latent_dim))

        # Adapter MLP mapping [base_features (128) + z_vehicle (16)] -> delta forward velocity
        self.adapter_mlp = nn.Sequential(
            nn.Linear(128 + latent_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)  # delta_speed
        )

    def forward(self, x_raw):
        """
        Input x_raw: RAW physical sensor tensor of shape (B, 9, W) or (B, 6, W).
        """
        B, C, W = x_raw.shape

        # 1. Physical calibration in sensor units
        R = build_rotation_matrix_3d(self.mount_euler)  # (3, 3)

        # De-bias in physical units
        accel = x_raw[:, 0:3, :] - self.accel_bias.view(1, 3, 1)
        gyro  = x_raw[:, 3:6, :] - self.gyro_bias.view(1, 3, 1)

        # 3D rotation from phone body frame to vehicle chassis frame
        accel_rot = torch.einsum("ij,bjk->bik", R, accel)
        gyro_rot  = torch.einsum("ij,bjk->bik", R, gyro)

        if C >= 9:
            gravity = x_raw[:, 6:9, :]
            grav_rot = torch.einsum("ij,bjk->bik", R, gravity)
            x_calibrated = torch.cat([accel_rot, gyro_rot, grav_rot], dim=1)
        else:
            x_calibrated = torch.cat([accel_rot, gyro_rot], dim=1)

        # 2. Normalize calibrated physical tensor using frozen train statistics
        mean = self.norm_mean[:, :C, :]
        std  = self.norm_std[:, :C, :]
        x_norm = (x_calibrated - mean) / (std + 1e-6)

        # 3. Frozen base model inference
        # Base model parameters have requires_grad=False, so their weights remain frozen,
        # but gradients flow back through x_norm into R, mount_euler, and physical biases.
        base_out = self.base_model(x_norm)
        base_feat = base_out["features"]
        base_v_seq = base_out["v_seq"]
        base_yaw = base_out["delta_psi"]
        base_stop = base_out["p_stop"]

        # 4. Personalized motion state adaptation
        z_expanded = self.z_vehicle.unsqueeze(0).expand(B, -1)
        adapter_in = torch.cat([base_feat, z_expanded], dim=-1)
        delta_v = self.adapter_mlp(adapter_in).squeeze(-1)

        # Apply vehicle scale and delta to velocity sequence for physical consistency
        v_seq_pers = F.softplus(base_v_seq * self.vehicle_scale + delta_v.unsqueeze(-1))
        personalized_v = v_seq_pers[:, -1]
        personalized_s = torch.sum((v_seq_pers[:, :-1] + v_seq_pers[:, 1:]) * 0.5, dim=-1) * self.base_model.dt
        personalized_yaw = base_yaw * self.yaw_scale

        return {
            "v_t": personalized_v,
            "speed": personalized_v,
            "delta_s": personalized_s,
            "delta_psi": personalized_yaw,
            "p_stop": base_stop,
            "v_seq": v_seq_pers,
            "mount_rotation": R,
            "base_speed": base_out["v_t"]
        }

    def adapt_step(self, x_raw, gps_speed, gps_heading_delta, optimizer, lr=1e-3):
        """
        Runs one online calibration update during GPS-active phase.
        x_raw must be in RAW physical units.
        """
        self.train()
        optimizer.zero_grad()
        out = self.forward(x_raw)

        target_v = torch.tensor([gps_speed], dtype=torch.float32, device=x_raw.device)
        target_yaw = torch.tensor([gps_heading_delta], dtype=torch.float32, device=x_raw.device)

        loss_v = F.mse_loss(out["v_t"], target_v)
        loss_yaw = F.mse_loss(out["delta_psi"], target_yaw)
        total_loss = loss_v + 10.0 * loss_yaw

        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.parameters(), 0.5)
        optimizer.step()

        return float(total_loss.item()), float(loss_v.item())
