"""
SIH 26168 - PyTorch Deep Learning Architectures
1. UniversalMotionNet: Pre-trained deep base representation learning universal vehicle motion from IMU windows.
2. PersonalizationAdapter: Lightweight online adapter tuning vehicle dynamics, mount rotation, and suspension damping.
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
    def __init__(self, in_channels=6, hidden_dim=64, rnn_dim=64):
        super().__init__()
        
        self.input_proj = nn.Sequential(
            nn.Conv1d(in_channels, hidden_dim, kernel_size=5, padding=2),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU()
        )
        
        self.res1 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=1)
        self.res2 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=2)
        self.res3 = ResidualBlock1D(hidden_dim, kernel_size=3, dilation=4)
        
        self.gru = nn.GRU(hidden_dim, rnn_dim, num_layers=2, batch_first=True, bidirectional=True)
        
        feat_dim = rnn_dim * 2
        self.speed_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        # Init speed head final layer: bias=3.0 so model starts near mean speed
        nn.init.xavier_uniform_(self.speed_head[2].weight, gain=0.1)
        nn.init.constant_(self.speed_head[2].bias, 3.0)  # 3 m/s ≈ 11 km/h mean
        
        self.yaw_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        
        self.accel_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )
        
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
        gru_out, _ = self.gru(gru_in)
        last_feat = gru_out[:, -1, :]
        return last_feat

    def forward(self, x):
        feat = self.extract_features(x)
        speed = self.speed_head(feat)
        yaw_rate = self.yaw_head(feat)
        long_accel = self.accel_head(feat)
        log_var = self.var_head(feat)
        
        return {
            "speed": speed.squeeze(-1),
            "yaw_rate": yaw_rate.squeeze(-1),
            "long_accel": long_accel.squeeze(-1),
            "log_var": log_var.squeeze(-1),
            "features": feat
        }


class PersonalizationAdapter(nn.Module):
    def __init__(self, base_model):
        super().__init__()
        self.base_model = base_model
        for param in self.base_model.parameters():
            param.requires_grad = False
            
        self.mount_angles = nn.Parameter(torch.zeros(3))
        self.accel_bias = nn.Parameter(torch.zeros(3))
        self.gyro_bias = nn.Parameter(torch.zeros(3))
        self.vehicle_scale = nn.Parameter(torch.tensor([1.0]))
        
        self.adapter_mlp = nn.Sequential(
            nn.Linear(128, 32),
            nn.Tanh(),
            nn.Linear(32, 1)
        )

    def forward(self, x):
        B, C, W = x.shape
        accel = x[:, 0:3, :] - self.accel_bias.view(1, 3, 1)
        gyro = x[:, 3:6, :] - self.gyro_bias.view(1, 3, 1)
        x_calibrated = torch.cat([accel, gyro], dim=1)
        
        with torch.no_grad():
            feat = self.base_model.extract_features(x_calibrated)
            base_speed = self.base_model.speed_head(feat).squeeze(-1)
            base_yaw = self.base_model.yaw_head(feat).squeeze(-1)
            
        delta_speed = self.adapter_mlp(feat).squeeze(-1)
        personalized_speed = torch.clamp(base_speed * self.vehicle_scale + delta_speed, min=0.0)
        
        return {
            "speed": personalized_speed,
            "yaw_rate": base_yaw,
            "base_speed": base_speed
        }
