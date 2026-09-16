"""
Monte Carlo Sensor Perturbation Robustness Stress Tester for NaviSense IDR.

Executes 1,000 stochastically perturbed rollouts on candidate models:
- Gyro bias random shifts (up to +- 0.005 rad/s)
- Accelerometer scale calibration errors (up to +- 5%)
- Additive sensor noise
- Angular orientation jitter

Outputs:
- Mean Point Error (m)
- 95th Percentile Point Error (m)
- 99th Percentile Point Error (m)
- Worst-Case Point Error (m)
- Mean, P95, P99, and Worst-Case Drift %
"""

import numpy as np
import torch
from training.rollout import propagate_trajectory_closed_loop
from preprocessing.window_builder import TrajectoryRolloutDataset


def run_monte_carlo_robustness_test(
    model: torch.nn.Module,
    test_window: dict,
    num_runs: int = 1000,
    device: str = "cuda"
) -> dict:
    """
    Runs Monte Carlo stress testing over num_runs perturbed trajectories.
    """
    model.eval()
    base_imu = test_window['imu_seq']
    ref_enu = test_window['ref_enu']
    ref_yaw = test_window['ref_yaw']
    T_imu = len(base_imu)
    T_pred = len(ref_enu)

    path_dist = float(np.sum(np.linalg.norm(np.diff(ref_enu, axis=0), axis=-1)))
    if path_dist < 1.0:
        path_dist = 1.0

    all_max_pt_errors = []
    all_endpoint_errors = []
    all_mean_pt_errors = []
    all_drifts = []

    print(f"\n[MONTE CARLO] Launching {num_runs} perturbed closed-loop rollouts (Path length: {path_dist:.1f}m)...")

    # Use batches of 50 to maximize RTX 5070 Ti utilization while keeping memory minimal
    batch_size = 50
    num_batches = int(np.ceil(num_runs / batch_size))

    aug_cfg = {
        'gyro_bias_std_rad_s': 0.003,
        'accel_noise_std_m_s2': 0.05,
        'scale_variation_min': 0.95,
        'scale_variation_max': 1.05,
        'body_rotation_perturb_deg': 4.0
    }

    dummy_dataset = TrajectoryRolloutDataset([test_window], augment=True, augment_config=aug_cfg)

    with torch.no_grad():
        for b in range(num_batches):
            curr_b_size = min(batch_size, num_runs - b * batch_size)
            # Create perturbed copies
            perturbed_list = []
            for _ in range(curr_b_size):
                p_imu = dummy_dataset._apply_physically_consistent_augmentation(base_imu.copy())
                perturbed_list.append(torch.from_numpy(p_imu).float())

            batch_imu = torch.stack(perturbed_list).to(device)  # (B, T_imu, 13)
            init_enu = torch.from_numpy(ref_enu[0:1]).repeat(curr_b_size, 1).to(device)
            init_yaw = torch.from_numpy(ref_yaw[0:1]).repeat(curr_b_size).to(device)

            out = model(batch_imu)
            pred_enu, _ = propagate_trajectory_closed_loop(
                disp=out['disp'],
                delta_yaw=out['delta_yaw'],
                initial_enu=init_enu,
                initial_yaw=init_yaw
            )

            p_np = pred_enu.cpu().numpy()  # (B, T_pred, 3)

            for i in range(curr_b_size):
                diff = p_np[i] - ref_enu
                pt_errs = np.linalg.norm(diff, axis=-1)
                end_err = float(np.linalg.norm(p_np[i, -1] - ref_enu[-1]))

                all_mean_pt_errors.append(float(np.mean(pt_errs)))
                all_max_pt_errors.append(float(np.max(pt_errs)))
                all_endpoint_errors.append(end_err)
                all_drifts.append((end_err / path_dist) * 100.0)

    report = {
        'num_runs': num_runs,
        'path_distance_m': path_dist,
        'mean_pointwise_error_m': float(np.mean(all_mean_pt_errors)),
        'p95_pointwise_error_m': float(np.percentile(all_mean_pt_errors, 95)),
        'p99_pointwise_error_m': float(np.percentile(all_mean_pt_errors, 99)),
        'worst_case_max_point_error_m': float(np.max(all_max_pt_errors)),
        'mean_endpoint_error_m': float(np.mean(all_endpoint_errors)),
        'p95_endpoint_error_m': float(np.percentile(all_endpoint_errors, 95)),
        'p99_endpoint_error_m': float(np.percentile(all_endpoint_errors, 99)),
        'worst_case_endpoint_error_m': float(np.max(all_endpoint_errors)),
        'mean_drift_pct': float(np.mean(all_drifts)),
        'p95_drift_pct': float(np.percentile(all_drifts, 95)),
        'p99_drift_pct': float(np.percentile(all_drifts, 99)),
        'worst_case_drift_pct': float(np.max(all_drifts))
    }

    print("MONTE CARLO ROBUSTNESS RESULTS (1,000 Runs):")
    print(f"  Mean Pointwise Error: {report['mean_pointwise_error_m']:.2f} m")
    print(f"  P95 Pointwise Error:  {report['p95_pointwise_error_m']:.2f} m")
    print(f"  P99 Pointwise Error:  {report['p99_pointwise_error_m']:.2f} m")
    print(f"  Worst-Case Max Error: {report['worst_case_max_point_error_m']:.2f} m")
    print(f"  Mean Drift:           {report['mean_drift_pct']:.2f} %")
    print(f"  P95 Drift:            {report['p95_drift_pct']:.2f} %")
    print(f"  Worst-Case Drift:     {report['worst_case_drift_pct']:.2f} %")

    return report
