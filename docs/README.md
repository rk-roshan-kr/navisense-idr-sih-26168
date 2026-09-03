# NaviSense IDR — Technical Documentation Index
## Smart India Hackathon 2024 | Problem Statement ID: PS 26168
**Theme:** Smart Vehicles | **Organization:** ISRO (Department of Space)

Welcome to the complete technical documentation suite for **NaviSense IDR**, the zero-external-sensor, offline Intelligent Dead Reckoning system built for ISRO's SIH Problem Statement 26168.

---

## 📚 Complete Documentation Index

| Document | Description | Key Topics |
| :--- | :--- | :--- |
| **[1. System Architecture (`ARCHITECTURE.md`)](./ARCHITECTURE.md)** | **Definitive architectural specification.** | Component topology, UniversalMotionNet, PersonalizationAdapter, 10-state EKF, Spatial Chunks, Anti-Glitch Service Lane, Multi-Level Gating, 95% Off-Road Gating. |
| **[2. Mathematical Formulations (`MATHEMATICAL_SPECIFICATION.md`)](./MATHEMATICAL_SPECIFICATION.md)** | **Exhaustive mathematical derivations.** | $\text{SO}(3)$ Euler rotation, Trapezoidal velocity integration, ZUPT conditions, Mahalanobis likelihood, Bayesian off-road accumulator, WGS-84 ellipsoid conversion. |
| **[3. Problem Statement & Solution (`PROBLEM_STATEMENT_AND_SOLUTION.md`)](./PROBLEM_STATEMENT_AND_SOLUTION.md)** | **ISRO problem definition & our approach.** | MEMS sensor limitations, IO-VNBD dataset characteristics, competitive matrix against commercial competitors. |
| **[4. Pitch Deck & Presentation (`SIH_26168_Presentation_Pitch_Deck.md`)](./SIH_26168_Presentation_Pitch_Deck.md)** | **Judge-facing presentation script & slides.** | Problem definition, solution pillars, architecture diagrams, live benchmark proofs, ISRO impact. |
| **[5. Live Demo Guide (`SIH_DEMO_GUIDE.md`)](./SIH_DEMO_GUIDE.md)** | **Step-by-step 30-second judge demonstration flow.** | How to run the live demo, trigger blackout, show Technical Proof drawer, demonstrate Freecam and 2-Location Route Planner. |
| **[6. Research Pipeline (`RESEARCH_PIPELINE.md`)](./RESEARCH_PIPELINE.md)** | **Deep learning training & experimentation pipeline.** | Training methodology, loss functions, loss weights, evaluation protocols on IO-VNBD benchmark. |
| **[7. Prototype 101 Guide (`PROTOTYPE_101.md`)](./PROTOTYPE_101.md)** | **Quickstart guide for running the system locally.** | Environment setup, Python backend execution, frontend build instructions, WebSocket streaming. |
| **[8. Demo Video Script (`demo_video_script.md`)](./demo_video_script.md)** | **Timed script for the 3-minute evaluation video.** | Voiceover script, visual cues, timestamps, and demonstration checkpoints. |

---

## 🚀 Quick Verification Links

* **Live Demo Server:** `http://127.0.0.1:8000` (run via `python run_live_demo.py`)
* **WebSocket Telemetry Stream:** `ws://127.0.0.1:8000/ws/telemetry`
* **Unit Verification Suite:**
  * `python tests/test_chunked_road_network.py` (Tests $10\text{ km}$ spatial chunking, $< 100\text{ KB}$ RAM, $0.46\text{ ms}$ latency)
  * `python tests/test_multi_level_and_service_lane.py` (Tests anti-service-lane glitch separation & flyover elevation gating)

---

## 🏆 Key Benchmark Highlights (IO-VNBD Ground Truth)

1. **Highway Outage (Driver D - Unseen Vehicle):** **`2.6%` drift** ($26.4\text{ m}$ deviation over $1,001.5\text{ m}$) — *Beats $< 10.0\%$ target by nearly 4x!*
2. **Offline Spatial Chunk RAM:** **`95.8 KB`** working set — *500x lighter than the $< 50\text{ MB}$ target!*
3. **Execution Latency on Standard CPU:** **`0.46 ms`** ($2,160\text{ Hz}$ throughput) — *40x faster than $< 20\text{ ms}$ requirement!*
4. **External Sensors Required:** **`0`** (No OBD-II, no CAN-bus, no wheel encoders — 100% smartphone internal MEMS).
