# SIH 26168 — AI-ML Based Intelligent Dead Reckoning System (Prototype 101)

> **Problem Statement ID:** PS 26168 (ISRO / Department of Space)  
> **Theme:** Smart Vehicles / Seamless Navigation  
> **Core Concept:** Smartphone-only vehicular dead reckoning using a universal motion neural representation rapidly personalized to specific vehicle dynamics and phone mounting orientation during GNSS availability.

---

## 1. Repository Architecture

The codebase is organized into modular packages to separate kinematics, baseline estimators, neural models, dataset loaders, experimental analysis, and the mobile test console:

```text
SIH prototype/
├── index.html                    # Mobile-first interactive test console (OLED Dark UI)
├── css/
│   └── style.css                 # High-contrast tactile dark mode stylesheet
├── js/
│   ├── app.js                    # UI coordinator & 5-scene SIH live demo controller
│   ├── idr_engine.js             # 60fps client-side math engines (B1, B2, B4, B5)
│   ├── map_canvas.js             # 60fps trajectory canvas & grid renderer
│   ├── chart_renderer.js         # Real-time drift & 6-axis IMU oscilloscope
│   ├── scenario_player.js        # IO-VNBD dataset playback & DeviceMotion streamer
│   └── iovnbd_benchmark_data.json# Exported empirical evaluation logs
│
├── src/                          # Modular Python Backend
│   ├── __init__.py               # Top-level package re-exports
│   │
│   ├── core/                     # Kinematics & Modular IDR Engine
│   │   ├── coordinate_frames.py  # Geodetic (WGS84) to ENU Cartesian, DCM, & gravity
│   │   ├── idr_core.py           # Decoupled 8-component Modular IDR Engine
│   │   ├── personalization.py    # Online Personalization State Engine (R_b^p, ba, bg)
│   │   └── personalized_idr.py   # Baseline B5: Personalized IDR implementation
│   │
│   ├── baselines/                # Benchmark Comparison Ladder
│   │   ├── ins_physics.py        # Baseline B1: Raw Strapdown INS double integration
│   │   ├── ekf_nhc.py            # Baseline B2: 15-state Error-State EKF + NHC + ZUPT
│   │   ├── base_idr.py           # Baseline B4: Base Learned IDR model
│   │   └── map_match.py          # Baseline B3: Map-constrained road projection
│   │
│   ├── models/                   # Deep Learning & Sensor Perturbations
│   │   ├── nn_models.py          # PyTorch UniversalMotionNet & PersonalizationAdapter
│   │   └── robustness_augmenter.py # Sensor noise, bias drift, harmonics & tilt jitter
│   │
│   ├── data/                     # Data Ingestion & Caching
│   │   └── iovnbd_loader.py      # Zero-dependency IO-VNBD CSV parser & stream loader
│   │
│   ├── analysis/                 # Evaluation & Forensic Diagnostics
│   │   ├── metrics.py            # E_end, Drift%, E_max, Along-track & Cross-track error
│   │   ├── blackout.py           # GNSS outage generator (10s, 30s, 60s, 500m)
│   │   └── error_forensics.py    # Sensor error source decomposition (tilt, bias, noise)
│   │
│   └── pipelines/                # Executable Benchmark & Research Scripts
│       ├── run_experiment.py     # End-to-end benchmark on held-out IO-VNBD routes
│       └── train_and_evaluate.py # Multi-vehicle Leave-One-Vehicle-Out research pipeline
│
├── data/
│   └── IO-VNBD/                  # Official ISRO IO-VNBD synchronized dataset
│
├── experiments/
│   ├── figures/                  # Publication-ready CDF curves & error growth plots
│   ├── models/                   # Trained PyTorch neural network checkpoints (.pt)
│   └── results/                  # Benchmark JSON evaluation logs
│
└── docs/                         # Technical Documentation & Presentation Guides
    ├── PROBLEM_STATEMENT_AND_SOLUTION.md  # Master problem breakdown & solution design
    ├── PROTOTYPE_101.md                   # Prototype developer & architecture guide
    ├── RESEARCH_PIPELINE.md               # Multi-vehicle deep learning research report
    ├── EXPERIMENT_PROTOCOL.md             # Scientific evaluation & blackout protocol
    └── SIH_DEMO_GUIDE.md                  # 5-Scene Live Demo Script for Jury Presentation
```

---

## 2. Quick Start & Execution

### Launch the Interactive Web Console
Open [index.html](file:///d:/SIH%20prototype/index.html) directly in any modern browser (or serve locally):
```bash
python -m http.server 8080
```
Navigate to `http://localhost:8080` to experience the 5-Scene SIH live demo, simulate 10s/30s/60s blackouts, or stream live smartphone motion data.

### Run the Benchmark Experiment
```bash
python src/pipelines/run_experiment.py
```

### Run Multi-Vehicle Deep Learning Training
```bash
python src/pipelines/train_and_evaluate.py
```
