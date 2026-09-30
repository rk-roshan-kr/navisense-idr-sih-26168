"""
================================================================================
NAVISENSE NEURAL DR V3 - EXPERIMENTAL RESEARCH SUBPROJECT
================================================================================
STATUS: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH
NOTE: THIS IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.
This module is strictly isolated in neural_dr_v3/ and does NOT overwrite or
modify the production NaviSense IDR V2.2 runtime, base models, or adapters.

File: neural_dr_v3/data/episode_dataset.py
Description: PyTorch Dataset, DataLoader, and split builder for multi-scale
blackout episode training with online sensor perturbation.
================================================================================
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

from src.data.preprocessor import repair_and_resample_sequence
from .blackout_generator import BlackoutEpisode, generate_blackout_episodes_from_segment
from .sensor_perturbation import SensorPerturbationEngine


class BlackoutEpisodeDataset(Dataset):
    """
    PyTorch Dataset serving Blackout Episodes with optional online sensor perturbation.
    Produces fixed or sliced rollouts for truncated BPTT closed-loop training.
    """
    def __init__(
        self,
        episodes: List[BlackoutEpisode],
        rollout_steps: int = 50,         # 50 steps = 5.0s rollout window
        w_hist: int = 20,                # 20 samples = 2.0s history
        augment: bool = False,
        norm_mean: Optional[np.ndarray] = None,
        norm_std: Optional[np.ndarray] = None,
        perturbation_engine: Optional[SensorPerturbationEngine] = None,
        max_slices: Optional[int] = None
    ):
        self.episodes = episodes
        self.rollout_steps = rollout_steps
        self.w_hist = w_hist
        self.augment = augment
        self.norm_mean = norm_mean
        self.norm_std = norm_std
        self.perturbation_engine = perturbation_engine if perturbation_engine is not None else SensorPerturbationEngine()

        # Build index of valid rollout slices: (ep_idx, slice_start)
        self.slices = []
        for ep_idx, ep in enumerate(self.episodes):
            if ep.num_steps >= self.rollout_steps:
                for start_idx in range(0, ep.num_steps - self.rollout_steps + 1, 30):
                    self.slices.append((ep_idx, start_idx))

        if max_slices is not None and len(self.slices) > max_slices:
            np.random.seed(42)
            sel_indices = np.random.choice(len(self.slices), size=max_slices, replace=False)
            self.slices = [self.slices[i] for i in sorted(sel_indices)]

        print(f"  [EPISODE DATASET] Indexed {len(self.slices)} rollout slices from {len(self.episodes)} episodes (rollout={rollout_steps}).")

    def __len__(self) -> int:
        return len(self.slices)

    def __getitem__(self, idx: int) -> Dict[str, torch.Tensor]:
        ep_idx, s_idx = self.slices[idx]
        ep = self.episodes[ep_idx]
        e_idx = s_idx + self.rollout_steps

        # Anchor speed & heading at rollout start
        if s_idx == 0:
            anchor_v0 = float(ep.anchor_speed_mps)
            anchor_psi0 = float(ep.anchor_heading_rad)
        else:
            anchor_v0 = float(ep.gt_speed[s_idx - 1])
            anchor_psi0 = float(ep.anchor_heading_rad + ep.gt_delta_psi[s_idx - 1])

        # Slice IMU cleanly from combined episode array
        ep_full_imu = np.hstack([ep.anchor_imu_history, ep.imu_stream])
        full_imu = ep_full_imu[:, s_idx:s_idx + self.w_hist + self.rollout_steps].copy()

        # Online physical perturbation during training
        if self.augment:
            speed_ref = np.hstack([
                np.full(self.w_hist, anchor_v0, dtype=np.float32),
                ep.gt_speed[s_idx:e_idx]
            ])
            full_imu = self.perturbation_engine.perturb_imu_sequence(full_imu, speed_ref=speed_ref)

        # Normalize IMU channels
        if self.norm_mean is not None and self.norm_std is not None:
            full_imu = (full_imu - self.norm_mean) / (self.norm_std + 1e-6)

        hist_norm = full_imu[:, :self.w_hist]
        stream_norm = full_imu[:, self.w_hist:]

        # Ground truth targets relative to the rollout start
        base_e = ep.gt_delta_east[s_idx] if s_idx > 0 else 0.0
        base_n = ep.gt_delta_north[s_idx] if s_idx > 0 else 0.0
        base_psi = ep.gt_delta_psi[s_idx] if s_idx > 0 else 0.0

        gt_de = ep.gt_delta_east[s_idx:e_idx] - base_e
        gt_dn = ep.gt_delta_north[s_idx:e_idx] - base_n
        gt_dpsi = ep.gt_delta_psi[s_idx:e_idx] - base_psi
        gt_speed = ep.gt_speed[s_idx:e_idx]
        gt_yaw_rate = ep.gt_yaw_rate[s_idx:e_idx]
        gt_p_stop = ep.gt_p_stop[s_idx:e_idx]

        # Step displacements: ds(t) = sqrt(dE^2 + dN^2)
        step_de = np.diff(np.insert(gt_de, 0, 0.0))
        step_dn = np.diff(np.insert(gt_dn, 0, 0.0))
        step_ds = np.sqrt(step_de**2 + step_dn**2).astype(np.float32)
        step_dpsi = np.diff(np.insert(gt_dpsi, 0, 0.0)).astype(np.float32)

        return {
            "hist_imu": torch.from_numpy(hist_norm.astype(np.float32)),        # (9, W_hist)
            "stream_imu": torch.from_numpy(stream_norm.astype(np.float32)),    # (9, rollout_steps)
            "anchor_v0": torch.tensor(anchor_v0, dtype=torch.float32),
            "anchor_psi0": torch.tensor(anchor_psi0, dtype=torch.float32),
            "gt_delta_east": torch.from_numpy(gt_de.astype(np.float32)),       # (rollout_steps,)
            "gt_delta_north": torch.from_numpy(gt_dn.astype(np.float32)),      # (rollout_steps,)
            "gt_delta_psi": torch.from_numpy(gt_dpsi.astype(np.float32)),      # (rollout_steps,)
            "gt_step_ds": torch.from_numpy(step_ds),                           # (rollout_steps,)
            "gt_step_dpsi": torch.from_numpy(step_dpsi),                       # (rollout_steps,)
            "gt_speed": torch.from_numpy(gt_speed.astype(np.float32)),         # (rollout_steps,)
            "gt_yaw_rate": torch.from_numpy(gt_yaw_rate.astype(np.float32)),   # (rollout_steps,)
            "gt_p_stop": torch.from_numpy(gt_p_stop.astype(np.float32))        # (rollout_steps,)
        }


def build_episode_dataloaders(
    data_dir: str = r"data/IO-VNBD/Synchronised V abd S datasets/Categorised IOVNB Dataset",
    batch_size: int = 32,
    rollout_steps: int = 50,
    w_hist: int = 20,
    durations_s: List[float] = [5.0, 10.0, 20.0, 30.0, 60.0],
    max_train_slices: int = 5000,
    max_val_slices: int = 1000
) -> Tuple[DataLoader, DataLoader, DataLoader, Dict]:
    """
    Builds canonical leak-free train, validation, and holdout test DataLoaders.
      - TRAIN: Driver A (S1, S3a, S3c, S4), Driver B (M), Driver E (Vta, Vtb, Vw)
      - VAL:   Driver A (S2 - unseen route)
      - TEST:  Driver D (Y1 - unseen vehicle & driver)
    """
    base_path = Path(data_dir)
    print(f"\n[NEURAL DR v3] Sourcing dataset from: {base_path}")
    all_s_files = sorted(list(base_path.rglob("S-*.csv")) + list(base_path.rglob("s-*.csv")))

    train_episodes, val_episodes, test_episodes = [], [], []
    train_imu_collect = []

    for s_path in all_s_files:
        fname = s_path.name
        parent_folder = s_path.parent.name
        grandparent_folder = s_path.parent.parent.name

        try:
            segs = repair_and_resample_sequence(str(s_path))
            if not segs:
                continue
        except Exception:
            continue

        for seg in segs:
            seg["name"] = fname
            eps = generate_blackout_episodes_from_segment(seg, durations_s=durations_s, w_hist=w_hist)
            if not eps:
                continue

            if "S2" in parent_folder or "S2" in fname:
                val_episodes.extend(eps)
            elif "Y (Driver D)" in grandparent_folder or "Y1" in fname:
                test_episodes.extend(eps)
            else:
                train_episodes.extend(eps)
                # Sample for normalization
                imu_9 = np.vstack([
                    seg["ax"], seg["ay"], seg["az"],
                    seg["gyaw"], seg["gpit"], seg["grol"],
                    seg["gx"], seg["gy"], seg["gz"]
                ])
                train_imu_collect.append(imu_9[:, ::10])

    print(f"[SUMMARY] Episodes -> Train: {len(train_episodes)} | Val: {len(val_episodes)} | Test: {len(test_episodes)}")

    # Compute training normalization stats
    all_ch = np.hstack(train_imu_collect) if train_imu_collect else np.zeros((9, 100))
    norm_mean = np.mean(all_ch, axis=1, keepdims=True).astype(np.float32)
    norm_std = np.std(all_ch, axis=1, keepdims=True).astype(np.float32)
    norm_std = np.maximum(norm_std, 1e-4)

    # Save norm stats
    ckpt_dir = Path("neural_dr_v3/checkpoints")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    stats_dict = {
        "mean": norm_mean.flatten().tolist(),
        "std": norm_std.flatten().tolist()
    }
    with open(ckpt_dir / "norm_stats.json", "w") as f:
        json.dump(stats_dict, f, indent=2)

    train_ds = BlackoutEpisodeDataset(train_episodes, rollout_steps=rollout_steps, w_hist=w_hist, augment=True, norm_mean=norm_mean, norm_std=norm_std, max_slices=max_train_slices)
    val_ds   = BlackoutEpisodeDataset(val_episodes, rollout_steps=rollout_steps, w_hist=w_hist, augment=False, norm_mean=norm_mean, norm_std=norm_std, max_slices=max_val_slices)
    test_ds  = BlackoutEpisodeDataset(test_episodes, rollout_steps=rollout_steps, w_hist=w_hist, augment=False, norm_mean=norm_mean, norm_std=norm_std, max_slices=max_val_slices)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader   = DataLoader(val_ds, batch_size=batch_size, shuffle=False)
    test_loader  = DataLoader(test_ds, batch_size=batch_size, shuffle=False)

    return train_loader, val_loader, test_loader, stats_dict
