"""
SIH 26168 - UniversalMotionNetV2 Physical Metric Training & Validation
Authoritative training pipeline enforcing:
  1. Identical preprocessing: raw IMU -> SensorConditioner -> normalized -> model
  2. Supervision from synchronized Vehicle CAN reference (v_seq, omega_seq, CAN ENU 2D displacement)
  3. Strict physical metric evaluation:
     - v_rmse, v_mae (m/s)
     - w_rmse, w_mae (rad/s)
     - fwd_rmse, lat_rmse, pos_2d_rmse (m)
     - stop_f1 (score)
  4. Composite validation dashboard and checkpoint selection on physical pos_2d_rmse.
"""

import os, sys, json, time, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader

from src.data.iovnbd_loader import build_canonical_splits
from src.models.nn_models import UniversalMotionNetV2

CFG = {
    "window": 20,
    "stride": 5,
    "channels": 9,
    "batch_size": 256,
    "epochs": 12,
    "lr": 1e-3,
    "weight_decay": 1e-4,
    "device": "cuda" if torch.cuda.is_available() else "cpu",
    "num_workers": 0,
    "model_save_path": "models/universal_motion_net.pt",
    "backup_save_path": "models/universal_motion_net_v2.pt",
}


class MultiTaskMotionLoss(nn.Module):
    """
    Stabilized heteroscedastic multi-task loss supervising:
      - Forward velocity v(t) sequence and endpoint
      - Yaw-rate omega_z(t) sequence and endpoint
      - Deterministic trapezoidal integral delta_s and delta_psi
      - Vehicle CAN initial-heading frame displacement [delta_forward, delta_lateral]
      - Physical standstill probability p_stop
    """
    SPD_NORM  = 10.0   # normalize speed for loss balance (~10 m/s)
    YAW_NORM  = 0.5    # normalize angular rate (~0.5 rad/s)
    DIST_NORM = 10.0   # normalize displacement (~10 m)

    def __init__(self, w_v=1.0, w_w=0.8, w_dist=0.6, w_yaw=0.5, w_pos=1.0, w_stop=0.4):
        super().__init__()
        self.w_v = w_v
        self.w_w = w_w
        self.w_dist = w_dist
        self.w_yaw = w_yaw
        self.w_pos = w_pos
        self.w_stop = w_stop
        self.bce = nn.BCELoss()

    def forward(self, pred: dict, batch: dict):
        dev = pred["v_seq"].device

        v_true = batch["v_seq"].to(dev)
        omega_true = batch["omega_seq"].to(dev)
        dist_true = batch["delta_s"].to(dev)
        yaw_true = batch["delta_psi"].to(dev)
        fwd_true = batch["delta_forward"].to(dev)
        lat_true = batch["delta_lateral"].to(dev)
        stop_true = batch["p_stop"].to(dev)

        v_pred = pred["v_seq"]
        omega_pred = pred["omega_seq"]
        log_var_v = pred["log_var_v"]
        log_var_w = pred["log_var_w"]

        # 1. Forward velocity sequence loss: Base MSE + Stabilized Bounded NLL
        l_v_mse = F.mse_loss(v_pred / self.SPD_NORM, v_true / self.SPD_NORM)
        v_diff_sq = ((v_pred - v_true) / self.SPD_NORM) ** 2
        s_v = torch.clamp(log_var_v, -2.0, 2.0)
        l_v_nll = torch.mean(0.5 * torch.exp(-s_v) * v_diff_sq + 0.5 * s_v)
        l_v = l_v_mse + 0.2 * l_v_nll

        # 2. Yaw rate sequence loss: Base MSE + Stabilized Bounded NLL
        l_w_mse = F.mse_loss(omega_pred / self.YAW_NORM, omega_true / self.YAW_NORM)
        w_diff_sq = ((omega_pred - omega_true) / self.YAW_NORM) ** 2
        s_w = torch.clamp(log_var_w, -2.0, 2.0)
        l_w_nll = torch.mean(0.5 * torch.exp(-s_w) * w_diff_sq + 0.5 * s_w)
        l_w = l_w_mse + 0.2 * l_w_nll

        # 3. Scalar distance integral loss
        l_dist = F.mse_loss(pred["delta_s"] / self.DIST_NORM, dist_true / self.DIST_NORM)

        # 4. Heading increment integral loss
        l_yaw = F.mse_loss(pred["delta_psi"] / self.YAW_NORM, yaw_true / self.YAW_NORM)

        # 5. 2D Kinematic Displacement Consistency Loss (Initial-Heading Frame)
        l_pos = (
            F.mse_loss(pred["delta_forward"] / self.DIST_NORM, fwd_true / self.DIST_NORM) +
            F.mse_loss(pred["delta_lateral"] / self.DIST_NORM, lat_true / self.DIST_NORM)
        )

        # 6. Stationary stop loss: BCE + full-window velocity suppression + fraction-gated displacement
        is_still_k = (v_true < 0.2).float()
        l_stat_v = torch.mean(is_still_k * (v_pred / self.SPD_NORM) ** 2)

        # Fraction of window where reference vehicle is stopped
        r_stop = torch.mean(is_still_k, dim=-1)  # (B,)
        mostly_still = (r_stop >= 0.8).float()   # strictly gated to predominantly stationary windows
        l_stat_pos = torch.mean(
            mostly_still * (
                (pred["delta_forward"] / self.DIST_NORM) ** 2 +
                (pred["delta_lateral"] / self.DIST_NORM) ** 2
            )
        )

        l_stop_bce = self.bce(pred["p_stop"], stop_true)
        l_stop = l_stop_bce + 0.8 * l_stat_v + 0.8 * l_stat_pos

        total = (
            self.w_v * l_v +
            self.w_w * l_w +
            self.w_dist * l_dist +
            self.w_yaw * l_yaw +
            self.w_pos * l_pos +
            self.w_stop * l_stop
        )

        loss_dict = {
            "l_v": float(l_v_mse.item()),
            "l_w": float(l_w_mse.item()),
            "l_dist": float(l_dist.item()),
            "l_yaw": float(l_yaw.item()),
            "l_pos": float(l_pos.item()),
            "l_stop": float(l_stop_bce.item()),
            "l_stat_v": float(l_stat_v.item()),
            "l_stat_pos": float(l_stat_pos.item()),
            "total_loss": float(total.item())
        }
        return total, loss_dict


