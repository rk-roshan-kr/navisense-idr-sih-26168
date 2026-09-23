// Centralized UI Display Formatters — Guaranteed Zero NaN / Null / Undefined Leaks

/**
 * Checks if a value is a valid, finite number (not null, undefined, NaN, or Infinity)
 */
export function isValidNumber(val: any): val is number {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
}

/**
 * Formats distance in meters to a clean readable string (km or m)
 * Examples: 1800 -> "1.8 km", 450 -> "450 m", null -> "—"
 */
export function formatDistance(meters?: number | null): string {
  if (!isValidNumber(meters)) return '—';
  if (meters < 0) return '0 m';

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

/**
 * Formats speed in km/h
 * Examples: 42.4 -> "42", 0 -> "0", null -> "—"
 */
export function formatSpeed(kmh?: number | null): string {
  if (!isValidNumber(kmh)) return '—';
  if (kmh < 0) return '0';
  return `${Math.round(kmh)}`;
}

/**
 * Formats heading azimuth with cardinal direction
 * Examples: 83.2 -> { degStr: "083°", cardinal: "E", full: "083° E" }, null -> { full: "Heading unavailable" }
 */
export function formatHeading(deg?: number | null): {
  degStr: string;
  cardinal: string;
  full: string;
  isAvailable: boolean;
} {
  if (!isValidNumber(deg)) {
    return {
      degStr: '—',
      cardinal: '—',
      full: 'Heading unavailable',
      isAvailable: false,
    };
  }

  const normalized = ((deg % 360) + 360) % 360;
  const rounded = Math.round(normalized);
  const degStr = `${String(rounded).padStart(3, '0')}°`;

  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const idx = Math.round(normalized / 45);
  const cardinal = cardinals[idx] || 'N';

  return {
    degStr,
    cardinal,
    full: `${degStr} ${cardinal}`,
    isAvailable: true,
  };
}

/**
 * Formats estimated time of arrival (ETA) in minutes
 * Examples: 4 -> "ETA 4 min", 65 -> "ETA 1h 5m", null -> "—"
 */
export function formatEta(minutes?: number | null): string {
  if (!isValidNumber(minutes)) return '—';
  if (minutes <= 0) return 'Arrived';

  const m = Math.round(minutes);
  if (m < 60) {
    return `ETA ${m} min`;
  }
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return `ETA ${hours}h ${mins}m`;
}

/**
 * Formats uncertainty or accuracy margin in meters
 * Examples: 4.2 -> "±4.2 m", 0.65 -> "±0.65 m (Sub-meter)", null -> "—"
 */
export function formatAccuracy(meters?: number | null, isSubmeter = false): string {
  if (!isValidNumber(meters)) return '—';
  const val = Math.abs(meters);

  if (val < 1.0 || isSubmeter) {
    return `±${val.toFixed(2)} m`;
  }
  return `±${val.toFixed(1)} m`;
}

/**
 * Formats drift percentage
 * Examples: 1.2 -> "1.2%", null -> "—"
 */
export function formatDriftPct(pct?: number | null): string {
  if (!isValidNumber(pct)) return '—';
  return `${pct.toFixed(1)}%`;
}

/**
 * Formats geodetic coordinates [lat, lon]
 * Examples: (28.6315, 77.2167) -> "28.63150°, 77.21670°", null -> "Coordinates unavailable"
 */
export function formatCoordinate(lat?: number | null, lon?: number | null): string {
  if (!isValidNumber(lat) || !isValidNumber(lon)) {
    return 'Coordinates unavailable';
  }
  return `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
}

/**
 * Formats safe human-readable text with fallback and maximum length truncation
 */
export function formatSafeText(text: string | null | undefined, fallback: string, maxLength?: number): string {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return fallback;
  }
  const clean = text.trim();
  if (maxLength && clean.length > maxLength) {
    return `${clean.substring(0, maxLength)}…`;
  }
  return clean;
}
