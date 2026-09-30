"""
SIH 26168 - Session-Level Turn & Stoppage Specialized Sub-Dataset Builder
Extracts non-mutually exclusive multi-label windows partitioned strictly by whole recording session:
  - Labels: [p_stop, p_turn, p_cruise]
  - Continuous Kinematics: [v_t, delta_psi, delta_s]
  - Session-level leak-free split (Train Sessions vs Held-Out Val Sessions vs Held-Out Test Sessions)
"""

import os, sys, time, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
from torch.utils.data import Dataset

from src.data.iovnbd_loader import find_all_s_csvs
from src.data.preprocessor import repair_and_resample_sequence

class ManeuverStoppageDataset(Dataset):
    """
    Session-level partitioned dataset for ManeuverSpecialistNet.
    """
    def __init__(self, samples, norm_mean=None, norm_std=None):
        self.samples = samples
        self.norm_mean = norm_mean.reshape(9, 1) if norm_mean is not None else None
        self.norm_std  = norm_std.reshape(9, 1) if norm_std is not None else None

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        imu = s["imu"].copy() # (9, 20)

        if self.norm_mean is not None and self.norm_std is not None:
            imu = (imu - self.norm_mean) / (self.norm_std + 1e-6)

        imu = np.squeeze(imu)
        return {
            "imu": torch.tensor(imu, dtype=torch.float32),
            "p_stop": torch.tensor(s["p_stop"], dtype=torch.float32),
            "p_turn": torch.tensor(s["p_turn"], dtype=torch.float32),
            "p_cruise": torch.tensor(s["p_cruise"], dtype=torch.float32),
            "v_t": torch.tensor(s["v_t"], dtype=torch.float32),
            "delta_psi": torch.tensor(s["delta_psi"], dtype=torch.float32),
            "delta_s": torch.tensor(s["delta_s"], dtype=torch.float32),
        }

