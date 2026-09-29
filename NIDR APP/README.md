# NaviSense IDR Mobile Prototype (Internal Round)

> **NaviSense IDR**: Real Native Android Application (React Native + Kotlin Native Hardware Layer)  
> **Purpose**: Physical proof-of-concept and dataset generator for the internal round (pedestrian motion), testing the core Intelligent Dead Reckoning (IDR) engine before vehicular adaptation.

---

## 1. System Architecture

```text
                             NAVISENSE IDR APP
                                     │
                   ┌─────────────────┴─────────────────┐
                   ▼                                   ▼
             REACT NATIVE                        NATIVE ANDROID
           (TypeScript / UI)                    (Kotlin / Hardware)
                   │                                   │
      ┌────────────┼────────────┐         ┌────────────┼────────────┐
      ▼            ▼            ▼         ▼            ▼            ▼
   Screens      MapLibre     Zustand   Foreground     Sensors      GNSS
 (Collect/Test) (Offline)    Stores     Service      (50-100Hz)  (Location)
      │            │            │         │            │            │
      └────────────┼────────────┘         │            ▼            ▼
                   │                      │      Buffered Native I/O
                   ▼                      │      (Direct to Storage)
           Throttled Telemetry            │       ├── metadata.json
              (5 - 10 Hz)                 │       ├── imu_canonical.csv
                                          │       └── gnss_canonical.csv
                                          ▼                     │
                                     IDR Engine                 │
                                  (Kinematic Core /             │
                                  ExecuTorch-Ready) ◄───────────┘
```

### Core Invariants:
1. **Real Native Android App**: Generates a standard APK; no browser or PWA dependencies.
2. **Zero JS Bridge Congestion**: Android `SensorManager` runs on a dedicated background `HandlerThread` bound to an Android `ForegroundService` with `WAKELOCK`. Raw samples write directly to `imu_canonical.csv` via buffered native I/O. Only throttled (10 Hz) telemetry crosses the bridge for UI dials and waveforms.
3. **Dual Monotonic & Wall Clock**: Every sensor event logs both `elapsed_realtime_nanos` and `unix_time_ms`, aligned at session initialization for inter-device sync.
4. **Strict Programmatic Blackout**: At blackout trigger, software immediately halts location provider callbacks, disconnects BLE, and routes ONLY onboard IMU to `IdrEngineCore`.
5. **Independent Reference GNSS**: Comparisons are measured against the reference phone's GNSS (internal pedestrian target: $<20\%$ drift over $\sim 40\text{ m}$; SIH vehicle target: $<10\%$ drift).

---

## 2. Operational Modes

### Mode 1: COLLECT DATA (Single Phone)
* Used by participants to contribute independent recordings on various Android devices.
* Records synchronized timestamped IMU (Accel, Gyro, Gravity, Rotation Vector, Magnetometer) and GNSS fixes.
* Outputs session archives (`session_col_YYYYMMDD_HHMMSS/`) for workstation GPU training.

### Mode 2: TEST IDR (Two-Phone Setup)
* **Phone A (Reference Phone)**: Continuously records GNSS as the independent reference trajectory.
* **Phone B (IDR Test Phone)**:
  1. *Acquires Lock*: Obtains high-accuracy GNSS fix.
  2. *Freezes Anchor*: Locks $P_0 = [\text{lat}_0, \text{lon}_0]$, $\psi_0$, and initial velocity.
  3. *Trigger Blackout*: Programmatically shuts off GNSS and BLE. Dead-reckoning engine propagates state from local IMU.
  4. *Restore GNSS*: Ends blackout, gathers trajectory, and computes scientific scorecard against the reference path.

---

## 3. Canonical Data Schema

Stored in `sessions/session_<role>_<timestamp>/`:

### `metadata.json`
```json
{
  "sessionId": "session_col_20260920_143022",
  "role": "COLLECT",
  "deviceModel": "Google Pixel 7 Pro",
  "androidVersion": "Android 14 (API 34)",
  "participant": "Contributor_1",
  "movementMode": "Walking",
  "startElapsedRealtimeNanos": 1726815622000000,
  "startUnixTimeMs": 1726815622000,
  "requestedRateHz": 100,
  "actualRateHz": 98.6,
  "imuSampleCount": 18450,
  "gnssSampleCount": 184
}
```

### `imu_canonical.csv`
```csv
timestamp_elapsed_nanos,timestamp_unix_ms,ax,ay,az,gx,gy,gz,gravity_x,gravity_y,gravity_z,rot_qx,rot_qy,rot_qz,rot_qw,mag_x,mag_y,mag_z,accuracy
1726815622010000,1726815622010,0.12,9.81,0.05,0.001,-0.002,0.005,0.01,9.80,0.02,0.01,0.02,0.707,0.707,24.1,-12.3,-45.2,3
```

### `gnss_canonical.csv`
```csv
timestamp_elapsed_nanos,timestamp_unix_ms,lat,lon,alt,speed_mps,bearing_deg,accuracy_m
1726815622100000,1726815622100,28.613939,77.209021,216.5,1.25,84.2,3.1
```

---

## 4. Verification & Type Checking

To verify the TypeScript contracts and application code:

```bash
cd "d:/SIH prototype/NIDR APP"
npm run typecheck
```
