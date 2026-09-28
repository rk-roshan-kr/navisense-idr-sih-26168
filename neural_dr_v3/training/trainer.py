"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/training/trainer.py
Description: High-performance PyTorch training engine supporting closed-loop
trajectory rollout loss, scheduled sampling, and checkpoint management.
================================================================================
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Dict, Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from neural_dr_v3.data.episode_dataset import build_episode_dataloaders
from neural_dr_v3.models.model_b_neural_dr import NeuralDeadReckoningNetV3
from neural_dr_v3.models.model_a_vel_yaw import VelYawBaselineNet
from neural_dr_v3.models.model_c_direct_cartesian import DirectCartesianBaselineNet
from neural_dr_v3.training.losses import MultiHorizonTrajectoryLoss
from neural_dr_v3.training.scheduled_sampler import ScheduledSamplingCurriculum


class NeuralDRTrainer:
    """
    Executes training for Neural DR v3 models with GPU acceleration and validation.
    """
    def __init__(
        self,
        model: nn.Module,
        train_loader: DataLoader,
        val_loader: DataLoader,
        device: torch.device,
        model_type: str = "b",
        lr: float = 1e-3,
        weight_decay: float = 1e-4,
        epochs: int = 15,
        checkpoint_dir: str = "neural_dr_v3/checkpoints",
        loss_weights: Optional[Dict[str, float]] = None
    ):
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.device = device
        self.model_type = model_type.lower()
        self.epochs = epochs
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        self.optimizer = torch.optim.AdamW(self.model.parameters(), lr=lr, weight_decay=weight_decay)
        self.scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(self.optimizer, T_max=epochs, eta_min=1e-5)

        lw = loss_weights or {}
        self.criterion = MultiHorizonTrajectoryLoss(
            lambda_step=lw.get("lambda_step", 1.0),
            lambda_traj=lw.get("lambda_traj", 2.0),
            lambda_final=lw.get("lambda_final", 3.0),
            lambda_heading=lw.get("lambda_heading", 1.5),
            lambda_speed=lw.get("lambda_speed", 1.0),
            lambda_stop=lw.get("lambda_stop", 1.0),
            lambda_nll=lw.get("lambda_nll", 0.1)
        )

        self.curriculum = ScheduledSamplingCurriculum(
            initial_prob=0.0,
            final_prob=0.8,
            warmup_epochs=3,
            total_epochs=epochs
        )

    def train_epoch(self, epoch: int) -> Dict[str, float]:
        self.model.train()
        total_loss = 0.0
        total_drift = 0.0
        n_batches = 0

        sched_prob = self.curriculum.get_probability(epoch)

        for batch in self.train_loader:
            hist_imu = batch["hist_imu"].to(self.device)
            stream_imu = batch["stream_imu"].to(self.device)
            anchor_v0 = batch["anchor_v0"].to(self.device)
            anchor_psi0 = batch["anchor_psi0"].to(self.device)

            # Targets dictionary
            targets = {
                "gt_delta_east": batch["gt_delta_east"].to(self.device),
                "gt_delta_north": batch["gt_delta_north"].to(self.device),
                "gt_delta_psi": batch["gt_delta_psi"].to(self.device),
                "gt_step_ds": batch["gt_step_ds"].to(self.device),
                "gt_step_dpsi": batch["gt_step_dpsi"].to(self.device),
                "gt_speed": batch["gt_speed"].to(self.device),
                "gt_p_stop": batch["gt_p_stop"].to(self.device)
            }

            full_imu = torch.cat([hist_imu, stream_imu], dim=-1)

            # Build ground truth state tensor for scheduled sampling: [v/15, ds/1.5, dpsi, p_stop]
            gt_states = torch.stack([
                torch.clamp(targets["gt_speed"] / 15.0, -1.0, 3.0),
                torch.clamp(targets["gt_step_ds"] / 1.5, 0.0, 3.0),
                torch.clamp(targets["gt_step_dpsi"], -1.0, 1.0),
                torch.clamp(targets["gt_p_stop"], 0.0, 1.0)
            ], dim=-1)

            self.optimizer.zero_grad()

            preds = self.model.forward_rollout(
                imu_full=full_imu,
                anchor_v0=anchor_v0,
                anchor_psi0=anchor_psi0,
                w_hist=hist_imu.shape[-1],
                scheduled_sample_prob=sched_prob,
                gt_states=gt_states
            )

            loss_dict = self.criterion(preds, targets)
            loss = loss_dict["total_loss"]

            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()

            total_loss += loss.item()
            total_drift += loss_dict["endpoint_drift_m"].item()
            n_batches += 1

        self.scheduler.step()

        return {
            "loss": total_loss / max(n_batches, 1),
            "endpoint_drift_m": total_drift / max(n_batches, 1),
            "scheduled_sample_prob": sched_prob
        }

    @torch.no_grad()
    def evaluate(self, loader: DataLoader) -> Dict[str, float]:
        self.model.eval()
        total_loss = 0.0
        total_drift = 0.0
        n_batches = 0

        for batch in loader:
            hist_imu = batch["hist_imu"].to(self.device)
            stream_imu = batch["stream_imu"].to(self.device)
            anchor_v0 = batch["anchor_v0"].to(self.device)
            anchor_psi0 = batch["anchor_psi0"].to(self.device)

            targets = {
                "gt_delta_east": batch["gt_delta_east"].to(self.device),
                "gt_delta_north": batch["gt_delta_north"].to(self.device),
                "gt_delta_psi": batch["gt_delta_psi"].to(self.device),
                "gt_step_ds": batch["gt_step_ds"].to(self.device),
                "gt_step_dpsi": batch["gt_step_dpsi"].to(self.device),
                "gt_speed": batch["gt_speed"].to(self.device),
                "gt_p_stop": batch["gt_p_stop"].to(self.device)
            }

            full_imu = torch.cat([hist_imu, stream_imu], dim=-1)

            # In evaluation, pure autonomous rollout (scheduled_sample_prob = 1.0)
            preds = self.model.forward_rollout(
                imu_full=full_imu,
                anchor_v0=anchor_v0,
                anchor_psi0=anchor_psi0,
                w_hist=hist_imu.shape[-1],
                scheduled_sample_prob=1.0
            )

            loss_dict = self.criterion(preds, targets)
            total_loss += loss_dict["total_loss"].item()
            total_drift += loss_dict["endpoint_drift_m"].item()
            n_batches += 1

        return {
            "loss": total_loss / max(n_batches, 1),
            "endpoint_drift_m": total_drift / max(n_batches, 1)
        }

    def run(self) -> Dict:
        print("=" * 80)
        print(f"NAVISENSE NEURAL DR V3 TRAINING: MODEL {self.model_type.upper()}")
        print(f"Device: {self.device} | Epochs: {self.epochs}")
        print("=" * 80)

        best_val_drift = float("inf")
        history = []

        for epoch in range(1, self.epochs + 1):
            t0 = time.time()
            train_metrics = self.train_epoch(epoch)
            val_metrics = self.evaluate(self.val_loader)
            elapsed = time.time() - t0

            is_best = val_metrics["endpoint_drift_m"] < best_val_drift
            if is_best:
                best_val_drift = val_metrics["endpoint_drift_m"]
                save_path = self.checkpoint_dir / f"best_model_{self.model_type}.pt"
                torch.save({
                    "epoch": epoch,
                    "model_state_dict": self.model.state_dict(),
                    "optimizer_state_dict": self.optimizer.state_dict(),
                    "val_drift_m": best_val_drift,
                    "model_type": self.model_type
                }, save_path)
                star = " [BEST SAVED]"
            else:
                star = ""

            print(
                f"Epoch {epoch:2d}/{self.epochs:2d} ({elapsed:4.1f}s) | "
                f"Train Loss: {train_metrics['loss']:.3f}, Drift: {train_metrics['endpoint_drift_m']:.2f}m | "
                f"Val Loss: {val_metrics['loss']:.3f}, Val Drift: {val_metrics['endpoint_drift_m']:.2f}m | "
                f"SchedProb: {train_metrics['scheduled_sample_prob']:.2f}{star}",
                flush=True
            )

            history.append({
                "epoch": epoch,
                "train_loss": train_metrics["loss"],
                "train_drift_m": train_metrics["endpoint_drift_m"],
                "val_loss": val_metrics["loss"],
                "val_drift_m": val_metrics["endpoint_drift_m"],
                "scheduled_prob": train_metrics["scheduled_sample_prob"]
            })

        print("=" * 80)
        print(f"TRAINING COMPLETE. Best Val Endpoint Drift: {best_val_drift:.2f} m")
        print("=" * 80)
        return {"best_val_drift_m": best_val_drift, "history": history}


def parse_args():
    parser = argparse.ArgumentParser(description="Train NaviSense Neural DR v3 (Experimental Subproject)")
    parser.add_argument("--model", type=str, default="b", choices=["a", "b", "c"], help="Model variant: a, b, or c")
    parser.add_argument("--epochs", type=int, default=12, help="Number of training epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-3, help="Learning rate")
    parser.add_argument("--rollout-steps", type=int, default=50, help="Rollout steps per slice (50 = 5.0s)")
    return parser.parse_args()


def main():
    args = parse_args()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[INIT] Using device: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")

    train_loader, val_loader, test_loader, norm_stats = build_episode_dataloaders(
        batch_size=args.batch_size,
        rollout_steps=args.rollout_steps
    )

    if args.model == "b":
        model = NeuralDeadReckoningNetV3()
    elif args.model == "a":
        model = VelYawBaselineNet()
    else:
        model = DirectCartesianBaselineNet()

    trainer = NeuralDRTrainer(
        model=model,
        train_loader=train_loader,
        val_loader=val_loader,
        device=device,
        model_type=args.model,
        lr=args.lr,
        epochs=args.epochs
    )

    trainer.run()


if __name__ == "__main__":
    main()
