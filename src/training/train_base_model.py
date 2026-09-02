"""
SIH 26168 — Base Model Training Script
Trains UniversalMotionNet on IO-VNBD smartphone CSV data.

Usage:
    python src/training/train_base_model.py

Output:
    models/universal_motion_net.pt      — PyTorch checkpoint
    models/universal_motion_net.onnx    — ONNX for browser inference
    models/training_log.json            — epoch loss history
    results/position_plots/             — position plots per val sequence
"""

import os, sys, json, time
sys.stdout.reconfigure(line_buffering=True)   # flush after every print line
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

# Make src importable from repo root
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.data.iovnbd_loader import build_datasets, load_sequence, find_all_s_csvs
from src.models.nn_models import UniversalMotionNet

# ── Config ──────────────────────────────────────────────────────────────────────

CFG = {
    "window":        100,     # samples per window (10 s at 10 Hz)
    "stride":        10,      # stride between windows during dataset build
    "batch_size":    64,
    "lr":            1e-3,
    "weight_decay":  1e-5,
    "epochs":        40,
    "warmup_epochs": 3,
    "speed_weight":  1.0,     # loss weight for speed prediction
    "pos_weight":    0.5,     # loss weight for Δposition prediction
    "yaw_weight":    0.2,     # loss weight for yaw_rate prediction
    "val_drivers":   ("S",),  # Driver A held out for validation
    "val_seqs":      ("S2",), # S2 is the unseen test route
    "save_dir":      Path("models"),
    "results_dir":   Path("results/position_plots"),
    "device":        "cuda" if torch.cuda.is_available() else "cpu",
}


# ── Loss ────────────────────────────────────────────────────────────────────────

class IDRLoss(nn.Module):
    """
    Normalised combined loss — all terms are O(1):
      L = MSE(speed/SPD_NORM) + 0.3 * MSE(yaw_rate/YAW_NORM)
    Position term removed — it's redundant given speed supervision.
    """
    SPEED_NORM = 10.0   # normalise speeds to ~[-1, 1] range (max ~30 m/s / 10)
    YAW_NORM   = 0.5    # normalise yaw rates (typical range ±0.5 rad/s)

    def __init__(self, w_spd=1.0, w_pos=0.3, w_yaw=0.3):
        super().__init__()
        self.w_spd = w_spd
        self.w_yaw = w_yaw

    def forward(self, pred, batch):
        speed_true = batch["speed"].to(pred["speed"].device)
        yaw_true   = batch["yaw_rate"].to(pred["yaw_rate"].device)

        # Normalise both pred and target to O(1) scale
        l_spd = nn.functional.mse_loss(
            pred["speed"]    / self.SPEED_NORM,
            speed_true       / self.SPEED_NORM
        )
        l_yaw = nn.functional.mse_loss(
            pred["yaw_rate"] / self.YAW_NORM,
            yaw_true         / self.YAW_NORM
        )

        total = self.w_spd * l_spd + self.w_yaw * l_yaw
        return total, {"spd": l_spd.item(), "yaw": l_yaw.item()}


# ── LR scheduler: cosine with warmup ───────────────────────────────────────────

def get_lr(epoch, cfg):
    if epoch < cfg["warmup_epochs"]:
        return cfg["lr"] * (epoch + 1) / cfg["warmup_epochs"]
    progress = (epoch - cfg["warmup_epochs"]) / max(1, cfg["epochs"] - cfg["warmup_epochs"])
    return cfg["lr"] * 0.5 * (1 + np.cos(np.pi * progress))


# ── Position evaluation ─────────────────────────────────────────────────────────

