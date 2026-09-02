/**
 * IMU Simulator — converts road geometry → realistic phone IMU stream
 *
 * Given a sequence of [lat, lng] waypoints from OSRM, simulates:
 *   - accel [ax, ay, az] in body frame (m/s²)
 *   - gyro  [gx, gy, gz] in body frame (rad/s)
 *   - speed (m/s), heading (degrees)
 *
 * Scenario injection (after GPS cut):
 *   - STOP:  decelerates vehicle to 0 over 3s
 *   - ACCEL: accelerates from current speed to target over 4s
 *   - TURN:  injects yaw_rate offset for N seconds
 */

const EARTH_R = 6371000; // metres

function haversineM(a, b) {
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(x));
}

function bearing(a, b) {
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
  return Math.atan2(y, x); // radians
}

/** Convert ENU offset (dx, dy) metres → lat/lng offset from anchor */
function enuToLatLng(anchor, dx, dy) {
  const lat = anchor[0] + (dy / 111320);
  const lng = anchor[1] + (dx / (111320 * Math.cos(anchor[0] * Math.PI / 180)));
  return [lat, lng];
}

class ImuSimulator {
  constructor() {
    this.DT = 0.1;  // 10 Hz
    this.GRAVITY = 9.80665;
    this.SPEED_DEFAULT = 11.1; // 40 km/h in m/s
    this.ACCEL_MAX = 2.5;      // m/s² max longitudinal accel

    // Sensor noise stddev
    this.ACCEL_NOISE = 0.08;   // m/s²
    this.GYRO_NOISE  = 0.006;  // rad/s
    this.MOUNT_PITCH = 0.05;   // 3° tilt
    this.MOUNT_ROLL  = 0.02;

    // Internal state
    this.reset();
  }

  reset() {
    this.waypoints = [];       // [{lat, lng, dist_from_start}]
    this.totalDist = 0;
    this.traversed = 0;        // metres along route
    this.currentSpeed = 0;     // m/s
    this.targetSpeed  = this.SPEED_DEFAULT;
    this.headingRad   = 0;     // current vehicle heading
    this.prevHeadingRad = 0;
    this.prevSpeed    = 0;

    // Scenario injection
    this.scenarioYawExtra = 0; // additional yaw rate (rad/s)
    this.scenarioYawTime  = 0; // how long to apply it (seconds)
  }

  /** Load a route from OSRM geometry (array of [lng, lat] pairs) */
  loadRoute(coords) {
    this.reset();
    // Convert [lng, lat] → [lat, lng] and compute cumulative distances
    let cumDist = 0;
    this.waypoints = coords.map((c, i) => {
      if (i > 0) {
        cumDist += haversineM([coords[i-1][1], coords[i-1][0]], [c[1], c[0]]);
      }
      return { lat: c[1], lng: c[0], dist: cumDist };
    });
    this.totalDist = cumDist;

    // Init heading from first segment
    if (this.waypoints.length >= 2) {
      this.headingRad = bearing(
        [this.waypoints[0].lat, this.waypoints[0].lng],
        [this.waypoints[1].lat, this.waypoints[1].lng]
      );
    }
    console.log(`[IMU] Route loaded: ${this.waypoints.length} waypoints, ${(cumDist/1000).toFixed(2)} km`);
  }

