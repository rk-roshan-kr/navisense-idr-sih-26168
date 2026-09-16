"""
Knowledge Distillation Engine: Teacher -> Mobile Student.

Compresses the large Research Teacher (Causal TCN 64->256 + 3-Layer GRU 256)
into the lightweight Mobile Student (Causal TCN 32->128 + 2-Layer GRU 128)
for mobile ExecuTorch deployment on Android.

Key Invariant:
Reference trajectory supervision remains strictly authoritative.
Teacher representations regularize and guide compression without poisoning the ground truth.
"""

import os
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader

from models.teacher.pdr_teacher import NaviSensePDRTeacher
from models.student.pdr_mobile import NaviSensePDRMobile
from models.losses import DistillationLoss
from preprocessing.window_builder import TrajectoryRolloutDataset
from training.rollout import propagate_trajectory_closed_loop
from training.train import create_dataset_splits
from training.validate import evaluate_model


def distill_mobile_student(
    config: dict,
    all_windows: list,
    teacher_checkpoint_path: str = "checkpoints/best_teacher_model.pth",
    output_dir: str = "checkpoints",
    epochs: int = 50
) -> NaviSensePDRMobile:
    """
    Distills knowledge from frozen Teacher into lightweight Mobile Student.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    device_str = config.get('training', {}).get('device', config.get('hardware', {}).get('device', 'cuda'))
    device_name = "cuda" if torch.cuda.is_available() and device_str == 'cuda' else "cpu"
    device = torch.device(device_name)

    print("\n" + "=" * 65)
    print("          KNOWLEDGE DISTILLATION: TEACHER -> MOBILE STUDENT")
    print("=" * 65)
    print(f"Active Device: {device} | Student Target: Compact Mobile Model (~3-4 MB)")

    # 1. Load & Freeze Teacher Model
    teacher = NaviSensePDRTeacher(
        in_channels=13,
        tcn_channels=[64, 128, 192, 256, 256],
        gru_hidden_dim=256,
        gru_layers=3
    ).to(device)

    if os.path.exists(teacher_checkpoint_path):
        ckpt = torch.load(teacher_checkpoint_path, map_location=device, weights_only=False)
        teacher.load_state_dict(ckpt['model_state_dict'])
        print(f"[OK] Loaded pre-trained Teacher checkpoint from: {teacher_checkpoint_path}")
    else:
        print(f"[WARNING] Teacher checkpoint {teacher_checkpoint_path} not found. Using initialized teacher weights.")

    teacher.eval()
    for param in teacher.parameters():
        param.requires_grad = False

    # 2. Instantiate Mobile Student
    student = NaviSensePDRMobile(
        in_channels=13,
        tcn_channels=[32, 48, 64, 96, 128],
        gru_hidden_dim=128,
        gru_layers=2,
        teacher_latent_dim=256
    ).to(device)

    # 3. Dataset Splits (strict unseen physical device)
    train_w, val_w = create_dataset_splits(all_windows, split_strategy="unseen_device", val_ratio=0.2)
    if not train_w:
        train_w, val_w = all_windows, all_windows

    aug_cfg = config.get('augmentation', {})
    train_dataset = TrajectoryRolloutDataset(train_w, augment=aug_cfg.get('enabled', True), augment_config=aug_cfg)
    val_dataset = TrajectoryRolloutDataset(val_w, augment=False)

    batch_size = config.get('distillation', {}).get('batch_size', config.get('training', {}).get('batch_size', 32))
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, drop_last=(len(train_dataset) > batch_size))
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # 4. Distillation Criterion & Optimizer
    criterion = DistillationLoss(
        lambda_trajectory=1.0,  # Authoritative ground-truth reference
        lambda_motion=0.3,      # Teacher displacement & heading imitation
        lambda_latent=0.15,     # Teacher latent representation matching
        lambda_regime_kd=0.05,  # Soft target temperature distillation
        temperature=2.0
    ).to(device)

    optimizer = torch.optim.AdamW(student.parameters(), lr=1e-3, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)
    scaler = torch.amp.GradScaler('cuda', enabled=(device_name == 'cuda'))

    best_drift = float('inf')
    best_student_path = os.path.join(output_dir, "best_student_distilled.pth")

    print(f"\nDistilling Student over {epochs} epochs (batch_size={batch_size})...\n")

    for ep in range(1, epochs + 1):
        student.train()
        train_losses = []

        for batch in train_loader:
            imu_seq = batch['imu_seq'].to(device)
            ref_enu = batch['ref_enu'].to(device)
            ref_yaw = batch['ref_yaw'].to(device)
            ref_qual = batch['ref_quality'].to(device)
            ref_regime = batch['ref_regime'].to(device)

            optimizer.zero_grad()

            with torch.amp.autocast('cuda', enabled=(device_name == 'cuda')):
                # Teacher forward pass (inference mode)
                with torch.no_grad():
                    t_out = teacher(imu_seq)

                # Student forward pass
                s_out = student(imu_seq)

                # Propagate student trajectory in closed-loop
                s_pred_enu, s_pred_yaw = propagate_trajectory_closed_loop(
                    disp=s_out['disp'],
                    delta_yaw=s_out['delta_yaw'],
                    initial_enu=ref_enu[:, 0, :],
                    initial_yaw=ref_yaw[:, 0]
                )

                loss_dict = criterion(
                    student_pred_enu=s_pred_enu,
                    ref_enu=ref_enu,
                    student_pred_yaw=s_pred_yaw,
                    ref_yaw=ref_yaw,
                    student_log_var=s_out['log_var_4d'],
                    ref_quality=ref_qual,
                    student_regime_logits=s_out['regime_logits'],
                    ref_regime=ref_regime,
                    student_disp=s_out['disp'],
                    teacher_disp=t_out['disp'],
                    student_delta_yaw=s_out['delta_yaw'],
                    teacher_delta_yaw=t_out['delta_yaw'],
                    student_projected_latent=s_out['projected_latent'],
                    teacher_latent=t_out['latent'],
                    teacher_regime_logits=t_out['regime_logits']
                )
                loss = loss_dict['loss']

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(student.parameters(), max_norm=5.0)
            scaler.step(optimizer)
            scaler.update()

            train_losses.append(loss.item())

        scheduler.step()

        # Validate every 5 epochs
        if ep % 5 == 0 or ep == epochs:
            val_metrics = evaluate_model(student, val_loader, device=device_name)
            val_drift = val_metrics['mean_drift_pct']
            val_pt = val_metrics['mean_point_error_m']
            val_end = val_metrics['mean_endpoint_error_m']

            print(f"Epoch [{ep:02d}/{epochs:02d}] "
                  f"Distill Loss: {np.mean(train_losses):.4f} | "
                  f"Val Point Err: {val_pt:.2f}m | "
                  f"Val End Err: {val_end:.2f}m | "
                  f"Val Drift: {val_drift:.2f}% | "
                  f"Regime Acc: {val_metrics['regime_accuracy_pct']:.1f}%")

            if val_drift < best_drift:
                best_drift = val_drift
                torch.save({
                    'epoch': ep,
                    'model_state_dict': student.state_dict(),
                    'val_metrics': val_metrics,
                    'drift_pct': best_drift,
                    'config': config
                }, best_student_path)
                print(f"  --> Saved Distilled Student Checkpoint: {best_student_path} (Drift: {best_drift:.2f}%)")

    if os.path.exists(best_student_path):
        ckpt = torch.load(best_student_path, map_location=device, weights_only=False)
        student.load_state_dict(ckpt['model_state_dict'])
        print(f"\nDistillation Complete. Best Drift on Unseen Devices: {best_drift:.2f}%")

    return student
