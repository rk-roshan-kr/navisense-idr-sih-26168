"""
SIH 26168 - IO-VNBD Deterministic Preprocessor & Synchronizer
Implements TRUE temporal clock alignment between Smartphone IMU and Vehicle CAN Reference.
Resolves UTC vs BST time offsets, calculates actual temporal overlap, unwraps heading
per-segment (no phase contamination), and produces canonical 10.0 Hz streams.
"""

import os, re
from pathlib import Path
import numpy as np
import pandas as pd

def clean_col_name(c):
    c = re.sub(r'[^\x00-\x7F]+', '', str(c))
    c = re.sub(r'\s+', ' ', c).strip()
    return c

def parse_time_of_day_seconds(date_series):
    """
    Parses 'DATE (YYYY-MO-DD HH-MI-SS_SSS)' to seconds of day:
    e.g. '2019-09-08 10:07:49:546' -> 10*3600 + 7*60 + 49 + 0.546 = 36469.546 s
    """
    tod = np.zeros(len(date_series), dtype=np.float64)
    for i, d_str in enumerate(date_series):
        try:
            parts = str(d_str).split(' ')[-1].replace('_', ':').split(':')
            tod[i] = int(parts[0])*3600 + int(parts[1])*60 + int(parts[2]) + int(parts[3])/1000.0
        except Exception:
            tod[i] = np.nan
    return tod

def find_paired_v_file(s_path):
    s_path = Path(s_path)
    s_name = s_path.name
    candidates = [
        s_name.replace("S-", "V-"),
        s_name.replace("s-", "v-"),
        s_name.replace("S-", "v-"),
        s_name.replace("s-", "V-")
    ]
    for c in candidates:
        p = s_path.parent / c
        if p.exists():
            return p
    return None

