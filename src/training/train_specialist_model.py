"""
SIH 26168 - Maneuver Specialist Model Training Script (Session-Level Partitioning)
Trains ManeuverSpecialistNet on the session-partitioned IO-VNBD dataset.
Evaluates on completely held-out recording sessions.
"""

import os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

# Ensure unbuffered output on Windows
sys.stdout.reconfigure(line_buffering=True)

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from src.data.maneuver_dataset import build_maneuver_sub_dataset
from src.models.specialist_model import ManeuverSpecialistNet

def train_specialist(epochs=15, batch_size=256, lr=1e-3, device=None):
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    device = torch.device(device)

    print("=" * 70)
    print(f"  Training ManeuverSpecialistNet on Device: {device}")
    print("=" * 70)

    # 1. Load session-partitioned dataset
    train_ds, val_ds, test_ds, (norm_mean, norm_std) = build_maneuver_sub_dataset()
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0, pin_memory=True)
    val_loader   = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=0)
    test_loader  = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=0)

    print(f"  Training samples:   {len(train_ds):,} (Train Sessions)")
    print(f"  Validation samples: {len(val_ds):,} (Held-Out Val Sessions)")
    print(f"  Test samples:       {len(test_ds):,} (Held-Out Test Sessions: S3b, Vta)")

    # 2. Model & Optimizer
    model = ManeuverSpecialistNet(in_channels=9).to(device)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Model parameters:   {n_params:,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)

    bce_loss  = nn.BCELoss()
    huber_spd = nn.SmoothL1Loss(beta=1.0)

    save_dir = Path("models")
    save_dir.mkdir(exist_ok=True, parents=True)
    best_val_loss = float("inf")
    best_path = save_dir / "maneuver_specialist_net.pt"

    t0 = time.time()

    for epoch in range(1, epochs + 1):
        model.train()
        train_losses = []

        for batch in train_loader:
            imu = batch["imu"].to(device)
            p_stop_true = torch.clamp(batch["p_stop"].to(device), 0.0, 1.0)
            p_turn_true = torch.clamp(batch["p_turn"].to(device), 0.0, 1.0)
            p_cr_true   = torch.clamp(batch["p_cruise"].to(device), 0.0, 1.0)
            v_true      = torch.clamp(batch["v_t"].to(device), min=0.0)
            yaw_true    = batch["delta_psi"].to(device)

            optimizer.zero_grad()
            out = model(imu)

            l_stop   = bce_loss(out["p_stop"], p_stop_true)
            l_turn   = bce_loss(out["p_turn"], p_turn_true)
            l_cruise = bce_loss(out["p_cruise"], p_cr_true)
            l_spd    = huber_spd(out["v_crawl"], v_true)


            # Heteroscedastic NLL for yaw
            diff_sq = (out["delta_psi"] - yaw_true) ** 2
            s_var = out["log_var_psi"]
            l_yaw = torch.mean(0.5 * torch.exp(-s_var) * diff_sq + 0.5 * s_var)

            loss = 1.0 * l_stop + 1.0 * l_turn + 0.8 * l_cruise + 1.2 * l_spd + 2.0 * l_yaw
            loss.backward()
            optimizer.step()

            train_losses.append(loss.item())

        scheduler.step()

        # Validation on held-out sessions
        model.eval()
        val_losses = []
        spd_errors = []
        yaw_errors = []
        stop_correct = 0
        turn_correct = 0
        val_total = 0

        with torch.no_grad():
            for batch in val_loader:
                imu = batch["imu"].to(device)
                p_stop_true = torch.clamp(batch["p_stop"].to(device), 0.0, 1.0)
                p_turn_true = torch.clamp(batch["p_turn"].to(device), 0.0, 1.0)
                p_cr_true   = torch.clamp(batch["p_cruise"].to(device), 0.0, 1.0)
                v_true      = torch.clamp(batch["v_t"].to(device), min=0.0)
                yaw_true    = batch["delta_psi"].to(device)

                out = model(imu)
                l_stop   = bce_loss(out["p_stop"], p_stop_true)
                l_turn   = bce_loss(out["p_turn"], p_turn_true)
                l_cruise = bce_loss(out["p_cruise"], p_cr_true)
                l_spd    = huber_spd(out["v_crawl"], v_true)
                diff_sq  = (out["delta_psi"] - yaw_true) ** 2
                s_var    = out["log_var_psi"]
                l_yaw    = torch.mean(0.5 * torch.exp(-s_var) * diff_sq + 0.5 * s_var)

                v_loss = 1.0 * l_stop + 1.0 * l_turn + 0.8 * l_cruise + 1.2 * l_spd + 2.0 * l_yaw
                val_losses.append(v_loss.item())

                spd_errors.append(torch.abs(out["v_crawl"] - v_true).cpu().numpy())
                yaw_errors.append(torch.abs(out["delta_psi"] - yaw_true).cpu().numpy())

                stop_pred = (out["p_stop"] > 0.5).float()
                stop_correct += (stop_pred == (p_stop_true > 0.5).float()).sum().item()

                turn_pred = (out["p_turn"] > 0.5).float()
                turn_correct += (turn_pred == (p_turn_true > 0.5).float()).sum().item()

                val_total += len(p_stop_true)

        mean_val = float(np.mean(val_losses))
        stop_acc = (stop_correct / max(1, val_total)) * 100.0
        turn_acc = (turn_correct / max(1, val_total)) * 100.0
        mean_spd_err = float(np.mean(np.concatenate(spd_errors))) * 3.6 # km/h
        mean_yaw_err = float(np.degrees(np.mean(np.concatenate(yaw_errors)))) # deg

        print(f"Epoch {epoch:2d}/{epochs:2d} | Train: {np.mean(train_losses):.4f} | Val: {mean_val:.4f} | Stop Acc: {stop_acc:.1f}% | Turn Acc: {turn_acc:.1f}% | Spd MAE: {mean_spd_err:.2f} km/h | Yaw MAE: {mean_yaw_err:.2f}°")

        if mean_val < best_val_loss:
            best_val_loss = mean_val
            torch.save({
                "model_state": model.state_dict(),
                "norm_mean": norm_mean,
                "norm_std": norm_std,
                "val_loss": best_val_loss,
                "stop_acc": stop_acc,
                "turn_acc": turn_acc,
                "spd_mae_kmh": mean_spd_err,
                "yaw_mae_deg": mean_yaw_err,
                "epoch": epoch
            }, best_path)

    # 3. Final Test Evaluation on Completely Unseen Sessions (S3b, Vta)
    print("\n" + "=" * 70)
    print("  EVALUATION ON HELD-OUT UNSEEN TEST SESSIONS (S3b & Vta01a)")
    print("=" * 70)
    best_ckpt = torch.load(best_path, weights_only=False)
    model.load_state_dict(best_ckpt["model_state"])
    model.eval()

    test_spd_err = []
    test_yaw_err = []
    t_stop_corr = 0
    t_turn_corr = 0
    test_total = 0

    with torch.no_grad():
        for batch in test_loader:
            imu = batch["imu"].to(device)
            p_stop_true = torch.clamp(batch["p_stop"].to(device), 0.0, 1.0)
            p_turn_true = torch.clamp(batch["p_turn"].to(device), 0.0, 1.0)
            v_true      = torch.clamp(batch["v_t"].to(device), min=0.0)
            yaw_true    = batch["delta_psi"].to(device)


            out = model(imu)
            test_spd_err.append(torch.abs(out["v_crawl"] - v_true).cpu().numpy())
            test_yaw_err.append(torch.abs(out["delta_psi"] - yaw_true).cpu().numpy())

            stop_pred = (out["p_stop"] > 0.5).float()
            t_stop_corr += (stop_pred == (p_stop_true > 0.5).float()).sum().item()

            turn_pred = (out["p_turn"] > 0.5).float()
            t_turn_corr += (turn_pred == (p_turn_true > 0.5).float()).sum().item()

            test_total += len(p_stop_true)

    heldout_stop_acc = (t_stop_corr / max(1, test_total)) * 100.0
    heldout_turn_acc = (t_turn_corr / max(1, test_total)) * 100.0
    heldout_spd_mae  = float(np.mean(np.concatenate(test_spd_err))) * 3.6
    heldout_yaw_mae  = float(np.degrees(np.mean(np.concatenate(test_yaw_err))))

    print(f"  Held-out Test Stop Accuracy: {heldout_stop_acc:.2f}% (Target >= 96.0%)")
    print(f"  Held-out Test Turn Accuracy: {heldout_turn_acc:.2f}%")
    print(f"  Held-out Test Speed MAE:     {heldout_spd_mae:.2f} km/h")
    print(f"  Held-out Test Yaw MAE:       {heldout_yaw_mae:.2f}°")
    print(f"  Training completed in {time.time() - t0:.1f}s!")
    print(f"  Model checkpoint saved: {best_path}")
    print("=" * 70 + "\n")

    return best_path

if __name__ == "__main__":
    train_specialist()
