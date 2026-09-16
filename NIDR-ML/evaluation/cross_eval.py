"""
Multi-Tier Generalization & Placement Robustness Evaluator for NaviSense IDR.

Validates candidate models across 4 strict generalization regimes:
- Regime A: Seen physical device + seen person
- Regime B: Unseen person
- Regime C: Unseen physical phone (physical_device_id)
- Regime D: Unseen person + unseen physical phone (the headline generalization test)

Plus Placement Breakdown:
- Separate error metrics for HAND vs POCKET vs BAG vs OTHER
"""

import numpy as np
import torch
from torch.utils.data import DataLoader
from preprocessing.window_builder import TrajectoryRolloutDataset
from training.rollout import propagate_trajectory_closed_loop
from training.validate import compute_along_cross_track_errors


def evaluate_window_subset(model: torch.nn.Module, windows: list, device: str = "cuda") -> dict:
    """
    Evaluates model on a specific list of windows and returns comprehensive trajectory metrics.
    """
    if not windows:
        return {
            'num_samples': 0,
            'mean_point_error_m': 0.0,
            'p95_point_error_m': 0.0,
            'max_point_error_m': 0.0,
            'endpoint_error_m': 0.0,
            'drift_pct': 0.0,
            'along_track_m': 0.0,
            'cross_track_m': 0.0
        }

    dataset = TrajectoryRolloutDataset(windows, augment=False)
    loader = DataLoader(dataset, batch_size=32, shuffle=False)
    model.eval()

    all_pt_errs = []
    all_end_errs = []
    all_drift_pcts = []
    all_along = []
    all_cross = []

    with torch.no_grad():
        for batch in loader:
            imu_seq = batch['imu_seq'].to(device)
            ref_enu = batch['ref_enu'].to(device)
            ref_yaw = batch['ref_yaw'].to(device)

            out = model(imu_seq)
            pred_enu, _ = propagate_trajectory_closed_loop(
                disp=out['disp'],
                delta_yaw=out['delta_yaw'],
                initial_enu=ref_enu[:, 0, :],
                initial_yaw=ref_yaw[:, 0]
            )

            p_np = pred_enu.cpu().numpy()
            r_np = ref_enu.cpu().numpy()

            for b in range(len(p_np)):
                pt_err = np.linalg.norm(p_np[b] - r_np[b], axis=-1)
                all_pt_errs.extend(pt_err)

                end_err = float(np.linalg.norm(p_np[b, -1] - r_np[b, -1]))
                all_end_errs.append(end_err)

                dist = float(np.sum(np.linalg.norm(np.diff(r_np[b], axis=0), axis=-1)))
                if dist > 1.0:
                    all_drift_pcts.append((end_err / dist) * 100.0)

                along, cross = compute_along_cross_track_errors(p_np[b], r_np[b])
                all_along.extend(along)
                all_cross.extend(cross)

    return {
        'num_samples': len(windows),
        'mean_point_error_m': float(np.mean(all_pt_errs)) if all_pt_errs else 0.0,
        'p95_point_error_m': float(np.percentile(all_pt_errs, 95)) if all_pt_errs else 0.0,
        'max_point_error_m': float(np.max(all_pt_errs)) if all_pt_errs else 0.0,
        'endpoint_error_m': float(np.mean(all_end_errs)) if all_end_errs else 0.0,
        'drift_pct': float(np.mean(all_drift_pcts)) if all_drift_pcts else 0.0,
        'along_track_m': float(np.mean(all_along)) if all_along else 0.0,
        'cross_track_m': float(np.mean(all_cross)) if all_cross else 0.0
    }


def run_4regime_and_placement_evaluation(model: torch.nn.Module, all_windows: list, device: str = "cuda") -> dict:
    """
    Executes cross-evaluation across all 4 generalization regimes and phone placements.
    """
    devices = sorted(list(set(w['physical_device_id'] for w in all_windows)))
    people = sorted(list(set(w['participant_id'] for w in all_windows)))

    results = {
        'total_windows': len(all_windows),
        'num_physical_devices': len(devices),
        'num_participants': len(people),
        'regimes': {},
        'placements': {}
    }

    # Split definitions
    held_out_device = devices[-1] if len(devices) > 1 else None
    held_out_person = people[-1] if len(people) > 1 else None

    # Regime A: Seen device / seen person (everything excluding held-out)
    regime_a_windows = [w for w in all_windows if w['physical_device_id'] != held_out_device and w['participant_id'] != held_out_person]
    # Regime B: Unseen person
    regime_b_windows = [w for w in all_windows if w['participant_id'] == held_out_person] if held_out_person else []
    # Regime C: Unseen physical phone
    regime_c_windows = [w for w in all_windows if w['physical_device_id'] == held_out_device] if held_out_device else []
    # Regime D: Unseen person + unseen physical phone
    regime_d_windows = [w for w in all_windows if w['physical_device_id'] == held_out_device and w['participant_id'] == held_out_person]

    results['regimes']['Regime_A_Seen'] = evaluate_window_subset(model, regime_a_windows or all_windows, device)
    results['regimes']['Regime_B_Unseen_Person'] = evaluate_window_subset(model, regime_b_windows, device)
    results['regimes']['Regime_C_Unseen_Phone'] = evaluate_window_subset(model, regime_c_windows, device)
    results['regimes']['Regime_D_Unseen_Both'] = evaluate_window_subset(model, regime_d_windows, device)

    # Placements breakdown: HAND, POCKET, BAG, OTHER
    for pl in ['HAND', 'POCKET', 'BAG', 'OTHER']:
        pl_windows = [w for w in all_windows if w.get('placement', 'HAND').upper() == pl]
        if pl_windows:
            results['placements'][pl] = evaluate_window_subset(model, pl_windows, device)

    return results
