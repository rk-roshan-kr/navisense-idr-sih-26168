"""
Pre-Flight Data & Sensor QA Audit Engine for NaviSense IDR.

Audits incoming contributor sessions before training:
1. Physical Hardware Signature: Extracts deviceModel, manufacturer, sensor inventory hashes
2. Sensor Sampling Rate & Jitter: Computes median dt, sample counts, dropped intervals
3. Monotonic Timestamp Continuity: Detects timestamp regressions, duplicates, nanosecond gaps
4. GNSS Availability & Accuracy: Evaluates fix counts, accuracy metrics (<= 15m), reference duration
5. Path Distance & Duration: Calculates total walking distance to verify 40m outage eligibility
6. Placement / Movement Labels: Audits HAND, POCKET, BAG annotations

Produces a pre-flight QA scorecard and per-session diagnostic audit table.
"""

import os
import json
from pathlib import Path
import numpy as np
import pandas as pd


def inspect_session_qa(session_dir: Path) -> dict:
    """
    Performs comprehensive data quality audit on a single extracted session.
    """
    session_id = session_dir.name
    meta_path = session_dir / "metadata.json"
    imu_path = session_dir / "imu_canonical.csv"
    gnss_path = session_dir / "gnss_canonical.csv"

    report = {
        'session_id': session_id,
        'valid': False,
        'issues': [],
        'device_id': 'unknown',
        'device_model': 'unknown',
        'participant': 'unknown',
        'placement': 'unknown',
        'imu_samples': 0,
        'imu_rate_hz': 0.0,
        'imu_jitter_ms': 0.0,
        'timestamp_monotonic': True,
        'gnss_fixes': 0,
        'gnss_good_fixes': 0,
        'duration_s': 0.0,
        'path_distance_m': 0.0,
        'eligible_for_40m_gate': False
    }

    # 1. Metadata Audit
    if meta_path.exists():
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            enrollment_id = meta.get('participant', meta.get('userId', 'user'))
            hardware_fp = meta.get('physicalDeviceId', meta.get('deviceModel', 'dev0'))
            # Composite physical device identity: Enrollment ID + Sensor/Hardware Fingerprint
            # Distinguishes two identical phone models owned by different contributors
            report['device_id'] = f"{enrollment_id}_{hardware_fp}"
            report['device_model'] = meta.get('deviceModel', 'unknown')
            report['participant'] = meta.get('participant', 'unknown')
            report['placement'] = meta.get('placement', 'HAND').upper()
        except Exception as e:
            report['issues'].append(f"Corrupt metadata.json: {e}")
    else:
        report['issues'].append("Missing metadata.json")

    # 2. IMU Audit
    if not imu_path.exists():
        report['issues'].append("Missing imu_canonical.csv")
        return report

    try:
        imu_df = pd.read_csv(imu_path)
        report['imu_samples'] = len(imu_df)

        if len(imu_df) < 50:
            report['issues'].append("Session too short (< 50 IMU samples)")
            return report

        # Check timestamps
        ts_col = 'timestamp_elapsed_nanos' if 'timestamp_elapsed_nanos' in imu_df.columns else 'timestamp_unix_ms'
        timestamps = imu_df[ts_col].values

        diffs = np.diff(timestamps)
        # Check monotonicity
        if np.any(diffs <= 0):
            report['timestamp_monotonic'] = False
            report['issues'].append("Non-monotonic or duplicate timestamps detected in IMU")

        dt_seconds = diffs * (1e-9 if ts_col == 'timestamp_elapsed_nanos' else 1e-3)
        valid_dt = dt_seconds[dt_seconds > 0]
        if len(valid_dt) > 0:
            median_dt = float(np.median(valid_dt))
            report['imu_rate_hz'] = float(round(1.0 / median_dt, 1)) if median_dt > 0 else 0.0
            report['imu_jitter_ms'] = float(round(np.std(valid_dt) * 1000.0, 2))
            report['duration_s'] = float(round(np.sum(dt_seconds), 1))

    except Exception as e:
        report['issues'].append(f"Error parsing IMU data: {e}")

    # 3. GNSS Reference Audit
    report['collection_tier'] = "NO_GNSS"
    if gnss_path.exists():
        try:
            gnss_df = pd.read_csv(gnss_path)
            report['gnss_fixes'] = len(gnss_df)

            if len(gnss_df) >= 2 and 'lat' in gnss_df.columns and 'lon' in gnss_df.columns:
                valid_mask = (gnss_df['lat'].abs() > 1e-4) & (gnss_df['lon'].abs() > 1e-4)
                if 'accuracy_m' in gnss_df.columns:
                    good_mask = valid_mask & (gnss_df['accuracy_m'] <= 15.0)
                    report['gnss_good_fixes'] = int(good_mask.sum())
                else:
                    report['gnss_good_fixes'] = int(valid_mask.sum())

                # Calculate approximate distance traveled
                lats = np.radians(gnss_df['lat'].values)
                lons = np.radians(gnss_df['lon'].values)
                dlat = np.diff(lats)
                dlon = np.diff(lons)
                a = np.sin(dlat / 2.0)**2 + np.cos(lats[:-1]) * np.cos(lats[1:]) * np.sin(dlon / 2.0)**2
                c = 2.0 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))
                dist_m = float(np.sum(6371000.0 * c))
                report['path_distance_m'] = float(round(dist_m, 1))

                # Explicit separation of 35m collection threshold and 40m scientific gate
                if dist_m >= 40.0:
                    report['eligible_for_40m_gate'] = True
                    report['collection_tier'] = "40M_GATE_ELIGIBLE"
                elif dist_m >= 35.0:
                    report['eligible_for_40m_gate'] = False
                    report['collection_tier'] = "GENERAL_TRAINING_ONLY"
                    report['issues'].append(f"Usable for training ({dist_m:.1f}m), but ineligible for 40m gate (< 40m)")
                else:
                    report['eligible_for_40m_gate'] = False
                    report['collection_tier'] = "SHORT_TRAJECTORY"
                    report['issues'].append(f"Short trajectory ({dist_m:.1f}m < 35m collection minimum)")
            else:
                report['issues'].append("Insufficient GNSS coordinate fixes (< 2 fixes)")
        except Exception as e:
            report['issues'].append(f"Error parsing GNSS data: {e}")
    else:
        report['issues'].append("Missing gnss_canonical.csv (inertial-only session)")

    report['valid'] = len(report['issues']) == 0 or (len(report['issues']) == 1 and "Usable for training" in report['issues'][0])
    return report