def compute_physical_metrics(pred: dict, batch: dict) -> dict:
    """Computes true physical units: m/s, rad/s, meters, and classification scores."""
    v_pred = pred["v_seq"].detach().cpu().numpy()
    v_true = batch["v_seq"].numpy()
    w_pred = pred["omega_seq"].detach().cpu().numpy()
    w_true = batch["omega_seq"].numpy()

    fwd_pred = pred["delta_forward"].detach().cpu().numpy()
    fwd_true = batch["delta_forward"].numpy()
    lat_pred = pred["delta_lateral"].detach().cpu().numpy()
    lat_true = batch["delta_lateral"].numpy()

    p_stop_pred = pred["p_stop"].detach().cpu().numpy()
    p_stop_true = batch["p_stop"].numpy()

    # Velocity metrics (m/s)
    v_err = v_pred - v_true
    v_rmse = float(np.sqrt(np.mean(v_err ** 2)))
    v_mae  = float(np.mean(np.abs(v_err)))

    # Yaw-rate metrics (rad/s)
    w_err = w_pred - w_true
    w_rmse = float(np.sqrt(np.mean(w_err ** 2)))
    w_mae  = float(np.mean(np.abs(w_err)))

    # Displacement metrics (meters)
    fwd_err = fwd_pred - fwd_true
    fwd_rmse = float(np.sqrt(np.mean(fwd_err ** 2)))

    lat_err = lat_pred - lat_true
    lat_rmse = float(np.sqrt(np.mean(lat_err ** 2)))

    # 2D Terminal position Euclidean error (meters)
    pos_2d_sq = fwd_err ** 2 + lat_err ** 2
    pos_2d_rmse = float(np.sqrt(np.mean(pos_2d_sq)))
    pos_2d_mae  = float(np.mean(np.sqrt(pos_2d_sq)))

    # Stop classification F1
    bin_pred = (p_stop_pred > 0.5).astype(int)
    bin_true = (p_stop_true > 0.5).astype(int)
    tp = np.sum((bin_pred == 1) & (bin_true == 1))
    fp = np.sum((bin_pred == 1) & (bin_true == 0))
    fn = np.sum((bin_pred == 0) & (bin_true == 1))
    prec = tp / max(tp + fp, 1)
    rec  = tp / max(tp + fn, 1)
    f1   = float(2 * prec * rec / max(prec + rec, 1e-6))

    return {
        "v_rmse_mps": v_rmse,
        "v_mae_mps": v_mae,
        "w_rmse_rads": w_rmse,
        "w_mae_rads": w_mae,
        "fwd_rmse_m": fwd_rmse,
        "lat_rmse_m": lat_rmse,
        "pos_2d_rmse_m": pos_2d_rmse,
        "pos_2d_mae_m": pos_2d_mae,
        "stop_f1": f1
    }


