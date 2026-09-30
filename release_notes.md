# Navisense IDR v1.0.0 — Official SIH 26168 Release

🚀 **Production-grade AI/ML vehicular dead-reckoning navigation system developed for Smart India Hackathon (Problem Statement 26168 — Ministry of Space / ISRO).**

---

### 📦 Included Release Assets (Direct Download)

| Asset | Description | Size | Recommended For |
| :--- | :--- | :--- | :--- |
| **[`Navisense_SIH_Vehicle_App_STANDALONE.apk`](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App_STANDALONE.apk)** | **Full Standalone Android Vehicle Cockpit APK.** Works out of the box with zero external dependencies. Features real phone 50 Hz IMU sensors (`expo-sensors`), phone GPS (`expo-location`), MapLibre 3D Vector Map, HUD, and live GPS blackout simulation. | ~152 MB | **Real Car Drives, In-Vehicle Tablets & Phone Mounts** |
| **[`Navisense_SIH_Vehicle_App.apk`](https://github.com/rk-roshan-kr/navisense-idr-sih-26168/releases/download/v1.0.0/Navisense_SIH_Vehicle_App.apk)** | Client-Server APK build. Can stream from onboard edge vehicle computers (Raspberry Pi / Jetson) or our live PyTorch cloud backend. | ~152 MB | **Edge Hardware Testbenches & Telemetry Streaming** |

---

### 🌐 Live Web Application & Cloud API

- 🖥️ **Live Web Dashboard**: [https://navisense-idr-sih.netlify.app](https://navisense-idr-sih.netlify.app)  
  *Experience 3D MapLibre navigation, custom A→B routing, Google Maps exploration mode, and live GPS blackout injection right in your browser (desktop & mobile).*
- ⚡ **Live PyTorch IDR Backend (Render)**: [https://navisense-backend-z328.onrender.com](https://navisense-backend-z328.onrender.com)  
  *Real-time 10 Hz WebSocket streaming PyTorch neural state estimation (`wss://navisense-backend-z328.onrender.com/ws/telemetry`).*

---

### ✨ Core Features & Highlights

1. **Dual-Engine Fail-Safe Architecture**:
   - High-frequency on-device kinematic and dead-reckoning engine running 100% locally.
   - Real-time PyTorch Universal Motion Net (`UniversalMotionNetV2` + `ManeuverSpecialistNet` + `VehicleAdapter`) with learned uncertainty estimation.
2. **Seamless GPS Outage Handling**:
   - Sub-meter accuracy during normal driving.
   - Sub-2.6% drift over extended GNSS signal loss (tunnels, dense urban canyons, flyovers).
   - Reconverges instantly upon GPS signal restoration without jumping or spiderweb artifacts.
3. **Turn-by-Turn 3D Cockpit & Google Maps Mode**:
   - 3D perspective camera with real-time heading rotation and 3D extruded building models.
   - Full Google Maps exploration mode with search, preset corridors, and instant transition into driving mode.
4. **Hardware-In-The-Loop Diagnostics**:
   - Live sensor watchdog, Huber M-estimator map registration, and fault-injection lab directly accessible via the settings drawer.

---

### 📲 How to Install the APK on Android

1. Download **`Navisense_SIH_Vehicle_App_STANDALONE.apk`** to your Android device.
2. Tap the downloaded file to install (allow *"Install from unknown sources"* if prompted).
3. Open **Navisense** and mount the phone on your car dashboard!
