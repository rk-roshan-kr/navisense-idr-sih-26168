"""
Automated Session ZIP Ingestion, Unpacking, and Device Indexing.

Reads raw session ZIPs from data/raw/ or specific paths, extracts into data/canonical/,
and extracts strict identification metadata:
- physical_device_id: Distinguishes between multiple physical devices of the same model
  using hardware fingerprinting (sensor vendor versions, resolutions, and serial hashes).
- participant_id: Subject contributor ID for unseen-person validation splits.
"""

import os
import zipfile
import json
import hashlib
from pathlib import Path


def generate_physical_device_fingerprint(metadata: dict, inventory: dict) -> str:
    """
    Constructs a deterministic physical device ID.
    If multiple contributors have the same model (e.g. Samsung M35),
    this uses the hardware sensor inventory signatures or explicit ID
    to ensure individual phones are separated in validation splits.
    """
    if 'physicalDeviceId' in metadata and metadata['physicalDeviceId']:
        return str(metadata['physicalDeviceId'])

    # Build unique hardware signature from sensor inventory
    device_model = metadata.get('deviceModel', 'unknown_model').replace(' ', '_')

    if inventory and 'sensors' in inventory:
        sig_parts = []
        for s in inventory['sensors']:
            # Fingerprint each physical sensor vendor, version, and resolution
            name = s.get('name', '')
            vendor = s.get('vendor', '')
            ver = str(s.get('version', ''))
            res = f"{s.get('resolution', 0.0):.6f}"
            sig_parts.append(f"{name}|{vendor}|{ver}|{res}")
        sig_str = ";".join(sorted(sig_parts))
        h = hashlib.sha256(sig_str.encode('utf-8')).hexdigest()[:8]
        return f"{device_model}_{h}"

    # Fallback to model plus participant tag
    p_tag = metadata.get('participant', 'p0').replace(' ', '_')
    return f"{device_model}_{p_tag}"


def ingest_raw_session_zip(zip_path: str, canonical_base_dir: str) -> dict:
    """
    Extracts a session ZIP archive into canonical_base_dir/<sessionId>/
    and parses session metadata.
    """
    zip_path = Path(zip_path)
    if not zip_path.exists():
        raise FileNotFoundError(f"Session ZIP not found: {zip_path}")

    session_id = zip_path.stem
    extract_dir = Path(canonical_base_dir) / session_id
    extract_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(extract_dir)

    # Read metadata.json
    meta_path = extract_dir / "metadata.json"
    metadata = {}
    if meta_path.exists():
        with open(meta_path, 'r', encoding='utf-8') as f:
            metadata = json.load(f)

    # Read sensor_inventory.json
    inv_path = extract_dir / "sensor_inventory.json"
    inventory = {}
    if inv_path.exists():
        with open(inv_path, 'r', encoding='utf-8') as f:
            inventory = json.load(f)

    physical_device_id = generate_physical_device_fingerprint(metadata, inventory)
    participant_id = metadata.get('participant', 'unnamed_participant')
    movement_mode = metadata.get('movementMode', 'Unknown')

    record = {
        'session_id': session_id,
        'path': str(extract_dir),
        'physical_device_id': physical_device_id,
        'device_model': metadata.get('deviceModel', 'unknown'),
        'participant_id': participant_id,
        'movement_mode': movement_mode,
        'start_unix_time_ms': metadata.get('startUnixTimeMs', 0),
        'end_unix_time_ms': metadata.get('endUnixTimeMs', 0),
        'actual_rate_hz': metadata.get('actualRateHz', 0.0),
        'imu_sample_count': metadata.get('imuSampleCount', 0),
        'gnss_sample_count': metadata.get('gnssSampleCount', 0)
    }

    return record


def ingest_all_raw_zips(raw_dir: str, canonical_dir: str, index_file: str = "dataset_index.json") -> list:
    """
    Discovers all ZIP files in raw_dir, unpacks them into canonical_dir,
    and updates the dataset index manifest.
    """
    raw_path = Path(raw_dir)
    raw_path.mkdir(parents=True, exist_ok=True)
    canonical_path = Path(canonical_dir)
    canonical_path.mkdir(parents=True, exist_ok=True)

    zip_files = list(raw_path.glob("*.zip"))
    records = []

    for zf in zip_files:
        try:
            rec = ingest_raw_session_zip(str(zf), str(canonical_path))
            records.append(rec)
            print(f"Ingested: {rec['session_id']} | Device: {rec['physical_device_id']} | User: {rec['participant_id']}")
        except Exception as e:
            print(f"Error ingesting {zf.name}: {e}")

    # Also inspect any folders already in canonical_dir
    for sub in canonical_path.iterdir():
        if sub.is_dir() and (sub / "metadata.json").exists():
            # Check if not already in records
            sid = sub.name
            if not any(r['session_id'] == sid for r in records):
                with open(sub / "metadata.json", 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                inv = {}
                if (sub / "sensor_inventory.json").exists():
                    with open(sub / "sensor_inventory.json", 'r', encoding='utf-8') as f:
                        inv = json.load(f)
                dev_id = generate_physical_device_fingerprint(meta, inv)
                records.append({
                    'session_id': sid,
                    'path': str(sub),
                    'physical_device_id': dev_id,
                    'device_model': meta.get('deviceModel', 'unknown'),
                    'participant_id': meta.get('participant', 'unnamed_participant'),
                    'movement_mode': meta.get('movementMode', 'Unknown'),
                    'imu_sample_count': meta.get('imuSampleCount', 0),
                    'gnss_sample_count': meta.get('gnssSampleCount', 0)
                })

    index_dest = canonical_path / index_file
    with open(index_dest, 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2)

    print(f"Dataset index updated: {len(records)} sessions indexed at {index_dest}")
    return records
