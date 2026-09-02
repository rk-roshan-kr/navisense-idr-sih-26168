"""
SIH 26168 - IO-VNBD Empirical Data Forensics & Audit Script
Analyzes real synchronized smartphone & vehicle CAN datasets.
Calculates sampling jitter, sensor noise, stationary periods, and cross-correlations.
"""

import os, sys, glob, json, re
from pathlib import Path
import numpy as np
import pandas as pd

def clean_col(c):
    # Remove non-ascii and clean whitespace
    c = re.sub(r'[^\x00-\x7F]+', '', str(c))
    c = re.sub(r'\s+', ' ', c).strip()
    return c

def audit_dataset(base_dir, max_files=10):
    base_path = Path(base_dir)
    print(f"[AUDIT] Scanning: {base_path}")
    
    # Discover all S-*.csv files
    s_files = list(base_path.rglob("S-*.csv")) + list(base_path.rglob("s-*.csv"))
    print(f"[AUDIT] Found {len(s_files)} smartphone CSV files.")
    
    results = {
        "summary": {},
        "files": []
    }
    
    total_duration_sec = 0
    total_rows = 0
    
    # Process key sequences covering different drivers
    audited = 0
    for s_path in sorted(s_files):
        # Find matching V file
        s_name = s_path.name
        v_name_candidates = [
            s_name.replace("S-", "V-"),
            s_name.replace("s-", "v-"),
            s_name.replace("S-", "v-"),
            s_name.replace("s-", "V-")
        ]
        
        v_path = None
        for cand in v_name_candidates:
            cand_path = s_path.parent / cand
            if cand_path.exists():
                v_path = cand_path
                break
            # Check parallel folder
            for p in s_path.parent.glob(cand):
                v_path = p
                break
                
        # Limit to diverse set if too many
        if audited >= max_files and not any(k in str(s_path) for k in ["S1", "S2", "M", "Y1", "Vw1", "Vta1", "Vtb1"]):
            continue
            
        try:
            # Read smartphone CSV
            df_s = pd.read_csv(s_path, encoding='latin1', low_memory=False)
            df_s.columns = [clean_col(c) for c in df_s.columns]
            
            # Identify columns
            t_col = [c for c in df_s.columns if "TIME SINCE START" in c.upper()]
            gps_spd_col = [c for c in df_s.columns if "GPS SPEED" in c.upper()]
            gps_lat_col = [c for c in df_s.columns if "GPS LATITUDE" in c.upper()]
            gps_lon_col = [c for c in df_s.columns if "GPS LONGITUDE" in c.upper()]
            gps_acc_col = [c for c in df_s.columns if "GPS ACCURACY" in c.upper()]
            ax_col = [c for c in df_s.columns if "ACCELEROMETER X" in c.upper()]
            ay_col = [c for c in df_s.columns if "ACCELEROMETER Y" in c.upper()]
            az_col = [c for c in df_s.columns if "ACCELEROMETER Z" in c.upper()]
            gx_col = [c for c in df_s.columns if "GRAVITY X" in c.upper()]
            gy_col = [c for c in df_s.columns if "GRAVITY Y" in c.upper()]
            gz_col = [c for c in df_s.columns if "GRAVITY Z" in c.upper()]
            yaw_col = [c for c in df_s.columns if "GYROSCOPE YAW" in c.upper()]
            pitch_col = [c for c in df_s.columns if "GYROSCOPE PITCH" in c.upper()]
            roll_col = [c for c in df_s.columns if "GYROSCOPE ROLL" in c.upper()]
            
            n_rows = len(df_s)
            if n_rows < 100:
                continue
                
            file_meta = {
                "s_file": s_path.name,
                "folder": s_path.parent.parent.name + " / " + s_path.parent.name,
                "rows": n_rows,
                "v_paired": v_path is not None
            }
            
            # Timing & Sampling
            if t_col:
                t_ms = pd.to_numeric(df_s[t_col[0]], errors='coerce').dropna().values
                dt_ms = np.diff(t_ms)
                duration_s = (t_ms[-1] - t_ms[0]) / 1000.0 if len(t_ms) > 1 else 0
                file_meta["duration_s"] = float(np.round(duration_s, 1))
                file_meta["dt_mean_ms"] = float(np.round(np.mean(dt_ms), 2))
                file_meta["dt_std_ms"] = float(np.round(np.std(dt_ms), 2))
                file_meta["dt_min_ms"] = float(np.min(dt_ms)) if len(dt_ms) else 0
                file_meta["dt_max_ms"] = float(np.max(dt_ms)) if len(dt_ms) else 0
                total_duration_sec += duration_s
                total_rows += n_rows
            
            # GPS Analysis: Check update frequency
            if gps_lat_col and gps_lon_col:
                lats = pd.to_numeric(df_s[gps_lat_col[0]], errors='coerce').dropna().values
                lons = pd.to_numeric(df_s[gps_lon_col[0]], errors='coerce').dropna().values
                # Count distinct coordinate updates
                coords = np.column_stack([lats, lons])
                _, unique_indices = np.unique(coords, axis=0, return_index=True)
                gps_updates = len(unique_indices)
                effective_gps_hz = gps_updates / max(1, file_meta.get("duration_s", 1))
                file_meta["gps_unique_updates"] = gps_updates
                file_meta["gps_effective_rate_hz"] = float(np.round(effective_gps_hz, 2))
                
            if gps_spd_col:
                spd_kmh = pd.to_numeric(df_s[gps_spd_col[0]], errors='coerce').dropna().values
                file_meta["gps_spd_max_kmh"] = float(np.round(np.max(spd_kmh), 1)) if len(spd_kmh) else 0
                file_meta["gps_spd_mean_kmh"] = float(np.round(np.mean(spd_kmh), 1)) if len(spd_kmh) else 0
                
            if gps_acc_col:
                acc_m = pd.to_numeric(df_s[gps_acc_col[0]], errors='coerce').dropna().values
                file_meta["gps_acc_median_m"] = float(np.round(np.median(acc_m), 1)) if len(acc_m) else 0
                file_meta["gps_acc_95th_m"] = float(np.round(np.percentile(acc_m, 95), 1)) if len(acc_m) else 0
                
            # IMU & Sensor Statistics
            if ax_col and ay_col and az_col:
                ax = pd.to_numeric(df_s[ax_col[0]], errors='coerce').dropna().values
                ay = pd.to_numeric(df_s[ay_col[0]], errors='coerce').dropna().values
                az = pd.to_numeric(df_s[az_col[0]], errors='coerce').dropna().values
                min_l = min(len(ax), len(ay), len(az))
                ax, ay, az = ax[:min_l], ay[:min_l], az[:min_l]
                norm_a = np.sqrt(ax**2 + ay**2 + az**2)
                file_meta["accel_norm_mean"] = float(np.round(np.mean(norm_a), 3))
                file_meta["accel_norm_std"] = float(np.round(np.std(norm_a), 3))
                file_meta["ax_range"] = [float(np.round(np.min(ax), 2)), float(np.round(np.max(ax), 2))]
                file_meta["ay_range"] = [float(np.round(np.min(ay), 2)), float(np.round(np.max(ay), 2))]
                file_meta["az_range"] = [float(np.round(np.min(az), 2)), float(np.round(np.max(az), 2))]

            if yaw_col:
                gyaw = pd.to_numeric(df_s[yaw_col[0]], errors='coerce').dropna().values
                file_meta["gyro_yaw_mean_rads"] = float(np.round(np.mean(gyaw), 5))
                file_meta["gyro_yaw_std_rads"] = float(np.round(np.std(gyaw), 4))
                file_meta["gyro_yaw_max_rads"] = float(np.round(np.max(np.abs(gyaw)), 3))

            # Stationary analysis (GPS Speed < 0.5 km/h)
            if gps_spd_col and ax_col:
                stationary_mask = (spd_kmh[:min_l] < 0.5)
                stat_points = np.sum(stationary_mask)
                file_meta["stationary_pct"] = float(np.round(stat_points / max(1, len(spd_kmh)) * 100, 1))
                if stat_points > 50:
                    stat_ax = ax[stationary_mask]
                    stat_ay = ay[stationary_mask]
                    stat_az = az[stationary_mask]
                    stat_yaw = gyaw[:min_l][stationary_mask] if yaw_col else []
                    file_meta["stat_accel_noise_std"] = float(np.round(np.std(np.sqrt(stat_ax**2 + stat_ay**2 + stat_az**2)), 4))
                    if len(stat_yaw):
                        file_meta["stat_gyro_bias_rads"] = float(np.round(np.mean(stat_yaw), 5))
                        file_meta["stat_gyro_noise_std"] = float(np.round(np.std(stat_yaw), 5))
            
            # Read Vehicle CAN file if paired
            if v_path and v_path.exists():
                df_v = pd.read_csv(v_path, encoding='latin1', low_memory=False)
                df_v.columns = [clean_col(c) for c in df_v.columns]
                v_spd_col = [c for c in df_v.columns if "VELOCITY (KM/HR)" in c.upper()]
                v_rpm_col = [c for c in df_v.columns if "ENGINE SPEED" in c.upper()]
                v_yaw_col = [c for c in df_v.columns if "YAW RATE" in c.upper()]
                v_ax_col  = [c for c in df_v.columns if "LONGITUDINAL ACCELERATION" in c.upper()]
                
                v_meta = {"v_rows": len(df_v)}
                if v_spd_col:
                    v_spd = pd.to_numeric(df_v[v_spd_col[0]], errors='coerce').dropna().values
                    v_meta["v_spd_max_kmh"] = float(np.round(np.max(v_spd), 1))
                    v_meta["v_spd_mean_kmh"] = float(np.round(np.mean(v_spd), 1))
                if v_rpm_col:
                    v_rpm = pd.to_numeric(df_v[v_rpm_col[0]], errors='coerce').dropna().values
                    v_meta["v_rpm_idle"] = float(np.round(np.percentile(v_rpm[v_rpm > 500], 5), 0)) if len(v_rpm[v_rpm > 500]) else 0
                    v_meta["v_rpm_max"] = float(np.round(np.max(v_rpm), 0)) if len(v_rpm) else 0
                if v_yaw_col:
                    v_yaw = pd.to_numeric(df_v[v_yaw_col[0]], errors='coerce').dropna().values
                    v_meta["v_yaw_rate_max_degs"] = float(np.round(np.max(np.abs(v_yaw)), 1)) if len(v_yaw) else 0
                if v_ax_col:
                    v_ax = pd.to_numeric(df_v[v_ax_col[0]], errors='coerce').dropna().values
                    v_meta["v_long_accel_g_range"] = [float(np.round(np.min(v_ax), 3)), float(np.round(np.max(v_ax), 3))] if len(v_ax) else []
                    
                file_meta["vehicle_reference"] = v_meta

            results["files"].append(file_meta)
            audited += 1
            print(f"  [OK] Audited {s_path.name}: {n_rows} rows, {file_meta.get('duration_s',0):.1f}s, paired={v_path is not None}")
            
        except Exception as e:
            print(f"  [ERR] Failed auditing {s_path.name}: {e}")

    results["summary"] = {
        "audited_sequences": audited,
        "total_rows_audited": total_rows,
        "total_duration_hours": float(np.round(total_duration_sec / 3600.0, 2))
    }
    
    # Save output
    out_dir = Path("results")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "iovnbd_empirical_audit.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
        
    print(f"\n[DONE] Full empirical audit saved to: {out_file}")
    return results

if __name__ == "__main__":
    base = "D:/SIH prototype/data/IO-VNBD/Synchronised V abd S datasets/Categorised IOVNB Dataset"
    audit_dataset(base, max_files=15)
