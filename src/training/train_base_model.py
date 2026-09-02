"""
SIH 26168 — Universal MotionNet Base Model Training Script
Trains on canonical, leak-free 10.0 Hz IO-VNBD dataset windows.
Supervises frame-invariant primary navigation targets:
  Y = [v_t, delta_s, delta_psi, p_stop]
Exports PyTorch weights and ONNX model for browser inference.
"""

import os, sys, json, time
from pathlib import Path
sys.stdout.reconfigure(line_buffering=True)

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from src.data.iovnbd_loader import build_canonical_splits, find_all_s_csvs
from src.models.nn_models import UniversalMotionNet

CFG = {
    "window":        20,      # 2.0 seconds at 10.0 Hz
    "stride":        5,       # 0.5 second step during dataset construction
    "channels":      9,       # [ax, ay, az, gyaw, gpit, grol, gx, gy, gz]
    "batch_size":    256,
    "lr":            1e-3,
    "weight_decay":  1e-4,
    "epochs":        15,
    "warmup_epochs": 3,
    "w_speed":       1.0,     # loss weight for v_t
    "w_dist":        0.8,     # loss weight for delta_s
    "w_yaw":         0.5,     # loss weight for delta_psi
    "w_stop":        0.4,     # loss weight for p_stop
    "save_dir":      Path("models"),
    "results_dir":   Path("results"),
    "device":        "cuda" if torch.cuda.is_available() else "cpu",
}

class MultiObjectiveNavigationLoss(nn.Module):
    """
    Multi-objective normalized loss supervising primary navigation state:
      1. Forward velocity with Stabilized Heteroscedastic NLL:
         L_spd = MSE(v_pred/10, v_true/10) + 0.2 * mean(0.5 * exp(-s) * diff^2 + 0.5 * s)
      2. Window scalar distance: MSE(delta_s / 10)
      3. Heading change: MSE(delta_psi / 0.5)
      4. Stationary stop: BCE(p_stop) + stop velocity collapse penalty
    """
    SPD_NORM  = 10.0  # normalize speeds (mean ~10 m/s)
    DIST_NORM = 10.0  # normalize window displacement
    YAW_NORM  = 0.5   # normalize heading change (rad)

    def __init__(self, w_spd=1.0, w_dist=0.8, w_yaw=0.5, w_stop=0.4):
        super().__init__()
        self.w_spd = w_spd
        self.w_dist = w_dist
        self.w_yaw = w_yaw
        self.w_stop = w_stop
        self.bce = nn.BCELoss()

    def forward(self, pred, batch):
        v_true = batch["v_t"].to(pred["v_t"].device)
        dist_true = batch["delta_s"].to(pred["delta_s"].device)
        yaw_true = batch["delta_psi"].to(pred["delta_psi"].device)
        stop_true = batch["p_stop"].to(pred["p_stop"].device)

        v_pred = pred["v_t"]
        log_var = pred["log_var"]

        # 1. Forward velocity loss: Base MSE + Stabilized Bounded NLL
        l_spd_base = nn.functional.mse_loss(v_pred / self.SPD_NORM, v_true / self.SPD_NORM)
        v_diff_sq = ((v_pred - v_true) / self.SPD_NORM) ** 2
        s = torch.clamp(log_var, -2.0, 2.0)
        l_spd_nll = torch.mean(0.5 * torch.exp(-s) * v_diff_sq + 0.5 * s)
        l_spd = l_spd_base + 0.2 * l_spd_nll
        
        # 2. Window scalar distance loss (trapezoidal integration consistency)
        l_dist = nn.functional.mse_loss(pred["delta_s"] / self.DIST_NORM, dist_true / self.DIST_NORM)
        
        # 3. Heading increment loss
        l_yaw = nn.functional.mse_loss(pred["delta_psi"] / self.YAW_NORM, yaw_true / self.YAW_NORM)
        
        # 4. Stationary stop loss: BCE + stop velocity collapse penalty
        l_stop_bce = self.bce(pred["p_stop"], stop_true)
        l_stop_pen = torch.mean(stop_true * (v_pred / self.SPD_NORM) ** 2)
        l_stop = l_stop_bce + l_stop_pen

        total = (
            self.w_spd * l_spd +
            self.w_dist * l_dist +
            self.w_yaw * l_yaw +
            self.w_stop * l_stop
        )

        metrics = {
            "l_spd": float(l_spd_base.item()),
            "l_spd_nll": float(l_spd_nll.item()),
            "l_dist": float(l_dist.item()),
            "l_yaw": float(l_yaw.item()),
            "l_stop": float(l_stop.item()),
            "total": float(total.item())
        }
        return total, metrics

def get_lr(epoch, cfg):
    if epoch < cfg["warmup_epochs"]:
        return cfg["lr"] * (epoch + 1) / cfg["warmup_epochs"]
    progress = (epoch - cfg["warmup_epochs"]) / max(1, cfg["epochs"] - cfg["warmup_epochs"])
    return cfg["lr"] * 0.5 * (1 + np.cos(np.pi * progress))