  /** Get [lat, lng] at current traversed distance via linear interpolation */
  getPositionAtDist(dist) {
    const pts = this.waypoints;
    if (!pts.length) return [0, 0];
    dist = Math.max(0, Math.min(dist, pts[pts.length-1].dist));

    // Binary search for segment
    let lo = 0, hi = pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].dist <= dist) lo = mid; else hi = mid - 1;
    }
    const p0 = pts[lo], p1 = pts[lo + 1] || pts[lo];
    const seg = p1.dist - p0.dist;
    const t   = seg > 0 ? (dist - p0.dist) / seg : 0;
    return [
      p0.lat + t * (p1.lat - p0.lat),
      p0.lng + t * (p1.lng - p0.lng)
    ];
  }

  /** Get road heading at current position */
  getHeadingAtDist(dist) {
    const pts = this.waypoints;
    if (pts.length < 2) return 0;
    dist = Math.max(0, Math.min(dist, pts[pts.length-1].dist));

    let lo = 0, hi = pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].dist <= dist) lo = mid; else hi = mid - 1;
    }
    const p0 = pts[lo], p1 = pts[lo + 1] || pts[lo];
    return bearing([p0.lat, p0.lng], [p1.lat, p1.lng]);
  }

  /** Gaussian noise */
  _gauss(std) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /**
   * Step the simulation by DT seconds.
   * Returns { accel, gyro, gps_pos:[lat,lng], gps_speed, heading_deg, done }
   */
  step() {
    if (!this.waypoints.length) return null;

    const dt = this.DT;

    // --- Speed control (smooth acceleration) ---
    const dv = this.targetSpeed - this.currentSpeed;
    const accel_cmd = Math.sign(dv) * Math.min(Math.abs(dv) / dt, this.ACCEL_MAX);
    this.currentSpeed = Math.max(0, this.currentSpeed + accel_cmd * dt);

    // Slow for route end
    const remaining = this.totalDist - this.traversed;
    if (remaining < 30) this.targetSpeed = Math.min(this.targetSpeed, remaining / 3);

    // Advance position
    this.traversed += this.currentSpeed * dt;
    const done = this.traversed >= this.totalDist;

    // GPS truth position
    const gps_pos = this.getPositionAtDist(this.traversed);

    // Road heading
    const roadHeading = this.getHeadingAtDist(this.traversed);

    // Smooth heading towards road
    let dh = roadHeading - this.headingRad;
    while (dh >  Math.PI) dh -= 2*Math.PI;
    while (dh < -Math.PI) dh += 2*Math.PI;
    this.headingRad += Math.sign(dh) * Math.min(Math.abs(dh), 0.08 * Math.abs(this.currentSpeed) * dt + 0.01);

    // --- IMU computation ---
    // Longitudinal acceleration (body Y, forward direction)
    const long_accel = accel_cmd;

    // Yaw rate from heading change
    let yaw_rate = (this.headingRad - this.prevHeadingRad) / dt;
    this.prevHeadingRad = this.headingRad;

    // Scenario injection (TURN override)
    if (this.scenarioYawTime > 0) {
      yaw_rate += this.scenarioYawExtra;
      this.scenarioYawTime -= dt;
      if (this.scenarioYawTime <= 0) this.scenarioYawExtra = 0;
    }

    // Body-frame accel (phone tilted by mount angles)
    const ax_body =  long_accel * Math.sin(this.MOUNT_PITCH) + this._gauss(this.ACCEL_NOISE);
    const ay_body =  long_accel * Math.cos(this.MOUNT_PITCH) * Math.cos(this.MOUNT_ROLL) + this._gauss(this.ACCEL_NOISE);
    const az_body = -this.GRAVITY * Math.cos(this.MOUNT_PITCH) + this._gauss(this.ACCEL_NOISE * 0.5);

    const gyro_x  = this._gauss(this.GYRO_NOISE);           // pitch rate
    const gyro_y  = this._gauss(this.GYRO_NOISE);           // roll rate
    const gyro_z  = yaw_rate + this._gauss(this.GYRO_NOISE); // yaw rate

    this.prevSpeed = this.currentSpeed;

    return {
      accel:     [ax_body, ay_body, az_body],
      gyro:      [gyro_z, gyro_y, gyro_x],  // [yaw, pitch, roll] — matches IDREngine convention
      gps_pos,
      gps_speed: this.currentSpeed,
      heading_deg: (this.headingRad * 180 / Math.PI + 360) % 360,
      traversed:  this.traversed,
      totalDist:  this.totalDist,
      done
    };
  }

  /** Inject STOP scenario */
  injectStop() { this.targetSpeed = 0; }

  /** Inject ACCELERATE scenario */
  injectAccel(targetKmh = 60) { this.targetSpeed = targetKmh / 3.6; }

  /** Inject TURN scenario — sharp heading change */
  injectTurn(direction = 'left', durationS = 4) {
    this.scenarioYawExtra = direction === 'left' ? 0.35 : -0.35; // rad/s
    this.scenarioYawTime  = durationS;
  }

  /** Resume normal speed */
  injectResume() { this.targetSpeed = this.SPEED_DEFAULT; }
}

window.ImuSimulator = ImuSimulator;
window.haversineM   = haversineM;
window.enuToLatLng  = enuToLatLng;