def evaluate_position_drift(model, val_csv_path, device, window=100, blackout_start_pct=0.4):
    """
    Run full-sequence dead reckoning on one validation CSV.
    Computes drift at 30s, 60s, and 1 km outage.

    Returns:
        dict with drift metrics and arrays for plotting.
    """
    from src.data.iovnbd_loader import load_sequence

    model.eval()
    seq = load_sequence(val_csv_path)
    N = len(seq["time_ms"])
    accel = seq["accel"]    # (N, 3)
    gyro  = seq["gyro"]     # (N, 3)
    pos_true = seq["pos_enu"]  # (N, 2) — GPS ground truth

    blackout_start = int(N * blackout_start_pct)

    # Accumulate dead-reckoning position
    pred_pos  = np.zeros((N, 2))
    pred_pos[0] = pos_true[0]   # start at true position

    heading_rad = 0.0  # we integrate heading from gyro

    # Build ALL sliding windows at once with unfold — single batched inference
    imu_np = np.concatenate([accel, gyro], axis=1).astype(np.float32)  # (N, 6)
    # Pad the start so every sample has a full window
    pad    = np.zeros((window, 6), dtype=np.float32)
    imu_padded = np.vstack([pad, imu_np])                               # (N+W, 6)

    imu_t   = torch.from_numpy(imu_padded).to(device)                  # (N+W, 6)
    windows = imu_t.unfold(0, window, 1)                                # (N+1, 6, W)
    windows = windows[:-1]                                              # (N, 6, W) align with N samples
    windows = windows.permute(0, 1, 2)                                  # already (N, 6, W) ✓

    # Run in mini-batches of 512 to avoid OOM
    EVAL_BATCH = 512
    speed_all    = np.zeros(N, dtype=np.float32)
    yaw_rate_all = np.zeros(N, dtype=np.float32)

    with torch.no_grad():
        for b_start in range(0, N, EVAL_BATCH):
            b_end   = min(b_start + EVAL_BATCH, N)
            batch   = windows[b_start:b_end]
            out     = model(batch)
            speed_all[b_start:b_end]    = out["speed"].cpu().numpy()
            yaw_rate_all[b_start:b_end] = out["yaw_rate"].cpu().numpy()

    dt_arr = seq["dt"]

    for i in range(1, N):
        speed_ms = float(speed_all[i])
        yaw_rate = float(yaw_rate_all[i])
        dt       = float(dt_arr[i])

        if i >= blackout_start:
            heading_rad += yaw_rate * dt
            dx = speed_ms * np.cos(heading_rad) * dt
            dy = speed_ms * np.sin(heading_rad) * dt
            pred_pos[i] = pred_pos[i - 1] + np.array([dx, dy])
        else:
            pred_pos[i] = pos_true[i]
            d = pos_true[i] - pos_true[i - 1]
            if np.linalg.norm(d) > 0.1:
                heading_rad = np.arctan2(d[1], d[0])

    # Compute errors
    errors = np.linalg.norm(pred_pos[blackout_start:] - pos_true[blackout_start:], axis=1)
    dist_travelled = np.cumsum(np.linalg.norm(np.diff(pos_true[blackout_start:], axis=0), axis=1))

    # Drift at specific outage durations
    dt_mean = float(np.mean(seq["dt"][blackout_start:]))
    idx_30s  = min(int(30  / dt_mean), len(errors) - 1)
    idx_60s  = min(int(60  / dt_mean), len(errors) - 1)
    idx_1km  = np.searchsorted(dist_travelled, 1000) if len(dist_travelled) > 0 else -1

    def pct(err_m, dist_m):
        return (err_m / max(dist_m, 1.0)) * 100.0

    metrics = {
        "drift_30s_m":   float(errors[idx_30s])  if idx_30s  < len(errors) else None,
        "drift_60s_m":   float(errors[idx_60s])  if idx_60s  < len(errors) else None,
        "drift_1km_m":   float(errors[idx_1km])  if 0 < idx_1km < len(errors) else None,
    }

    # Add % of distance
    if metrics["drift_30s_m"] and idx_30s < len(dist_travelled):
        metrics["drift_30s_pct"] = pct(metrics["drift_30s_m"], dist_travelled[min(idx_30s, len(dist_travelled)-1)])
    if metrics["drift_60s_m"] and idx_60s < len(dist_travelled):
        metrics["drift_60s_pct"] = pct(metrics["drift_60s_m"], dist_travelled[min(idx_60s, len(dist_travelled)-1)])
    if metrics["drift_1km_m"]:
        metrics["drift_1km_pct"] = pct(metrics["drift_1km_m"], 1000.0)

    return {
        "metrics":    metrics,
        "pos_true":   pos_true,
        "pos_pred":   pred_pos,
        "blackout_start": blackout_start,
        "errors":     errors,
    }


# ── Save position plot as JSON (for frontend) ───────────────────────────────────

