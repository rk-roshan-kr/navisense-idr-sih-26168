# SIH 26168 — AI-ML Based Intelligent Dead Reckoning System for Seamless Navigation

**Organization:** ISRO (Department of Space)  
**Category:** Software  
**Theme:** Smart Vehicles  
**Problem Statement ID:** PS 26168  

---

## Executive Summary

Modern vehicle navigation systems rely heavily on Global Navigation Satellite Systems (GNSS) such as GPS, NavIC, and Galileo. However, in GNSS-denied environments—such as urban canyons, tunnels, underground parking garages, dense foliage, and deep valleys—GNSS signals degrade, freeze, or drop completely. High-end autonomous vehicles mitigate this using fused wheel odometers, high-precision IMUs, and direct OBD-II speed sensors. 

**PS 26168 targets the standalone smartphone challenge:** delivering continuous, sub-10% drift dead reckoning using **only an ordinary in-vehicle mounted smartphone** without physical or wireless connections to vehicle OBD-II ports or wheel speed sensors.

Our solution, **Personalized Adaptive Inertial Navigation (PAIN)**, combines generic Deep Learning IMU representations with real-time online adaptation (vehicle dynamics, phone mount frame orientation, vibration decoupling), non-holonomic motion constraints (NHC), road network graphs, and adaptive fusion to maintain accurate position estimates during GNSS blackouts.

---

## 1. Problem Definition & Challenge Analysis

### 1.1 The Operational Environment & Sensor Limitations
Consumer-grade Micro-Electro-Mechanical Systems (MEMS) sensors inside smartphones (accelerometer, gyroscope, magnetometer) exhibit severe physical limitations:
* **Sensor Bias & Drift:** Constant and time-varying bias offsets cause rapid error accumulation.
* **Vibration & Engine Harmonics:** Engine vibrations, road roughness, potholes, and cabin acoustic resonances contaminate navigation signals.
* **Mounting Instability & Alignment:** Unconstrained smartphone mounting introduces roll, pitch, and yaw misalignment relative to the vehicle body frame, which may shift during driving.
* **Double Integration Instability:** Position estimation via direct double integration of linear acceleration ($p(t) = \iint a(t) \, dt^2$) amplifies small sensor errors quadratically over time ($E(t) \propto t^2$).

```
Acceleration (m/s²)
        │
        ├─ Integration (gathers bias & noise over time)
        ▼
   Velocity (m/s)
        │
        ├─ Integration (quadratically accumulates error)
        ▼
   Position Error (Exploding Drift)
```

### 1.2 ISRO Core Requirements & Metrics
* **Automatic In-Vehicle Calibration:** Estimate phone-to-vehicle mounting matrix (pitch, roll, yaw) dynamically without manual user calibration.
* **AI-Based Speed & Vibration Signal Processing:** Extract forward motion velocity from noisy MEMS signals while filtering out non-kinematic noise (engine idle, road bumps).
* **Kinematic & Map Constraints:** Enforce Non-Holonomic Constraints (lateral/vertical velocity $v_y = v_z \approx 0$) and probabilistic road network map matching.
* **Seamless GNSS/INS Fusion:** Zero-delay transition between GNSS-aided and pure inertial dead reckoning (IDR) modes.
* **Edge Compatibility & Benchmark Target:** 
  * Position drift $< 10\%$ of distance traveled during GNSS outages (e.g., $< 5\text{ m}$ drift over $50\text{ m}$, $< 100\text{ m}$ drift over $1\text{ km}$).
  * Update frequency: 10 Hz for mobile smartphones; $\ge 200\text{ Hz}$ support for external FOG/MEMS units.

---

## 2. Benchmark Dataset: IO-VNBD

The project utilizes the **IO-VNBD** (Indoor-Outdoor Vehicle Navigation Benchmark Dataset):
* **Volume:** ~58 hours and over 4,400 km of real-world driving data.
* **Sensors Captured:** Multi-phone MEMS IMU, GNSS trajectories, and high-accuracy vehicle-side ground truth reference sensors.
* **Scenarios:** Urban traffic, roundabouts, high-speed highways, abrupt braking, aggressive maneuvers, and unpaved roads.

---

## 3. System Architecture & Proposed Solution

