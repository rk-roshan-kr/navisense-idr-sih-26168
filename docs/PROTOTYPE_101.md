# SIH 26168 — Prototype 101 Technical Specification

> **Problem Statement:** PS 26168 (ISRO) — AI-ML based Intelligent Dead Reckoning System for Seamless Navigation  
> **Core Architectural Paradigm:** Base -> Calibrate -> Personalize -> Isolate -> Navigate

---

## 1. The 5-Stage Scientific Architecture

```text
[ STAGE 1: BASE MODEL ]
  Universal 1D-CNN + GRU trained offline across multiple vehicle platforms (IO-VNBD pool).
               │
               ▼
[ STAGE 2: ONLINE CALIBRATION ]
  Phone placed in mount. Observes normal GNSS-guided driving (t <= 180s).
  Causally estimates mount orientation R_p^b (pitch/roll), sensor biases, and vibration spectrum.
               │
               ▼
[ STAGE 3: VEHICLE PERSONALIZATION ]
  Learns specific vehicle longitudinal acceleration scale, suspension damping, and drag.
               │
               ▼
[ STAGE 4: STRICT ISOLATION ]
  Continuously computes an independent GNSS-free trajectory (Blue path) alongside GNSS (Green path).
  GNSS position coordinates are strictly blocked from the dead reckoning filter.
               │
               ▼
[ STAGE 5: AUTONOMOUS NAVIGATION (BLACKOUT) ]
  GNSS severed (tunnels / urban canyons). System navigates seamlessly on IMU + Personalized Model.
```

---

## 2. The 8 Decoupled Subsystems

The engine in `src/core/idr_core.py` implements eight single-responsibility components:

| Component | Class | Responsibility |
| :--- | :--- | :--- |
| **1. Sensor Ingestion** | `SensorIngestion` | Validates and normalizes raw 10 Hz accelerometer & gyroscope streams. |
| **2. Coordinate Transform** | `CoordinateTransform` | Transforms smartphone mounting frame to vehicle body frame ($\mathbf{R}_p^b$). |
| **3. Calibration Engine** | `CalibrationEngine` | Strictly causal estimation of mount tilt angles and sensor biases ($t \le T_{calib}$). |
| **4. IMU Conditioner** | `IMUConditioner` | Suspension resonance damping, pothole shock clamping, and noise filtering. |
| **5. State Estimator** | `VehicleStateEstimator` | Longitudinal forward speed regression and aerodynamic drag decay. |
| **6. Inertial Propagator** | `InertialPropagator` | Yaw integration and 2D kinematic position displacement. |
| **7. Constraint Fusion** | `ConstraintFusion` | Non-Holonomic Constraints ($v_y^b = v_z^b = 0$) and stationary ZUPT detection. |
| **8. Output Interface** | `OutputInterface` | Formats the verified state vector, uncertainty bounds, and telemetry. |

---

## 3. Scientific Benchmark Ladder (B0–B5)

| Tier | Baseline | Description |
| :--- | :--- | :--- |
| **B0** | GNSS Reference | Ground truth reference trajectory from vehicle CAN-bus / dual-frequency GPS. |
| **B1** | Raw Strapdown INS | Mechanization: gyro attitude $\to$ rotate accel $\to$ gravity removal $\to$ double integration. Explodes quadratically ($O(t^2)$). |
| **B2** | Classical EKF + NHC | 15-state Error-State EKF enforcing zero lateral slip ($v_y^b = v_z^b = 0$) and ZUPT. |
| **B3** | Map-Constrained IDR | Road graph centerline candidate projection. |
| **B4** | Base Learned IDR | Generic deep motion prior without vehicle-specific tuning. |
| **B5** | **Personalized IDR** | **Universal base representation + online vehicle/mount adapter (our core contribution).** |

---

## 4. Evaluation Outage Protocol

* **Temporal Blackouts:** `10s`, `30s`, `60s` (simulating short underpasses and medium tunnels).
* **Distance Blackouts:** `1000m (1 km)` (simulating long highway tunnels at 60 km/h).
* **Mandatory Metrics Reported:**
  * End-point drift: $E_{end} = \|\hat{\mathbf{p}}(T) - \mathbf{p}_{ref}(T)\|$
  * Drift percentage: $Drift\% = \frac{E_{end}}{D_{travel}} \times 100\%$
  * Maximum error: $E_{max} = \max_t \|\hat{\mathbf{p}}(t) - \mathbf{p}_{ref}(t)\|$
  * Along-track RMSE: $E_{along}$
  * Cross-track RMSE: $E_{cross}$
  * Velocity RMSE: $v_{rmse}$
