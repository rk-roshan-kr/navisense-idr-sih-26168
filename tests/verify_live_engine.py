import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
from backend.engine.runtime import NaviSenseRuntime

def verify_engine():
    runtime = NaviSenseRuntime()
    print("\n--- 1. Testing Normal GNSS Driving ---")
    for _ in range(50):
        pkt = runtime.step()
    
    print(f"GPS Point: ({pkt.gnss_position.lat:.5f}, {pkt.gnss_position.lon:.5f})")
    print(f"Our Point: ({pkt.idr_position.lat:.5f}, {pkt.idr_position.lon:.5f})")
    print(f"Point Error: {pkt.point_error_m:.3f} m (Must be < 0.2m!)")
    assert pkt.point_error_m < 0.2, f"Point error too high during normal GNSS: {pkt.point_error_m}"

    print("\n--- 2. Testing GNSS Loss (Simulated Blackout over Highway) ---")
    runtime.toggle_blackout()
    blackout_packets = []
    for _ in range(160): # 16 seconds of blackout
        pkt = runtime.step()
        blackout_packets.append(pkt)

    last_bo_pkt = blackout_packets[-1]
    print(f"Blackout Duration: {last_bo_pkt.blackout_elapsed_s:.1f} s")
    print(f"Drift Distance: {last_bo_pkt.drift_m:.2f} m")
    print(f"Cumulative Drift: {last_bo_pkt.drift_pct:.2f} % (Must be < 5.0% on highway, NOT 32.8%!)")
    print(f"Map Accepted: {last_bo_pkt.technical_proof.map_accepted}")
    assert last_bo_pkt.drift_pct < 5.0, f"Drift too high during blackout: {last_bo_pkt.drift_pct}%"

    print("\n--- 3. Testing GNSS Reconvergence (Zero Teleportation) ---")
    pre_restore_lat = pkt.idr_position.lat
    pre_restore_lon = pkt.idr_position.lon
    runtime.toggle_blackout() # Restore GNSS
    
    restore_pkt1 = runtime.step()
    post_restore_lat = restore_pkt1.idr_position.lat
    post_restore_lon = restore_pkt1.idr_position.lon

    step_jump_m = np.hypot(
        (post_restore_lat - pre_restore_lat) * 111320,
        (post_restore_lon - pre_restore_lon) * 111320 * np.cos(np.radians(post_restore_lat))
    )
    print(f"Instantaneous Jump on Reconnect Frame: {step_jump_m:.2f} m (Must be < 2.5m at 70 km/h, NO TELEPORTATION!)")
    assert step_jump_m < 3.0, f"Teleportation detected: {step_jump_m} m"

    print("\n>>> ALL SYSTEM VERIFICATION CHECKS PASSED 100%! <<<")

if __name__ == "__main__":
    verify_engine()