Our core philosophy is **Personalized Adaptive Inertial Navigation**. Instead of relying on a static, universal deep learning model that fails under unseen vehicle dynamics or mounting setups, we use a two-phase architecture:
1. **Base Model:** Pre-trained on extensive driving datasets (IO-VNBD + custom data) to learn generalized IMU-to-motion representations.
2. **Personalization Engine:** Adapts dynamically to the specific vehicle, phone mount, and vibration signature during GNSS-available driving periods.

```
                                    GNSS Signal
                                         │
                                         ▼
                                ┌─────────────────┐
                                │  GNSS Quality   │
                                │   Evaluator     │
                                └────────┬────────┘
                                         │
                                         ▼
RAW IMU ──────────────► ┌───────────────────────────────────┐
(Accel/Gyro/Mag)        │    Base IDR Neural Estimator      │
                        └────────────────┬──────────────────┘
                                         │
                                         ▼
                        ┌───────────────────────────────────┐
                        │    Online Personalization Engine  │
                        │  (Phone Align, Vehicle Dynamics,  │
                        │   Vibration Profile Modeling)     │
                        └────────────────┬──────────────────┘
                                         │
                                         ▼
                        ┌───────────────────────────────────┐
                        │   Personalized IDR Core Engine    │
                        └────────────────┬──────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     ┌───────────────────────┐                       ┌───────────────────────┐
     │ Vehicle State & NHC   │                       │ Dynamic Road Graph    │
     │ Physical Constraints  │                       │ Candidate Hypotheses  │
     └───────────┬───────────┘                       └───────────┬───────────┘
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         │
                                         ▼
                        ┌───────────────────────────────────┐
                        │     Neural Vehicle Shadow         │
                        │   (Sensor Consistency Check)      │
                        └────────────────┬──────────────────┘
                                         │
                                         ▼
                        ┌───────────────────────────────────┐
                        │    Adaptive RL Fusion Module      │
                        │  (Dynamic Covariance/Trust Weight)│
                        └────────────────┬──────────────────┘
                                         │
                                         ▼
                        ┌───────────────────────────────────┐
                        │ Estimated Position & Uncertainty  │
                        └───────────────────────────────────┘
```

---

## 4. Key Subsystem Specifications

### 4.1 Phase 1 — Generalized Base Model
* **Input:** Raw IMU buffer $\mathbf{X}_t \in \mathbb{R}^{W \times 6}$ (3-axis Accel + 3-axis Gyro window).
* **Target Output:** Vehicle forward speed $\hat{v}_k$, angular velocity vector $\hat{\boldsymbol{\omega}}_k$, motion state probabilities, and uncertainty variance $\sigma_v^2$.
* **Key Design:** Predicts **relative motion states and residual dynamics** rather than absolute latitude/longitude coordinates.

### 4.2 Phase 2 — Online Auto-Calibration & Personalization
When GNSS is healthy, the system executes continuous self-calibration:
* **Mount Alignment ($\mathbf{R}_{b}^{p}$):** Learns rotation matrix transforming Phone Frame ($p$) to Vehicle Body Frame ($b$) using vehicle acceleration vectors and cornering yaw rates.
* **Parameter Adaptation ($\boldsymbol{\theta}_{personal}$):** Fits vehicle acceleration/braking coefficients, sensor bias profiles, phone mount stability scores, and suspension vibration signatures.
* **GNSS as a Teacher:** Minimizes residual error $e(t) = \|\mathbf{x}_{GNSS}(t) - \mathbf{x}_{IDR}(t)\|$ to refine personalized weight parameters online without explicit offline retraining.

### 4.3 Vibration Intelligence & Signal Decoupling
Observed IMU acceleration $\mathbf{a}_{obs}(t)$ is decomposed into distinct physical sources:
$$\mathbf{a}_{obs}(t) = \mathbf{a}_{vehicle}(t) + \mathbf{a}_{pothole}(t) + \mathbf{a}_{engine}(t) + \mathbf{a}_{mount\_wobble}(t) + \boldsymbol{\eta}(t)$$
* High-frequency periodic signals $\rightarrow$ Engine RPM harmonics.
* High-amplitude impulsive spikes $\rightarrow$ Road anomalies (bumps/potholes).
* Low-frequency continuous signals $\rightarrow$ Vehicle longitudinal & lateral kinematics.
* Independent orientation shifts without vehicle yaw $\rightarrow$ Phone movement in holder (triggers instantaneous automatic recalibration state).

