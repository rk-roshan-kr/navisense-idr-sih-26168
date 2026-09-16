"""
Reference GNSS Trajectory Generation, Quality Filtering & Geodetic-to-ENU Projection.

Terminology standard:
- 'Reference Trajectory': Derived from quality-filtered, forward-backward smoothed
  smartphone GNSS coordinates. We explicitly do NOT call raw phone GNSS 'ground truth'.
"""

import numpy as np
from scipy.signal import savgol_filter


# WGS-84 Ellipsoid Constants
WGS84_A = 6378137.0             # Semi-major axis (meters)
WGS84_F = 1.0 / 298.257223563   # Flattening
WGS84_B = WGS84_A * (1.0 - WGS84_F)
WGS84_E2 = 2.0 * WGS84_F - WGS84_F**2  # First eccentricity squared


def geodetic_to_ecef(lat_deg: np.ndarray, lon_deg: np.ndarray, alt_m: np.ndarray):
    """
    Converts WGS-84 Geodetic Coordinates (lat, lon, alt) to Earth-Centered Earth-Fixed (ECEF) [X, Y, Z].
    """
    lat_rad = np.radians(lat_deg)
    lon_rad = np.radians(lon_deg)

    sin_lat = np.sin(lat_rad)
    cos_lat = np.cos(lat_rad)
    sin_lon = np.sin(lon_rad)
    cos_lon = np.cos(lon_rad)

    # Prime vertical radius of curvature
    n = WGS84_A / np.sqrt(1.0 - WGS84_E2 * sin_lat**2)

    x = (n + alt_m) * cos_lat * cos_lon
    y = (n + alt_m) * cos_lat * sin_lon
    z = (n * (1.0 - WGS84_E2) + alt_m) * sin_lat

    return x, y, z


def geodetic_to_enu(lat_deg: np.ndarray, lon_deg: np.ndarray, alt_m: np.ndarray,
                    anchor_lat: float, anchor_lon: float, anchor_alt: float):
    """
    Transforms WGS-84 Geodetic coordinates to Local East-North-Up (ENU) coordinates
    relative to a local anchor point P0 = (anchor_lat, anchor_lon, anchor_alt).

    Returns:
        e: East displacement in meters
        n: North displacement in meters
        u: Up displacement in meters
    """
    lat_deg = np.asarray(lat_deg, dtype=np.float64)
    lon_deg = np.asarray(lon_deg, dtype=np.float64)
    alt_m = np.asarray(alt_m, dtype=np.float64)

    x, y, z = geodetic_to_ecef(lat_deg, lon_deg, alt_m)
    x0, y0, z0 = geodetic_to_ecef(anchor_lat, anchor_lon, anchor_alt)

    dx = x - x0
    dy = y - y0
    dz = z - z0

    phi0 = np.radians(anchor_lat)
    lam0 = np.radians(anchor_lon)

    sin_phi0 = np.sin(phi0)
    cos_phi0 = np.cos(phi0)
    sin_lam0 = np.sin(lam0)
    cos_lam0 = np.cos(lam0)

    e = -sin_lam0 * dx + cos_lam0 * dy
    n = -sin_phi0 * cos_lam0 * dx - sin_phi0 * sin_lam0 * dy + cos_phi0 * dz
    u = cos_phi0 * cos_lam0 * dx + cos_phi0 * sin_lam0 * dy + sin_phi0 * dz

    return e, n, u


def enu_to_geodetic(e: np.ndarray, n: np.ndarray, u: np.ndarray,
                     anchor_lat: float, anchor_lon: float, anchor_alt: float):
    """
    Inverse transform: Local ENU (East, North, Up in meters) back to WGS-84 Geodetic (lat, lon, alt).
    """
    phi0 = np.radians(anchor_lat)
    lam0 = np.radians(anchor_lon)

    sin_phi0 = np.sin(phi0)
    cos_phi0 = np.cos(phi0)
    sin_lam0 = np.sin(lam0)
    cos_lam0 = np.cos(lam0)

    # Invert ENU rotation
    dx = -sin_lam0 * e - sin_phi0 * cos_lam0 * n + cos_phi0 * cos_lam0 * u
    dy = cos_lam0 * e - sin_phi0 * sin_lam0 * n + cos_phi0 * sin_lam0 * u
    dz = cos_phi0 * n + sin_phi0 * u

    x0, y0, z0 = geodetic_to_ecef(anchor_lat, anchor_lon, anchor_alt)
    x = x0 + dx
    y = y0 + dy
    z = z0 + dz

    # Ferrari's algebraic solution for ECEF to geodetic
    p = np.sqrt(x**2 + y**2)
    theta = np.arctan2(z * WGS84_A, p * WGS84_B)
    e_prime2 = (WGS84_A**2 - WGS84_B**2) / (WGS84_B**2)

    lat = np.arctan2(z + e_prime2 * WGS84_B * np.sin(theta)**3,
                     p - WGS84_E2 * WGS84_A * np.cos(theta)**3)
    lon = np.arctan2(y, x)
    n_curve = WGS84_A / np.sqrt(1.0 - WGS84_E2 * np.sin(lat)**2)
    alt = p / np.cos(lat) - n_curve

    return np.degrees(lat), np.degrees(lon), alt


def smooth_reference_trajectory(e: np.ndarray, n: np.ndarray, u: np.ndarray,
                                timestamps_s: np.ndarray, accuracy_m: np.ndarray,
                                window_length_s: float = 3.0):
    """
    Applies forward-backward smoothing to noisy smartphone GNSS coordinates
    to produce a high-fidelity reference trajectory for training.

    Uses adaptive polynomial smoothing (Savitzky-Golay / weighted low-pass filter)
    respecting temporal sample density.
    """
    n_points = len(e)
    if n_points < 7:
        # Too few points to smooth safely
        return e.copy(), n.copy(), u.copy()

    dt = np.median(np.diff(timestamps_s)) if n_points > 1 else 1.0
    if dt <= 0:
        dt = 1.0

    # Determine filter window size (must be odd)
    window_pts = int(round(window_length_s / dt))
    if window_pts % 2 == 0:
        window_pts += 1
    window_pts = max(5, min(window_pts, n_points if n_points % 2 != 0 else n_points - 1))

    if window_pts > 3:
        poly_order = min(2, window_pts - 1)
        e_smooth = savgol_filter(e, window_length=window_pts, polyorder=poly_order)
        n_smooth = savgol_filter(n, window_length=window_pts, polyorder=poly_order)
        u_smooth = savgol_filter(u, window_length=window_pts, polyorder=poly_order)
    else:
        e_smooth, n_smooth, u_smooth = e.copy(), n.copy(), u.copy()

    return e_smooth, n_smooth, u_smooth


def compute_reference_quality_weights(accuracy_m: np.ndarray,
                                      time_since_fix_s: np.ndarray,
                                      max_accuracy_threshold_m: float = 15.0) -> np.ndarray:
    """
    Computes a target quality weight w_t in [0.1, 1.0] for each reference point:
    - High confidence (small accuracy error, recent GNSS fix): weight ~ 1.0
    - Degraded / interpolated (large accuracy circle or distant fix): weight ~ 0.1-0.3
    """
    acc_factor = np.clip(1.0 - (accuracy_m / max_accuracy_threshold_m), 0.0, 1.0)
    time_decay = np.exp(-time_since_fix_s / 3.0)  # Decay confidence if interpolated far from fix
    weights = 0.1 + 0.9 * (acc_factor * time_decay)
    return np.clip(weights, 0.1, 1.0)
