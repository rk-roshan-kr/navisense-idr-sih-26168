"""
SIH 26168 - IO-VNBD Canonical Sequence Window Dataset Loader V2.2
Produces leak-free, clean 10.0 Hz sliding windows with full trajectory supervision:
  Targets (100% derived from Synchronized Vehicle CAN Reference):
    - v_seq:       (W,) forward speed sequence from Vehicle CAN (m/s)
    - omega_seq:   (W,) yaw rate sequence from Vehicle CAN (rad/s)
    - v_t:         endpoint speed (m/s) = v_seq[-1]
    - omega_t:     endpoint yaw rate (rad/s) = omega_seq[-1]
    - delta_s:     trapezoidal scalar distance (m) over 19 intervals
    - delta_psi:   trapezoidal heading change (rad) over 19 intervals
    - delta_forward, delta_lateral: Vehicle CAN reference displacement rotated into vehicle's initial heading frame
    - p_stop:      binary stop indicator (1.0 if v_t < 0.2 m/s, else 0.0)

IMU Pipeline:
  Raw IMU -> Augmentation (if train) -> Stateful SensorConditioner -> Train Normalization -> Model
"""

import os, sys, json, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader

from src.data.preprocessor import repair_and_resample_sequence
from src.models.sensor_conditioner import SensorConditioner

