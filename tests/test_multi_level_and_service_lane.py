"""
SIH Problem Statement 26168 - Verification Suite
Multi-Level Elevation & Anti-Service-Lane Glitch Protection Tests
"""

import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
from src.navigation.chunked_road_network import SpatialChunkizer, DynamicChunkManager

def test_anti_service_lane_glitch():
    print("\n" + "=" * 75)
    print("  TEST 1: ANTI-SERVICE-LANE GLITCH PROTECTION")
    print("=" * 75)

    chunkizer = SpatialChunkizer(chunk_size_m=500.0)

    # 1. Main Highway: runs from North = 0 to 1000m along East = 0m, speed limit 100 km/h
    highway_wpts = np.column_stack([np.zeros(200), np.linspace(0, 1000, 200)])
    chunkizer.ingest_polyline(highway_wpts, road_type="motorway", speed_limit=100, is_service=False)

    # 2. Parallel Service Lane: runs parallel just 6.0m to the right (East = 6m), speed limit 40 km/h
    service_wpts = np.column_stack([np.full(200, 6.0), np.linspace(0, 1000, 200)])
    chunkizer.ingest_polyline(service_wpts, road_type="service", speed_limit=40, is_service=True)

    manager = DynamicChunkManager(chunkizer=chunkizer, max_active_chunks=9)

    # Scenario A: Vehicle driving on Main Highway at 80 km/h (22.2 m/s).
    # It changes lane to the right (East = 2.5m, closer to service lane than center).
    print("\n[Scenario A] Vehicle cruising on highway at 80 km/h, lane-shifting 2.5m towards shoulder...")
    pos = np.array([2.5, 150.0]) # East = 2.5m, North = 150m
    heading = 0.0 # Heading North (0 deg)
    speed_mps = 22.2 # 80 km/h

    found, r_y, r_psi, psi_road, n_unit, prob = manager.query_candidate(
        pos_enu=pos,
        vehicle_psi=heading,
        speed_mps=speed_mps
    )

    stats = manager.get_diagnostic_stats()
    print(f"  Matched Road: is_on_service = {stats['is_on_service']}, Active Track ID = {stats['active_track_id']}")
    print(f"  Cross-Track to Selected Centerline: {r_y:.2f} m, Match Confidence: {prob*100:.1f}%")

    assert found is True, "Highway candidate should be matched!"
    assert stats['is_on_service'] is False, "CRITICAL ERROR: Vehicle falsely glitched into parallel service lane!"
    print("  >>> PASSED: Anti-glitch engine held vehicle on Main Highway! <<<")

    # Scenario B: Deceleration & Legitimate Exit Ramp Maneuver
    print("\n[Scenario B] Vehicle slows to 30 km/h (8.3 m/s) and steers into off-ramp...")
    manager.is_on_service = True # Driver completes exit ramp maneuver into service lane
    pos_service = np.array([6.0, 300.0]) # Exactly in service lane
    found, r_y, r_psi, psi_road, n_unit, prob = manager.query_candidate(
        pos_enu=pos_service,
        vehicle_psi=heading,
        speed_mps=8.3 # 30 km/h
    )
    stats = manager.get_diagnostic_stats()
    assert stats['is_on_service'] is True, "Service lane should be matched when legitimately entering!"
    print("  >>> PASSED: Legitimate service lane entry tracked cleanly! <<<")


def test_multi_level_elevation():
    print("\n" + "=" * 75)
    print("  TEST 2: MULTI-LEVEL ELEVATION GATING (FLYOVER VS SURFACE STREET)")
    print("=" * 75)

    chunkizer = SpatialChunkizer(chunk_size_m=500.0)

    # 1. Surface Street (Layer = 0): East = 0 to 500m, North = 0m
    surface_wpts = np.column_stack([np.linspace(0, 500, 100), np.zeros(100)])
    chunkizer.ingest_polyline(surface_wpts, road_type="primary", layer=0)

    # 2. Elevated Flyover directly overhead (Layer = 1): Same coordinates East = 0 to 500m, North = 0m
    flyover_wpts = np.column_stack([np.linspace(0, 500, 100), np.zeros(100)])
    chunkizer.ingest_polyline(flyover_wpts, road_type="motorway", layer=1)

    manager = DynamicChunkManager(chunkizer=chunkizer, max_active_chunks=9)

    # Case A: Vehicle driving on Surface Street (pitch = 0.0 deg)
    print("\n[Case A] Driving on surface street underneath flyover (pitch = 0.0 deg)...")
    pos = np.array([100.0, 0.0])
    heading = np.radians(90.0) # East
    found, r_y, r_psi, psi_road, n_unit, prob = manager.query_candidate(
        pos_enu=pos,
        vehicle_psi=heading,
        speed_mps=15.0,
        pitch_deg=0.0
    )
    stats = manager.get_diagnostic_stats()
    print(f"  Matched Layer: {stats['current_layer']} (Expected: 0)")
    assert stats['current_layer'] == 0, "Vehicle on surface street incorrectly snapped to overhead flyover!"
    print("  >>> PASSED: Correctly locked to surface street! <<<")

    # Case B: Vehicle climbing flyover incline ramp (pitch = +4.5 deg)
    print("\n[Case B] Vehicle climbs flyover ramp with positive incline pitch (+4.5 deg)...")
    found, r_y, r_psi, psi_road, n_unit, prob = manager.query_candidate(
        pos_enu=pos,
        vehicle_psi=heading,
        speed_mps=15.0,
        pitch_deg=4.5 # Incline
    )
    stats = manager.get_diagnostic_stats()
    print(f"  Matched Layer: {stats['current_layer']} (Expected: 1)")
    assert stats['current_layer'] == 1, "Vehicle climbing ramp failed to switch to elevated flyover layer!"
    print("  >>> PASSED: Correctly transitioned to elevated flyover! <<<")


if __name__ == "__main__":
    test_anti_service_lane_glitch()
    test_multi_level_elevation()
    print("\n" + "=" * 75)
    print("  >>> ALL MULTI-LEVEL & ANTI-SERVICE-LANE TESTS PASSED! <<<")
    print("=" * 75 + "\n")
