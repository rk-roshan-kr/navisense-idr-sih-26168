"""
SIH 26168 - ManeuverSpecialistNet: Non-Mutually Exclusive Residual Expert
Outputs:
  - Independent probabilities: p_stop, p_turn, p_cruise in [0, 1]
  - Continuous kinematics: v_crawl (m/s) and delta_psi (rad) with log-variance uncertainties
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

class SpecialistResidualBlock1D(nn.Module):
    def __init__(self, channels, dilation=1):
        super().__init__()
        self.conv1 = nn.Conv1d(channels, channels, kernel_size=3, padding=dilation, dilation=dilation)
        self.bn1   = nn.BatchNorm1d(channels)
        self.conv2 = nn.Conv1d(channels, channels, kernel_size=3, padding=1)
        self.bn2   = nn.BatchNorm1d(channels)
        self.act   = nn.GELU()

    def forward(self, x):
        res = x
        out = self.act(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        return self.act(out + res)

class ManeuverSpecialistNet(nn.Module):
    """
    Lightweight residual expert model (~45k parameters) for urban turns and stop-and-go regimes.
    Takes normalized 9-axis IMU window of shape (B, 9, 20).
    """
    def __init__(self, in_channels=9, hidden_dim=64, gru_dim=32):
        super().__init__()
        self.input_proj = nn.Sequential(
            nn.Conv1d(in_channels, hidden_dim, kernel_size=3, padding=1),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU()
        )

        self.res1 = SpecialistResidualBlock1D(hidden_dim, dilation=1)
        self.res2 = SpecialistResidualBlock1D(hidden_dim, dilation=2)

        self.gru = nn.GRU(hidden_dim, gru_dim, num_layers=1, batch_first=True, bidirectional=True)
        feat_dim = gru_dim * 2 # 64

        # ── 1. Non-Mutually Exclusive State Probability Heads ────────────────
        # Independent Sigmoids: a window can be TURNING + CRAWLING simultaneously
        self.stop_prob_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        self.turn_prob_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        self.cruise_prob_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1),
            nn.Sigmoid()
        )

        # ── 2. Continuous Kinematics Heads ───────────────────────────────────
        # Crawl speed (m/s) focused on 0-25 km/h regime
        self.crawl_speed_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )

        # Cornering heading increment (rad)
        self.cornering_yaw_head = nn.Sequential(
            nn.Linear(feat_dim, 32),
            nn.GELU(),
            nn.Linear(32, 1)
        )

        # Heteroscedastic uncertainty for yaw (log_var_psi)
        self.yaw_var_head = nn.Sequential(
            nn.Linear(feat_dim, 16),
            nn.GELU(),
            nn.Linear(16, 1)
        )

    def extract_features(self, x):
        if x.dim() == 4 and x.shape[1] == 1:
            x = x.squeeze(1)
        h = self.input_proj(x)
        h = self.res1(h)
        h = self.res2(h)
        gru_in = h.permute(0, 2, 1) # (B, W, C)
        gru_out, _ = self.gru(gru_in) # (B, W, feat_dim)
        return gru_out[:, -1, :] # last timestep feature: (B, feat_dim)

    def forward(self, x):
        feat = self.extract_features(x)

        # 1. Independent Probabilities
        p_stop   = self.stop_prob_head(feat).squeeze(-1)
        p_turn   = self.turn_prob_head(feat).squeeze(-1)
        p_cruise = self.cruise_prob_head(feat).squeeze(-1)

        # 2. Continuous Kinematics
        v_crawl   = F.softplus(self.crawl_speed_head(feat).squeeze(-1))
        delta_psi = self.cornering_yaw_head(feat).squeeze(-1)
        log_var_psi = torch.clamp(self.yaw_var_head(feat).squeeze(-1), min=-4.0, max=4.0)
        conf_psi  = torch.sigmoid(-log_var_psi) # higher confidence when log_var is low

        return {
            "p_stop":       p_stop,
            "p_turn":       p_turn,
            "p_cruise":     p_cruise,
            "v_crawl":      v_crawl,
            "delta_psi":    delta_psi,
            "log_var_psi":  log_var_psi,
            "conf_psi":     conf_psi,
            "features":     feat
        }
