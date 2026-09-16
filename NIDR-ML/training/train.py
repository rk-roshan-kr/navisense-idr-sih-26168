"""
Unified Training Loop for NaviSense PDR-Net V1.

Features:
- Closed-Loop Trajectory Rollout Optimization
- PyTorch AMP (Automatic Mixed Precision) on CUDA GPU
- Strict Unseen Physical Device & Unseen Participant Data Splits
- Model Checkpointing & Multi-Metric Logging
"""

import os
import json
import yaml
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader

from models.pdr_net import NaviSensePDRNetV1
from models.losses import ClosedLoopTrajectoryLoss
from preprocessing.window_builder import TrajectoryRolloutDataset
from training.rollout import propagate_trajectory_closed_loop
from training.validate import evaluate_model


def create_dataset_splits(all_windows: list, split_strategy: str = "unseen_device", val_ratio: float = 0.2) -> tuple:
    """
    Creates train and validation sets based on strict grouping keys:
    - 'unseen_device': Test set contains physical devices never seen during training.
    - 'unseen_person': Test set contains participants never seen during training.
    - 'random': Standard randomized session split.
    """
    if not all_windows:
        return [], []

    if split_strategy == "unseen_device":
        devices = sorted(list(set(w['physical_device_id'] for w in all_windows)))
        if len(devices) > 1:
            n_val = max(1, int(round(len(devices) * val_ratio)))
            val_devs = set(devices[-n_val:])
            train_windows = [w for w in all_windows if w['physical_device_id'] not in val_devs]
            val_windows = [w for w in all_windows if w['physical_device_id'] in val_devs]
            print(f"Split [Unseen Physical Device]: Train on {len(devices) - n_val} devices, Validate on {len(val_devs)} devices ({val_devs})")
            return train_windows, val_windows

    elif split_strategy == "unseen_person":
        people = sorted(list(set(w['participant_id'] for w in all_windows)))
        if len(people) > 1:
            n_val = max(1, int(round(len(people) * val_ratio)))
            val_people = set(people[-n_val:])
            train_windows = [w for w in all_windows if w['participant_id'] not in val_people]
            val_windows = [w for w in all_windows if w['participant_id'] in val_people]
            print(f"Split [Unseen Person]: Train on {len(people) - n_val} participants, Validate on {len(val_people)} participants ({val_people})")
            return train_windows, val_windows

    # Fallback random split
    indices = np.random.permutation(len(all_windows))
    n_val = max(1, int(len(all_windows) * val_ratio))
    val_idx = set(indices[:n_val])
    train_windows = [all_windows[i] for i in range(len(all_windows)) if i not in val_idx]
    val_windows = [all_windows[i] for i in range(len(all_windows)) if i in val_idx]
    print(f"Split [Random]: Train on {len(train_windows)} windows, Validate on {len(val_windows)} windows")
    return train_windows, val_windows