### 4.4 Neural Vehicle Shadow (Sensor Consistency Engine)
A forward generative network predicts expected IMU readings given a candidate vehicle path and road geometry:
$$\hat{\mathbf{S}}_{IMU}(t) = f_{shadow}\left(\mathbf{x}_{cand}(t), \mathbf{Road}_{geom}, \mathbf{R}_b^p\right)$$
The residual discrepancy $\|\hat{\mathbf{S}}_{IMU}(t) - \mathbf{S}_{IMU}(t)\|$ acts as an inverse consistency likelihood, pruning invalid map-matching candidate routes prior to position update.

### 4.5 Adaptive RL Fusion
An Reinforcement Learning (RL) agent monitors contextual indicators (vibration level, model uncertainty, GNSS HDOP/number of satellites, recent filter residuals, road graph density) to dynamically adjust trust weights across IMU dead reckoning, vehicle kinematic constraints, map topology, and returning GNSS signals.

### 4.6 Dynamic Road Corridor ("Minecraft Chunks" Map Engine)
* Loads bounding road graph networks dynamically as spatial tiles relative to heading vector and velocity.
* Unloads trailing graph sectors to conserve mobile device CPU/RAM while ensuring complex intersection topology is immediately available during sudden GNSS outages.

---

## 5. Dual-Path Demonstration ("Blue vs. Green") Architecture

To provide verifiable empirical proof during testing and SIH demonstrations:

```
[ Normal Driving (GNSS Active) ]
  ├── Green Path : Raw / Filtered GNSS Reference Trajectory
  └── Blue Path  : Pure Sensor-Only IDR Trajectory (GNSS disabled as input)
                  ▲
                  └─ Green and Blue paths converge during personalized online learning.

[ GNSS Outage Event (Tunnel / Urban Canyon / Simulated Drop) ]
  ├── Green Path : Drops / Freezes / Lost (X)
  └── Blue Path  : Continues seamlessly without interruption via Personalized IDR Engine.

[ GNSS Restoration ]
  └── Smooth Re-convergence: Blue path smoothly fuses with returning Green GNSS signals
      without visual jumps or teleportation.
```

---

## 6. Implementation & Verification Strategy

| Phase | Milestone | Description & Output |
| :--- | :--- | :--- |
| **Step 1** | **Physics Baseline** | Naive IMU double integration benchmark on IO-VNBD dataset. |
| **Step 2** | **Classical EKF/UKF + NHC** | Extended/Unscented Kalman Filter with Non-Holonomic Vehicle Constraints. |
| **Step 3** | **Base Learned Model** | Deep neural network predicting forward velocity and heading change from IMU windows. |
| **Step 4** | **Personalization Module** | Online adaptation engine adjusting parameters $\boldsymbol{\theta}_{personal}$ using GNSS reference. |
| **Step 5** | **Road Topology Constraints** | Graph-constrained map matching engine. |
| **Step 6** | **Neural Vehicle Shadow** | Sensor-consistency evaluation filter. |
| **Step 7** | **Adaptive RL Fusion** | RL policy tuning sensor covariance matrices dynamically. |
| **Step 8** | **Mobile Edge Deployment** | ONNX/TensorFlow Lite model export integrated into Android/iOS application UI. |

---

## 7. Key Research Questions & Technical Novelty

1. **Auto-Calibration:** Can the phone-to-vehicle transformation matrix be reliably computed within $<30$ seconds of normal city driving?
2. **Vibration Decoupling:** Does explicit vibration separation outperform traditional low-pass filtering in vehicle velocity estimation?
3. **Personalization Efficiency:** How much does vehicle-specific online adaptation reduce positional drift compared to a static base model?
4. **Sensor Consistency:** Can forward neural sensor prediction effectively eliminate false turn map-snapping during dense urban navigation?

---

*This document serves as the foundational technical baseline for the ISRO PS 26168 Intelligent Dead Reckoning project implementation.*
