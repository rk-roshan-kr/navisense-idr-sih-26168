# NAVISENSE NEURAL DR V3 (EXPERIMENTAL SUBPROJECT)

> ⚠️ **IMPORTANT NOTICE: STANDALONE RESEARCH / EXPERIMENTAL TESTBENCH**  
> **THIS MODULE IS A SUBPROJECT / TEST PROJECT AND IS NOT PART OF THE BASE V2.2 ARCHITECTURE YET.**  
> Nothing in `neural_dr_v3/` modifies, overrides, or replaces the production NaviSense IDR V2.2 runtime, base models (`UniversalMotionNetV2`), adapters (`VehicleAdapter`), or the EKF map-matching pipeline.

---

## 1. Executive Summary & Objective

In NaviSense IDR V2.2, dead-reckoning relies on:
1. Instantaneous velocity and yaw-rate prediction ($v_t, \omega_t$) over sliding 1.9s windows.
2. Step-by-step trapezoidal integration.
3. Hand-tuned EKF process covariances and soft road network constraints.

While V2.2 performs well, hand-tuned estimators can drift exponentially when sensor biases or junction ambiguities arise. 

**Neural DR v3** explores a clean, neural-first alternative:
- **Relative Motion from Anchor**: Rather than predicting global latitude/longitude or raw unconstrained velocities, the model predicts **incremental motion from the last trusted GNSS anchor** ($P_0, \psi_0, v_0$).
- **Strict Blackout Autonomy**: During simulated outages ($t \in [0, T]$), the network receives zero current GNSS, zero future GNSS, and zero ground truth coordinates.
- **Closed-Loop Rollout with Kinematics**:
  $$\begin{aligned}
  \Delta s_t, \Delta \psi_t, \sigma_t, p_{stop} &= f_\theta(s_t, \text{IMU}_{t-W:t}) \\
  \psi_{t+1} &= \psi_t + \Delta \psi_t \\
  \Delta E_{t+1} &= \Delta E_t + \Delta s_t \sin(\psi_{t+1}) \\
  \Delta N_{t+1} &= \Delta N_t + \Delta s_t \cos(\psi_{t+1}) \\
  P(t) &= P_0 + [\Delta E(t), \Delta N(t)]
  \end{aligned}$$
- **Trajectory-Level Multi-Loss**: Penalizes 1-step errors, cumulative trajectory displacement errors, and final endpoint drift.
- **Scheduled Sampling**: Model experiences its own accumulated prediction errors during training rollouts so it learns error recovery.
- **Sensor Perturbation Augmentation**: Injects realistic bias random walks, scale factor errors, 3D mount tilt jitter, and vibration.

---

## 2. Model Architectures Tested

| Architecture | Pipeline Description | Intended Role |
| :--- | :--- | :--- |
| **Model A** | $\text{IMU} \to [v_t, \omega_t] \to$ Trapezoidal Integration $\to$ Pose | Velocity/Yaw Rate baseline |
| **Model B** | $\text{IMU} + \text{Anchor/State} \to [\Delta s_t, \Delta \psi_t, \text{Uncertainty}, p_{stop}] \to$ Kinematics $\to$ Pose | **Primary Proposed Model** |
| **Model C** | $\text{IMU} + \text{Anchor/State} \to [\Delta E_t, \Delta N_t]$ (Direct Cartesian) | Direct Cartesian baseline |

---

## 3. Directory Structure

```text
neural_dr_v3/
├── README.md                      # This document (subproject notice & experimental guide)
├── configs/
│   ├── train_config.json          # Rollout lengths, learning rates, loss weights
│   └── perturbation_config.json   # Sensor noise, bias random walk, mount tilt ranges
├── data/
│   ├── sensor_perturbation.py     # Real-time sensor noise, bias walk & mount misalignment engine
│   ├── blackout_generator.py      # Slices 5s, 10s, 20s, 30s, 60s, 120s blackout episodes from IO-VNBD
│   └── episode_dataset.py         # PyTorch Dataset and DataLoader with canonical splits
├── models/
│   ├── causal_backbone.py         # Strictly causal TCN + LayerNorm + GRU feature extractor
│   ├── kinematic_integrator.py    # Differentiable 2D kinematics + WGS84 local projector
│   ├── model_a_vel_yaw.py         # Model A: Velocity & Yaw rate regression
│   ├── model_b_neural_dr.py       # Model B: Primary closed-loop incremental motion network
│   └── model_c_direct_cartesian.py# Model C: Direct Cartesian displacement baseline
├── training/
│   ├── losses.py                  # Trajectory rollout multi-loss (step, traj, final, heading, NLL)
│   ├── scheduled_sampler.py       # Curriculum scheduled sampling (closed-loop error feedback)
│   └── trainer.py                 # Multi-epoch PyTorch training engine (CUDA RTX 5070 Ti)
├── evaluation/
│   ├── metrics.py                 # 10/30/60/120s drift, Along-Track/Cross-Track error, T_fail
│   ├── evaluator.py               # Pure autonomous rollout evaluation loop (zero GNSS)
│   └── benchmark_vs_v2.py         # Head-to-head comparison against V2.2 baseline
├── diagnostics/
│   ├── plot_trajectories.py       # Trajectory overlay and drift comparison visualization
│   └── error_forensics.py         # Analysis of drift decomposition (heading vs scale vs stopping)
├── checkpoints/                   # Saved PyTorch checkpoint weights (.pt)
└── results/                       # Evaluation JSON matrices and generated figures
```

---

## 4. How to Run the Subproject

1. **Verify Integrity & Unit Tests**:
   ```bash
   python -m neural_dr_v3.evaluation.evaluator --test-sanity
   ```
2. **Train Model B (Primary Neural DR)**:
   ```bash
   python -m neural_dr_v3.training.trainer --model b --epochs 12 --batch-size 32
   ```
3. **Run Head-to-Head Benchmark vs V2.2**:
   ```bash
   python -m neural_dr_v3.evaluation.benchmark_vs_v2
   ```