def train_pdr_net(config: dict, all_windows: list, output_dir: str = "checkpoints") -> NaviSensePDRNetV1:
    """
    Main training execution function.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    device_name = "cuda" if torch.cuda.is_available() and config['training'].get('device') == 'cuda' else "cpu"
    device = torch.device(device_name)
    print(f"NaviSense PDR-Net V1 Training Engine active on: {device} ({torch.cuda.get_device_name(0) if device_name == 'cuda' else 'CPU'})")

    # 1. Dataset splits
    train_w, val_w = create_dataset_splits(all_windows, split_strategy="unseen_device", val_ratio=0.2)
    if not train_w:
        train_w = all_windows
        val_w = all_windows

    aug_cfg = config.get('augmentation', {})
    train_dataset = TrajectoryRolloutDataset(train_w, augment=aug_cfg.get('enabled', True), augment_config=aug_cfg)
    val_dataset = TrajectoryRolloutDataset(val_w, augment=False)

    batch_size = config['training'].get('batch_size', 32)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True, drop_last=(len(train_dataset) > batch_size))
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    # 2. Instantiate Model
    m_cfg = config['model']
    model = NaviSensePDRNetV1(
        in_channels=m_cfg.get('in_channels', 13),
        tcn_channels=m_cfg.get('tcn_channels', [32, 64, 128]),
        kernel_size=m_cfg.get('tcn_kernel_size', 3),
        tcn_dropout=m_cfg.get('tcn_dropout', 0.1),
        gru_hidden_dim=m_cfg.get('gru_hidden_dim', 128),
        gru_layers=m_cfg.get('gru_layers', 2),
        gru_dropout=m_cfg.get('gru_dropout', 0.1),
        num_regimes=m_cfg.get('num_regimes', 5)
    ).to(device)

    # 3. Loss & Optimizer
    lw = config.get('loss_weights', {})
    criterion = ClosedLoopTrajectoryLoss(
        lambda_point=lw.get('lambda_point', 1.0),
        lambda_endpoint=lw.get('lambda_endpoint', 2.0),
        lambda_heading=lw.get('lambda_heading', 0.5),
        lambda_step=lw.get('lambda_step', 0.2),
        lambda_regime=lw.get('lambda_regime', 0.1),
        lambda_uncertainty=lw.get('lambda_uncertainty', 0.05)
    ).to(device)

    lr = config['training'].get('learning_rate', 0.001)
    weight_decay = config['training'].get('weight_decay', 1e-4)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)

    epochs = config['training'].get('epochs', 60)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    use_amp = config['training'].get('use_amp', True) and device_name == "cuda"
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

    best_drift = float('inf')
    best_ckpt_path = os.path.join(output_dir, "best_pdr_model.pth")

    print(f"\nBeginning Training ({epochs} epochs, batch_size={batch_size}, AMP={use_amp})...\n")

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses = []
        train_drifts = []

        for batch in train_loader:
            imu_seq = batch['imu_seq'].to(device)
            ref_enu = batch['ref_enu'].to(device)
            ref_yaw = batch['ref_yaw'].to(device)
            ref_qual = batch['ref_quality'].to(device)
            ref_regime = batch['ref_regime'].to(device)

            optimizer.zero_grad()

            with torch.cuda.amp.autocast(enabled=use_amp):
                out = model(imu_seq)
                disp = out['disp']
                delta_yaw = out['delta_yaw']
                log_var = out['log_var']
                regime_logits = out['regime_logits']

                # Propagate trajectory in closed-loop
                pred_enu, pred_yaw = propagate_trajectory_closed_loop(
                    disp=disp,
                    delta_yaw=delta_yaw,
                    initial_enu=ref_enu[:, 0, :],
                    initial_yaw=ref_yaw[:, 0]
                )

                loss_dict = criterion(
                    pred_enu=pred_enu,
                    ref_enu=ref_enu,
                    pred_yaw=pred_yaw,
                    ref_yaw=ref_yaw,
                    pred_log_var=log_var,
                    ref_quality=ref_qual,
                    pred_regime=regime_logits,
                    ref_regime=ref_regime
                )
                loss = loss_dict['loss']

            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=config['training'].get('grad_clip_norm', 5.0))
            scaler.step(optimizer)
            scaler.update()

            train_losses.append(loss.item())
            train_drifts.append(loss_dict['endpoint_drift_m'])

        scheduler.step()

        # Validation phase every 5 epochs or final
        if epoch % 5 == 0 or epoch == epochs:
            val_metrics = evaluate_model(model, val_loader, device=device_name)
            curr_val_drift = val_metrics['mean_drift_pct']
            mean_pt_err = val_metrics['mean_point_error_m']
            mean_end_err = val_metrics['mean_endpoint_error_m']

            print(f"Epoch [{epoch:02d}/{epochs:02d}] "
                  f"Train Loss: {np.mean(train_losses):.4f} | "
                  f"Val Point Err: {mean_pt_err:.2f}m | "
                  f"Val End Err: {mean_end_err:.2f}m | "
                  f"Val Drift: {curr_val_drift:.2f}% | "
                  f"Regime Acc: {val_metrics['regime_accuracy_pct']:.1f}%")

            if curr_val_drift < best_drift:
                best_drift = curr_val_drift
                torch.save({
                    'epoch': epoch,
                    'model_state_dict': model.state_dict(),
                    'optimizer_state_dict': optimizer.state_dict(),
                    'val_metrics': val_metrics,
                    'config': config
                }, best_ckpt_path)
                print(f"  --> Saved New Best Model Checkpoint: {best_ckpt_path} (Drift: {best_drift:.2f}%)")

    # Load best checkpoint before returning
    if os.path.exists(best_ckpt_path):
        ckpt = torch.load(best_ckpt_path, map_location=device, weights_only=False)
        model.load_state_dict(ckpt['model_state_dict'])
        print(f"\nTraining Complete. Loaded best checkpoint from epoch {ckpt['epoch']} (Best Drift: {best_drift:.2f}%)")

    return model