class CanonicalIOVNBDDataset(Dataset):
    """
    Sliding window dataset built on preprocessed and causally conditioned 10.0 Hz streams.
    Timing contract: W=20 samples @ 10 Hz = 19 intervals = 1.9s duration.
    """
    def __init__(self, segments, window=20, stride=5, channels=9, augment=False, norm_stats=None):
        self.W = window
        self.dt = 0.1
        self.channels = channels
        self.augment = augment
        self.norm_stats = norm_stats  # tuple of (mean, std) each shaped (C, 1)

        # Pre-condition all segments statefully from t=0 using fresh SensorConditioners
        self.conditioned_segments = []
        for seg in segments:
            # Extract raw 9-channel array: [ax, ay, az, gyaw, gpit, grol, gx, gy, gz]
            ax, ay, az = seg["ax"], seg["ay"], seg["az"]
            gyaw, gpit, grol = seg["gyaw"], seg["gpit"], seg["grol"]
            gx, gy, gz = seg["gx"], seg["gy"], seg["gz"]

            raw_9ch = np.vstack([ax, ay, az, gyaw, gpit, grol, gx, gy, gz]).astype(np.float64)

            # Online sensor augmentation applied before conditioning during training
            if self.augment:
                N = raw_9ch.shape[1]
                # Sensor bias drift
                bias_a = np.random.uniform(-0.15, 0.15, (3, 1))
                bias_g = np.random.uniform(-0.008, 0.008, (3, 1))
                raw_9ch[:3, :] += bias_a
                raw_9ch[3:6, :] += bias_g
                # Small Gaussian sensor noise
                raw_9ch[:3, :] += np.random.randn(3, N) * 0.03
                raw_9ch[3:6, :] += np.random.randn(3, N) * 0.002

            conditioner = SensorConditioner(dt=self.dt)
            cond_imu = conditioner.condition_sequence(raw_9ch)

            seg_copy = dict(seg)
            seg_copy["cond_imu"] = cond_imu
            self.conditioned_segments.append(seg_copy)

        # Build window index: (seg_idx, end_idx)
        self.index = []
        for si, seg in enumerate(self.conditioned_segments):
            n_pts = len(seg["time_s"])
            for end in range(window, n_pts, stride):
                self.index.append((si, end))

        print(f"  [DATASET] Built {len(self.index)} windows (W={window}, stride={stride}, C={channels}) from {len(segments)} segments.")

    def __len__(self):
        return len(self.index)

    def __getitem__(self, idx):
        si, end = self.index[idx]
        seg = self.conditioned_segments[si]
        start = end - self.W

        imu_tensor = seg["cond_imu"][:self.channels, start:end].copy()  # (C, W)

        # Feature normalization using training-set statistics
        if self.norm_stats is not None:
            mean, std = self.norm_stats
            imu_tensor = (imu_tensor - mean) / (std + 1e-6)

        # ── Primary Trajectory Targets strictly from Vehicle CAN Reference ────
        # 1. Forward Speed Sequence v(t) in m/s
        v_seq = seg["spd_ms"][start:end].astype(np.float32)
        v_t = np.float32(v_seq[-1])

        # 2. Yaw Rate Sequence omega_z(t) in rad/s from CAN reference (fallback to heading grad if unpopulated)
        u_head_win = seg["head_unwrapped_rad"][start:end].astype(np.float64)
        can_yaw = seg.get("yaw_rate_rads")
        if can_yaw is not None and len(can_yaw) >= end and np.any(can_yaw[start:end] != 0.0):
            omega_seq = can_yaw[start:end].astype(np.float32)
        else:
            omega_seq = np.gradient(u_head_win, self.dt).astype(np.float32)
        omega_t = np.float32(omega_seq[-1])

        # 3. Deterministic trapezoidal integral targets over 19 intervals
        target_delta_s = np.float32(np.sum((v_seq[:-1] + v_seq[1:]) * 0.5) * self.dt)
        target_delta_psi = np.float32(np.sum((omega_seq[:-1] + omega_seq[1:]) * 0.5) * self.dt)

        # 4. Vehicle CAN Reference 2D Displacement Rotated into Vehicle's Initial Heading Frame
        psi_0 = float(u_head_win[0])
        if "can_east_m" in seg and "can_north_m" in seg:
            delta_e = float(seg["can_east_m"][end - 1] - seg["can_east_m"][start])
            delta_n = float(seg["can_north_m"][end - 1] - seg["can_north_m"][start])
        else:
            # High-fidelity fallback to integrated CAN speed and heading
            sin_psi = np.sin(u_head_win)
            cos_psi = np.cos(u_head_win)
            vel_e = v_seq * sin_psi
            vel_n = v_seq * cos_psi
            delta_e = float(np.sum((vel_e[:-1] + vel_e[1:]) * 0.5) * self.dt)
            delta_n = float(np.sum((vel_n[:-1] + vel_n[1:]) * 0.5) * self.dt)

        # Rotate global [delta_E, delta_N] into initial-heading-aligned vehicle chassis frame
        # forward along psi_0, lateral orthogonal to forward
        delta_forward = float(delta_e * math.sin(psi_0) + delta_n * math.cos(psi_0))
        delta_lateral = float(delta_e * math.cos(psi_0) - delta_n * math.sin(psi_0))

        # 5. Stationary stop indicator (1.0 if v_t < 0.2 m/s, else 0.0)
        target_p_stop = np.float32(1.0 if v_t < 0.2 else 0.0)

        return {
            "imu": torch.from_numpy(imu_tensor.astype(np.float32)),
            "v_seq": torch.from_numpy(v_seq),
            "omega_seq": torch.from_numpy(omega_seq),
            "v_t": torch.tensor(v_t),
            "omega_t": torch.tensor(omega_t),
            "delta_s": torch.tensor(target_delta_s),
            "delta_psi": torch.tensor(target_delta_psi),
            "delta_forward": torch.tensor(np.float32(delta_forward)),
            "delta_lateral": torch.tensor(np.float32(delta_lateral)),
            "p_stop": torch.tensor(target_p_stop),
        }