def repair_and_resample_sequence(s_csv_path, v_csv_path=None, target_hz=10.0):
    """
    Loads raw smartphone CSV and pairs with Vehicle CAN reference CSV using TRUE temporal alignment.
    1. Parses phone UTC time-of-day vs Vehicle CAN time-of-day.
    2. Identifies true continuous temporal overlap.
    3. Splits on non-monotonic jumps.
    4. Unwraps heading PER-SEGMENT independently.
    5. Resamples both IMU and true CAN velocity/heading onto the strict 10.0 Hz canonical grid.
    """
    s_path = Path(s_csv_path)
    if v_csv_path is None:
        v_path = find_paired_v_file(s_path)
    else:
        v_path = Path(v_csv_path) if Path(v_csv_path).exists() else None

    df_s = pd.read_csv(s_path, encoding='latin1', low_memory=False)
    df_s.columns = [clean_col_name(c) for c in df_s.columns]
    
    col_t = [c for c in df_s.columns if "TIME SINCE START" in c.upper()][0]
    col_date = [c for c in df_s.columns if "DATE" in c.upper()][0]
    col_ax = [c for c in df_s.columns if "ACCELEROMETER X" in c.upper()][0]
    col_ay = [c for c in df_s.columns if "ACCELEROMETER Y" in c.upper()][0]
    col_az = [c for c in df_s.columns if "ACCELEROMETER Z" in c.upper()][0]
    col_gx = [c for c in df_s.columns if "GRAVITY X" in c.upper()][0]
    col_gy = [c for c in df_s.columns if "GRAVITY Y" in c.upper()][0]
    col_gz = [c for c in df_s.columns if "GRAVITY Z" in c.upper()][0]
    col_gyaw = [c for c in df_s.columns if "GYROSCOPE YAW" in c.upper()][0]
    col_gpit = [c for c in df_s.columns if "GYROSCOPE PITCH" in c.upper()][0]
    col_grol = [c for c in df_s.columns if "GYROSCOPE ROLL" in c.upper()][0]
    col_mx = [c for c in df_s.columns if "MAGNETIC FIELD X" in c.upper()]
    col_my = [c for c in df_s.columns if "MAGNETIC FIELD Y" in c.upper()]
    col_mz = [c for c in df_s.columns if "MAGNETIC FIELD Z" in c.upper()]
    col_s_spd = [c for c in df_s.columns if "GPS SPEED" in c.upper()][0]
    col_s_head = [c for c in df_s.columns if "GPS ORIENTATION" in c.upper()]
    col_s_lat = [c for c in df_s.columns if "GPS LATITUDE" in c.upper()][0]
    col_s_lon = [c for c in df_s.columns if "GPS LONGITUDE" in c.upper()][0]

    # Parse Phone Time of Day
    s_tod_raw = parse_time_of_day_seconds(df_s[col_date])
    has_v = False
    v_tod = None
    df_v = None

    if v_path and v_path.exists():
        try:
            df_v = pd.read_csv(v_path, encoding='latin1', low_memory=False)
            df_v.columns = [clean_col_name(c) for c in df_v.columns]
            col_v_time = [c for c in df_v.columns if "TIME SINCE START OF DAY" in c.upper() or "TIME" in c.upper()]
            col_v_spd = [c for c in df_v.columns if "VELOCITY (KM/HR)" in c.upper() or "VELOCITY" in c.upper()]
            col_v_head = [c for c in df_v.columns if "HEADING (DEGREES)" in c.upper() or "HEADING" in c.upper()]
            col_v_yaw = [c for c in df_v.columns if "YAW RATE" in c.upper()]
            col_v_lat = [c for c in df_v.columns if "LATITUDE" in c.upper()]
            col_v_lon = [c for c in df_v.columns if "LONGITUDE" in c.upper()]

            if len(col_v_time) and len(col_v_spd):
                v_tod = pd.to_numeric(df_v[col_v_time[0]], errors='coerce').values
                has_v = True
        except Exception:
            has_v = False

    # True Temporal Clock Alignment
    if has_v and v_tod is not None:
        # Check gross UTC offset (e.g. UK BST daylight savings = 3600 s)
        valid_t = np.isfinite(s_tod_raw) & np.isfinite(v_tod[:len(s_tod_raw)])
        if np.sum(valid_t) > 100:
            median_diff = np.median(s_tod_raw[valid_t] - v_tod[:len(s_tod_raw)][valid_t])
            utc_offset = 3600.0 if abs(median_diff - 3600.0) < 1800.0 else 0.0
            s_time_sec = s_tod_raw - utc_offset
        else:
            s_time_sec = pd.to_numeric(df_s[col_t], errors='coerce').values / 1000.0
            v_tod = None
            has_v = False
    else:
        s_time_sec = pd.to_numeric(df_s[col_t], errors='coerce').values / 1000.0

    # Extract Phone arrays
    raw_ax = pd.to_numeric(df_s[col_ax], errors='coerce').values
    raw_ay = pd.to_numeric(df_s[col_ay], errors='coerce').values
    raw_az = pd.to_numeric(df_s[col_az], errors='coerce').values
    raw_gx = pd.to_numeric(df_s[col_gx], errors='coerce').values
    raw_gy = pd.to_numeric(df_s[col_gy], errors='coerce').values
    raw_gz = pd.to_numeric(df_s[col_gz], errors='coerce').values
    raw_gyaw = pd.to_numeric(df_s[col_gyaw], errors='coerce').values
    raw_gpit = pd.to_numeric(df_s[col_gpit], errors='coerce').values
    raw_grol = pd.to_numeric(df_s[col_grol], errors='coerce').values
    raw_mx = pd.to_numeric(df_s[col_mx[0]], errors='coerce').values if col_mx else np.zeros_like(raw_ax)
    raw_my = pd.to_numeric(df_s[col_my[0]], errors='coerce').values if col_my else np.zeros_like(raw_ay)
    raw_mz = pd.to_numeric(df_s[col_mz[0]], errors='coerce').values if col_mz else np.zeros_like(raw_az)

    # Valid mask on smartphone side
    s_valid = (
        np.isfinite(s_time_sec) & np.isfinite(raw_ax) & np.isfinite(raw_ay) & np.isfinite(raw_az) &
        np.isfinite(raw_gx) & np.isfinite(raw_gy) & np.isfinite(raw_gz) &
        np.isfinite(raw_gyaw) & np.isfinite(raw_gpit) & np.isfinite(raw_grol)
    )

    t_s = s_time_sec[s_valid]
    ax = raw_ax[s_valid]
    ay = raw_ay[s_valid]
    az = raw_az[s_valid]
    gx = raw_gx[s_valid]
    gy = raw_gy[s_valid]
    gz = raw_gz[s_valid]
    gyaw = raw_gyaw[s_valid]
    gpit = raw_gpit[s_valid]
    grol = raw_grol[s_valid]
    mx = raw_mx[s_valid]
    my = raw_my[s_valid]
    mz = raw_mz[s_valid]

    # Pre-extract Vehicle CAN Reference arrays if available
    if has_v and df_v is not None and v_tod is not None:
        v_valid = np.isfinite(v_tod)
        t_v = v_tod[v_valid]
        v_spd = (pd.to_numeric(df_v[col_v_spd[0]], errors='coerce').values / 3.6)[v_valid]
        v_head_raw = pd.to_numeric(df_v[col_v_head[0]], errors='coerce').values[v_valid]
        v_yaw = np.deg2rad(pd.to_numeric(df_v[col_v_yaw[0]], errors='coerce').values[v_valid]) if col_v_yaw else np.zeros_like(v_spd)
        v_lat = pd.to_numeric(df_v[col_v_lat[0]], errors='coerce').values[v_valid] if col_v_lat else np.zeros_like(v_spd)
        v_lon = pd.to_numeric(df_v[col_v_lon[0]], errors='coerce').values[v_valid] if col_v_lon else np.zeros_like(v_spd)
    else:
        # Fallback to Phone GPS
        t_v = t_s
        v_spd = (pd.to_numeric(df_s[col_s_spd], errors='coerce').values / 3.6)[s_valid]
        v_head_raw = pd.to_numeric(df_s[col_s_head[0]], errors='coerce').values[s_valid] if col_s_head else np.zeros_like(v_spd)
        v_yaw = gyaw
        v_lat = pd.to_numeric(df_s[col_s_lat], errors='coerce').values[s_valid]
        v_lon = pd.to_numeric(df_s[col_s_lon], errors='coerce').values[s_valid]

    # 3. Detect non-monotonic jumps in smartphone time (dt <= 0 or dt > 5.0s)
    diffs = np.diff(t_s)
    split_indices = np.where((diffs <= 0) | (diffs > 5.0))[0] + 1
    segment_starts = np.insert(split_indices, 0, 0)
    segment_ends = np.append(split_indices, len(t_s))

    resampled_segments = []
    dt_target = 1.0 / target_hz  # 0.1 s

    for start_idx, end_idx in zip(segment_starts, segment_ends):
        seg_len = end_idx - start_idx
        if seg_len < 30:
            continue

        t_seg = t_s[start_idx:end_idx]
        if (t_seg[-1] - t_seg[0]) < 3.0:
            continue

        sort_order = np.argsort(t_seg)
        t_sorted = t_seg[sort_order]
        unique_t, u_idx = np.unique(t_sorted, return_index=True)
        if len(unique_t) < 30:
            continue

        # Check overlap with Vehicle CAN timeline
        t_min = max(unique_t[0], t_v[0])
        t_max = min(unique_t[-1], t_v[-1])
        if t_max - t_min < 3.0:
            continue

        # Canonical 10.0 Hz temporal grid on common overlap
        t_grid = np.arange(t_min, t_max, dt_target)
        if len(t_grid) < 20:
            continue

        # Extract segment IMU values
        seg_ax = ax[start_idx:end_idx][sort_order][u_idx]
        seg_ay = ay[start_idx:end_idx][sort_order][u_idx]
        seg_az = az[start_idx:end_idx][sort_order][u_idx]
        seg_gx = gx[start_idx:end_idx][sort_order][u_idx]
        seg_gy = gy[start_idx:end_idx][sort_order][u_idx]
        seg_gz = gz[start_idx:end_idx][sort_order][u_idx]
        seg_gyaw = gyaw[start_idx:end_idx][sort_order][u_idx]
        seg_gpit = gpit[start_idx:end_idx][sort_order][u_idx]
        seg_grol = grol[start_idx:end_idx][sort_order][u_idx]
        seg_mx = mx[start_idx:end_idx][sort_order][u_idx]
        seg_my = my[start_idx:end_idx][sort_order][u_idx]
        seg_mz = mz[start_idx:end_idx][sort_order][u_idx]

        # 4. FIX: UNWRAP HEADING PER SEGMENT INDEPENDENTLY (No phase contamination!)
        # Find CAN heading points that cover this segment
        v_mask = (t_v >= t_min - 1.0) & (t_v <= t_max + 1.0)
        if np.sum(v_mask) < 10:
            continue
        v_t_sub = t_v[v_mask]
        v_h_sub = v_head_raw[v_mask]
        v_s_sub = v_spd[v_mask]
        v_y_sub = v_yaw[v_mask]
        v_lat_sub = v_lat[v_mask]
        v_lon_sub = v_lon[v_mask]

        # Unwrap heading within this segment only
        v_head_unwrapped = np.unwrap(np.deg2rad(v_h_sub))

        # Sort CAN timeline if needed
        v_sort = np.argsort(v_t_sub)
        v_t_sorted = v_t_sub[v_sort]
        v_uniq_t, v_u_idx = np.unique(v_t_sorted, return_index=True)

        # Resample unwrapped heading onto canonical grid
        u_head_interp = np.interp(t_grid, v_uniq_t, v_head_unwrapped[v_sort][v_u_idx])
        head_deg_interp = (np.rad2deg(u_head_interp) % 360.0)

        # Compute vehicle CAN reference integrated planar trajectory (East, North)
        can_spd_interp = np.interp(t_grid, v_uniq_t, v_s_sub[v_sort][v_u_idx])
        can_yaw_interp = np.interp(t_grid, v_uniq_t, v_y_sub[v_sort][v_u_idx])
        
        # Navigation heading: clockwise from North
        sin_psi = np.sin(u_head_interp)
        cos_psi = np.cos(u_head_interp)
        vel_e = can_spd_interp * sin_psi
        vel_n = can_spd_interp * cos_psi
        
        # Trapezoidal cumulative integration
        de = np.zeros(len(t_grid), dtype=np.float64)
        dn = np.zeros(len(t_grid), dtype=np.float64)
        if len(t_grid) > 1:
            de[1:] = 0.5 * (vel_e[:-1] + vel_e[1:]) * dt_target
            dn[1:] = 0.5 * (vel_n[:-1] + vel_n[1:]) * dt_target
        can_e = np.cumsum(de)
        can_n = np.cumsum(dn)

        seg_dict = {
            "time_s": t_grid - t_grid[0],
            "ax": np.interp(t_grid, unique_t, seg_ax),
            "ay": np.interp(t_grid, unique_t, seg_ay),
            "az": np.interp(t_grid, unique_t, seg_az),
            "gx": np.interp(t_grid, unique_t, seg_gx),
            "gy": np.interp(t_grid, unique_t, seg_gy),
            "gz": np.interp(t_grid, unique_t, seg_gz),
            "gyaw": np.interp(t_grid, unique_t, seg_gyaw),
            "gpit": np.interp(t_grid, unique_t, seg_gpit),
            "grol": np.interp(t_grid, unique_t, seg_grol),
            "mx": np.interp(t_grid, unique_t, seg_mx),
            "my": np.interp(t_grid, unique_t, seg_my),
            "mz": np.interp(t_grid, unique_t, seg_mz),
            # True Vehicle CAN Ground Truth Targets
            "spd_ms": can_spd_interp,
            "head_deg": head_deg_interp,
            "head_unwrapped_rad": u_head_interp,
            "yaw_rate_rads": can_yaw_interp,
            "can_east_m": can_e,
            "can_north_m": can_n,
            "lat": np.interp(t_grid, v_uniq_t, v_lat_sub[v_sort][v_u_idx]),
            "lon": np.interp(t_grid, v_uniq_t, v_lon_sub[v_sort][v_u_idx]),
            "v_paired": has_v
        }
        resampled_segments.append(seg_dict)

    return resampled_segments
