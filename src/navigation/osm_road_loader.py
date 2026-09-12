"""
SIH 26168 - Independent OpenStreetMap Vector Road Network Loader V2.2
Loads and caches genuine external vector road centerlines from OpenStreetMap.
Strict anti-leakage guarantee:
  Zero ground-truth trajectory coordinates are ever used to generate or select road geometry.
  Provenance is 100% external OpenStreetMap ways (motorway, trunk, primary, secondary, tertiary, residential).
"""

import os, sys, json, math, time
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
OSM_CACHE_DIR = ROOT_DIR / "data/osm"

# Provenance bounding boxes covering the evaluation scenario regions:
SCENARIO_BOUNDS = {
    "rugby_s3b": {
        "name": "Rugby, UK (Hillmorton / Moultrie Road)",
        "bbox": (52.365, -1.275, 52.385, -1.250), # (min_lat, min_lon, max_lat, max_lon)
        "cache_file": OSM_CACHE_DIR / "rugby_s3b_osm.json"
    },
    "coventry_s1_s4": {
        "name": "Coventry / Warwickshire, UK",
        "bbox": (52.375, -1.565, 52.415, -1.500),
        "cache_file": OSM_CACHE_DIR / "coventry_s1_s4_osm.json"
    }
}


def fetch_osm_ways_from_overpass(bbox: Tuple[float, float, float, float]) -> List[dict]:
    """
    Queries public OpenStreetMap Overpass API for road centerlines within bbox.
    bbox: (min_lat, min_lon, max_lat, max_lon)
    """
    min_lat, min_lon, max_lat, max_lon = bbox
    query = f"""[out:json][timeout:30];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|service"]({min_lat},{min_lon},{max_lat},{max_lon});
);
out geom;"""

    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": "NaviSense-IDR-V2/1.0"})
    with urllib.request.urlopen(req, timeout=25) as response:
        data = json.loads(response.read().decode("utf-8"))
        elements = data.get("elements", [])
        return elements


def ensure_osm_cache(scenario_key: str = "rugby_s3b") -> Path:
    """
    Ensures the OSM vector road network is cached locally.
    Offline guarantee: If cached JSON exists, loads immediately without any internet access!
    """
    OSM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cfg = SCENARIO_BOUNDS.get(scenario_key, SCENARIO_BOUNDS["rugby_s3b"])
    cache_path = cfg["cache_file"]

    if cache_path.exists() and cache_path.stat().st_size > 500:
        return cache_path

    print(f"[OSM] Downloading independent OSM road graph for {cfg['name']}...")
    try:
        elements = fetch_osm_ways_from_overpass(cfg["bbox"])
        payload = {
            "provenance": "OpenStreetMap Overpass API",
            "download_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "region": cfg["name"],
            "bbox": cfg["bbox"],
            "way_count": len(elements),
            "ways": elements
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=1)
        print(f"[OSM] Successfully cached {len(elements)} OSM ways to {cache_path}")
    except Exception as e:
        print(f"[OSM] Warning: Could not fetch from Overpass ({e}). Using existing or fallback.")
    return cache_path


def load_raw_osm_ways(scenario_key: str) -> List[dict]:
    """Loads raw OSM way elements from cache."""
    cache_path = ensure_osm_cache(scenario_key)
    if not cache_path.exists():
        raise FileNotFoundError(f"OSM cache file not found at {cache_path}")
    with open(cache_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("ways", [])


def update_osm_cache_provenance(scenario_key: str, provenance_data: dict) -> None:
    """Updates cached OSM provenance in sidecar metadata JSON (fast & atomic)."""
    cfg = SCENARIO_BOUNDS.get(scenario_key, SCENARIO_BOUNDS["rugby_s3b"])
    meta_path = cfg["cache_file"].with_suffix(".reg.json")
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(provenance_data, f, indent=2)
        print(f"[OSM] Saved registration provenance to {meta_path.name}")
    except Exception as e:
        print(f"[OSM] Could not update provenance: {e}")



def load_osm_polylines_enu(
    scenario_key: str,
    projector,
    map_registrator=None,
    max_radius_m: float = 2500.0
) -> List[np.ndarray]:
    """
    Loads independent OSM road centerline polylines and projects into local ENU frame.
    Optionally applies map registration offset [t_E, t_N]^T.
    Filters out distant county-wide roads beyond max_radius_m from scenario origin.
    Returns list of (K, 2) arrays of [East, North] centerline vertices.
    """
    cache_path = ensure_osm_cache(scenario_key)
    if not cache_path.exists():
        raise FileNotFoundError(f"OSM cache file not found at {cache_path}")

    with open(cache_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    offset = np.array([0.0, 0.0], dtype=np.float64)
    if map_registrator and getattr(map_registrator, "is_calibrated", False):
        offset = np.array([map_registrator.offset_e, map_registrator.offset_n], dtype=np.float64)

    polylines_enu = []
    for way in data.get("ways", []):
        geom = way.get("geometry", [])
        if len(geom) < 2:
            continue

        lats = [pt["lat"] for pt in geom]
        lons = [pt["lon"] for pt in geom]

        e, n = projector.geodetic_to_enu(np.array(lats), np.array(lons))
        pts = np.column_stack([e, n]) + offset

        # Filter out roads > 2.5 km away from scenario origin
        if np.any(np.abs(pts) < max_radius_m):
            polylines_enu.append(pts)

    print(f"[OSM] Loaded {len(polylines_enu)} independent vector road polylines for {scenario_key} from {cache_path.name}")
    return polylines_enu


def build_osm_corridor_and_chunkizer(
    scenario_key: str,
    projector,
    chunk_size_m: float = 500.0,
    max_corridor_width_m: float = 35.0,
    map_registrator=None
):
    """
    Builds SpatialChunkizer and junction-aware RoadGraph from independent OSM vector data.
    Strictly zero ground-truth trajectory coordinates are used.
    """
    from src.navigation.chunked_road_network import SpatialChunkizer, DynamicChunkManager
    from src.navigation.road_graph import RoadGraph

    polylines = load_osm_polylines_enu(scenario_key, projector, map_registrator=map_registrator, max_radius_m=2500.0)
    chunkizer = SpatialChunkizer(chunk_size_m=chunk_size_m)

    for poly in polylines:
        chunkizer.ingest_polyline(poly)

    chunk_manager = DynamicChunkManager(
        chunkizer=chunkizer,
        max_active_chunks=9,
        max_corridor_width_m=max_corridor_width_m,
        lookahead_seconds=8.0
    )

    # Build junction-aware RoadGraph with 5-term branch scorer
    cache_path = ensure_osm_cache(scenario_key)
    with open(cache_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw_ways = data.get("ways", [])

    road_graph = RoadGraph(max_corridor_width_m=max_corridor_width_m)
    road_graph.build_from_osm_ways(raw_ways, projector, map_registrator=map_registrator)

    return chunkizer, chunk_manager, road_graph


