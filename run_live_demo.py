"""
Navisense IDR - Live Prototype Launcher
Starts the real PyTorch IDR backend and serves the high-impact live navigation interface.

Usage:
  python run_live_demo.py
  Then open: http://127.0.0.1:8000
"""

import sys, webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import uvicorn

def main():
    print("="*75)
    print("  NAVISENSE IDR — INTELLIGENT DEAD RECKONING | LIVE DEMO PROTOTYPE")
    print("  SIH Problem Statement 26168")
    print("="*75)
    print("\n  [1] Starting PyTorch Navigation Engine...")
    print("  [2] Mounting real-time WebSocket telemetry at ws://127.0.0.1:8000/ws/telemetry")
    print("  [3] Serving minimalist live HUD interface at http://127.0.0.1:8000\n")
    print("  Demo Instructions (The 30-Second Judge Flow):")
    print("    1. Open http://127.0.0.1:8000 in your browser.")
    print("    2. Vehicle drives following the emerald green GNSS trail.")
    print("    3. Click [ SIMULATE GNSS LOSS ]:")
    print("       - Green line freezes.")
    print("       - Alert flashes: GNSS SIGNAL LOST — NAVISENSE IDR ACTIVE.")
    print("       - Electric blue trail continues driving forward seamlessly!")
    print("    4. Click [ TECHNICAL PROOF ] in the bottom right corner to show the judge:")
    print("       - Live 10 Hz IMU physical readouts.")
    print("       - Neural network predicted velocity and yaw rate.")
    print("       - Map hypothesis probability and ACCEPTED / REJECTED badge.")
    print("    5. Click [ RESTORE GNSS SIGNAL ]:")
    print("       - Green line resumes with smooth reconvergence (zero teleportation).\n")
    print("="*75 + "\n")

    # Start FastAPI server on port 8000
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, log_level="info")

if __name__ == "__main__":
    main()
