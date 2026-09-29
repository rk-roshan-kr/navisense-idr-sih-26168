# NaviSense NIDR — Smart India Hackathon (SIH 26168)
## Fault-Tolerant Vehicle Dead Reckoning Mobile Application

A commercial-grade React Native vehicle navigation application designed as a **fault-tolerant state machine with explicit failure handling**.

---

### Core Architectural Principle

> **React Native renders the navigation experience. Native mission core owns every function that must continue working when the screen, JS runtime, network, or GNSS fails.**

```text
                    React Native UI
                         │
                  read-only telemetry
                         │
                         ▼
              ┌─────────────────────┐
              │ Native Mission Core │
              └──────────┬──────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
     GNSS/Net          IMU/NIDR        Route/Map
        │                │                │
        └────────────────┼────────────────┘
                         ▼
             State / Supervisory Engine
             (Watchdog + OutputValidator)
                         │
                         ▼
                  Navigation State
                         │
                         ▼
                   React Native UI
```

---

### 1. Decoupled Independent State Machines

The application avoids single monolithic states by separating the system into independent state machines:

1. **Navigation State**: `IDLE` ➔ `PRECHECK` ➔ `ROUTE_READY` ➔ `NAVIGATING` ➔ `ARRIVED`
2. **Position Source**: `GNSS` ➔ `GNSS_DEGRADED` ➔ `NIDR` ➔ `GNSS_REACQUIRED` ➔ `FUSED`
3. **Model Health**: `NOT_LOADED` ➔ `LOADING` ➔ `READY` ➔ `RUNNING` ➔ `INVALID`
4. **Map State**: `ONLINE` ➔ `CACHED` ➔ `PARTIAL` ➔ `UNAVAILABLE`
5. **Vehicle Motion State**: `STATIONARY` (ZUPT Active) • `MOVING` • `ACCELERATING` • `BRAKING` • `TURNING` • `REVERSING` • `IRREGULAR` (Potholes/Rough Road)

---

### 2. Pre-Flight Safety Verification Sequence

Before navigation begins, tapping **START NAVIGATION** triggers a pre-flight safety check:
- **Location Hardware Access**: Precise GNSS permission (`ACCESS_FINE_LOCATION`)
- **Inertial Sensor Suite (IMU)**: 3-Axis Accel, Gyro & Gravity producing valid 10 Hz stream
- **Universal Motion Net & Schema**: Conv1D-ResNet + BiGRU weights loaded and verified
- **Offline Road Corridor Cache**: Vector road corridor pre-cached in memory
- **Initial Geodetic Anchor**: Valid WGS84 origin coordinate and heading locked
- **Storage Buffer**: Working set memory verified ($28.4\text{ KB} \ll 50\text{ MB}$)

---

### 3. Supervisory Layer & Watchdog Safety

```text
                 NIDR
                  │
             ┌────▼────┐
             │ Output  │
             │Validator│ (Physical range & innovation gate)
             └────┬────┘
                  │
             ┌────▼────┐
             │ Sensor  │
             │Watchdog │ (Monotonic time, jitter, >200ms drop detector)
             └────┬────┘
                  │
        ┌─────────▼─────────┐
        │ Navigation State  │
        │    Supervisor     │ (GNSS / FUSED / NIDR / DEGRADED)
        └───────────────────┘
```

- **Sensor Watchdog** ([sensorWatchdog.ts](file:///d:/SIH%20prototype/Navisense%20Application/src/engine/sensorWatchdog.ts)): Uses monotonic `elapsed_realtime_nanos` to protect against clock shifts, detects frame drops, and flags hardware freezes.
- **Output Validator** ([outputValidator.ts](file:///d:/SIH%20prototype/Navisense%20Application/src/engine/outputValidator.ts)): Enforces physical bounds ($0 \le v \le 65\text{ m/s}$, $|\omega| \le 1.5\text{ rad/s}$), rejects `NaN`/`Inf`, and uses a **$25\text{ m}$ Kalman Innovation Gate** to discard implausible multipath GNSS jumps.
- **Navigation Supervisor** ([navigationSupervisor.ts](file:///d:/SIH%20prototype/Navisense%20Application/src/engine/navigationSupervisor.ts)): Synthesizes inputs into authoritative position states (`GNSS`, `NIDR`, `DEGRADED`).

---

### 4. Developer Failure Lab & Fault Injection

The **5 MODULES** slide-up drawer contains an interactive **Failure Lab**:

#### On-Demand Fault Injections:
- **GNSS Faults**: `Normal Fix` • `Blackout` • `Jump +20m` • `Degraded ±25m`
- **Network States**: `Online Cellular` • `Airplane Mode (Offline Cache)`
- **Sensor Faults**: `Healthy 10 Hz` • `Drop Gyro (>200ms)` • `Timestamp Gap`

#### Automated Multi-Phase Evaluation Scenarios:
- **Scenario A**: Tunnel Outage & Smooth Recovery (Normal ➔ 60s Outage ➔ 3.5s Reconvergence)
- **Scenario B**: Hard Braking ➔ ZUPT Zero-Velocity Stop ➔ Outage
- **Scenario C**: Cellular Network Loss (Offline cached route & vector tiles continue)
- **Scenario D**: Airplane Mode (Simultaneous GNSS and Cellular outage)
- **Scenario E**: Y-Junction / Elevated Flyover Ambiguity Resolution
- **Scenario F**: Phone Mount Slip & Dynamic SO(3) Recalibration

---

### 5. Running the Application

```powershell
cd "d:\SIH prototype\Navisense Application"
npx expo start
```

- Press **`w`** for immediate web browser testing.
- Press **`a`** to launch on an Android device or emulator.
- Scan the terminal QR code with **Expo Go** on a smartphone.
