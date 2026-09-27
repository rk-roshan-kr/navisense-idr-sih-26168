"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/models/kinematic_integrator.py
Description: Differentiable 2D vehicular kinematic integrator and WGS84 anchor
coordinate reconstruction engine.
================================================================================
"""

import math
from typing import Dict, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn


class KinematicIntegrator(nn.Module):
    """
    Differentiable vehicular kinematic layer connecting incremental step predictions
    (delta_s, delta_psi) to continuous 2D Cartesian trajectories (delta_E, delta_N).
    
    Physics Model:
      psi_{t+1} = psi_t + delta_psi_t
      delta_E_{t+1} = delta_E_t + delta_s_t * sin(psi_{t+1})
      delta_N_{t+1} = delta_N_t + delta_s_t * cos(psi_{t+1})
      v_{t+1} = delta_s_t / dt
    """
    def __init__(self, dt: float = 0.1):
        super().__init__()
        self.dt = dt

    def step(
        self,
        prev_e: torch.Tensor,       # (B,)
        prev_n: torch.Tensor,       # (B,)
        prev_psi: torch.Tensor,     # (B,)
        delta_s: torch.Tensor,      # (B,)
        delta_psi: torch.Tensor,    # (B,)
        p_stop: Optional[torch.Tensor] = None # (B,) in [0, 1]
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Executes single-step kinematic update.
        """
        # Standstill suppression: if p_stop > 0.8, attenuate delta_s
        if p_stop is not None:
            motion_gate = torch.clamp(1.0 - p_stop, min=0.0, max=1.0)
            effective_ds = delta_s * motion_gate
        else:
            effective_ds = delta_s

        new_psi = prev_psi + delta_psi
        new_e = prev_e + effective_ds * torch.sin(new_psi)
        new_n = prev_n + effective_ds * torch.cos(new_psi)
        new_v = effective_ds / self.dt

        return new_e, new_n, new_psi, new_v

    def rollout_sequence(
        self,
        step_ds: torch.Tensor,      # (B, T)
        step_dpsi: torch.Tensor,    # (B, T)
        init_psi: torch.Tensor,     # (B,) or (B, 1)
        p_stop: Optional[torch.Tensor] = None # (B, T)
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Differentiable multi-step trajectory rollout.
        Returns:
          traj_e: (B, T)
          traj_n: (B, T)
          traj_psi: (B, T)
        """
        B, T = step_ds.shape
        device = step_ds.device

        if init_psi.dim() == 1:
            init_psi = init_psi.unsqueeze(-1)  # (B, 1)

        # Standstill soft gating
        if p_stop is not None:
            motion_gate = torch.clamp(1.0 - p_stop, min=0.0, max=1.0)
            eff_ds = step_ds * motion_gate
        else:
            eff_ds = step_ds

        # Cumulative heading: psi[t] = init_psi + sum_{k=0}^t dpsi[k]
        cum_dpsi = torch.cumsum(step_dpsi, dim=1)  # (B, T)
        traj_psi = init_psi + cum_dpsi             # (B, T)

        # Incremental displacements in East and North
        inc_e = eff_ds * torch.sin(traj_psi)       # (B, T)
        inc_n = eff_ds * torch.cos(traj_psi)       # (B, T)

        traj_e = torch.cumsum(inc_e, dim=1)        # (B, T)
        traj_n = torch.cumsum(inc_n, dim=1)        # (B, T)

        return traj_e, traj_n, traj_psi


class WGS84AnchorProjector:
    """
    Local tangent plane projection centered at the last trusted GNSS anchor P0 = (lat0, lon0).
    Converts relative ENU coordinates [delta_E, delta_N] into global WGS84 (lat, lon).
    """
    WGS84_A = 6378137.0         # semi-major axis (m)
    WGS84_F = 1.0 / 298.257223563
    WGS84_E2 = 2 * WGS84_F - WGS84_F**2

    def __init__(self, anchor_lat: float, anchor_lon: float):
        self.lat0_rad = math.radians(anchor_lat)
        self.lon0_rad = math.radians(anchor_lon)
        self.anchor_lat = anchor_lat
        self.anchor_lon = anchor_lon

        # Radii of curvature at anchor latitude
        sin_lat = math.sin(self.lat0_rad)
        cos_lat = math.cos(self.lat0_rad)
        denom = math.sqrt(1.0 - self.WGS84_E2 * sin_lat**2)
        self.R_m = self.WGS84_A * (1.0 - self.WGS84_E2) / (denom**3)
        self.R_n = self.WGS84_A / denom
        self.cos_lat0 = cos_lat

    def enu_to_geodetic(self, delta_e: float, delta_n: float) -> Tuple[float, float]:
        """Converts local displacement [delta_E, delta_N] in meters to (latitude, longitude)."""
        d_lat_rad = delta_n / self.R_m
        d_lon_rad = delta_e / (self.R_n * self.cos_lat0)
        lat = self.anchor_lat + math.degrees(d_lat_rad)
        lon = self.anchor_lon + math.degrees(d_lon_rad)
        return lat, lon

    def geodetic_to_enu(self, lat: float, lon: float) -> Tuple[float, float]:
        """Converts (latitude, longitude) to local displacement [delta_E, delta_N] from anchor."""
        d_lat_rad = math.radians(lat - self.anchor_lat)
        d_lon_rad = math.radians(lon - self.anchor_lon)
        delta_n = d_lat_rad * self.R_m
        delta_e = d_lon_rad * (self.R_n * self.cos_lat0)
        return delta_e, delta_n
