"""
Integration test for Navisense IDR Runtime & Telemetry Stream.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.engine.runtime import NaviSenseRuntime

def test_runtime():
    print("="*60)
    print("  TESTING NAVISENSE RUNTIME & REAL PYTORCH PIPELINE")
    print("="*60)

    rt = NaviSenseRuntime(device="cpu")
    print(f"Loaded scenario: {rt.current_scenario_id}")
    print(f"Total steps available: {rt.total_steps}")
    print(f"Current step after adaptation: {rt.current_step}")

    # Run 10 steps with GNSS Available
    print("\nSimulating 10 steps with GNSS Available:")
    for _ in range(10):
        pkt = rt.step()
    print(f"  Step {rt.current_step}: Mode={pkt.mode}, Speed={pkt.speed_kmh} km/h, Drift={pkt.drift_m}m ({pkt.drift_pct}%)")
    print(f"  GNSS pos: {pkt.gnss_position.lat:.5f}, {pkt.gnss_position.lon:.5f}")
    print(f"  IDR pos:  {pkt.idr_position.lat:.5f}, {pkt.idr_position.lon:.5f}")

    # Engage Blackout
    print("\nEngaging GNSS Blackout:")
    rt.toggle_blackout(True)
    for _ in range(10):
        pkt = rt.step()
    print(f"  Step {rt.current_step}: Mode={pkt.mode}, Speed={pkt.speed_kmh} km/h, Drift={pkt.drift_m}m ({pkt.drift_pct}%)")
    print(f"  GNSS pos: {pkt.gnss_position} (Must be None!)")
    print(f"  IDR pos:  {pkt.idr_position.lat:.5f}, {pkt.idr_position.lon:.5f}")
    print(f"  Map hypothesis: prob={pkt.technical_proof.map_best_prob}, accepted={pkt.technical_proof.map_accepted}")

    assert pkt.gnss_position is None, "GNSS position must be None during blackout!"
    assert pkt.mode == "PSEUDO_GNSS", "Mode must be PSEUDO_GNSS during blackout!"

    # Restore GNSS
    print("\nRestoring GNSS:")
    rt.toggle_blackout(False)
    pkt = rt.step()
    print(f"  Step {rt.current_step}: Mode={pkt.mode}, GNSS available={pkt.gnss_available}")
    assert pkt.gnss_available == True, "GNSS must be available after restore!"

    print("\n" + "="*60)
    print("  ALL RUNTIME INTEGRATION TESTS PASSED!")
    print("="*60 + "\n")

if __name__ == "__main__":
    test_runtime()
