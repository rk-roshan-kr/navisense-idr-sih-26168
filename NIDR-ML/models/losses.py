"""
Closed-Loop Trajectory Rollout Multi-Objective & Distillation Loss Functions.

Implements:
1. ClosedLoopTrajectoryLoss:
   - 4D Vector Uncertainty NLL [log σ_E^2, log σ_N^2, log σ_U^2, log σ_ψ^2]
   - De-weighted vertical altitude error (horizontal EN is primary objective)
   - Signed circular heading alignment
   - Local step consistency
   - Motion regime classification cross-entropy
2. TeacherMultiTaskLoss:
   - Auxiliary velocity consistency (||v_t|| >= 0)
   - Auxiliary signed turn rate consistency (ω_z)
3. DistillationLoss:
   - Authoritative reference trajectory supervision
   - Teacher motion prediction imitation (displacement & signed heading increment)
   - Latent feature representation matching (adapter-projected student latent -> teacher latent)
   - Temperature-scaled soft target regime distillation
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


class ClosedLoopTrajectoryLoss(nn.Module):
    """
    Multi-objective trajectory optimization loss with 4D vector uncertainty and de-weighted vertical error.
    """
    def __init__(
        self,
        lambda_point: float = 1.0,
        lambda_endpoint: float = 2.0,
        lambda_heading: float = 0.5,
        lambda_step: float = 0.2,
        lambda_regime: float = 0.1,
        lambda_uncertainty: float = 0.05,
        vertical_weight: float = 0.1
    ):
        super().__init__()
        self.lp = lambda_point
        self.le = lambda_endpoint
        self.lh = lambda_heading
        self.ls = lambda_step
        self.lr = lambda_regime
        self.lu = lambda_uncertainty
        self.vert_w = vertical_weight
        self.ce_loss = nn.CrossEntropyLoss()

    def forward(
        self,
        pred_enu: torch.Tensor,         # (Batch, T, 3)
        ref_enu: torch.Tensor,          # (Batch, T, 3)
        pred_yaw: torch.Tensor,         # (Batch, T)
        ref_yaw: torch.Tensor,          # (Batch, T)
        pred_log_var: torch.Tensor,     # (Batch, T, 4) or (Batch, T)
        ref_quality: torch.Tensor,      # (Batch, T)
        pred_regime: torch.Tensor,      # (Batch, T, num_classes)
        ref_regime: torch.Tensor        # (Batch, T)
    ) -> dict:
        # 1. Trajectory point error (horizontal primary, vertical de-weighted)
        diff_e = pred_enu[:, :, 0] - ref_enu[:, :, 0]
        diff_n = pred_enu[:, :, 1] - ref_enu[:, :, 1]
        diff_u = pred_enu[:, :, 2] - ref_enu[:, :, 2]

        err_horiz = torch.sqrt(diff_e**2 + diff_n**2 + 1e-8)
        err_vert = torch.abs(diff_u)
        point_errors = err_horiz + self.vert_w * err_vert
        loss_point = torch.mean(point_errors * ref_quality)

        # 2. Endpoint error penalty
        end_diff_e = pred_enu[:, -1, 0] - ref_enu[:, -1, 0]
        end_diff_n = pred_enu[:, -1, 1] - ref_enu[:, -1, 1]
        end_diff_u = pred_enu[:, -1, 2] - ref_enu[:, -1, 2]
        endpoint_err = torch.sqrt(end_diff_e**2 + end_diff_n**2 + 1e-8) + self.vert_w * torch.abs(end_diff_u)
        loss_endpoint = torch.mean(endpoint_err)

        # 3. Signed heading alignment loss (circular cosine distance: 1 - cos(Δψ))
        heading_diff = pred_yaw - ref_yaw
        loss_heading = torch.mean(1.0 - torch.cos(heading_diff))

        # 4. Local step consistency
        pred_step = pred_enu[:, 1:, :] - pred_enu[:, :-1, :]
        ref_step = ref_enu[:, 1:, :] - ref_enu[:, :-1, :]
        loss_step = torch.mean(torch.norm(pred_step - ref_step, dim=-1))

        # 5. Motion regime classification cross-entropy
        B, T, C = pred_regime.shape
        loss_regime = self.ce_loss(pred_regime.reshape(B * T, C), ref_regime.reshape(B * T))

        # 6. 4D Heteroscedastic Uncertainty NLL
        if pred_log_var.dim() == 3 and pred_log_var.shape[-1] >= 4:
            # Clamped log variances to prevent exploding gradients
            clamped_log = torch.clamp(pred_log_var, -6.0, 6.0)
            var_e = torch.exp(clamped_log[:, :, 0])
            var_n = torch.exp(clamped_log[:, :, 1])
            var_u = torch.exp(clamped_log[:, :, 2])
            var_yaw = torch.exp(clamped_log[:, :, 3])

            nll_e = (diff_e**2) / (2.0 * var_e + 1e-6) + 0.5 * clamped_log[:, :, 0]
            nll_n = (diff_n**2) / (2.0 * var_n + 1e-6) + 0.5 * clamped_log[:, :, 1]
            nll_u = (diff_u**2) / (2.0 * var_u + 1e-6) + 0.5 * clamped_log[:, :, 2]
            nll_yaw = (1.0 - torch.cos(heading_diff)) / (var_yaw + 1e-6) + 0.5 * clamped_log[:, :, 3]

            nll_total = nll_e + nll_n + self.vert_w * nll_u + nll_yaw
            loss_uncertainty = torch.mean(nll_total * ref_quality)
        else:
            # Scalar uncertainty fallback
            clamped_log = torch.clamp(pred_log_var, -6.0, 6.0)
            var = torch.exp(clamped_log)
            nll = (point_errors**2) / (2.0 * var + 1e-6) + 0.5 * clamped_log
            loss_uncertainty = torch.mean(nll * ref_quality)

        total_loss = (
            self.lp * loss_point +
            self.le * loss_endpoint +
            self.lh * loss_heading +
            self.ls * loss_step +
            self.lr * loss_regime +
            self.lu * loss_uncertainty
        )

        return {
            'loss': total_loss,
            'loss_point': loss_point.item(),
            'loss_endpoint': loss_endpoint.item(),
            'loss_heading': loss_heading.item(),
            'loss_step': loss_step.item(),
            'loss_regime': loss_regime.item(),
            'loss_uncertainty': loss_uncertainty.item(),
            'mean_drift_m': point_errors.mean().item(),
            'endpoint_drift_m': loss_endpoint.item()
        }


class TeacherMultiTaskLoss(nn.Module):
    """
    Teacher training loss combining closed-loop trajectory tracking with auxiliary
    linear speed and signed turn-rate consistency.
    """
    def __init__(self, base_trajectory_loss: ClosedLoopTrajectoryLoss = None, lambda_aux: float = 0.2):
        super().__init__()
        self.base_loss = base_trajectory_loss or ClosedLoopTrajectoryLoss()
        self.lambda_aux = lambda_aux

    def forward(
        self,
        pred_enu: torch.Tensor,
        ref_enu: torch.Tensor,
        pred_yaw: torch.Tensor,
        ref_yaw: torch.Tensor,
        pred_log_var: torch.Tensor,
        ref_quality: torch.Tensor,
        pred_regime: torch.Tensor,
        ref_regime: torch.Tensor,
        pred_velocity: torch.Tensor,        # (Batch, T)
        pred_angular_rate: torch.Tensor,    # (Batch, T)
        dt: float = 0.05
    ) -> dict:
        res = self.base_loss(
            pred_enu=pred_enu,
            ref_enu=ref_enu,
            pred_yaw=pred_yaw,
            ref_yaw=ref_yaw,
            pred_log_var=pred_log_var,
            ref_quality=ref_quality,
            pred_regime=pred_regime,
            ref_regime=ref_regime
        )

        # Auxiliary velocity consistency: reference speed = ||ΔP_ref|| / dt
        ref_disp = torch.diff(ref_enu[:, :, 0:2], dim=1, prepend=ref_enu[:, 0:1, 0:2])
        ref_speed = torch.norm(ref_disp, dim=-1) / dt
        loss_vel = F.smooth_l1_loss(pred_velocity, ref_speed)

        # Auxiliary signed turn rate: reference ω_z = Δref_yaw / dt
        ref_dyaw = torch.diff(ref_yaw, dim=1, prepend=ref_yaw[:, 0:1])
        ref_dyaw = (ref_dyaw + torch.pi) % (2.0 * torch.pi) - torch.pi
        ref_omega = ref_dyaw / dt
        loss_omega = F.smooth_l1_loss(pred_angular_rate, ref_omega)

        total_loss = res['loss'] + self.lambda_aux * (loss_vel + loss_omega)
        res['loss'] = total_loss
        res['loss_aux_vel'] = loss_vel.item()
        res['loss_aux_omega'] = loss_omega.item()
        return res


class DistillationLoss(nn.Module):
    """
    Knowledge Distillation Loss:
    Authoritative reference trajectory loss + Teacher motion/latent distillation regularizers.
    """
    def __init__(
        self,
        lambda_trajectory: float = 1.0,     # Authoritative ground-truth reference weight
        lambda_motion: float = 0.4,         # Teacher displacement & heading imitation
        lambda_latent: float = 0.2,         # Teacher latent feature projection matching
        lambda_regime_kd: float = 0.1,      # Soft target temperature distillation
        temperature: float = 2.0
    ):
        super().__init__()
        self.lt = lambda_trajectory
        self.lm = lambda_motion
        self.ll = lambda_latent
        self.lrk = lambda_regime_kd
        self.T = temperature
        self.base_traj_loss = ClosedLoopTrajectoryLoss()
        self.kl_div = nn.KLDivLoss(reduction='batchmean')

    def forward(
        self,
        student_pred_enu: torch.Tensor,
        ref_enu: torch.Tensor,
        student_pred_yaw: torch.Tensor,
        ref_yaw: torch.Tensor,
        student_log_var: torch.Tensor,
        ref_quality: torch.Tensor,
        student_regime_logits: torch.Tensor,
        ref_regime: torch.Tensor,
        student_disp: torch.Tensor,
        teacher_disp: torch.Tensor,
        student_delta_yaw: torch.Tensor,
        teacher_delta_yaw: torch.Tensor,
        student_projected_latent: torch.Tensor,
        teacher_latent: torch.Tensor,
        teacher_regime_logits: torch.Tensor
    ) -> dict:
        # 1. Authoritative Reference Trajectory Loss
        traj_res = self.base_traj_loss(
            pred_enu=student_pred_enu,
            ref_enu=ref_enu,
            pred_yaw=student_pred_yaw,
            ref_yaw=ref_yaw,
            pred_log_var=student_log_var,
            ref_quality=ref_quality,
            pred_regime=student_regime_logits,
            ref_regime=ref_regime
        )
        l_traj = traj_res['loss']

        # 2. Teacher Motion Output Alignment (imitate teacher local kinematics)
        loss_disp_match = F.mse_loss(student_disp, teacher_disp.detach())
        loss_yaw_match = torch.mean(1.0 - torch.cos(student_delta_yaw - teacher_delta_yaw.detach()))
        l_motion = loss_disp_match + loss_yaw_match

        # 3. Latent Representation Alignment (adapter-projected student latent -> teacher latent)
        l_latent = F.mse_loss(student_projected_latent, teacher_latent.detach())

        # 4. Temperature-Scaled Soft Target Regime Distillation
        s_soft = F.log_softmax(student_regime_logits / self.T, dim=-1)
        t_soft = F.softmax(teacher_regime_logits.detach() / self.T, dim=-1)
        l_regime_kd = (self.T ** 2) * self.kl_div(s_soft, t_soft)

        # Total Distillation Loss: Reference trajectory remains authoritative!
        total_loss = (
            self.lt * l_traj +
            self.lm * l_motion +
            self.ll * l_latent +
            self.lrk * l_regime_kd
        )

        return {
            'loss': total_loss,
            'loss_authoritative_traj': l_traj.item(),
            'loss_teacher_motion': l_motion.item(),
            'loss_teacher_latent': l_latent.item(),
            'loss_teacher_regime_kd': l_regime_kd.item(),
            'mean_drift_m': traj_res['mean_drift_m'],
            'endpoint_drift_m': traj_res['endpoint_drift_m']
        }
