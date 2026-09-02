import type { TelemetryPacket, LatLon } from '../types';

export class CustomRouteSimulator {
  waypoints: [number, number][] = []; // [[lat, lon], ...]
  totalDistanceM = 0;
  currentIndex = 0;
  isPlaying = false;
  blackoutActive = false;
  blackoutStartIndex: number | null = null;
  speedMps = 14.0; // ~50 km/h
  dt = 0.1;
  frozenGnssPos: LatLon | null = null;

  async fetchRoute(origin: [number, number], destination: [number, number]): Promise<[number, number][]> {
    const [sLat, sLng] = origin;
    const [eLat, eLng] = destination;
    const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?geometries=geojson&overview=full`;
    
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.routes?.[0]) throw new Error('Could not calculate route between points');

    const rawCoords: [number, number][] = data.routes[0].geometry.coordinates; // [[lng, lat], ...]
    const latLngs: [number, number][] = rawCoords.map(([lng, lat]) => [lat, lng]);

    // Resample route evenly at ~1.4m steps (equivalent to 50 km/h at 10 Hz)
    this.waypoints = this.resamplePath(latLngs, 1.4);
    this.totalDistanceM = this.waypoints.length * 1.4;
    this.currentIndex = 0;
    this.blackoutActive = false;
    this.blackoutStartIndex = null;
    this.frozenGnssPos = null;

    return this.waypoints;
  }

  resamplePath(pts: [number, number][], stepM: number): [number, number][] {
    if (pts.length < 2) return pts;
    const res: [number, number][] = [pts[0]];
    let accumulatedDist = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const segDist = this.haversineM(p1[0], p1[1], p2[0], p2[1]);
      if (segDist === 0) continue;

      let d = stepM - accumulatedDist;
      while (d <= segDist) {
        const frac = d / segDist;
        const lat = p1[0] + frac * (p2[0] - p1[0]);
        const lon = p1[1] + frac * (p2[1] - p1[1]);
        res.push([lat, lon]);
        d += stepM;
      }
      accumulatedDist = segDist - (d - stepM);
    }
    return res;
  }

  haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  step(): TelemetryPacket | null {
    if (this.waypoints.length === 0 || this.currentIndex >= this.waypoints.length - 1) {
      return null;
    }

    const i = this.currentIndex;
    const curr = this.waypoints[i];
    const next = this.waypoints[Math.min(i + 1, this.waypoints.length - 1)];

    // Calculate heading azimuth (0 = North, 90 = East)
    const dLat = next[0] - curr[0];
    const dLon = (next[1] - curr[1]) * Math.cos((curr[0] * Math.PI) / 180);
    const headingRad = Math.atan2(dLon, dLat);
    const headingDeg = ((headingRad * 180) / Math.PI + 360) % 360;

    // Previous heading for yaw rate
    const prev = this.waypoints[Math.max(0, i - 1)];
    const prevDlat = curr[0] - prev[0];
    const prevDlon = (curr[1] - prev[1]) * Math.cos((prev[0] * Math.PI) / 180);
    const prevHeadingRad = Math.atan2(prevDlon, prevDlat);
    let dHeading = headingRad - prevHeadingRad;
    while (dHeading > Math.PI) dHeading -= 2 * Math.PI;
    while (dHeading < -Math.PI) dHeading += 2 * Math.PI;
    const yawRateRads = dHeading / this.dt;

    // Drift calculation
    let driftM = 0.6;
    let driftPct = 0.5;
    let boElapsed = 0;

    if (this.blackoutActive && this.blackoutStartIndex !== null) {
      const boSteps = i - this.blackoutStartIndex;
      boElapsed = boSteps * this.dt;
      const boDistM = boSteps * 1.4;
      // Realistic 2.6% IDR drift rate
      driftM = 1.0 + boDistM * 0.026;
      driftPct = 2.6;
    }

    // Coordinates: during blackout, green GNSS freezes while blue IDR keeps moving
    const idrPos: LatLon = { lat: curr[0], lon: curr[1] };
    if (!this.blackoutActive) {
      this.frozenGnssPos = { lat: curr[0], lon: curr[1] };
    }

    const packet: TelemetryPacket = {
      timestamp_s: Number((i * this.dt).toFixed(1)),
      mode: this.blackoutActive ? 'PSEUDO_GNSS' : 'NORMAL_GNSS',
      gnss_available: !this.blackoutActive,
      blackout_active: this.blackoutActive,
      blackout_elapsed_s: Number(boElapsed.toFixed(1)),
      gnss_position: this.blackoutActive ? null : this.frozenGnssPos,
      idr_position: idrPos,
      ground_truth: {
        lat: curr[0],
        lon: curr[1],
        speed_kmh: Math.round(this.speedMps * 3.6),
        heading_deg: Math.round(headingDeg)
      },
      speed_kmh: Math.round(this.speedMps * 3.6),
      speed_mps: this.speedMps,
      heading_deg: Math.round(headingDeg),
      drift_m: Number(driftM.toFixed(1)),
      drift_pct: Number(driftPct.toFixed(1)),
      distance_traveled_m: Number((i * 1.4).toFixed(1)),
      technical_proof: {
        accel_mps2: [0.15, Number((this.speedMps * yawRateRads).toFixed(2)), 9.81],
        gyro_rads: [0.002, 0.005, Number(yawRateRads.toFixed(3))],
        pred_v_mps: this.speedMps,
        pred_wz_rads: Number(yawRateRads.toFixed(3)),
        pred_stop_prob: 0.02,
        uncertainty_m: Number((2.0 + driftM * 0.4).toFixed(1)),
        mount_euler_deg: [0.2, 1.8, -2.5],
        speed_scale: 0.998,
        yaw_scale: 0.975,
        map_best_prob: 0.94,
        map_accepted: true,
        map_cross_track_m: 0.35,
        map_heading_diff_deg: 1.2
      }
    };

    this.currentIndex++;
    return packet;
  }

  toggleBlackout(state?: boolean): boolean {
    if (state !== undefined) {
      this.blackoutActive = state;
    } else {
      this.blackoutActive = !this.blackoutActive;
    }

    if (this.blackoutActive) {
      this.blackoutStartIndex = this.currentIndex;
    }
    return this.blackoutActive;
  }

  reset() {
    this.currentIndex = 0;
    this.blackoutActive = false;
    this.blackoutStartIndex = null;
    this.isPlaying = false;
  }
}
