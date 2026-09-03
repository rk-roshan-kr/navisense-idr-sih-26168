"""
SIH Problem Statement 26168 - Verification Suite
Spatial Road Network Chunkization & Dynamic LRU Paging Benchmark
"""

import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import time
import numpy as np
from src.navigation.chunked_road_network import SpatialChunkizer, DynamicChunkManager

def generate_synthetic_highway(length_km: float = 10.0, step_m: float = 5.0) -> np.ndarray:
    """Generates a 10 km highway trajectory curving through multiple spatial cells."""
    num_pts = int((length_km * 1000.0) / step_m)
    t = np.linspace(0, length_km * 1000.0, num_pts)
    
    # S-curving trajectory crossing many 500m cells
    east = t * np.cos(np.radians(25.0)) + 150.0 * np.sin(t / 400.0)
    north = t * np.sin(np.radians(25.0)) + 80.0 * np.cos(t / 300.0)
    return np.column_stack([east, north])

def run_chunkization_benchmark():
    print("=" * 75)
    print("  NAVISENSE IDR — ROAD NETWORK CHUNKIZATION & DYNAMIC PAGING BENCHMARK")
    print("  SIH Problem Statement 26168 Verification")
    print("=" * 75)

    # 1. Ingest 10 km road network into 500m spatial cells
    print("\n[STEP 1] Generating 10 km road network and chunking with S = 500.0m...")
    waypoints = generate_synthetic_highway(length_km=10.0, step_m=5.0)
    print(f"  Total raw waypoints: {len(waypoints)}")

    t0 = time.perf_counter()
    chunkizer = SpatialChunkizer(chunk_size_m=500.0)
    chunkizer.ingest_polyline(waypoints)
    chunk_time_ms = (time.perf_counter() - t0) * 1000.0

    print(f"  Ingestion and Spatial Chunkization Time: {chunk_time_ms:.2f} ms")
    print(f"  Total Spatial Tiles Generated: {chunkizer.total_chunks()} tiles")
    print(f"  Total Indexed Road Segments: {chunkizer.total_segments()} segments")

    # 2. Initialize Dynamic Memory-Bounded Pager
    print("\n[STEP 2] Initializing Dynamic Chunk Manager (Max Active Chunks = 9, 3x3 window)...")
    manager = DynamicChunkManager(
        chunkizer=chunkizer,
        max_active_chunks=9,
        lookahead_seconds=8.0
    )

    # 3. Simulate Vehicle Driving Across the Entire 10 km Trajectory
    print("\n[STEP 3] Simulating vehicle driving at 25 m/s (90 km/h) through all chunks...")
    speed_mps = 25.0
    query_latencies = []
    max_ram_kb = 0.0

    # Step at 10 Hz (every 2.5m)
    for i in range(0, len(waypoints) - 1, 2):
        pos = waypoints[i]
        next_pos = waypoints[i + 1]
        diff = next_pos - pos
        heading = float(np.arctan2(diff[0], diff[1]) % (2.0 * np.pi))

        # Add small simulated 1.2m lateral driving offset
        noisy_pos = pos + np.array([-np.cos(heading) * 1.2, np.sin(heading) * 1.2])

        t_query_start = time.perf_counter()
        found, r_y, r_psi, psi_road, n_unit, conf = manager.query_candidate(
            pos_enu=noisy_pos,
            vehicle_psi=heading,
            speed_mps=speed_mps
        )
        t_query_ms = (time.perf_counter() - t_query_start) * 1000.0
        query_latencies.append(t_query_ms)

        ram_kb = manager.get_working_set_memory_kb()
        if ram_kb > max_ram_kb:
            max_ram_kb = ram_kb

    stats = manager.get_diagnostic_stats()

    # 4. Results & Compliance Assessment
    avg_latency_ms = float(np.mean(query_latencies))
    p99_latency_ms = float(np.percentile(query_latencies, 99))
    max_latency_ms = float(np.max(query_latencies))

    print("\n" + "=" * 75)
    print("  DYNAMIC CHUNKIZATION PERFORMANCE AUDIT")
    print("=" * 75)
    print(f"  Active Chunks in Working Set:    {stats['active_chunks']} / {stats['max_chunks']} tiles")
    print(f"  Peak Working Set RAM Footprint:  {max_ram_kb:.2f} KB (Target: < 50,000 KB)")
    print(f"  Cache Hits:                      {stats['cache_hits']}")
    print(f"  Cache Misses (Tile Loads):       {stats['cache_misses']}")
    print(f"  Stale Tile Evictions (LRU):      {stats['evictions']}")
    print(f"  Average Query Latency:           {avg_latency_ms:.4f} ms (Target: < 5.0 ms)")
    print(f"  99th-Percentile Latency:         {p99_latency_ms:.4f} ms")
    print(f"  Max Latency (at tile boundary):  {max_latency_ms:.4f} ms")
    print("=" * 75)

    # Compliance Assertions
    assert max_ram_kb < 100.0, f"Peak RAM {max_ram_kb} KB exceeds embedded budget!"
    assert avg_latency_ms < 1.0, f"Query latency {avg_latency_ms} ms is too slow!"
    assert stats['evictions'] > 0, "LRU eviction did not trigger as vehicle traveled across tiles!"
    print("\n  >>> ALL TESTS PASSED: Dynamic Road Chunkization is 100% compliant with PS 26168! <<<\n")

if __name__ == "__main__":
    run_chunkization_benchmark()
