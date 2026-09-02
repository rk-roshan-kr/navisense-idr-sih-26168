# SIH 26168 — Deep Learning Research & Personalization Pipeline

## 1. Executive Summary & Core Hypothesis

The **IO-VNBD dataset** provides an unprecedented multi-vehicle, multi-driver, multi-condition experimental benchmark:
* **4 Distinct Vehicle Platforms:** Ford Fiesta, Volvo XC70, Renault Megane, and Toyota Corolla Verso.
* **8 Different Drivers:** Capturing conservative, aggressive, city, highway, and roundabout cornering dynamics.
* **~100 Hours of Synchronized Telemetry:** High-precision vehicle CAN-bus reference sensors paired with smartphone MEMS sensors (10 Hz).
* **Sensor Bias & Mechanical Variance:** 20+ min stationary bias logs, varying tire pressures, potholes, bumps, and varying suspension geometries.

### The Research Question
> **Can a deep universal inertial navigation representation pre-trained across multiple vehicles rapidly adapt to an UNSEEN vehicle and mount using only a short segment of normal GNSS-guided driving, and significantly outperform generic models during subsequent GNSS blackouts?**

---

## 2. Multi-Vehicle Cross-Validation Protocol (Leave-One-Vehicle-Out)

```
[ MULTI-VEHICLE POOL (IO-VNBD) ]
  ├── Training Vehicles (Group 1):
  │   ├── Renault Megane / Volvo XC70 (Driver E: Vta, Vtb, Vw sequences)
  │   └── Ford Fiesta (Driver B: M1, M2)
  │   └── Objective: Pre-train UniversalMotionNet (Universal Motion Representations)
  │
  └── UNSEEN Target Vehicle (Group 2):
      ├── Toyota Corolla / Ford Fiesta (Driver A: S1, S2, S4)
      ├── Phase A: Online Personalization on S1 (2 min GNSS-aided driving)
      └── Phase B: GNSS Blackout Outage Testing on HELD-OUT S2
```

---

## 3. Deep Learning Architecture: UniversalMotionNet + PersonalizationAdapter

```
                   RAW SMARTPHONE IMU (6 x W)
                   [3-axis Accel + 3-axis Gyro]
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │        1D Temporal Residual ConvNet          │
        │  (Captures engine vibration & local dynamics)│
        └──────────────────────┬───────────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────┐
        │        Bidirectional GRU Temporal Core       │
        │     (Learns vehicle inertia and momentum)    │
        └──────────────────────┬───────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
   ┌─────────────────────────┐   ┌─────────────────────────┐
   │ Universal Feature Embed │   │ Online Personal Adapter │
   │ (Frozen Base Layer)     │   │ (Tuned on Unseen Car)   │
   └────────────┬────────────┘   └────────────┬────────────┘
                │                             │
                └──────────────┬──────────────┘
                               ▼
            ┌─────────────────────────────────────┐
            │  Personalized Forward Velocity v_k  │
            │  + Heading Yaw Rate ω_z + Variance  │
            └─────────────────────────────────────┘
```

### Key Innovations:
1. **Separation of Concerns:** Deep temporal convolutions decouple high-frequency engine vibration from translational vehicle motion.
2. **Fast Online Personalization Head:** Requires only small parameter tuning ($\boldsymbol{\theta}_{personal}$: $\mathbf{R}_b^p$ mount angles, $\mathbf{b}_a, \mathbf{b}_g$ bias residuals, vehicle scale factor) without catastrophic forgetting of base physics.
3. **Strict GNSS Isolation:** Inference consumes purely IMU measurements and the personalized adapter state; GNSS position is never used as an input during dead reckoning.

---

## 4. Sensor Forensics & Error Source Breakdown

Forensic analysis on IO-VNBD logs reveals why naive double integration fails and how personalization corrects each error layer:

| Error Source | Physical Mechanism | Uncompensated Impact (30s Outage) | Personalization Mitigation |
| :--- | :--- | :--- | :--- |
| **Mount Tilt ($1^\circ$)** | Gravity vector leaks $g \sin(1^\circ) \approx 0.171\text{ m/s}^2$ into horizontal axis | **$\sim 77\text{ m}$ quadratic drift** | Dynamically estimated $\mathbf{R}_b^p$ projection cancels gravity leakage. |
| **Sensor Bias** | Residual offset $b_a \approx 0.05\text{ m/s}^2$ | **$\sim 22\text{ m}$ drift** | Online bias tracker removes constant offsets during ZUPT intervals. |
| **Engine Vibration** | High-frequency acoustic and chassis harmonics | Degrades velocity regression precision | 1D Residual Convolutions + suspension damping filter. |
| **Vehicle Scale Mismatch** | Engine throttle response, tire radius, brake dive | Scaling error on velocity integration | Learned linear adapter aligns velocity scale with vehicle dynamics. |

---

## 5. Artifacts & Generated Publications

* **Trained Weights:** `experiments/models/base_motion_net.pt`
* **Benchmark Logs:** `experiments/results/cross_vehicle_benchmark.json`
* **Scientific Figures:**
  - `experiments/figures/drift_comparison_cdf.png`: Empirical CDF curve across test outages.
  - `experiments/figures/error_growth_over_time.png`: $E(t)$ error growth trajectories.
  - `experiments/figures/error_forensics_ablation.png`: Percentage breakdown of sensor error contributors.
