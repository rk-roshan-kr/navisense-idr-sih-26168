"""
Differentiable Closed-Loop Trajectory Propagator.

Accumulates step-by-step local motion predictions [Δforward, Δlateral, Δvertical]
and heading increments Δψ_t into global ENU trajectories:

ψ_t = ψ_{t-1} + Δψ_t
P_t = P_{t-1} + R(ψ_{t-1}) * Δp_t

100% differentiable for end-to-end PyTorch backpropagation.
"""

import torch


def propagate_trajectory_closed_loop(
    disp: torch.Tensor,
    delta_yaw: torch.Tensor,
    initial_enu: torch.Tensor = None,
    initial_yaw: torch.Tensor = None
) -> tuple:
    """
    Propagates local motion increments into global East-North-Up coordinates.

    Parameters:
        disp: (Batch, T, 3) predicted displacements [Δforward, Δlateral, Δvertical] in meters.
        delta_yaw: (Batch, T) predicted heading increments in radians.
        initial_enu: (Optional) (Batch, 3) starting anchor position P0 in meters. Default (0,0,0).
        initial_yaw: (Optional) (Batch,) starting heading angle ψ0 in radians. Default 0.

    Returns:
        pred_enu: (Batch, T, 3) accumulated trajectory positions [E, N, U].
        pred_yaw: (Batch, T) accumulated heading angles in radians.
    """
    B, T, _ = disp.shape
    device = disp.device
    dtype = disp.dtype

    if initial_enu is None:
        initial_enu = torch.zeros((B, 3), device=device, dtype=dtype)
    if initial_yaw is None:
        initial_yaw = torch.zeros((B,), device=device, dtype=dtype)

    # 1. Heading accumulation: ψ_t = ψ_0 + Σ Δψ_i
    yaw_cumsum = torch.cumsum(delta_yaw, dim=1)
    pred_yaw = initial_yaw.unsqueeze(1) + yaw_cumsum

    # The rotation angle used for step t is the heading at the start of step t: ψ_{t-1}
    # Prepend initial_yaw for rotation of each step
    psi_prev = torch.cat([initial_yaw.unsqueeze(1), pred_yaw[:, :-1]], dim=1)

    cos_psi = torch.cos(psi_prev)
    sin_psi = torch.sin(psi_prev)

    d_fwd = disp[:, :, 0]
    d_lat = disp[:, :, 1]
    d_vert = disp[:, :, 2]

    # 2. Local forward/lateral to global East/North rotation
    # Standard navigation convention: Heading ψ is azimuth clockwise from North toward East
    # Facing North (ψ = 0):  ΔEast = 0, ΔNorth = Δforward
    # Facing East (ψ = π/2): ΔEast = Δforward, ΔNorth = 0
    delta_e = sin_psi * d_fwd + cos_psi * d_lat
    delta_n = cos_psi * d_fwd - sin_psi * d_lat
    delta_u = d_vert

    delta_enu = torch.stack([delta_e, delta_n, delta_u], dim=-1)

    # 3. Position accumulation: P_t = P_0 + Σ ΔP_i
    pred_enu = initial_enu.unsqueeze(1) + torch.cumsum(delta_enu, dim=1)

    return pred_enu, pred_yaw
