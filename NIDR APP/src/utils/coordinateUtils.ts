const WGS84_A = 6378137.0; // semi-major axis (m)
const WGS84_F = 1.0 / 298.257223563; // flattening
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F; // eccentricity squared

/**
 * Converts geodetic latitude/longitude to local East-North-Up (ENU) metres
 * relative to a reference coordinate (lat0, lon0).
 */
export function geodeticToEnu(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number
): { east: number; north: number } {
  const dLat = (lat - lat0) * (Math.PI / 180.0);
  const dLon = (lon - lon0) * (Math.PI / 180.0);
  const lat0Rad = lat0 * (Math.PI / 180.0);

  const sinLat = Math.sin(lat0Rad);
  const rN = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  const rM = (WGS84_A * (1.0 - WGS84_E2)) / Math.pow(1.0 - WGS84_E2 * sinLat * sinLat, 1.5);

  const north = dLat * rM;
  const east = dLon * rN * Math.cos(lat0Rad);

  return { east, north };
}

/**
 * Converts local East-North-Up (ENU) offsets back to geodetic coordinates.
 */
export function enuToGeodetic(
  east: number,
  north: number,
  lat0: number,
  lon0: number
): { latitude: number; longitude: number } {
  const lat0Rad = lat0 * (Math.PI / 180.0);
  const sinLat = Math.sin(lat0Rad);
  const rN = WGS84_A / Math.sqrt(1.0 - WGS84_E2 * sinLat * sinLat);
  const rM = (WGS84_A * (1.0 - WGS84_E2)) / Math.pow(1.0 - WGS84_E2 * sinLat * sinLat, 1.5);

  const dLat = north / rM;
  const dLon = east / (rN * Math.cos(lat0Rad));

  const latitude = lat0 + dLat * (180.0 / Math.PI);
  const longitude = lon0 + dLon * (180.0 / Math.PI);

  return { latitude, longitude };
}

/**
 * Haversine great-circle distance in metres between two geodetic coordinates.
 */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in metres
  const phi1 = (lat1 * Math.PI) / 180.0;
  const phi2 = (lat2 * Math.PI) / 180.0;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180.0;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180.0;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
