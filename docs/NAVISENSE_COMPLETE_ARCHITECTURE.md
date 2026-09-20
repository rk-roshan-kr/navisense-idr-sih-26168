# NaviSense IDR — Complete System Architecture & Operational Doctrine
## Smart India Hackathon (SIH) Problem Statement 26168
**Organization:** ISRO / Ministry of Space  
**Core Invention:** Smartphone-only Intelligent Dead Reckoning (IDR) engine that learns vehicle/motion dynamics and mounting geometry during GNSS availability, emitting a continuous, uncertainty-aware navigation state through extended outages.

---

## 1. System Scope: Delineating Internal Prototype vs. Final Vehicle Product

### Final SIH PS 26168 Product (Vehicular)
> **A personalized Intelligent Dead Reckoning engine that learns the characteristic motion of a specific phone–mount–vehicle setup while GNSS is available, then uses the phone's IMU and last trusted GNSS state to continuously estimate vehicle position during GNSS outages.**

The PS requires:
- Smartphone-only operation without depending on vehicle CAN-bus/OBD-II connectivity
- Coupled GNSS+INS state estimation
- Automatic 3D frame alignment (dashboard, windshield, cupholder)
- Learned motion handling and speed scale calibration
- Topological road graph / OSM vector corridor constraints
- Real-time on-device edge execution
- Strict target: **$<10\%$ drift over 10–120s outages**.

### Internal-Round Prototype (Pedestrian Proof-of-Concept)
We test the same underlying mathematical IDR engine with **pedestrian motion**:
```text
Phone A (Reference)              Phone B (IDR Test)
Continuous GNSS                   Acquires Anchor P₀, ψ₀
       │                                   │
       │                                   ▼
       │                          GNSS Outage Trigger
       │                          (Software Cutoff + BLE Disconnect)
       │                                   │
       ▼                                   ▼
Reference Trajectory              IMU-Only Inference (Dead Reckoning)
       │                                   │
       └──────────────┬────────────────────┘
                      ▼
        Pointwise Comparative Evaluation
         (Drift Target: <20% over ~40m)
```
The pedestrian prototype is **not the SIH vehicle solution**; it is our physical proof-of-concept, validation suite, and sensor data-generation platform.

---

## 2. Complete System Architecture

```text
                                  NAVISENSE
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
   DATA COLLECTION             MODEL TRAINING               IDR TEST APP
       MOBILE                    WORKSTATION                   MOBILE
          │                           │                           │
          ▼                           ▼                           ▼
     GNSS + IMU                Dataset Builder               IDR Runtime
          │                           │                           │
          └──────────────────────► Training ◄─────────────────────┘
                                      │
                                      ▼
                            Universal Motion Model
                                      │
                                      ▼
                               Personalization
                                      │
                                      ▼
                              Deployable Model
                                      │
                                      ▼
                            Android / Edge Runtime
```

---

## 3. Data Collection Engine (Mobile App Mode 1)

One Android phone is sufficient to act as a dataset generator:

```text
PHONE HARDWARE
├── 3-Axis Accelerometer (ax, ay, az)
├── 3-Axis Gyroscope (gx, gy, gz)
├── 3-Axis Gravity Vector (gx, gy, gz)
├── Rotation Vector / Orientation Quaternion (qx, qy, qz, qw)
├── Magnetometer (auxiliary) (mx, my, mz)
└── GNSS Receiver (lat, lon, alt, speed, bearing, accuracy)
        │
        ▼
Synchronized Ingestion (Dual Monotonic + Wall Clock)
        │
        ▼
Buffered Native Disk Writer (imu_canonical.csv + gnss_canonical.csv)
```

### Sensor Input ($X_t$)
$$X_t = [a_x, a_y, a_z, \omega_x, \omega_y, \omega_z, g_x, g_y, g_z, q_x, q_y, q_z, q_w, m_x, m_y, m_z]$$

### Reference Target ($Y_t$)
$$Y_t = [E, N, U, v, \psi, \sigma_{\text{gnss}}]$$

The mobile app does **not train the model**. It produces clean, labeled, timestamp-aligned sessions.

---

## 4. Multi-Phone / Multi-Person Dataset Protocol