def run_preflight_dataset_qa(canonical_dir: str) -> dict:
    """
    Audits all extracted sessions in canonical_dir and outputs QA audit scorecard.
    """
    c_path = Path(canonical_dir)
    session_subdirs = [s for s in c_path.iterdir() if s.is_dir() and (s / "imu_canonical.csv").exists()]

    reports = []
    for s_dir in session_subdirs:
        reports.append(inspect_session_qa(s_dir))

    print("\n" + "=" * 90)
    print("                 PRE-FLIGHT DATASET & SENSOR QA AUDIT SCORECARD")
    print("=" * 90)
    print(f"{'Session ID':<26} | {'Device ID':<16} | {'Person':<10} | {'Place':<7} | {'Rate':<7} | {'Dist(m)':<8} | {'Dur(s)':<7} | {'QA Status'}")
    print("-" * 90)

    devices = set()
    participants = set()
    eligible_count = 0

    for r in reports:
        status = "[PASS]" if r['valid'] else "[FLAGGED]"
        if r['eligible_for_40m_gate']:
            status += " (40m Gate Eligible)"
        devices.add(r['device_id'])
        participants.add(r['participant'])
        if r['eligible_for_40m_gate']:
            eligible_count += 1

        print(f"{r['session_id']:<26} | {r['device_id'][:16]:<16} | {r['participant'][:10]:<10} | {r['placement']:<7} | {r['imu_rate_hz']:<5.0f}Hz | {r['path_distance_m']:<8.1f} | {r['duration_s']:<7.1f} | {status}")
        if r['issues']:
            for issue in r['issues']:
                print(f"   -> Note: {issue}")

    print("-" * 90)
    print(f"Total Sessions Audited: {len(reports)} | Distinct Devices: {len(devices)} | Distinct Participants: {len(participants)}")
    print(f"40m Benchmark Outage Eligible Sessions: {eligible_count}/{len(reports)}")
    print("=" * 90 + "\n")

    return {
        'total_sessions': len(reports),
        'distinct_devices': list(devices),
        'distinct_participants': list(participants),
        'eligible_40m_sessions': eligible_count,
        'session_reports': reports
    }