def train():
    device = torch.device(CFG["device"])
    print(f"\n{'='*70}")
    print(f"  Universal MotionNet: Canonical IO-VNBD Base Model Training")
    print(f"  Device: {device} | Window: {CFG['window']} samples (2.0s) | Channels: {CFG['channels']}")
    print(f"{'='*70}\n")

    # 1. Build canonical splits
    train_ds, val_ds, test_ds = build_canonical_splits(
        window=CFG["window"],
        stride=CFG["stride"],
        channels=CFG["channels"]
    )

    train_loader = DataLoader(train_ds, batch_size=CFG["batch_size"], shuffle=True, num_workers=0, pin_memory=True)
    val_loader   = DataLoader(val_ds, batch_size=CFG["batch_size"], shuffle=False, num_workers=0)
    test_loader  = DataLoader(test_ds, batch_size=CFG["batch_size"], shuffle=False, num_workers=0)

    # 2. Model & Optimizer
    model = UniversalMotionNet(in_channels=CFG["channels"], hidden_dim=64, rnn_dim=64).to(device)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Model parameters: {n_params:,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=CFG["lr"], weight_decay=CFG["weight_decay"])
    loss_fn = MultiObjectiveNavigationLoss(
        w_spd=CFG["w_speed"],
        w_dist=CFG["w_dist"],
        w_yaw=CFG["w_yaw"],
        w_stop=CFG["w_stop"]
    )

    CFG["save_dir"].mkdir(exist_ok=True, parents=True)
    CFG["results_dir"].mkdir(exist_ok=True, parents=True)

    log = {"train_loss": [], "val_loss": [], "best_val": float("inf"), "best_epoch": 0}

    # 3. Training Loop
    start_time = time.time()
    for epoch in range(CFG["epochs"]):
        lr = get_lr(epoch, CFG)
        for pg in optimizer.param_groups:
            pg["lr"] = lr

        # Train
        model.train()
        train_losses = []
        for batch in train_loader:
            imu = batch["imu"].to(device)
            optimizer.zero_grad()
            pred = model(imu)
            loss, _ = loss_fn(pred, batch)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_losses.append(loss.item())

        # Validate
        model.eval()
        val_losses = []
        with torch.no_grad():
            for batch in val_loader:
                imu = batch["imu"].to(device)
                pred = model(imu)
                loss, _ = loss_fn(pred, batch)
                val_losses.append(loss.item())

        t_loss = float(np.mean(train_losses))
        v_loss = float(np.mean(val_losses))
        log["train_loss"].append(t_loss)
        log["val_loss"].append(v_loss)

        print(f"  Epoch {epoch+1:02d}/{CFG['epochs']}  lr={lr:.2e}  train={t_loss:.4f}  val={v_loss:.4f}")

        if v_loss < log["best_val"]:
            log["best_val"] = v_loss
            log["best_epoch"] = epoch + 1
            torch.save(model.state_dict(), CFG["save_dir"] / "universal_motion_net.pt")
            print(f"    -> [BEST] Checkpoint saved: val_loss={v_loss:.4f}")

    elapsed = time.time() - start_time
    print(f"\nTraining finished in {elapsed/60.0:.1f} mins. Best val loss: {log['best_val']:.4f} at epoch {log['best_epoch']}.")

    # 4. Save training log
    with open(CFG["save_dir"] / "training_log.json", "w") as f:
        json.dump(log, f, indent=2)

    # 5. Evaluate on Holdout Zero-Shot Test Set (Driver D - Y1)
    print("\nEvaluating Zero-Shot Generalization on Unseen Vehicle (Driver D - Y1)...")
    model.load_state_dict(torch.load(CFG["save_dir"] / "universal_motion_net.pt", map_location=device))
    model.eval()
    test_losses = []
    test_spd_errors = []
    with torch.no_grad():
        for batch in test_loader:
            imu = batch["imu"].to(device)
            pred = model(imu)
            loss, _ = loss_fn(pred, batch)
            test_losses.append(loss.item())
            err = torch.abs(pred["v_t"] - batch["v_t"].to(device))
            test_spd_errors.extend(err.cpu().numpy().tolist())

    zero_shot_rmse = float(np.sqrt(np.mean(np.array(test_spd_errors) ** 2)))
    zero_shot_mae = float(np.mean(np.abs(np.array(test_spd_errors))))
    print(f"  Zero-Shot Test Set (Driver D): Loss={np.mean(test_losses):.4f} | Speed RMSE={zero_shot_rmse:.3f} m/s | MAE={zero_shot_mae:.3f} m/s")

    # 6. Export to ONNX for browser deployment
    print("\nExporting Universal MotionNet to ONNX (9 channels, W=20)...")
    model.eval().cpu()
    dummy_input = torch.randn(1, CFG["channels"], CFG["window"])
    onnx_path = CFG["save_dir"] / "universal_motion_net.onnx"
    torch.onnx.export(
        model,
        dummy_input,
        str(onnx_path),
        input_names=["imu_window"],
        output_names=["speed", "delta_s", "delta_psi", "p_stop", "log_var"],
        dynamic_axes={"imu_window": {0: "batch"}},
        opset_version=17,
    )
    print(f"  ONNX Export Complete: {onnx_path} ({onnx_path.stat().st_size / 1024:.1f} KB)")

if __name__ == "__main__":
    train()