Generalization is achieved across diverse hardware and human gaits:
```text
Contributor 1 → Phone 1 → Sessions
Contributor 2 → Phone 2 → Sessions
Contributor 3 → Phone 3 → Sessions
Contributor 4 → Phone 4 → Sessions
```
Each session includes standardized metadata:
- Device manufacturer and model
- Android OS release and SDK version
- Requested and actual sensor sampling rates ($\text{Hz}$)
- Unique session ID and participant identifier
- Movement mode (`Walking`, `Running`, `Vehicle - Windshield`, `Vehicle - Dashboard`, `Vehicle - Cupholder`).

$$\text{Many phones} + \text{Many people} \longrightarrow \text{Universal Motion Model}$$

---

## 5. Workstation Training Pipeline

Model training occurs exclusively on workstation GPUs:
```text
Raw Sessions ──► Time-Sync ──► Denoising ──► Frame Normalization ──► Reference Generation ──► Closed-Loop Rollout ──► Model Export
```

### Critical Split Protocol
Datasets must be split strictly by **person, device, and session**—never by random individual samples:
- **Train Set**: Phone A/B/C, Contributor A/B/C
- **Validation Set**: Phone D, Contributor D
- **Test Set**: Phone E, Contributor E (Unseen device and gait).

---

## 6. Machine Learning Model Architecture

```text
Sensor Input Window (W = 20 @ 10 Hz)
      ↓
3D / Navigation-Frame Representation
      ↓
Causal Dilated TCN (4 Residual Blocks: d = 1, 2, 4, 8)
      ↓
Bidirectional GRU (Hidden Dim: 64)
      ↓
Shared Motion Latent
      │
      ├───────────────────────────────┐
      ▼                               ▼
Motion Heads (Δs, Δψ, v)        Uncertainty Head (log σ²)
```

---

## 7. Model Outputs & Local Relative Motion

The neural network does not directly regress geodetic coordinates ($lat, lon$). It regresses **local relative motion**:
- Primary displacements: $[\Delta E, \Delta N, \Delta U]$
- Heading increment: $\Delta\psi$
- Forward velocity: $v_x, v_y, v_z$
- Heteroscedastic uncertainty: $\sigma_E, \sigma_N, \sigma_U, \sigma_\psi$
- Standstill probability: $p_{\text{stop}}$.

---

## 8. Closed-Loop Rollout Trajectory Training

Instead of standard single-step supervised regression, training uses multi-step closed-loop autoregressive rollouts:
$$s_0 \xrightarrow{\hat{y}_1} s_1 \xrightarrow{\hat{y}_2} s_2 \dots \xrightarrow{\hat{y}_T} s_T$$
The model observes its own previous state predictions. The primary optimization objective is:
$$\boxed{\hat{P}_{1:T} \longrightarrow P_{1:T}^{\text{reference}}}$$

---

## 9. Multi-Objective Loss Function

$$\mathcal{L} = \lambda_p \mathcal{L}_{\text{point}} + \lambda_t \mathcal{L}_{\text{trajectory}} + \lambda_h \mathcal{L}_{\text{heading}} + \lambda_v \mathcal{L}_{\text{velocity}} + \lambda_f \mathcal{L}_{\text{final}} + \lambda_u \mathcal{L}_{\text{uncertainty}}$$

Where:
- $\mathcal{L}_{\text{point}} = \frac{1}{T}\sum_{t=1}^T \|\hat{P}_t - P_t^{\text{ref}}\|$
- $\mathcal{L}_{\text{final}} = \|\hat{P}_T - P_T^{\text{ref}}\|$
- $\mathcal{L}_{\text{trajectory}}$ penalizes curvature deviations and late-stage divergence.

---

## 10. Personalization Layer

```text
Universal Base Model (Frozen)
         +
Lightweight FiLM Adapter (Learned Scale, Bias, Latent Vector)
         ↓
Personalized IDR Engine
```
While GNSS is available, the smartphone continuously refines a compact adapter representing phone mounting geometry and dynamics without touching the frozen universal backbone.

---

## 11. Position Integration Engine

Dead reckoning coordinates are anchored strictly to the last trusted GNSS fix $P_0 = [E_0, N_0]$:
$$P_t = P_{t-1} + \Delta P_t$$
$$(E_t, N_t) \xrightarrow{\text{WGS84 Spherical}} (\text{lat}_t, \text{lon}_t)$$

---

## 12. Two-Phone Physical Blackout Test Protocol