def train_one_epoch(model, loader, optimizer, loss_fn, device):
    model.train()
    running_loss = 0.0
    all_phys = []

    for batch in loader:
        x = batch["imu"].to(device)
        optimizer.zero_grad()

        pred = model(x)
        loss, _ = loss_fn(pred, batch)

        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

        running_loss += loss.item() * len(x)

    n = len(loader.dataset)
    return running_loss / n


@torch.no_grad()
def evaluate(model, loader, loss_fn, device):
    model.eval()
    running_loss = 0.0
    phys_metrics_list = []

    for batch in loader:
        x = batch["imu"].to(device)
        pred = model(x)
        loss, _ = loss_fn(pred, batch)

        running_loss += loss.item() * len(x)
        pm = compute_physical_metrics(pred, batch)
        phys_metrics_list.append((pm, len(x)))

    n = len(loader.dataset)
    avg_loss = running_loss / n

    # Aggregate physical metrics weighted by batch size
    agg_phys = {}
    for pm, bs in phys_metrics_list:
        for k, v in pm.items():
            agg_phys[k] = agg_phys.get(k, 0.0) + v * bs
    for k in agg_phys:
        agg_phys[k] /= n

    return avg_loss, agg_phys


def main():
    print("=" * 80)
    print("  NAVISENSE IDR — UniversalMotionNetV2 Physical Metric Training")
    print(f"  Device: {CFG['device']} | Batch Size: {CFG['batch_size']} | Epochs: {CFG['epochs']}")
    print("=" * 80)

    device = torch.device(CFG["device"])

    # 1. Build Canonical Conditioned Dataset Splits
    train_ds, val_ds, test_ds = build_canonical_splits(
        window=CFG["window"],
        stride=CFG["stride"],
        channels=CFG["channels"]
    )

    train_loader = DataLoader(train_ds, batch_size=CFG["batch_size"], shuffle=True,  num_workers=CFG["num_workers"], pin_memory=True)
    val_loader   = DataLoader(val_ds,   batch_size=CFG["batch_size"], shuffle=False, num_workers=CFG["num_workers"], pin_memory=True)
    test_loader  = DataLoader(test_ds,  batch_size=CFG["batch_size"], shuffle=False, num_workers=CFG["num_workers"], pin_memory=True)

    # 2. Instantiate UniversalMotionNetV2
    model = UniversalMotionNetV2(
        in_channels=CFG["channels"],
        window=CFG["window"]
    ).to(device)

    total_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"[MODEL] UniversalMotionNetV2 initialized on {device}. Trainable params: {total_params:,}")

    loss_fn = MultiTaskMotionLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=CFG["lr"], weight_decay=CFG["weight_decay"])
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=CFG["epochs"], eta_min=1e-5)

    best_val_pos_rmse = float("inf")
    best_epoch = -1

    for epoch in range(1, CFG["epochs"] + 1):
        t0 = time.time()
        train_loss = train_one_epoch(model, train_loader, optimizer, loss_fn, device)
        val_loss, val_phys = evaluate(model, val_loader, loss_fn, device)
        scheduler.step()
        dt = time.time() - t0

        pos_rmse = val_phys["pos_2d_rmse_m"]
        v_rmse   = val_phys["v_rmse_mps"]
        w_rmse   = val_phys["w_rmse_rads"]
        stop_f1  = val_phys["stop_f1"]

        is_best = pos_rmse < best_val_pos_rmse
        star = " *** [BEST VAL POS] ***" if is_best else ""

        print(
            f"Epoch [{epoch:02d}/{CFG['epochs']:02d}] ({dt:.1f}s) | "
            f"TrainLoss: {train_loss:.4f} | ValLoss: {val_loss:.4f} | "
            f"Pos2D RMSE: {pos_rmse:.3f}m | Vel RMSE: {v_rmse:.3f}m/s | "
            f"YawRate RMSE: {w_rmse:.3f}rad/s | Stop F1: {stop_f1:.3f}{star}"
        )

        if is_best:
            best_val_pos_rmse = pos_rmse
            best_epoch = epoch
            save_payload = {
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "val_loss": val_loss,
                "val_phys_metrics": val_phys,
                "channels": CFG["channels"],
                "window": CFG["window"]
            }
            torch.save(save_payload, CFG["model_save_path"])
            torch.save(save_payload, CFG["backup_save_path"])
            print(f"  --> Saved checkpoint to {CFG['model_save_path']} (Best Val Pos RMSE: {pos_rmse:.3f}m)")

    print("\n" + "=" * 80)
    print(f"TRAINING COMPLETE. Best Epoch {best_epoch} with Val Pos 2D RMSE = {best_val_pos_rmse:.3f}m")
    print("=" * 80)

    # 3. Final Rigorous Physical Metric Evaluation on Unseen Test Split (Driver D / Vehicle Y1)
    print("\n[EVALUATION] Loading best model checkpoint and evaluating on Holdout TEST Split (Driver D / Vehicle Y1)...")
    ckpt = torch.load(CFG["model_save_path"], map_location=device, weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])

    test_loss, test_phys = evaluate(model, test_loader, loss_fn, device)

    print("\n" + "=" * 80)
    print("  HOLDOUT TEST SPLIT PHYSICAL NAVIGATION BENCHMARK (UNSEEN VEHICLE & DRIVER)")
    print("=" * 80)
    print(f"  Normalized Multi-Task Loss:    {test_loss:.4f}")
    print(f"  Terminal 2D Position RMSE:     {test_phys['pos_2d_rmse_m']:.4f} meters")
    print(f"  Terminal 2D Position MAE:      {test_phys['pos_2d_mae_m']:.4f} meters")
    print(f"  Forward Velocity RMSE:         {test_phys['v_rmse_mps']:.4f} m/s ({test_phys['v_rmse_mps']*3.6:.2f} km/h)")
    print(f"  Forward Velocity MAE:          {test_phys['v_mae_mps']:.4f} m/s ({test_phys['v_mae_mps']*3.6:.2f} km/h)")
    print(f"  Yaw-Rate RMSE:                 {test_phys['w_rmse_rads']:.4f} rad/s ({math.degrees(test_phys['w_rmse_rads']):.2f} deg/s)")
    print(f"  Yaw-Rate MAE:                  {test_phys['w_mae_rads']:.4f} rad/s ({math.degrees(test_phys['w_mae_rads']):.2f} deg/s)")
    print(f"  Forward Displacement RMSE:     {test_phys['fwd_rmse_m']:.4f} meters")
    print(f"  Lateral Displacement RMSE:     {test_phys['lat_rmse_m']:.4f} meters")
    print(f"  Stationary Classification F1:  {test_phys['stop_f1']:.4f}")
    print("=" * 80)

    # Save metrics to JSON
    with open("models/test_physical_metrics.json", "w") as f:
        json.dump({
            "test_loss": test_loss,
            "physical_metrics": test_phys
        }, f, indent=2)
    print("Saved physical benchmark results to models/test_physical_metrics.json")


if __name__ == "__main__":
    main()
