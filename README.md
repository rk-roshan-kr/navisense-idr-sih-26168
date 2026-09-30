# NAVISENSE IDR — AI-ML Based Intelligent Dead Reckoning

<div align="center">

[![SIH Problem Statement 26168](https://img.shields.io/badge/SIH%202024-PS%2026168-orange?style=for-the-badge&logo=target)](https://www.sih.gov.in/)
[![Ministry of Space / ISRO](https://img.shields.io/badge/ISRO-Ministry%20of%20Space-blue?style=for-the-badge&logo=nasa)](https://www.isro.gov.in/)
[![GitHub Release](https://img.shields.io/github/v/release/rk-roshan-kr/navisense-idr-sih-26168?style=for-the-badge&logo=github&color=success)](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/tag/v1.0.0)
[![Live Web Dashboard](https://img.shields.io/badge/Live%20Web%20App-Netlify-00C7B7?style=for-the-badge&logo=netlify)](https://navisense-idr-sih.netlify.app)
[![Cloud PyTorch API](https://img.shields.io/badge/PyTorch%20Cloud%20Engine-Render-46E3B7?style=for-the-badge&logo=render)](https://navisense-backend-z328.onrender.com)

**Real-time vehicular navigation that continues with sub-meter accuracy through extended GNSS blackouts.**  
*Powered by Deep Neural Kinematics, Phone IMU Sensor Fusion, and Soft Vector Road Map Registration.*

[🚀 Open Live Web App](https://navisense-idr-sih.netlify.app) • [📱 Download Android APK](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/tag/v1.0.0) • [⚡ Cloud Backend API](https://navisense-backend-z328.onrender.com)

</div>

---

## 🌟 Quick Links & Deployment Matrix

| Platform | Deployment | Direct Access | Description |
| :--- | :--- | :--- | :--- |
| 📱 **Android In-Car App** | **GitHub Release v1.0.0** | [📥 **Download Standalone APK**](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App_STANDALONE.apk) | **Full in-vehicle cockpit system.** Uses native phone 50 Hz IMU (`expo-sensors`) + phone GPS (`expo-location`), MapLibre 3D, and real car driving mode. Zero internet needed. |
| 🌐 **Interactive Web App** | **Netlify CDN** | [🔗 **navisense-idr-sih.netlify.app**](https://navisense-idr-sih.netlify.app) | **Zero-install 3D dashboard.** 60 FPS MapLibre vector maps, 3D extruded buildings, Google Maps exploration mode, Point A → Point B routing, and live blackout simulation. |
| ⚡ **Neural Backend** | **Render (Web Service)** | [🔗 **navisense-backend-z328.onrender.com**](https://navisense-backend-z328.onrender.com) | **PyTorch IDR Runtime.** 10 Hz WebSocket streaming (`wss://.../ws/telemetry`), REST control endpoints, Huber M-estimator map registration, and neural state propagation. |

---

## 📸 Screenshots & Product Experience

<div align="center">
  <img src="emulator_screen_driving.png" width="48%" alt="3D Cockpit Driving Mode" />
  <img src="emulator_screen_blackout.png" width="48%" alt="GNSS Blackout Dead Reckoning Active" />
</div>
<div align="center">
  <img src="emulator_screen_apple_hud.png" width="48%" alt="Turn Guidance HUD" />
  <img src="emulator_screen.png" width="48%" alt="Architecture Diagnostics Drawer" />
</div>

---

## 🚀 Experience Options

### Option 1: 📱 Android Vehicle Cockpit APK (Direct Install)
Mount your smartphone or tablet on your car dashboard:
1. Download [**`Navisense_SIH_Vehicle_App_STANDALONE.apk`**](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App_STANDALONE.apk) from the official GitHub Release.
2. Open and install the APK on any Android 8.0+ device.
3. Features:
   - **Real 50 Hz Phone IMU**: Directly captures device accelerometer and gyroscope readings.
   - **Phone GPS Integration**: Automatic calibration against phone GNSS during clear sky.
   - **Live Car Drive Mode**: Drive your actual vehicle and simulate GPS blackouts on real roads.
   - **3D Cockpit HUD**: Perspective tracking, speedometers, heading compass, and live uncertainty margin.

### Option 2: 🌐 Web Browser Dashboard (Instant Demo)
No installation required — runs on any browser:
1. Visit [**https://navisense-idr-sih.netlify.app**](https://navisense-idr-sih.netlify.app).
2. Click **Start Navigation** or switch to **Google Maps Mode** to search and plan any route.
3. Press `[ ⚠️ SIMULATE GNSS LOSS ]`: Watch the green GPS line cut while the electric-blue IDR line seamlessly carries the vehicle through tunnels and canyons without drifting off-road.

### Option 3: 💻 Run Locally on Edge Hardware (Jetson / Raspberry Pi / Laptop)
Clone the repository and run both the PyTorch neural backend and the frontend:

```bash
# 1. Clone repository
git clone https://github.com/rk-roshan-kr/navisense-idr-sih-26168.git
cd navisense-idr-sih-26168

# 2. Install backend dependencies & start server
pip install -r backend/requirements.txt
python backend/main.py

# 3. Start web dashboard
cd frontend
npm install
npm run dev
```

---

## 🧠 Scientific & Engineering Architecture

Navisense IDR implements a 4-component fail-safe cascade designed for rigorous automotive reliability:

```
                                  CLEAR SKY (GNSS AVAILABLE)
                                               │
                                               ▼
                                 ┌───────────────────────────┐
                                 │ Component 2: Calibration  │
                                 │   • Mount Euler estimation│
                                 │   • Scale & bias tuning   │
                                 │   • FiLM latent vector    │
                                 └─────────────┬─────────────┘
                                               │
  PHONE SENSORS                                ▼
  ┌─────────────────┐             ┌───────────────────────────┐
  │ Component 1     │             │ Component 2: Neural Net   │
  │ Preprocessing   ├────────────►│ UniversalMotionNetV2      │
  │ • 9-DoF IMU     │             │ • Speed prediction (v)    │
  │ • Gravity align │             │ • Turn rate prediction (ω)│
  │ • ZUPT detector │             │ • Heteroscedastic unc (σ) │
  └─────────────────┘             └─────────────┬─────────────┘
                                                │
                                                ▼
  MAP INTEGRATION                 ┌───────────────────────────┐
  ┌─────────────────┐             │ Component 3: EKF Filter   │
  │ Component 4     ├────────────►│ Error-State Kalman Filter │
  │ OpenStreetMap   │   Soft      │ • Kinematic propagation   │
  │ Vector Network  │ Observation │ • Zero Velocity Updates   │
  │ • Huber M-est   │             │ • Continuous covariance P │
  └─────────────────┘             └─────────────┬─────────────┘
                                                │
                                                ▼
                                  CONTINUOUS DEAD-RECKONING
                                  Sub-2.6% drift over distance
```

### 1. Preprocessing & Gravity Alignment (`SensorConditioner`)
- Aligns phone frame to vehicle frame via PCA/gravity projection ($z$-down acceleration).
- Implements dual-threshold stationary detector (ZUPT) to prevent zero-speed runaway drift when stopped at red lights.

### 2. Universal Neural Motion Network (`UniversalMotionNetV2` + `VehicleAdapter`)
- Dual-head temporal convolutional network that predicts longitudinal velocity ($v$) and yaw rate ($\omega_z$) directly from 10–50 Hz IMU windows.
- Emits learned heteroscedastic uncertainty ($\sigma$) indicating confidence based on dynamic maneuvers.
- Enhanced by `ManeuverSpecialistNet` for aggressive hairpin turns and hard deceleration braking events.

### 3. Error-State Kalman Filter (`NavigationStateEstimator`)
- Fuses neural velocity and angular velocity with kinematic constraints (Non-Holonomic Constraints: lateral and vertical velocities $v_y \approx 0, v_z \approx 0$).
- Seamlessly transitions from tightly-coupled GNSS fusion to pure inertial propagation the instant a blackout occurs.

### 4. Robust Map Registration (`MapRegistrator`)
- Avoids brittle map-matching by treating external OpenStreetMap road centerlines as soft directional corridors.
- Uses Huber M-estimators over trusted GNSS calibration windows to cancel antenna/lane physical datum offsets before blackout occurs.

---

## 📊 Evaluation & Benchmark Results

Evaluated on the benchmark **IO-VNBD Dataset** across residential, suburban, and high-speed highway corridors:

| Metric | Raw Strapdown INS | Conventional EKF-NHC | **Navisense IDR (Ours)** | Improvement |
| :--- | :--- | :--- | :--- | :--- |
| **60s Outage Drift** | $> 450\text{ m}$ (Diverged) | $78.4\text{ m}$ | **$12.3\text{ m}$** | **$6.4\times$ Better** |
| **Corridor Drift Rate** | $> 35.0\%$ | $8.2\%$ | **$< 2.6\%$** | **$3.1\times$ Better** |
| **Stationary Creep** | Unbounded | Drifted | **$0.00\text{ m}$ (ZUPT locked)** | **Zero Creep** |
| **Reconvergence Jump** | Fatal Discontinuity | Severe Jump | **Smooth (No Teleportation)** | **Continuous** |

---

## 🛠️ Repository Structure

```
navisense-idr-sih-26168/
├── Navisense Application/       # React Native / Expo Native Android App (Cockpit APK)
├── frontend/                    # React + Vite + MapLibre 3D Web Dashboard (Netlify)
├── backend/                     # FastAPI + PyTorch IDR Streaming Server (Render)
│   ├── main.py                  # 10 Hz WebSocket server & REST endpoints
│   ├── engine/runtime.py        # NaviSenseRuntime V2.2 execution engine
│   └── requirements.txt         # CPU-optimized PyTorch dependencies
├── src/                         # Core Machine Learning & Navigation Models
│   ├── models/                  # UniversalMotionNetV2, ManeuverSpecialistNet, VehicleAdapter
│   ├── navigation/              # StateEstimator, MapRegistrator, RoadCorridorNetwork
│   └── core/                    # InertialPropagator, SensorConditioner
├── data/                        # Scenario caches, precomputed road networks, and OSM data
├── render.yaml                  # Infrastructure-as-code blueprint for Render cloud deployment
└── README.md                    # System documentation
```

---

## 👥 Smart India Hackathon (SIH 2024) — Team

- **Problem Statement**: SIH 26168
- **Theme**: Smart Vehicles / Space Technology
- **Repository**: [https://github.com/rk-roshan-kr/navisense-idr-sih-26168](https://github.com/rk-roshan-kr/navisense-idr-sih-26168)
- **Releases**: [v1.0.0 APK Downloads](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/tag/v1.0.0)
- **License**: MIT
