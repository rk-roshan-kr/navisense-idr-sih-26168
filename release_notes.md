# Navisense IDR v1.0.0 — Official SIH 26168 Release

Production-grade AI/ML vehicular dead-reckoning navigation system developed for Smart India Hackathon (Problem Statement 26168 — Ministry of Space / ISRO).

---

### Included Release Assets (Direct Download)

| Asset | Description | Size | Platform |
| :--- | :--- | :--- | :--- |
| **[`Navisense_SIH_Vehicle_App_STANDALONE.apk`](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App_STANDALONE.apk)** | **Official Standalone In-Vehicle Cockpit APK.** Fully standalone out of the box with zero external dependencies. Features real phone 50 Hz IMU sensors (`expo-sensors`), high-precision phone GPS (`expo-location`), MapLibre 3D Vector Map, HUD, audio/spoken cues, tap-on-map route planner, and live GPS blackout simulation. | ~151 MB | Android 8.0+ |
| **[`Navisense_SIH_Vehicle_App.apk`](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App.apk)** | **Standard Release APK.** Identical unified production binary with full standalone support and optional live telemetry backend streaming. | ~151 MB | Android 8.0+ |

---

### Live Web Application & Cloud API

- **Live Web Dashboard**: [https://navisense-idr-sih.netlify.app](https://navisense-idr-sih.netlify.app)  
  *Experience 3D MapLibre navigation, custom A to B routing, Google Maps exploration mode, and live GPS blackout injection right in your browser (desktop and mobile).*
- **Live PyTorch IDR Backend (Render)**: [https://navisense-backend-z328.onrender.com](https://navisense-backend-z328.onrender.com)  
  *Real-time 10 Hz WebSocket streaming PyTorch neural state estimation (`wss://navisense-backend-z328.onrender.com/ws/telemetry`).*

---

### Core Features & Highlights

1. **Unified Standalone Architecture**:
   - High-frequency on-device kinematic and dead-reckoning engine running 100% locally.
   - Real-time PyTorch Universal Motion Net (`UniversalMotionNetV2` + `ManeuverSpecialistNet` + `VehicleAdapter`) with learned uncertainty estimation.
2. **Seamless GPS Outage Handling**:
   - Sub-meter accuracy during normal driving.
   - Sub-2.6% drift over extended GNSS signal loss (tunnels, dense urban canyons, flyovers).
   - Reconverges smoothly upon GPS signal restoration without jumping or spiderweb artifacts.
3. **Turn-by-Turn 3D Cockpit & Google Maps Mode**:
   - 3D perspective camera with real-time heading rotation and 3D extruded building models.
   - Full Google Maps exploration mode with preset corridors, custom tap-on-map pins, and instant transition into driving mode.
4. **Hardware-In-The-Loop Diagnostics**:
   - Live sensor watchdog, Huber M-estimator map registration, and fault-injection lab directly accessible via the settings drawer.
5. **Production Pre-Release Verification Pipeline**:
   - Built and validated with our 7-gate CI/CD pipeline verifying TypeScript strict types, zero-emoji compliance, sensor contracts, and native DEX bytecode integrity.

---

### How to Install the APK on Android

1. Download either **`Navisense_SIH_Vehicle_App_STANDALONE.apk`** or **`Navisense_SIH_Vehicle_App.apk`** to your Android device.
2. Tap the downloaded file to install (allow *"Install from unknown sources"* if prompted).
3. Open **Navisense** and mount the phone on your car dashboard!