def build_maneuver_sub_dataset(
    cache_path="data/cache/maneuver_sub_dataset_session.pt",
    force_rebuild=False
):
    cache_file = Path(cache_path)
    if cache_file.exists() and not force_rebuild:
        print(f"[SUB-DATASET] Loading cached session-split dataset from {cache_file}...")
        data = torch.load(cache_file, weights_only=False)
        norm_mean, norm_std = data["norm_stats"]
        train_ds = ManeuverStoppageDataset(data["train_samples"], norm_mean=norm_mean, norm_std=norm_std)
        val_ds   = ManeuverStoppageDataset(data["val_samples"], norm_mean=norm_mean, norm_std=norm_std)
        test_ds  = ManeuverStoppageDataset(data["test_samples"], norm_mean=norm_mean, norm_std=norm_std)
        return train_ds, val_ds, test_ds, (norm_mean, norm_std)


    print("[SUB-DATASET] Building fresh Session-Partitioned Turn & Stoppage Dataset...")
    csv_paths = sorted(list(set(find_all_s_csvs())))
    print(f"  Found {len(csv_paths)} unique recording paths.")

    # ── Strict Session-Level Partitioning ────────────────────────────────────
    # Train: Driver A (S1, S2, S4, S5), Driver B (M)
    # Val:   Driver A (S3a, S6), Driver C
    # Test:  Driver A (S3b), Driver E (Vta)
    train_paths = []
    val_paths   = []
    test_paths  = []

    for p in csv_paths:
        p_str = str(p)
        if "S3b" in p_str or "Vta" in p_str:
            test_paths.append(p)
        elif "S3a" in p_str or "S6" in p_str or "Driver C" in p_str:
            val_paths.append(p)
        else:
            train_paths.append(p)

    print(f"  Session Split: Train={len(train_paths)} sessions, Val={len(val_paths)} sessions, Test={len(test_paths)} sessions")

    def extract_samples_from_sessions(paths, name="split"):
        samples = []
        W = 20
        stride = 3 # 0.3s step for dense sampling
        dt = 0.1

        stats_turn = 0
        stats_stop = 0
        stats_cruise = 0
        all_yaw_rates = []
        all_speeds = []

        for p in paths:
            try:
                segs = repair_and_resample_sequence(p)
                if not segs:
                    continue
                for seg in segs:
                    spds = seg["spd_ms"]
                    heads = seg["head_unwrapped_rad"]
                    n_pts = len(spds)
                    if n_pts <= W:
                        continue

                    ax = seg["ax"]
                    ay = seg["ay"]
                    az = seg["az"]
                    gyaw = seg["gyaw"]
                    gpit = seg["gpit"]
                    grol = seg["grol"]
                    gx = seg["gx"]
                    gy = seg["gy"]
                    gz = seg["gz"]

                    for end in range(W, n_pts, stride):
                        start = end - W
                        v_end = float(spds[end - 1])
                        spd_win = spds[start:end]
                        d_s = float(np.sum((spd_win[:-1] + spd_win[1:]) * 0.5) * dt)
                        d_psi = float(heads[end - 1] - heads[start])
                        abs_d_psi_deg = float(np.degrees(abs(d_psi)))

                        # Sustained mean yaw rate over the 2.0s window (rad/s)
                        mean_wz = abs(d_psi) / (W * dt)

                        # Non-mutually exclusive continuous multi-labels:
                        # 1. Stop probability: 1.0 below 0.3 m/s, smooth ramp up to 1.2 m/s
                        if v_end < 0.3:
                            p_stop = 1.0
                        elif v_end < 1.2:
                            p_stop = float(np.clip((1.2 - v_end) / 0.9, 0.0, 1.0))
                        else:
                            p_stop = 0.0

                        # 2. Turn probability: based on sustained physical heading change and mean angular rate
                        # (eliminates false triggers from high-frequency road bump vibrations)
                        if abs_d_psi_deg >= 7.0 and mean_wz >= 0.05:
                            p_turn = 1.0
                        elif abs_d_psi_deg >= 3.0 and mean_wz >= 0.025:
                            p_turn = float(np.clip((abs_d_psi_deg - 3.0) / 4.0, 0.0, 1.0))
                        else:
                            p_turn = 0.0

                        # 3. Cruise probability: forward rolling speed with near-zero angular turning
                        if v_end > 4.0 and abs_d_psi_deg < 2.5:
                            p_cruise = 1.0
                        elif v_end > 1.5 and abs_d_psi_deg < 4.5:
                            spd_fac = float(np.clip((v_end - 1.5) / 2.5, 0.0, 1.0))
                            turn_fac = float(np.clip(1.0 - (abs_d_psi_deg / 4.5), 0.0, 1.0))
                            p_cruise = spd_fac * turn_fac
                        else:
                            p_cruise = 0.0


                        if p_turn > 0.5: stats_turn += 1
                        if p_stop > 0.5: stats_stop += 1
                        if p_cruise > 0.5: stats_cruise += 1

                        all_yaw_rates.append(mean_wz)
                        all_speeds.append(v_end * 3.6)

                        # 9-channel tensor: [ax, ay, az, gyaw, gpit, grol, gx, gy, gz]
                        imu_win = np.stack([
                            ax[start:end], ay[start:end], az[start:end],
                            gyaw[start:end], gpit[start:end], grol[start:end],
                            gx[start:end], gy[start:end], gz[start:end]
                        ], axis=0).astype(np.float32)

                        samples.append({
                            "imu": imu_win,
                            "v_t": v_end,
                            "delta_s": d_s,
                            "delta_psi": d_psi,
                            "p_stop": p_stop,
                            "p_turn": p_turn,
                            "p_cruise": p_cruise,
                        })
            except Exception as e:
                print(f"  [WARN] Failed to process {p}: {e}")
                continue


        print(f"  [{name.upper()}] Extracted {len(samples):,} windows:")
        print(f"    - Turn active (p_turn > 0.5):   {stats_turn:,} ({stats_turn/max(1, len(samples))*100:.1f}%)")
        print(f"    - Stop active (p_stop > 0.5):   {stats_stop:,} ({stats_stop/max(1, len(samples))*100:.1f}%)")
        print(f"    - Cruise active (p_cr > 0.5):   {stats_cruise:,} ({stats_cruise/max(1, len(samples))*100:.1f}%)")
        if all_speeds:
            print(f"    - Speed range:  mean={np.mean(all_speeds):.1f} km/h, max={np.max(all_speeds):.1f} km/h")
            print(f"    - Yaw rate p95: {np.degrees(np.percentile(all_yaw_rates, 95)):.1f} deg/s")
        return samples

    train_samples = extract_samples_from_sessions(train_paths, name="train")
    val_samples   = extract_samples_from_sessions(val_paths, name="val")
    test_samples  = extract_samples_from_sessions(test_paths, name="test")

    # Compute training normalization stats strictly from train split
    all_imus = np.stack([s["imu"] for s in train_samples], axis=0) # (N, 9, 20)
    norm_mean = np.mean(all_imus, axis=(0, 2), keepdims=True).astype(np.float32) # (1, 9, 1)
    norm_std  = np.std(all_imus, axis=(0, 2), keepdims=True).astype(np.float32)  # (1, 9, 1)
    norm_std[norm_std < 1e-4] = 1.0

    train_ds = ManeuverStoppageDataset(train_samples, norm_mean=norm_mean, norm_std=norm_std)
    val_ds   = ManeuverStoppageDataset(val_samples, norm_mean=norm_mean, norm_std=norm_std)
    test_ds  = ManeuverStoppageDataset(test_samples, norm_mean=norm_mean, norm_std=norm_std)

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "train_samples": train_samples,
        "val_samples": val_samples,
        "test_samples": test_samples,
        "norm_stats": (norm_mean, norm_std),
    }, cache_file)
    print(f"  [SUB-DATASET] Successfully saved session-partitioned dataset to {cache_file}\n")

    return train_ds, val_ds, test_ds, (norm_mean, norm_std)


if __name__ == "__main__":
    train_ds, val_ds, test_ds, norm_stats = build_maneuver_sub_dataset(force_rebuild=True)
    print(f"Verification: Train = {len(train_ds)}, Val = {len(val_ds)}, Test = {len(test_ds)}")