def save_position_plot(eval_result, out_path):
    r = eval_result
    bs = r["blackout_start"]
    data = {
        "gps_path":    r["pos_true"].tolist(),
        "model_path":  r["pos_pred"].tolist(),
        "blackout_start_idx": bs,
        "metrics":     r["metrics"],
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(data, f)
    print(f"  Position plot → {out_path}")


# ── Main training loop ──────────────────────────────────────────────────────────

def train():
    device = CFG["device"]
    print(f"\n{'='*60}")
    print(f"  SIH 26168 — Base Model Training")
    print(f"  Device: {device}")
    print(f"  Epochs: {CFG['epochs']}  |  Batch: {CFG['batch_size']}")
    print(f"{'='*60}\n")

    # 1. Build datasets
    print("Loading IO-VNBD sequences...")
    train_ds, val_ds = build_datasets(
        window=CFG["window"],
        stride=CFG["stride"],
        val_drivers=CFG["val_drivers"],
        val_seqs=CFG["val_seqs"],
    )

    train_loader = DataLoader(train_ds, batch_size=CFG["batch_size"], shuffle=True,
                              num_workers=0, pin_memory=(device == "cuda"))
    val_loader   = DataLoader(val_ds,   batch_size=CFG["batch_size"], shuffle=False,
                              num_workers=0)

    # 2. Model + optimiser
    model = UniversalMotionNet(in_channels=6, hidden_dim=64, rnn_dim=64).to(device)
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"\nModel parameters: {n_params:,}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=CFG["lr"],
                                  weight_decay=CFG["weight_decay"])
    loss_fn = IDRLoss(CFG["speed_weight"], CFG["pos_weight"], CFG["yaw_weight"])

    CFG["save_dir"].mkdir(exist_ok=True)
    log = {"train_loss": [], "val_loss": [], "best_val": float("inf"), "best_epoch": 0}

    # 3. Training loop
    for epoch in range(CFG["epochs"]):
        # Update LR
        lr = get_lr(epoch, CFG)
        for pg in optimizer.param_groups:
            pg["lr"] = lr

        # ── Train
        model.train()
        train_losses = []
        for batch in train_loader:
            imu = batch["imu"].to(device)   # (B, 6, W)
            optimizer.zero_grad()
            pred = model(imu)
            loss, _ = loss_fn(pred, batch)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            train_losses.append(loss.item())

        # ── Validate
        model.eval()
        val_losses = []
        with torch.no_grad():
            for batch in val_loader:
                imu = batch["imu"].to(device)
                pred = model(imu)
                loss, _ = loss_fn(pred, batch)
                val_losses.append(loss.item())

        t_loss = np.mean(train_losses)
        v_loss = np.mean(val_losses)
        log["train_loss"].append(t_loss)
        log["val_loss"].append(v_loss)

        print(f"  Epoch {epoch+1:02d}/{CFG['epochs']}  "
              f"lr={lr:.2e}  train={t_loss:.4f}  val={v_loss:.4f}")

        # Save best
        if v_loss < log["best_val"]:
            log["best_val"]   = v_loss
            log["best_epoch"] = epoch + 1
            torch.save(model.state_dict(), CFG["save_dir"] / "universal_motion_net.pt")
            print(f"    [BEST] model saved (val={v_loss:.4f})")

    print(f"\nBest val loss: {log['best_val']:.4f} at epoch {log['best_epoch']}")

    # 4. Save training log
    with open(CFG["save_dir"] / "training_log.json", "w") as f:
        json.dump(log, f, indent=2)

    # 5. Run position evaluation on val sequences
    print("\nRunning position evaluation on val sequences...")
    model.load_state_dict(torch.load(CFG["save_dir"] / "universal_motion_net.pt",
                                     map_location=device))

    all_csvs = find_all_s_csvs()
    val_csvs = [
        p for p in all_csvs
        if p.parent.parent.name.split()[0] in CFG["val_drivers"]
        and p.parent.name in CFG["val_seqs"]
    ]

    all_metrics = {}
    for csv_path in val_csvs:
        name = f"{csv_path.parent.parent.name.split()[0]}_{csv_path.parent.name}"
        print(f"\n  Evaluating {name}...")
        result = evaluate_position_drift(model, csv_path, device)
        m = result["metrics"]
        print(f"    Drift 30s:  {m.get('drift_30s_m', '?'):.1f} m  ({m.get('drift_30s_pct', '?'):.1f}%)")
        print(f"    Drift 60s:  {m.get('drift_60s_m', '?'):.1f} m  ({m.get('drift_60s_pct', '?'):.1f}%)")
        print(f"    Drift 1km:  {m.get('drift_1km_m', '?'):.1f} m  ({m.get('drift_1km_pct', '?'):.1f}%)")
        all_metrics[name] = m
        save_position_plot(result, CFG["results_dir"] / f"{name}_position.json")

    # 6. Export to ONNX
    print("\nExporting to ONNX...")
    model.eval().cpu()
    dummy_input = torch.randn(1, 6, CFG["window"])
    onnx_path = CFG["save_dir"] / "universal_motion_net.onnx"
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        input_names=["imu_window"],
        output_names=["speed", "yaw_rate", "long_accel", "log_var"],
        dynamic_axes={"imu_window": {0: "batch"}},
        opset_version=17,
    )
    print(f"  ONNX model → {onnx_path}")
    print(f"  ONNX size:  {onnx_path.stat().st_size / 1024:.1f} KB")

    # 7. Save final benchmark summary
    summary = {
        "model": "UniversalMotionNet",
        "dataset": "IO-VNBD",
        "train_sequences": "All except Driver A S2",
        "val_sequences": "Driver A S2 (held-out)",
        "epochs": CFG["epochs"],
        "best_val_loss": log["best_val"],
        "metrics": all_metrics,
    }
    with open(CFG["save_dir"] / "benchmark_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print("  Training complete.")
    print(f"  Checkpoint: {CFG['save_dir']}/universal_motion_net.pt")
    print(f"  ONNX:       {CFG['save_dir']}/universal_motion_net.onnx")
    print(f"  Results:    {CFG['results_dir']}/")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    train()
