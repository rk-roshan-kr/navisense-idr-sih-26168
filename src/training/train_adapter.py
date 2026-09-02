"""
SIH 26168 — Online Adapter Training (Per-Vehicle Calibration)
Simulates what happens on the phone while GNSS is active:
  - Frozen base model (UniversalMotionNet)
  - Only PersonalizationAdapter weights are updated
  - Teacher signal = GPS speed + position
  - 1 SGD step per second (every 10 IMU samples at 10 Hz)

This is the "RL-inspired online learning" phase described in the design.
GNSS is used ONLY as a supervision signal — never injected into the
dead-reckoning inference path.

Usage:
    python src/training/train_adapter.py --seq S2 --driver S

Output:
    models/adapter_<driver>_<seq>.pt   — adapter checkpoint
    results/adapter_calibration.json   — convergence log
"""

import sys, argparse, json
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.data.iovnbd_loader import load_sequence, find_all_s_csvs, BASE
from src.models.nn_models import UniversalMotionNet, PersonalizationAdapter


# ── Config ─────────────────────────────────────────────────────────────────────

WINDOW      = 100          # IMU samples per inference window
UPDATE_EVERY = 10          # update adapter every N samples (1 s at 10 Hz)
LR_ADAPTER  = 5e-4        # fast adaptation learning rate
DEVICE      = "cuda" if torch.cuda.is_available() else "cpu"


# ── Online training loop ────────────────────────────────────────────────────────

def run_online_adapter(base_model, seq, device, window=WINDOW,
                       update_every=UPDATE_EVERY, lr=LR_ADAPTER,
                       blackout_fraction=0.5):
    """
    Simulate one full drive with GNSS active for the first half.
    The adapter fine-tunes during the GNSS-active phase.
    After blackout, we run pure inference on the adapter.

    Args:
        base_model:          pre-trained UniversalMotionNet (frozen)
        seq:                 dict from load_sequence()
        blackout_fraction:   fraction of sequence where GPS is cut

    Returns:
        log:      dict with convergence history and drift metrics
        pred_pos: (N, 2) predicted positions
    """
    adapter = PersonalizationAdapter(base_model).to(device)
    optimizer = torch.optim.Adam(
        [p for p in adapter.parameters() if p.requires_grad],
        lr=lr
    )

    N = len(seq["time_ms"])
    blackout_start = int(N * blackout_fraction)
    accel    = seq["accel"]
    gyro     = seq["gyro"]
    pos_true = seq["pos_enu"]
    gps_spd  = seq["gps_speed_ms"]

    pred_pos   = np.zeros((N, 2))
    pred_pos[0]= pos_true[0]
    heading    = 0.0

    calibration_log = []   # (sample_idx, speed_error_ms, convergence_score)
    speed_errors    = []

    print(f"  Sequence: {N} samples  |  blackout @ sample {blackout_start}")
    print(f"  Adapter params: "
          f"{sum(p.numel() for p in adapter.parameters() if p.requires_grad):,}")

    for i in range(1, N):
        start = max(0, i - window)
        end   = i

        # Build IMU window (pad if needed)
        imu_win = np.concatenate([accel[start:end], gyro[start:end]], axis=1)
        if len(imu_win) < window:
            pad = np.zeros((window - len(imu_win), 6), dtype=np.float32)
            imu_win = np.vstack([pad, imu_win])

        imu_t = torch.from_numpy(imu_win.T.astype(np.float32)).unsqueeze(0).to(device)
        dt    = float(seq["dt"][i])

        # ── GNSS-active phase: train adapter ─────────────────────────────
        if i < blackout_start:
            adapter.train()
            out = adapter(imu_t)
            pred_speed = out["speed"][0]

            # Supervision: GPS speed + indirect position constraint
            true_speed = torch.tensor(gps_spd[i], dtype=torch.float32, device=device)
            loss = nn.functional.mse_loss(pred_speed, true_speed)

            if i % update_every == 0:
                optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(adapter.parameters(), 0.5)
                optimizer.step()

            spd_err = abs(float(pred_speed.detach().cpu()) - float(gps_spd[i]))
            speed_errors.append(spd_err)

            # Convergence score: rolling mean of recent speed errors
            recent_err = np.mean(speed_errors[-100:]) if speed_errors else 99.0
            conv_score = max(0.0, min(1.0, 1.0 - recent_err / 5.0))  # 5 m/s → 0%, 0 m/s → 100%

            if i % 500 == 0:
                print(f"    Step {i:5d} | speed_err={recent_err:.3f} m/s | "
                      f"calibration={conv_score*100:.1f}%")

            calibration_log.append({
                "sample": i,
                "speed_err_ms": float(spd_err),
                "conv_score":   float(conv_score),
            })

            # During calibration, still track true position (GNSS fusion mode)
            pred_pos[i] = pos_true[i]
            d = pos_true[i] - pos_true[i - 1]
            if np.linalg.norm(d) > 0.1:
                heading = np.arctan2(d[1], d[0])

        # ── GNSS-dead phase: pure sensor inference ────────────────────────
        else:
            adapter.eval()
            with torch.no_grad():
                out = adapter(imu_t)
                speed_ms = float(out["speed"][0].cpu())
                yaw_rate = float(out["yaw_rate"][0].cpu())

            heading   += yaw_rate * dt
            dx         = speed_ms * np.cos(heading) * dt
            dy         = speed_ms * np.sin(heading) * dt
            pred_pos[i]= pred_pos[i - 1] + np.array([dx, dy])

    # ── Compute drift metrics ─────────────────────────────────────────────
    errors   = np.linalg.norm(pred_pos[blackout_start:] - pos_true[blackout_start:], axis=1)
    diffs    = np.linalg.norm(np.diff(pos_true[blackout_start:], axis=0), axis=1)
    dist_cum = np.concatenate([[0], np.cumsum(diffs)])

    dt_arr   = seq["dt"][blackout_start:]
    dt_mean  = float(np.mean(dt_arr)) if len(dt_arr) else 0.1

    def drift_at(seconds=None, metres=None):
        if seconds:
            idx = min(int(seconds / dt_mean), len(errors) - 1)
        else:
            idx = int(np.searchsorted(dist_cum, metres))
            idx = min(idx, len(errors) - 1)
        err_m   = float(errors[idx])
        dist_m  = float(dist_cum[min(idx, len(dist_cum) - 1)])
        pct     = err_m / max(dist_m, 1.0) * 100.0
        return err_m, pct

    e30,  p30  = drift_at(seconds=30)
    e60,  p60  = drift_at(seconds=60)
    e1km, p1km = drift_at(metres=1000)

    print(f"\n  === Drift Results ===")
    print(f"  30s  outage: {e30:.1f} m  ({p30:.1f}% of dist)")
    print(f"  60s  outage: {e60:.1f} m  ({p60:.1f}% of dist)")
    print(f"  1km  outage: {e1km:.1f} m ({p1km:.1f}% of dist)")

    final_conv = calibration_log[-1]["conv_score"] if calibration_log else 0.0
    print(f"  Adapter calibration at blackout: {final_conv*100:.1f}%")

    log = {
        "calibration_history": calibration_log[::50],  # thin out for file size
        "final_convergence":   float(final_conv),
        "drift_30s_m":         e30,  "drift_30s_pct":  p30,
        "drift_60s_m":         e60,  "drift_60s_pct":  p60,
        "drift_1km_m":         e1km, "drift_1km_pct":  p1km,
        "blackout_start_idx":  blackout_start,
    }

    return adapter, log, pred_pos, pos_true


