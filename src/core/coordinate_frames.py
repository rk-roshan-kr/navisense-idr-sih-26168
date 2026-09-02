"""
SIH 26168 - Coordinate Frames and Kinematic Transformations
Handles Geodetic (WGS84) to Local Cartesian (ENU), Euler rotations, 
Direction Cosine Matrices (DCM), and gravity compensation.
"""

import numpy as np

# WGS84 Ellipsoid constants
WGS84_A = 6378137.0          # semi-major axis (meters)
WGS84_F = 1.0 / 298.257223563 # flattening
WGS84_B = WGS84_A * (1.0 - WGS84_F)
WGS84_E2 = 2.0 * WGS84_F - WGS84_F ** 2 # first eccentricity squared
STANDARD_GRAVITY = 9.80665   # m/s^2


def geodetic_to_ecef(lat_deg, lon_deg, alt_m=0.0):
    """Convert geodetic latitude, longitude, altitude to ECEF coordinates."""
    lat_rad = np.radians(lat_deg)
    lon_rad = np.radians(lon_deg)
    
    sin_lat = np.sin(lat_rad)
    cos_lat = np.cos(lat_rad)
    sin_lon = np.sin(lon_rad)
    cos_lon = np.cos(lon_rad)
    
    n = WGS84_A / np.sqrt(1.0 - WGS84_E2 * sin_lat ** 2)
    
    x = (n + alt_m) * cos_lat * cos_lon
    y = (n + alt_m) * cos_lat * sin_lon
    z = (n * (1.0 - WGS84_E2) + alt_m) * sin_lat
    
    return np.array([x, y, z], dtype=np.float64)


def geodetic_to_enu(lat_deg, lon_deg, alt_m, ref_lat, ref_lon, ref_alt=0.0):
    """
    Convert geodetic coordinates to local East-North-Up (ENU) coordinates
    relative to a reference geodetic point.
    """
    r_ecef = geodetic_to_ecef(lat_deg, lon_deg, alt_m)
    r_ref_ecef = geodetic_to_ecef(ref_lat, ref_lon, ref_alt)
    
    diff = r_ecef - r_ref_ecef
    
    ref_lat_rad = np.radians(ref_lat)
    ref_lon_rad = np.radians(ref_lon)
    
    sin_lat = np.sin(ref_lat_rad)
    cos_lat = np.cos(ref_lat_rad)
    sin_lon = np.sin(ref_lon_rad)
    cos_lon = np.cos(ref_lon_rad)
    
    # Rotation matrix ECEF to ENU
    r_matrix = np.array([
        [-sin_lon, cos_lon, 0.0],
        [-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat],
        [cos_lat * cos_lon, cos_lat * sin_lon, sin_lat]
    ], dtype=np.float64)
    
    return np.dot(r_matrix, diff)


def euler_to_dcm(roll_rad, pitch_rad, yaw_rad):
    """
    Convert Euler angles (roll phi, pitch theta, yaw psi) in Z-Y-X sequence
    to Direction Cosine Matrix (Rotation matrix R_body_to_nav).
    """
    cr = np.cos(roll_rad)
    sr = np.sin(roll_rad)
    cp = np.cos(pitch_rad)
    sp = np.sin(pitch_rad)
    cy = np.cos(yaw_rad)
    sy = np.sin(yaw_rad)
    
    r = np.array([
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp, cp * sr, cp * cr]
    ], dtype=np.float64)
    return r


def dcm_to_euler(dcm):
    """Extract roll, pitch, yaw from DCM (R_body_to_nav)."""
    pitch = -np.arcsin(np.clip(dcm[2, 0], -1.0, 1.0))
    if np.abs(np.cos(pitch)) > 1e-6:
        roll = np.arctan2(dcm[2, 1], dcm[2, 2])
        yaw = np.arctan2(dcm[1, 0], dcm[0, 0])
    else:
        roll = 0.0
        yaw = np.arctan2(-dcm[0, 1], dcm[1, 1])
    return roll, pitch, yaw


def propagate_attitude_dcm(dcm, gyro_rad_s, dt):
    """
    Propagate attitude DCM using angular rate vector via matrix exponential/first-order update.
    R_{k+1} = R_k * exp([omega x] * dt)
    """
    wx, wy, wz = gyro_rad_s
    sigma = np.sqrt(wx**2 + wy**2 + wz**2) * dt
    
    omega_skew = np.array([
        [0.0, -wz, wy],
        [wz, 0.0, -wx],
        [-wy, wx, 0.0]
    ], dtype=np.float64)
    
    if sigma < 1e-8:
        delta_r = np.eye(3) + omega_skew * dt
    else:
        delta_r = (np.eye(3) + 
                   (np.sin(sigma) / (sigma / dt)) * omega_skew + 
                   ((1.0 - np.cos(sigma)) / (sigma**2 / dt**2)) * np.dot(omega_skew, omega_skew))
                   
    new_dcm = np.dot(dcm, delta_r)
    # Orthogonalize DCM
    u, _, vt = np.linalg.svd(new_dcm)
    return np.dot(u, vt)