def compute_train_norm_stats(train_segments, channels=9):
    """Computes per-channel mean and std strictly on CONDITIONED TRAIN segments."""
    print("  [NORM] Computing normalization stats strictly from CONDITIONED TRAIN segments...")
    ch_data = [[] for _ in range(channels)]

    for seg in train_segments:
        # Pre-condition with fresh stateful conditioner
        raw_9ch = np.vstack([
            seg["ax"], seg["ay"], seg["az"],
            seg["gyaw"], seg["gpit"], seg["grol"],
            seg["gx"], seg["gy"], seg["gz"]
        ]).astype(np.float64)
        conditioner = SensorConditioner(dt=0.1)
        cond_imu = conditioner.condition_sequence(raw_9ch)

        for c in range(channels):
            ch_data[c].append(cond_imu[c, ::5])

    means = np.array([np.mean(np.concatenate(ch_data[c])) for c in range(channels)], dtype=np.float32)[:, None]
    stds  = np.array([np.std(np.concatenate(ch_data[c])) for c in range(channels)], dtype=np.float32)[:, None]
    stds = np.maximum(stds, 1e-4)
    print(f"  [NORM] Computed Conditioned Means: {means.flatten()[:6].round(3)} ...")
    print(f"  [NORM] Computed Conditioned Stds:  {stds.flatten()[:6].round(3)} ...")
    return means, stds


def build_canonical_splits(
    base_dir=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset",
    window=20,
    stride=5,
    channels=9
):
    """
    Builds strictly leak-free training, validation, and holdout splits:
      - TRAIN: Driver A (S1, S3a, S3c, S4), Driver B (M), Driver E (Vta, Vtb, Vw subsets)
      - VAL:   Driver A (S2 - completely unseen route of Vehicle A)
      - TEST:  Driver D (Y1 - completely unseen vehicle & driver)
    """
    base_path = Path(base_dir)
    print(f"[SPLIT] Building canonical leak-free splits from: {base_path}")

    train_segments = []
    val_segments = []
    test_segments = []

    all_s_files = list(base_path.rglob("S-*.csv")) + list(base_path.rglob("s-*.csv"))

    for s_path in sorted(all_s_files):
        fname = s_path.name
        parent_folder = s_path.parent.name
        grandparent_folder = s_path.parent.parent.name

        try:
            segs = repair_and_resample_sequence(s_path)
            if not segs:
                continue
        except Exception:
            continue

        if "S2" in parent_folder or "S2" in fname:
            val_segments.extend(segs)
        elif "Y (Driver D)" in grandparent_folder or "Y1" in fname:
            test_segments.extend(segs)
        else:
            train_segments.extend(segs)

    print(f"\n[SUMMARY] Train: {len(train_segments)} segs | Val: {len(val_segments)} segs | Test: {len(test_segments)} segs")

    train_mean, train_std = compute_train_norm_stats(train_segments, channels=channels)
    norm_stats = (train_mean, train_std)

    models_dir = Path("models")
    models_dir.mkdir(exist_ok=True, parents=True)
    with open(models_dir / "imu_norm_stats.json", "w") as f:
        json.dump({
            "channels": channels,
            "mean": train_mean.flatten().tolist(),
            "std": train_std.flatten().tolist()
        }, f, indent=2)
    print(f"  [NORM] Saved normalization stats to models/imu_norm_stats.json")

    train_dataset = CanonicalIOVNBDDataset(train_segments, window=window, stride=stride, channels=channels, augment=True, norm_stats=norm_stats)
    val_dataset   = CanonicalIOVNBDDataset(val_segments, window=window, stride=stride, channels=channels, augment=False, norm_stats=norm_stats)
    test_dataset  = CanonicalIOVNBDDataset(test_segments, window=window, stride=stride, channels=channels, augment=False, norm_stats=norm_stats)

    return train_dataset, val_dataset, test_dataset


def find_all_s_csvs(base_dir=r"D:\SIH prototype\data\IO-VNBD\Synchronised V abd S datasets\Categorised IOVNB Dataset"):
    base_path = Path(base_dir)
    return sorted(list(base_path.rglob("S-*.csv")) + list(base_path.rglob("s-*.csv")))
