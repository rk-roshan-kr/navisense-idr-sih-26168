"""
High-Capacity Teacher Model Training Engine.

Tailored for Workstation: AMD Ryzen 9 9950X + 64 GB DDR5 + NVIDIA RTX 5070 Ti 16 GB.

Features:
- PyTorch AMP (Automatic Mixed Precision) with TF32 matrix multiplication
- 5-Stage Progressive Rollout Curriculum (5s -> 120s)
- Gradient Checkpointing for memory-safe long trajectories
- Multi-Worker Data Loading with Pinned Memory (leveraging 16C/32T Ryzen 9950X)
- Comprehensive Multi-Task Loss: 4D Uncertainty NLL, Heading, Velocity, and Signed Turn-Rate
"""

import os
import json
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader

from models.teacher.pdr_teacher import NaviSensePDRTeacher
from models.losses import TeacherMultiTaskLoss, ClosedLoopTrajectoryLoss
from preprocessing.window_builder import TrajectoryRolloutDataset
from training.rollout import propagate_trajectory_closed_loop
from training.curriculum import RolloutCurriculum


def train_teacher_model(
    config: dict,
    sync_sessions: list,
    output_dir: str = "checkpoints",
    curriculum_stages: int = 3
) -> NaviSensePDRTeacher:
    """
    Trains the NaviSense PDR-Teacher across the progressive rollout curriculum.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    device_str = config.get('training', {}).get('device', config.get('hardware', {}).get('device', 'cuda'))
    device_name = "cuda" if torch.cuda.is_available() and device_str == 'cuda' else "cpu"
    device = torch.device(device_name)

    # Enable TF32 for maximal RTX 5070 Ti tensor core throughput
    if device_name == "cuda":
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    print("\n" + "=" * 65)
    print("          NAVISENSE PDR-TEACHER: WORKSTATION TRAINING")
    print("=" * 65)
    print(f"Active Device: {device} ({torch.cuda.get_device_name(0) if device_name == 'cuda' else 'CPU'})")
    print(f"TF32 Tensor Cores: Active | Progressive Curriculum: {curriculum_stages} Stages")

    # 1. Instantiate Teacher Model
    teacher = NaviSensePDRTeacher(
        in_channels=13,
        tcn_channels=[64, 128, 192, 256, 256],
        gru_hidden_dim=256,
        gru_layers=3,
        dropout=0.15,
        use_checkpointing=False
    ).to(device)

    # 2. Loss & Optimizer
    base_traj_loss = ClosedLoopTrajectoryLoss(
        lambda_point=1.0,
        lambda_endpoint=2.0,
        lambda_heading=0.6,
        lambda_step=0.2,
        lambda_regime=0.1,
        lambda_uncertainty=0.05,
        vertical_weight=0.1
    )
    criterion = TeacherMultiTaskLoss(base_trajectory_loss=base_traj_loss, lambda_aux=0.2).to(device)

    lr = config.get('training', {}).get('learning_rate', 0.001)
    optimizer = torch.optim.AdamW(teacher.parameters(), lr=lr, weight_decay=1e-4)
    scaler = torch.amp.GradScaler('cuda', enabled=(device_name == 'cuda'))

    best_loss = float('inf')
    best_teacher_path = os.path.join(output_dir, "best_teacher_model.pth")

    # Workstation DataLoader configuration for Ryzen 9950X
    num_workers = 4 if os.name == 'nt' else 8  # Safe multiprocessing workers on Windows
    aug_cfg = config.get('augmentation', {})

    # Train across curriculum stages
    for stage_idx in range(curriculum_stages):
        stage_cfg = RolloutCurriculum.get_stage_config(stage_idx)
        stage_name = stage_cfg['name']
        batch_size = stage_cfg['batch_size']
        teacher.use_checkpointing = stage_cfg['use_checkpointing']

        print(f"\n>>> ENTERING CURRICULUM STAGE {stage_idx + 1}/{curriculum_stages}: {stage_name}")
        print(f"    Rollout Horizon: {stage_cfg['steps']} steps ({stage_cfg['steps'] * 0.05:.1f}s) | Batch Size: {batch_size} | Gradient Checkpointing: {teacher.use_checkpointing}")

        stage_windows = RolloutCurriculum.slice_curriculum_windows(
            sync_sessions=sync_sessions,
            stage_idx=stage_idx,
            imu_hz=config['rates']['imu_canonical_hz'],
            pred_hz=config['rates']['prediction_hz']
        )

        if not stage_windows:
            print("    [NOTICE] Insufficient session duration for this stage, continuing...")
            continue

        dataset = TrajectoryRolloutDataset(stage_windows, augment=aug_cfg.get('enabled', True), augment_config=aug_cfg)
        loader = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=True,
            drop_last=(len(dataset) > batch_size),
            num_workers=0,  # Single-process for Windows compatibility in notebooks/scripts
            pin_memory=(device_name == 'cuda')
        )

        stage_epochs = max(10, 30 // (stage_idx + 1))
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=stage_epochs, eta_min=1e-5)

        for ep in range(1, stage_epochs + 1):
            teacher.train()
            ep_losses = []
            ep_drifts = []

            for batch in loader:
                imu_seq = batch['imu_seq'].to(device)
                ref_enu = batch['ref_enu'].to(device)
                ref_yaw = batch['ref_yaw'].to(device)
                ref_qual = batch['ref_quality'].to(device)
                ref_regime = batch['ref_regime'].to(device)

                optimizer.zero_grad()

                with torch.amp.autocast('cuda', enabled=(device_name == 'cuda')):
                    out = teacher(imu_seq)

                    # Propagate trajectory in closed-loop
                    pred_enu, pred_yaw = propagate_trajectory_closed_loop(
                        disp=out['disp'],
                        delta_yaw=out['delta_yaw'],
                        initial_enu=ref_enu[:, 0, :],
                        initial_yaw=ref_yaw[:, 0]
                    )

                    loss_dict = criterion(
                        pred_enu=pred_enu,
                        ref_enu=ref_enu,
                        pred_yaw=pred_yaw,
                        ref_yaw=ref_yaw,
                        pred_log_var=out['log_var_4d'],
                        ref_quality=ref_qual,
                        pred_regime=out['regime_logits'],
                        ref_regime=ref_regime,
                        pred_velocity=out['velocity'],
                        pred_angular_rate=out['angular_rate']
                    )
                    loss = loss_dict['loss']

                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(teacher.parameters(), max_norm=5.0)
                scaler.step(optimizer)
                scaler.update()

                ep_losses.append(loss.item())
                ep_drifts.append(loss_dict['endpoint_drift_m'])

            scheduler.step()

            if ep % 5 == 0 or ep == stage_epochs:
                mean_loss = np.mean(ep_losses)
                mean_drift = np.mean(ep_drifts)
                print(f"  Stage {stage_idx + 1} Epoch [{ep:02d}/{stage_epochs:02d}] "
                      f"Loss: {mean_loss:.4f} | Endpoint Drift: {mean_drift:.2f}m")

                if mean_loss < best_loss:
                    best_loss = mean_loss
                    torch.save({
                        'stage': stage_idx,
                        'epoch': ep,
                        'model_state_dict': teacher.state_dict(),
                        'loss': best_loss,
                        'config': config
                    }, best_teacher_path)

    print(f"\n[OK] Teacher Training Complete. Checkpoint saved: {best_teacher_path}")
    if os.path.exists(best_teacher_path):
        ckpt = torch.load(best_teacher_path, map_location=device, weights_only=False)
        teacher.load_state_dict(ckpt['model_state_dict'])

    return teacher
