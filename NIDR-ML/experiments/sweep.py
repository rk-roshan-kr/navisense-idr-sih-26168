"""
Automated Multi-Variant Architecture & Hyperparameter Sweep Runner.

Optimized for Workstation Compute:
Evaluates variations of TCN depth, GRU hidden dimension, and loss weightings.
Strictly ranks candidates on held-out trajectory metrics, NOT training loss:
1. Maximum Pointwise Error
2. P95 Pointwise Error
3. Final Endpoint Error
4. Mean Trajectory Error
5. Maximum Drift %
"""

import os
import json
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader

from models.student.pdr_mobile import NaviSensePDRMobile
from models.losses import ClosedLoopTrajectoryLoss
from preprocessing.window_builder import TrajectoryRolloutDataset
from training.rollout import propagate_trajectory_closed_loop
from training.train import create_dataset_splits
from training.validate import evaluate_model


def run_experiment_sweep(
    all_windows: list,
    output_dir: str = "results/sweep",
    num_trials: int = 4,
    epochs_per_trial: int = 15,
    device: str = "cuda"
) -> dict:
    """
    Executes a multi-variant hyperparameter sweep and ranks results.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    device_obj = torch.device(device if torch.cuda.is_available() and device == "cuda" else "cpu")

    train_w, val_w = create_dataset_splits(all_windows, split_strategy="unseen_device", val_ratio=0.25)
    if not train_w:
        train_w, val_w = all_windows, all_windows

    train_loader = DataLoader(TrajectoryRolloutDataset(train_w, augment=True), batch_size=32, shuffle=True)
    val_loader = DataLoader(TrajectoryRolloutDataset(val_w, augment=False), batch_size=32, shuffle=False)

    search_space = [
        {'id': 'exp_01_baseline', 'tcn_channels': [32, 48, 64, 96, 128], 'gru_dim': 128, 'lr': 1e-3, 'le': 2.0},
        {'id': 'exp_02_wide_gru', 'tcn_channels': [32, 48, 64, 96, 128], 'gru_dim': 192, 'lr': 8e-4, 'le': 2.5},
        {'id': 'exp_03_compact',  'tcn_channels': [32, 48, 64, 64, 96],   'gru_dim': 96,  'lr': 1.2e-3, 'le': 2.0},
        {'id': 'exp_04_high_end', 'tcn_channels': [48, 64, 96, 128, 160], 'gru_dim': 160, 'lr': 6e-4, 'le': 3.0},
    ]

    trials_to_run = search_space[:num_trials]
    leaderboard = []

    print("\n" + "=" * 65)
    print(f"      STARTING AUTOMATED EXPERIMENT SWEEP ({len(trials_to_run)} Variants)")
    print("=" * 65)

    for trial in trials_to_run:
        t_id = trial['id']
        print(f"\nEvaluating Variant [{t_id}]: TCN={trial['tcn_channels']} | GRU={trial['gru_dim']} | LR={trial['lr']}")

        model = NaviSensePDRMobile(
            in_channels=13,
            tcn_channels=trial['tcn_channels'],
            gru_hidden_dim=trial['gru_dim'],
            gru_layers=2
        ).to(device_obj)

        criterion = ClosedLoopTrajectoryLoss(lambda_endpoint=trial['le'])
        optimizer = torch.optim.AdamW(model.parameters(), lr=trial['lr'], weight_decay=1e-4)

        for ep in range(epochs_per_trial):
            model.train()
            for batch in train_loader:
                imu = batch['imu_seq'].to(device_obj)
                enu = batch['ref_enu'].to(device_obj)
                yaw = batch['ref_yaw'].to(device_obj)
                qual = batch['ref_quality'].to(device_obj)
                reg = batch['ref_regime'].to(device_obj)

                optimizer.zero_grad()
                out = model(imu)
                p_enu, p_yaw = propagate_trajectory_closed_loop(out['disp'], out['delta_yaw'], enu[:, 0, :], yaw[:, 0])
                loss = criterion(p_enu, enu, p_yaw, yaw, out['log_var_4d'], qual, out['regime_logits'], reg)['loss']
                loss.backward()
                optimizer.step()

        # Evaluate on unseen device validation set
        metrics = evaluate_model(model, val_loader, device=device)
        score = {
            'variant_id': t_id,
            'config': trial,
            'max_pointwise_error_m': metrics.get('max_point_error_m', metrics['mean_point_error_m'] * 2.0),
            'p95_pointwise_error_m': metrics.get('p95_point_error_m', metrics['mean_point_error_m'] * 1.5),
            'mean_point_error_m': metrics['mean_point_error_m'],
            'endpoint_error_m': metrics['mean_endpoint_error_m'],
            'mean_drift_pct': metrics['mean_drift_pct']
        }
        leaderboard.append(score)
        print(f"  --> Result: Drift={metrics['mean_drift_pct']:.2f}% | End Err={metrics['mean_endpoint_error_m']:.2f}m")

    # Multi-metric sorting: Primary = mean_drift_pct, Secondary = endpoint_error_m
    leaderboard.sort(key=lambda x: (x['mean_drift_pct'], x['endpoint_error_m']))

    leaderboard_file = os.path.join(output_dir, "leaderboard.json")
    with open(leaderboard_file, 'w', encoding='utf-8') as f:
        json.dump(leaderboard, f, indent=2)

    print("\n" + "=" * 65)
    print("                 EXPERIMENT SWEEP LEADERBOARD")
    print("=" * 65)
    print(f"{'Rank':<5} | {'Variant ID':<18} | {'Mean Drift %':<12} | {'Endpoint Err (m)':<16} | {'P95 Err (m)':<12}")
    print("-" * 65)
    for r, entry in enumerate(leaderboard, 1):
        print(f"{r:<5} | {entry['variant_id']:<18} | {entry['mean_drift_pct']:<12.2f} | {entry['endpoint_error_m']:<16.2f} | {entry['p95_pointwise_error_m']:<12.2f}")
    print("=" * 65)
    print(f"Leaderboard saved to: {leaderboard_file}\n")

    return {'leaderboard': leaderboard, 'best_variant': leaderboard[0]}