```text
REFERENCE PHONE (Phone A)                       IDR TEST PHONE (Phone B)
GNSS continuously active                        GNSS active initially (Acquires P₀)
       │                                                │
       │                                                ▼
       │                                      BLACKOUT TRIGGERED
       │                                      - Software GNSS Cutoff
       │                                      - BLE Disconnected
       │                                      - IMU-Only Dead Reckoning
       ▼                                                ▼
Independent Reference Path                             IDR Estimated Path
       │                                                │
       └───────────────────────┬────────────────────────┘
                               ▼
                   Pointwise Trace Analysis
```

---

## 13. Test-Mode Lifecycle State Machine

1. `START`: Synchronized recording initiated.
2. `ACQUIRING_LOCK`: Both phones verify GNSS accuracy $< 5\text{ m}$.
3. `FREEZE_ANCHOR`: IDR phone captures $P_0 = [\text{lat}_0, \text{lon}_0]$, heading $\psi_0$, and speed $v_0$.
4. `WALK & OUTAGE`: GNSS cutoff enforced programmatically; IDR engine propagates position.
5. `RESTORE_GNSS`: Test concludes; trajectory files paired for evaluation.

---

## 14. Scientific Evaluation Metrics

At every time interval $t$:
$$e_t = \sqrt{(E_t^{\text{IDR}} - E_t^{\text{REF}})^2 + (N_t^{\text{IDR}} - N_t^{\text{REF}})^2}$$
$$D_t = \sum_{i=1}^t \|\Delta P_i^{\text{REF}}\|$$
$$\text{Drift}_t = \frac{e_t}{D_t} \times 100\%$$

Reported Scorecard Metrics:
- Final endpoint error ($m$)
- Maximum pointwise error ($m$)
- Mean pointwise error ($m$)
- 95th-percentile error ($m$)
- Final drift %
- Maximum drift %
- Along-track (longitudinal) and Cross-track (lateral) error decomposition.

---

## 15. Map Representation Layer

- **Pedestrian Prototype**: MapLibre vector tiles for visual trajectory inspection.
- **Vehicular PS 26168**: Offline OSM vector road graph with probabilistic candidate edge gating and multi-hypothesis branch pruning.

---

## 16. SIH Vehicular Runtime Flow

$$\text{Phone IMU} \xrightarrow{} \text{Sensor Conditioning} \xrightarrow{} \text{Universal Motion Net} \xrightarrow{} \text{Vehicle Adapter} \xrightarrow{} \text{ZUPT State Estimator} \xrightarrow{} \text{OSM Road Graph} \xrightarrow{} \text{Pseudo-GNSS}$$

---

## 17. GNSS State Machine & Reconvergence

- **GNSS Available**: Normal navigation + continuous background personalization.
- **GNSS Lost**: Freeze last trusted anchor + switch to learned dead reckoning.
- **GNSS Restored**: Confidence-weighted Kalman smoothing (exponential decay over 3–5 seconds) to prevent visual coordinate jumps.

---

## 18. Scientific Evaluation Architecture

We enforce complete isolation of layers during evaluation:
- Neural-Only trajectory
- +ZUPT state estimator trajectory
- +Map constrained trajectory.
This guarantees the map or filters do not mask underlying inertial errors.

---

## 19. Mapping Internal Prototype to PS 26168

| Dimension | Internal Pedestrian Prototype | Final SIH PS 26168 Vehicle Product |
| :--- | :--- | :--- |
| **Motion Domain** | Pedestrian walking / running | Vehicular dynamics (highway, urban, winding) |
| **Data Collection** | Single smartphone IMU + GNSS | Smartphone mounted in vehicle |
| **Reference Trajectory** | Independent second phone GNSS | Synchronized reference GNSS / Ground truth |
| **Outage Horizon** | $\sim 40\text{ m}$ walking path | 10–120 second highway / tunnel outages |
| **Target Drift** | **$< 20\%$ drift** | **$< 10\%$ drift** (strict SIH requirement) |
| **Map Layer** | MapLibre visual overlay | Offline OSM topological graph constraint |
| **Model Runtime** | Kinematic PDR $\to$ ExecuTorch | UniversalMotionNet + Personalization Adapter |

---

## 20. Complete Development Loop & Core Principle

> **The application is not the model. The application is the sensor, data, and edge deployment layer around the model. No training occurs on-device in V1.**

```text
COLLECT APP ──► WORKSTATION GPU ──► EXPORT MOBILE MODEL ──► TEST APP ──► BLACKOUT VALIDATION
```
