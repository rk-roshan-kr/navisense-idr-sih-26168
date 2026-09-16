"""
Multi-Tier Validation & Metrics Evaluator for NaviSense IDR.

Computes:
- Total accumulated drift % = (endpoint error / distance traveled) * 100%
- Along-track error (stride/speed error)
- Cross-track error (azimuth/heading drift)
- Motion regime classification accuracy
- Evaluation on Unseen Physical Device and Unseen Participant splits.
"""

import numpy as np
import torch
from .rollout import propagate_trajectory_closed_loop


def compute_along_cross_track_errors(pred_enu: np.ndarray, ref_enu: np.ndarray) -> tuple:
    """
    Decomposes position error into along-track (speed) and cross-track (heading) components.

    Parameters:
        pred_enu: (T, 3) predicted trajectory
        ref_enu: (T, 3) reference trajectory

    Returns:
        along_track_err: (T,) error parallel to trajectory velocity vector
        cross_track_err: (T,) error perpendicular to trajectory in horizontal plane
    """
    T = len(ref_enu)
    along_track = np.zeros(T, dtype=np.float64)
    cross_track = np.zeros(T, dtype=np.float64)

    # Reference velocity vectors
    vel = np.diff(ref_enu[:, 0:2], axis=0, prepend=ref_enu[0:1, 0:2])
    speed = np.linalg.norm(vel, axis=1)

    for t in range(T):
        err = pred_enu[t, 0:2] - ref_enu[t, 0:2]
        if speed[t] > 0.1:
            tangent = vel[t] / speed[t]
            normal = np.array([-tangent[1], tangent[0]])  # 90 deg rotation
            along_track[t] = abs(np.dot(err, tangent))
            cross_track[t] = abs(np.dot(err, normal))
        else:
            along_track[t] = np.linalg.norm(err) / np.sqrt(2.0)
            cross_track[t] = np.linalg.norm(err) / np.sqrt(2.0)

    return along_track, cross_track


def evaluate_model(model: torch.nn.Module, dataloader, device: str = "cuda") -> dict:
    """
    Evaluates a model over a dataset and reports trajectory metrics.
    """
    model.eval()
    all_point_errors = []
    all_endpoint_errors = []
    all_drift_pcts = []
    all_along_track = []
    all_cross_track = []
    regime_correct = 0
    regime_total = 0

    with torch.no_grad():
        for batch in dataloader:
            imu_seq = batch['imu_seq'].to(device)
            ref_enu = batch['ref_enu'].to(device)
            ref_yaw = batch['ref_yaw'].to(device)
            ref_regime = batch['ref_regime'].to(device)

            out = model(imu_seq)
            disp = out['disp']
            delta_yaw = out['delta_yaw']
            regime_logits = out['regime_logits']

            # Closed-loop propagation
            pred_enu, pred_yaw = propagate_trajectory_closed_loop(
                disp=disp,
                delta_yaw=delta_yaw,
                initial_enu=ref_enu[:, 0, :],
                initial_yaw=ref_yaw[:, 0]
            )

            pred_np = pred_enu.cpu().numpy()
            ref_np = ref_enu.cpu().numpy()

            B, T, _ = pred_np.shape
            for b in range(B):
                p = pred_np[b]
                r = ref_np[b]
                pt_err = np.linalg.norm(p - r, axis=-1)
                all_point_errors.extend(pt_err)

                end_err = float(np.linalg.norm(p[-1] - r[-1]))
                all_endpoint_errors.append(end_err)

                # Path distance
                path_dist = float(np.sum(np.linalg.norm(np.diff(r, axis=0), axis=-1)))
                if path_dist > 1.0:
                    drift_pct = (end_err / path_dist) * 100.0
                    all_drift_pcts.append(drift_pct)

                along, cross = compute_along_cross_track_errors(p, r)
                all_along_track.extend(along)
                all_cross_track.extend(cross)

            # Regime accuracy
            pred_classes = torch.argmax(regime_logits, dim=-1)
            regime_correct += (pred_classes == ref_regime).sum().item()
            regime_total += ref_regime.numel()

    mean_pt = float(np.mean(all_point_errors)) if all_point_errors else 0.0
    mean_end = float(np.mean(all_endpoint_errors)) if all_endpoint_errors else 0.0
    mean_drift = float(np.mean(all_drift_pcts)) if all_drift_pcts else 0.0
    median_drift = float(np.median(all_drift_pcts)) if all_drift_pcts else 0.0
    p95_drift = float(np.percentile(all_drift_pcts, 95)) if all_drift_pcts else 0.0
    mean_along = float(np.mean(all_along_track)) if all_along_track else 0.0
    mean_cross = float(np.mean(all_cross_track)) if all_cross_track else 0.0
    regime_acc = (regime_correct / regime_total * 100.0) if regime_total > 0 else 0.0

    return {
        'mean_point_error_m': mean_pt,
        'mean_endpoint_error_m': mean_end,
        'mean_drift_pct': mean_drift,
        'median_drift_pct': median_drift,
        'p95_drift_pct': p95_drift,
        'mean_along_track_m': mean_along,
        'mean_cross_track_m': mean_cross,
        'regime_accuracy_pct': regime_acc
    }