# ── Main ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seq",    default="S2",  help="Sequence ID, e.g. S2")
    parser.add_argument("--driver", default="S",   help="Driver key, e.g. S for Driver A")
    parser.add_argument("--base",   default="models/universal_motion_net.pt",
                        help="Path to base model checkpoint")
    args = parser.parse_args()

    base_path = Path(args.base)
    if not base_path.exists():
        print(f"ERROR: Base model not found at {base_path}")
        print("       Run train_base_model.py first.")
        sys.exit(1)

    # Load base model (frozen)
    base_model = UniversalMotionNet(in_channels=6, hidden_dim=64, rnn_dim=64)
    base_model.load_state_dict(torch.load(base_path, map_location="cpu"))
    base_model.eval()
    print(f"Loaded base model from {base_path}")

    # Find the target sequence CSV
    all_csvs = find_all_s_csvs()
    target_csv = None
    for p in all_csvs:
        driver_key = p.parent.parent.name.split()[0]
        seq_name   = p.parent.name
        if driver_key == args.driver and seq_name == args.seq:
            target_csv = p
            break

    if target_csv is None:
        print(f"ERROR: Sequence {args.driver}/{args.seq} not found in dataset.")
        sys.exit(1)

    print(f"Sequence: {target_csv}")
    seq = load_sequence(target_csv)
    print(f"Loaded: {len(seq['time_ms'])} samples  "
          f"({len(seq['time_ms'])/10/60:.1f} min at 10 Hz)")

    # Run online adapter training
    adapter, log, pred_pos, pos_true = run_online_adapter(
        base_model, seq, device=DEVICE
    )

    # Save adapter checkpoint
    out_dir = Path("models")
    out_dir.mkdir(exist_ok=True)
    adapter_path = out_dir / f"adapter_{args.driver}_{args.seq}.pt"
    torch.save(adapter.state_dict(), adapter_path)
    print(f"\nAdapter saved → {adapter_path}")

    # Save results
    results_dir = Path("results")
    results_dir.mkdir(exist_ok=True)
    log_path = results_dir / f"adapter_{args.driver}_{args.seq}_log.json"

    # Add position arrays (thinned)
    log["pos_true_thinned"]  = pos_true[::10].tolist()
    log["pos_pred_thinned"]  = pred_pos[::10].tolist()

    with open(log_path, "w") as f:
        json.dump(log, f, indent=2)
    print(f"Results log → {log_path}")


if __name__ == "__main__":
    main()
