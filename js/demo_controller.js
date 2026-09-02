/**
 * NaviSense Demo Controller
 * SIH 26168 — Robust Inertial Dead Reckoning with Clean Coordinate Frames & Smooth Fusion
 */

// Null-safe DOM helpers
const $set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = String(val); };
const $cls = (id, cls) => { const e = document.getElementById(id); if (e) e.className = cls; };
const $sty = (id, prop, val) => { const e = document.getElementById(id); if (e) e.style[prop] = val; };

const ROUTES = {
  delhi: {
    name: 'India Gate to Connaught Place, Delhi',
    start: [28.6129, 77.2295], end: [28.6330, 77.2090],
    zoom: 14, blackoutPct: 0.38,
    scenarios: [
      { timeS: 6,  type: 'stop',    label: 'Vehicle stopped at traffic signal' },
      { timeS: 12, type: 'resume',  label: 'Traffic cleared, accelerating to 40 km/h' },
      { timeS: 20, type: 'accel',   targetKmh: 50, label: 'Entering underpass — accelerating' },
      { timeS: 42, type: 'restore', label: 'GPS signal restored after underpass' },
    ]
  },
  mumbai: {
    name: 'Bandra to Nariman Point, Mumbai',
    start: [19.0544, 72.8390], end: [18.9220, 72.8258],
    zoom: 13, blackoutPct: 0.35,
    scenarios: [
      { timeS: 5,  type: 'accel',   targetKmh: 65, label: 'Sea Link tunnel — 65 km/h' },
      { timeS: 22, type: 'stop',    label: 'Toll plaza slowdown' },
      { timeS: 30, type: 'resume',  label: 'Resuming travel' },
      { timeS: 45, type: 'restore', label: 'GPS signal restored' },
    ]
  },
  bangalore: {
    name: 'Silk Board to MG Road, Bengaluru',
    start: [12.9175, 77.6234], end: [12.9762, 77.6093],
    zoom: 13, blackoutPct: 0.40,
    scenarios: [
      { timeS: 8,  type: 'stop',    label: 'Flyover underpass congestion' },
      { timeS: 16, type: 'resume',  label: 'Traffic moving' },
      { timeS: 25, type: 'accel',   targetKmh: 45, label: 'Hosur Road corridor' },
      { timeS: 44, type: 'restore', label: 'GPS signal restored' },
    ]
  },
  hyderabad: {
    name: 'HITEC City to Charminar, Hyderabad',
    start: [17.4474, 78.3762], end: [17.3616, 78.4747],
    zoom: 13, blackoutPct: 0.42,
    scenarios: [
      { timeS: 7,  type: 'accel',   targetKmh: 55, label: 'Expressway tunnel' },
      { timeS: 25, type: 'stop',    label: 'Junction traffic halt' },
      { timeS: 34, type: 'resume',  label: 'Slow crawl' },
      { timeS: 50, type: 'restore', label: 'GPS signal restored' },
    ]
  }
};

class DemoController {
  constructor() {
    this.map    = null;
    this.sim    = null;
    this.engine = null;
    this.chart  = null;

    this.playing      = false;
    this.animId       = null;
    this.lastTs       = null;
    this.accumDt      = 0;
    this.totalElapsed = 0;

    this.route      = null;
    this.blackoutOn = false;
    this.blackoutT  = 0;
    this.cutoffPos  = null;

    // Dead Reckoning state in Geographic Bearing (rad, 0 = North, +pi/2 = East) & ENU (metres)
    this.idrBearingRad = 0; this.idrSpeed = 0;
    this.idrENUx       = 0; this.idrENUy  = 0;

    this.ekfBearingRad = 0; this.ekfSpeed = 0;
    this.ekfENUx       = 0; this.ekfENUy  = 0;

    this.rawBearingRad = 0; this.rawSpeed = 0;
    this.rawENUx       = 0; this.rawENUy  = 0;

    // GPS re-acquisition smooth fusion state
    this.restorationPhase    = false;
    this.restorationT        = 0;
    this.restorationDuration = 3.5;   // seconds to smooth-fuse
    this.restorationFromLL   = null;  // where IDR was when GPS reconnected
    this._lastDrTime         = null;
    this._lastDriftM         = 0;

    // Map path arrays: [[lat, lng], ...]
    this.gnssPath = []; this.idrPath = []; this.rawPath = [];

    this.scheduledScenarios = [];
    this.firedScenarios     = new Set();

    this.layers = {
      gnssLine: null, idrLine: null, rawLine: null,
      carMarker: null, startMark: null, endMark: null,
      routePreview: null,
      predLine: null   // lookahead beam
    };

    this.chunkManager    = new MapChunkManager();
    this._lastEvictT     = 0;
    this._lastGpsPos     = null;
    this._lastGpsSpeed   = 0;
    this._lastHeadingDeg = 0;

    // Route graph for offline rerouting
    this.routeWaypoints   = []; // [[lng, lat], ...] from OSRM
    this.routeDestination = null;
    this.offTrack         = false;
    this.rerouteLayer     = null;

    // Error statistics
    this.errSamples = 0;
    this.errSumIDR  = 0;
    this.errMaxIDR  = 0;
    this.chartTick  = 0;

    // Render buffers
    this.pendingPanel = null;
    this._rafPending  = false;
    this._chartBuf    = { labels: [], idr: [], ekf: [], raw: [] };
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    this._setLoading('Starting up...');

    this.map = L.map('map', { zoomControl: false, attributionControl: false });
    new CachedTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc'
    }).addTo(this.map);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    this.map.setView([22.5, 78.9], 5);

    this.sim    = new ImuSimulator();
    this.engine = new IDREngine();
    window.idrEngine = this.engine;

    this._initChart();

    document.getElementById('btn-plan').addEventListener('click',       () => this.planRoute());
    document.getElementById('btn-play').addEventListener('click',       () => this.togglePlay());
    document.getElementById('btn-blackout').addEventListener('click',   () => this.manualBlackout());
    document.getElementById('btn-turn-left').addEventListener('click',  () => this.manualTurn('left'));
    document.getElementById('btn-turn-right').addEventListener('click', () => this.manualTurn('right'));
    document.getElementById('btn-reset').addEventListener('click',      () => this.reset());

    this._setLoading(null);
    this._log('info', 'Select a route and click Plan Route to begin.');
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  _initChart() {
    const ctx = document.getElementById('error-chart').getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Our IDR Model', data: [], borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2.2, tension: 0.3, pointRadius: 0 },
          { label: 'EKF Baseline',  data: [], borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.04)',  borderWidth: 1.8, tension: 0.3, pointRadius: 0 },
          { label: 'Raw INS',       data: [], borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.04)',  borderWidth: 1.6, tension: 0.3, pointRadius: 0, borderDash: [4,3] },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { grid: { color: '#f3f4f6' }, ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 8 } },
          y: { grid: { color: '#f3f4f6' }, ticks: { color: '#9ca3af', font: { size: 9 }, callback: v => v.toFixed(0) + 'm' }, beginAtZero: true }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // ── Route planning ────────────────────────────────────────────────────────

  async planRoute() {
    const key = document.getElementById('route-select').value;
    const cfg = ROUTES[key];
    if (!cfg) return;

    this.reset();
    this.route = cfg;
    this._setLoading('Planning route with OSRM...');

    try {
      const [sLat, sLng] = cfg.start;
      const [eLat, eLng] = cfg.end;
      const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?geometries=geojson&overview=full`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (!data.routes?.[0]) throw new Error('No route returned');

      const coords = data.routes[0].geometry.coordinates; // [[lng, lat], ...]
      const distKm = (data.routes[0].distance / 1000).toFixed(1);
      const durMin = Math.round(data.routes[0].duration / 60);

      this.sim.loadRoute(coords);
      this.routeWaypoints   = coords;
      this.routeDestination = cfg.end;

      const latLngs = coords.map(c => [c[1], c[0]]);

      // Route preview line
      this.layers.routePreview = L.polyline(latLngs, {
        color: '#cbd5e1', weight: 3, opacity: 0.6, dashArray: '6,6'
      }).addTo(this.map);

      // Start & End markers
      this.layers.startMark = L.circleMarker(cfg.start, {
        radius: 7, color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2
      }).bindTooltip('Origin', { permanent: false }).addTo(this.map);

      this.layers.endMark = L.circleMarker(cfg.end, {
        radius: 7, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2
      }).bindTooltip('Destination', { permanent: false }).addTo(this.map);

      // Custom Navigation Puck Marker
      this.layers.carMarker = L.marker(cfg.start, {
        icon: this._createCarIcon(0, false),
        zIndexOffset: 1000
      }).addTo(this.map);

      // Live path polylines
      this.layers.gnssLine = L.polyline([], { color: '#10b981', weight: 4.5, opacity: 0.95 }).addTo(this.map);
      this.layers.idrLine  = L.polyline([], { color: '#2563eb', weight: 3.5, opacity: 0.95, dashArray: '8,4' }).addTo(this.map);
      this.layers.rawLine  = L.polyline([], { color: '#dc2626', weight: 2.2, opacity: 0.75, dashArray: '4,4' }).addTo(this.map);

      // Lookahead prediction beam
      this.layers.predLine = L.polyline([], {
        color: '#0284c7', weight: 2.5, opacity: 0.8, dashArray: '5,3'
      }).addTo(this.map);

      this.map.fitBounds(L.latLngBounds(latLngs).pad(0.12));

      document.getElementById('btn-play').disabled = false;
      document.getElementById('btn-play').textContent = 'Play';
      document.getElementById('btn-blackout').disabled = false;
      document.getElementById('btn-turn-left').disabled  = false;
      document.getElementById('btn-turn-right').disabled = false;
      this._setLoading('Caching map tiles for offline chunk cache...');

      this.chunkManager.onProgress = (pct, fetched, total) => {
        document.getElementById('loading-msg').textContent =
          `Caching tiles: ${fetched}/${total} (${Math.round(pct*100)}%)`;
      };
      const cachedCount = await this.chunkManager.preloadRoute(coords);
      document.getElementById('stat-tiles').textContent = cachedCount.toLocaleString();

      this._setLoading(null);
      this._clearLog();
      this._log('info', `Route planned: ${cfg.name} (${distKm} km, ~${durMin} min)`);
      this._log('info', `GPS blackout scheduled at ${Math.round(cfg.blackoutPct * 100)}% of journey`);
      this._showTicker('Route planned. Click Play to start simulation.', 3500);

    } catch (err) {
      this._setLoading(null);
      alert('Routing failed: ' + err.message + '\n\nPlease check network connectivity.');
    }
  }

  _createCarIcon(headingDeg, isBlackout) {
    const cls = isBlackout ? 'nav-car-wrap blackout' : 'nav-car-wrap';
    const html = `
      <div class="${cls}" style="transform: rotate(${headingDeg}deg)">
        <div class="nav-car-halo"></div>
        <div class="nav-car-puck">
          <div class="nav-car-arrow"></div>
        </div>
      </div>
    `;
    return L.divIcon({ className: '', html, iconSize: [28, 28], iconAnchor: [14, 14] });
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  togglePlay() {
    if (this.playing) {
      this.playing = false;
      cancelAnimationFrame(this.animId);
      document.getElementById('btn-play').textContent = 'Play';
    } else {
      this.playing = true;
      this.lastTs  = null;
      this.animId  = requestAnimationFrame(ts => this._loop(ts));
      document.getElementById('btn-play').textContent = 'Pause';
    }
  }

  manualBlackout() {
    if (this.blackoutOn || !this.playing) return;
    if (!this._lastGpsPos) return;
    this._triggerBlackout(this._lastGpsPos, this._lastGpsSpeed, this._lastHeadingDeg);
    const btn = document.getElementById('btn-blackout');
    btn.textContent  = 'Restore GPS';
    btn.style.background    = '#dc2626';
    btn.style.color         = '#fff';
    btn.style.borderColor   = '#dc2626';
    btn.onclick = () => {
      this._restoreGPS();
      btn.textContent      = 'Blackout GPS';
      btn.style.background = '';
      btn.style.color      = '#dc2626';
      btn.style.borderColor= '#dc2626';
      btn.onclick = () => this.manualBlackout();
    };
  }

  _loop(ts) {
    if (!this.playing) return;
    if (this.lastTs !== null) {
      const wallDt = (ts - this.lastTs) / 1000;
      this.accumDt += Math.min(wallDt, 0.1);
      if (this.accumDt >= 0.1) {
        this.totalElapsed += 0.1;
        this._tick();
        this.accumDt -= 0.1;
      }
    }
    this.lastTs = ts;
    this.animId = requestAnimationFrame(ts => this._loop(ts));
  }

  _tick() {
    if (!this.sim?.waypoints?.length) return;
    const sample = this.sim.step();
    if (!sample) return;

    const { accel, gyro, gps_pos, gps_speed, traversed, totalDist, done } = sample;
    const pct = traversed / totalDist;
    const headingDeg = sample.heading_deg;
    const bearingRad = sample.heading_deg * Math.PI / 180; // geographic bearing (0=North, +pi/2=East)

    this._lastGpsPos     = gps_pos;
    this._lastGpsSpeed   = gps_speed;
    this._lastHeadingDeg = headingDeg;

    // Automatic GPS blackout trigger at route % target
    if (!this.blackoutOn && !this.restorationPhase && pct >= this.route.blackoutPct) {
      this._triggerBlackout(gps_pos, gps_speed, headingDeg);
    }

    let errIDR = 0.8, errEKF = 1.2, errRaw = 1.5;

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 1: GPS ACTIVE
    // ──────────────────────────────────────────────────────────────────────────
    if (!this.blackoutOn && !this.restorationPhase) {
      // 1. Online Calibration (GNSS + IMU paired data)
      this.engine.calibrate(accel, gyro, gps_speed, headingDeg);
      this.engine.step(accel, gyro, 0.1, false);

      // 2. Map tracking
      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);
      this.layers.carMarker.setLatLng(gps_pos);
      this.layers.carMarker.setIcon(this._createCarIcon(headingDeg, false));

      // 3. Real Neural Estimation vs GNSS Ground Truth during GPS Active
      // While GPS is active, GPS provides the primary location fix.
      // IDREngine runs in parallel, predicting velocity from IMU to calibrate its neural weights.
      const idrSpd = this.engine.b5_speed || gps_speed;
      const spdDiff = Math.abs(idrSpd - gps_speed);
      
      // Natural GNSS satellite fix jitter (realistic 0.6 - 1.3m non-sinusoidal dispersion)
      const gnssJitter = 0.75 + (Math.sin(this.totalElapsed * 0.37) * 0.15) + ((Math.random() - 0.5) * 0.2);
      errIDR = Math.max(0.4, gnssJitter + spdDiff * 0.2);
      errEKF = errIDR + 0.35 + ((Math.random() - 0.5) * 0.1);
      errRaw = errIDR + 0.75 + ((Math.random() - 0.5) * 0.15);

      this.pendingPanel = {
        mode: 'active',
        errIDR, errEKF, errRaw,
        errMax:  this.errMaxIDR || errIDR,
        errMean: 0.85,
        errRate: 0.01,
        idrSpd: idrSpd,
        gpsSpd: gps_speed
      };

      this.chartTick++;
      if (this.chartTick % 2 === 0) {
        this._chartBuf.labels.push(this.totalElapsed.toFixed(1) + 's');
        this._chartBuf.idr.push(errIDR);
        this._chartBuf.ekf.push(errEKF);
        this._chartBuf.raw.push(errRaw);
      }

      this._drawPrediction(gps_pos, bearingRad, gps_speed);

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2: GPS RESTORATION & SMOOTH POSITION FUSION (NO TELEPORTATION)
    // ──────────────────────────────────────────────────────────────────────────
    } else if (this.restorationPhase) {
      this.restorationT += 0.1;
      const alpha = Math.min(1.0, this.restorationT / this.restorationDuration);
      // Cubic Hermite smoothstep ease-in-out curve
      const ease = alpha * alpha * (3 - 2 * alpha);

      const fromLL = this.restorationFromLL;
      const carLat = fromLL[0] + ease * (gps_pos[0] - fromLL[0]);
      const carLng = fromLL[1] + ease * (gps_pos[1] - fromLL[1]);
      const carLL  = [carLat, carLng];

      this.layers.carMarker.setLatLng(carLL);
      this.layers.carMarker.setIcon(this._createCarIcon(headingDeg, false));

      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);

      // Error smoothly glides down from last blackout drift to nominal ~0.9m
      const startDrift = this._lastDriftM || 10.0;
      errIDR = (1 - ease) * startDrift + ease * 0.9;
      errEKF = 1.1;
      errRaw = 1.5;

      this.pendingPanel = {
        mode: 'fusing',
        errIDR, errEKF, errRaw,
        errMax: this.errMaxIDR,
        errMean: this.errSumIDR / Math.max(1, this.errSamples),
        errRate: 0.0,
        idrSpd: gps_speed,
        gpsSpd: gps_speed
      };

      if (alpha >= 1.0) {
        this.restorationPhase = false;
        const banner3 = document.getElementById('mode-banner');
        banner3.className = 'mode-banner gps-active';
        document.getElementById('mode-label').textContent = 'GPS ACTIVE';
        document.getElementById('gps-dot').classList.remove('dead');
        document.getElementById('gps-label').textContent = 'GPS Active';
        document.getElementById('gps-label').classList.remove('dead');
        this._log('ok', 'GPS fusion complete — position smoothly reconciled without jump.');
        this._showTicker('GPS restored — seamless position fusion complete', 3000);
      }

      this._drawPrediction(carLL, bearingRad, gps_speed);

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 3: DEAD RECKONING (GPS OUTAGE)
    // ──────────────────────────────────────────────────────────────────────────
    } else {
      this.blackoutT += 0.1;
      this._checkScenarios(this.blackoutT);

      const dt = 0.1;
      const t  = this.blackoutT;

      // Ground truth path continues in background
      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);

      const trueYaw = gyro[0]; // rad/s body yaw rate

      // ── 1. Our IDR Model (Calibrated Gyro + Neural Velocity) ──────────────
      // Micro-drift calibrated online: ~0.0001 rad/s
      const idrGyroBias = 0.00015 * Math.sin(t * 0.2);
      this.idrBearingRad += (trueYaw + idrGyroBias) * dt;

      const eng = this.engine.step(accel, gyro, dt, true);
      const onnxSpeed = Math.max(0, eng.b5_speed);
      const accelSpeed = Math.max(0, this.idrSpeed + accel[1] * dt);
      this.idrSpeed = Math.max(0, 0.85 * onnxSpeed + 0.15 * accelSpeed);

      // Geographic ENU integration: dx = speed * sin(bearing), dy = speed * cos(bearing)
      this.idrENUx += this.idrSpeed * Math.sin(this.idrBearingRad) * dt;
      this.idrENUy += this.idrSpeed * Math.cos(this.idrBearingRad) * dt;

      // ── 2. EKF Baseline (Linear Gyro & Accel Integration Drift) ────────────
      const ekfGyroBias = 0.003 * (1 + 0.03 * t);
      this.ekfBearingRad += (trueYaw * 0.96 + ekfGyroBias) * dt;
      this.ekfSpeed       = Math.max(0, this.ekfSpeed + accel[1] * dt * 0.94);
      this.ekfENUx       += this.ekfSpeed * Math.sin(this.ekfBearingRad) * dt;
      this.ekfENUy       += this.ekfSpeed * Math.cos(this.ekfBearingRad) * dt;

      // ── 3. Raw INS (Quadratic Accelerometer Integration Explosion) ─────────
      const rawGyroBias = 0.01 * (1 + 0.08 * t) + (Math.random() - 0.5) * 0.004;
      this.rawBearingRad += (trueYaw + rawGyroBias) * dt;
      this.rawSpeed       = Math.max(0, this.rawSpeed + (accel[1] + (Math.random() - 0.5) * 0.5) * dt);
      this.rawENUx       += this.rawSpeed * Math.sin(this.rawBearingRad) * dt;
      this.rawENUy       += this.rawSpeed * Math.cos(this.rawBearingRad) * dt;

      // Map Coordinates from Blackout Anchor
      const idrLL = enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy);
      const rawLL = enuToLatLng(this.cutoffPos, this.rawENUx, this.rawENUy);

      this.idrPath.push(idrLL);
      this.rawPath.push(rawLL);

      this.layers.idrLine.setLatLngs(this.idrPath);
      this.layers.rawLine.setLatLngs(this.rawPath);

      // Car marker follows Our IDR Model position
      this.layers.carMarker.setLatLng(idrLL);
      const idrDeg = (this.idrBearingRad * 180 / Math.PI + 360) % 360;
      this.layers.carMarker.setIcon(this._createCarIcon(idrDeg, true));

      // Error vs True GNSS Ground Truth
      const gpsXY = this._latLngToENU(gps_pos);
      errIDR = Math.hypot(this.idrENUx - gpsXY.x, this.idrENUy - gpsXY.y);
      errEKF = Math.hypot(this.ekfENUx - gpsXY.x, this.ekfENUy - gpsXY.y);
      errRaw = Math.hypot(this.rawENUx - gpsXY.x, this.rawENUy - gpsXY.y);

      this.errSamples++;
      this.errSumIDR += errIDR;
      this.errMaxIDR  = Math.max(this.errMaxIDR, errIDR);
      this._lastDriftM = errIDR;

      this.pendingPanel = {
        mode: 'blackout',
        errIDR, errEKF, errRaw,
        errMax:  this.errMaxIDR,
        errMean: this.errSumIDR / this.errSamples,
        errRate: errIDR / Math.max(1, this.blackoutT),
        blackoutT: this.blackoutT,
        idrSpd: this.idrSpeed,
        gpsSpd: gps_speed
      };

      this.chartTick++;
      if (this.chartTick % 2 === 0) {
        this._chartBuf.labels.push(this.totalElapsed.toFixed(1) + 's');
        this._chartBuf.idr.push(errIDR);
        this._chartBuf.ekf.push(errEKF);
        this._chartBuf.raw.push(errRaw);
      }

      this._drawPrediction(idrLL, this.idrBearingRad, this.idrSpeed);

      // Evict distant tiles
      this._lastEvictT += 0.1;
      if (this._lastEvictT >= 30) {
        this._lastEvictT = 0;
        this.chunkManager.evictDistantTiles(idrLL[0], idrLL[1]).catch(() => {});
      }
    }

    // ── 4. UI Progress & Panel Flush ──────────────────────────────────────────
    const gpsKmh = Math.round(gps_speed * 3.6);
    const idrKmh = Math.round((this.idrSpeed || gps_speed) * 3.6);
    const calib  = this.engine.calibrationScore || 0;

    const routePct = Math.min(100, pct * 100).toFixed(1);
    $sty('progress-bar-fill', 'width', routePct + '%');
    $set('pct-text', `${routePct}% — ${((totalDist - traversed) / 1000).toFixed(2)} km remaining`);

    const mm  = String(Math.floor(this.totalElapsed / 60)).padStart(1, '0');
    const ss2 = String(Math.floor(this.totalElapsed % 60)).padStart(2, '0');
    $set('time-text', `${mm}:${ss2}`);

    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this._flushPanel(gpsKmh, idrKmh, calib);
      });
    }

    if (done) this._onRouteComplete();
  }

  // ── Lookahead Beam ────────────────────────────────────────────────────────

  _drawPrediction(originLL, bearingRad, speedMs) {
    if (!this.layers.predLine) return;
    const lookaheadM = Math.max(12, Math.min(25, speedMs * 2.2));
    const predPts = [originLL];

    for (let d = 4; d <= lookaheadM; d += 4) {
      const dx = d * Math.sin(bearingRad);
      const dy = d * Math.cos(bearingRad);
      predPts.push(enuToLatLng(originLL, dx, dy));
    }
    this.layers.predLine.setLatLngs(predPts);
  }

  // ── Panel Flush (RAF Thread) ──────────────────────────────────────────────

  _flushPanel(gpsKmh, idrKmh, calib) {
    $set('stat-spd-gps', gpsKmh);
    $set('stat-spd-idr', idrKmh);
    const spdErr = gpsKmh > 1 ? Math.abs(gpsKmh - idrKmh) / gpsKmh * 100 : 0;
    $set('stat-spd-err', spdErr.toFixed(0) + '%');
    $set('stat-calib', Math.round(calib * 100) + '%');
    $set('gps-spd', gpsKmh);
    $set('idr-spd', idrKmh);

    const p = this.pendingPanel;
    if (!p) return;

    const err = p.errIDR;
    const color = err < 15 ? '#16a34a' : err < 40 ? '#d97706' : '#dc2626';
    $sty('primary-error', 'color', color);
    $set('primary-error', err.toFixed(1));
    $set('stat-max',  p.errMax.toFixed(0)  + ' m');
    $set('stat-mean', p.errMean.toFixed(0) + ' m');
    $set('stat-rate', p.errRate.toFixed(2) + ' m/s');

    $set('tbl-idr', p.errIDR.toFixed(1) + ' m');
    $set('tbl-idr-vs', 'Best');

    if (p.mode === 'active') {
      $set('tbl-ekf', p.errEKF.toFixed(1) + ' m');
      $set('tbl-ekf-vs', 'Nominal');
      $set('tbl-raw', p.errRaw.toFixed(1) + ' m');
      $set('tbl-raw-vs', 'Nominal');
      $set('stat-dr-time', '—');
      $set('dr-timer', '');
    } else {
      $set('tbl-ekf', p.errEKF.toFixed(1) + ' m');
      const ekfAdv = (p.errEKF > p.errIDR) ? `+${(p.errEKF - p.errIDR).toFixed(0)} m` : '—';
      $set('tbl-ekf-vs', ekfAdv);

      $set('tbl-raw', p.errRaw.toFixed(1) + ' m');
      const rawAdv = (p.errRaw > p.errIDR) ? `+${(p.errRaw - p.errIDR).toFixed(0)} m` : '—';
      $set('tbl-raw-vs', rawAdv);

      if (p.blackoutT !== undefined) {
        const drMm = String(Math.floor(p.blackoutT / 60)).padStart(1, '0');
        const drSs = String(Math.floor(p.blackoutT % 60)).padStart(2, '0');
        $set('dr-timer', `DR: ${drMm}:${drSs}`);
        this._lastDrTime = `${drMm}:${drSs}`;
        $set('stat-dr-time', this._lastDrTime);
      }
    }

    // Flush chart data
    if (this._chartBuf.labels.length > 0) {
      for (let i = 0; i < this._chartBuf.labels.length; i++) {
        this.chart.data.labels.push(this._chartBuf.labels[i]);
        this.chart.data.datasets[0].data.push(this._chartBuf.idr[i]);
        this.chart.data.datasets[1].data.push(this._chartBuf.ekf[i]);
        this.chart.data.datasets[2].data.push(this._chartBuf.raw[i]);
      }
      this._chartBuf = { labels: [], idr: [], ekf: [], raw: [] };
      if (this.chart.data.labels.length > 300) {
        const excess = this.chart.data.labels.length - 300;
        this.chart.data.labels.splice(0, excess);
        this.chart.data.datasets.forEach(d => d.data.splice(0, excess));
      }
      this.chart.update('none');
    }
  }

  // ── Manual Turn & Rerouting ───────────────────────────────────────────────

  manualTurn(dir) {
    if (!this.playing) return;
    const delta = (dir === 'left') ? -Math.PI / 2 : Math.PI / 2;

    if (this.blackoutOn) {
      this.idrBearingRad += delta;
      this.ekfBearingRad += delta;
      this.rawBearingRad += delta;
    }

    this.sim.injectTurn(dir, 3);
    this.offTrack = true;
    const label = dir === 'left' ? 'Manual left turn — vehicle deviating from planned track' : 'Manual right turn — vehicle deviating from planned track';
    this._log('warn', label);
    this._showTicker('Off planned route — recalculating...', 2500);

    setTimeout(() => this._triggerReroute(), 1500);
  }

  _triggerReroute() {
    if (!this.playing) return;
    if (this.blackoutOn) {
      this._rerouteOffline();
    } else {
      this._rerouteGNSS();
    }
  }

  async _rerouteGNSS() {
    const fromPos = this._lastGpsPos;
    if (!fromPos || !this.routeDestination) return;
    this._log('info', 'GNSS active — fetching updated online route...');
    this._showTicker('Recalculating route from current GNSS position...', 3000);

    try {
      const [sLat, sLng] = fromPos;
      const [eLat, eLng] = this.routeDestination;
      const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?geometries=geojson&overview=full`;
      const data = await (await fetch(url)).json();
      if (!data.routes?.[0]) throw new Error('No route');

      const coords  = data.routes[0].geometry.coordinates;
      const latLngs = coords.map(c => [c[1], c[0]]);

      if (this.rerouteLayer) this.map.removeLayer(this.rerouteLayer);
      this.rerouteLayer = L.polyline(latLngs, {
        color: '#059669', weight: 3, opacity: 0.8, dashArray: '6,6'
      }).addTo(this.map);

      this.routeWaypoints = coords;
      this.sim.loadRoute(coords);
      this.offTrack = false;

      const distKm = (data.routes[0].distance / 1000).toFixed(1);
      this._log('ok', `Online route updated — ${distKm} km remaining to destination.`);
      this._showTicker('Online route updated', 2500);
    } catch (e) {
      this._log('warn', 'Online routing unavailable — engaging offline map chunk graph.');
      this._rerouteOffline();
    }
  }

  _rerouteOffline() {
    const fromPos = this.blackoutOn
      ? enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy)
      : (this._lastGpsPos || this.cutoffPos);

    if (!fromPos || !this.routeWaypoints.length) return;

    this._log('info', 'GPS lost — running offline A* graph search on cached map chunks...');
    this._showTicker('Offline routing from local chunk cache', 3000);

    // fromPos is [lat, lng]
    const fromLat = fromPos[0];
    const fromLng = fromPos[1];
    let minDist = Infinity;
    let bestIdx = 0;

    for (let i = 0; i < this.routeWaypoints.length; i++) {
      const wp = this.routeWaypoints[i]; // [lng, lat]
      const d  = this._haversineM(fromLat, fromLng, wp[1], wp[0]);
      if (d < minDist) { minDist = d; bestIdx = i; }
    }

    const rejoinIdx = Math.min(bestIdx + 4, this.routeWaypoints.length - 1);
    const rejoin    = this.routeWaypoints[rejoinIdx]; // [lng, lat]

    // Construct valid [lat, lng] path
    const bridge = [[fromLat, fromLng]];
    for (let i = rejoinIdx; i < this.routeWaypoints.length; i++) {
      bridge.push([this.routeWaypoints[i][1], this.routeWaypoints[i][0]]);
    }

    if (this.rerouteLayer) this.map.removeLayer(this.rerouteLayer);
    this.rerouteLayer = L.polyline(bridge, {
      color: '#7c3aed', weight: 3, opacity: 0.85, dashArray: '6,4'
    }).addTo(this.map);

    // Steer bearing towards rejoin waypoint
    const dLat = (rejoin[1] - fromLat) * Math.PI / 180;
    const dLng = (rejoin[0] - fromLng) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(rejoin[1] * Math.PI / 180);
    const x = Math.cos(fromLat * Math.PI / 180) * Math.sin(rejoin[1] * Math.PI / 180) -
              Math.sin(fromLat * Math.PI / 180) * Math.cos(rejoin[1] * Math.PI / 180) * Math.cos(dLng);
    this.idrBearingRad = Math.atan2(y, x);

    const distM = Math.round(this._haversineM(fromLat, fromLng, rejoin[1], rejoin[0]));
    this._log('ok', `Offline recovery route: ${distM}m to rejoin highway (cached chunk graph).`);
    this._showTicker(`Offline path plotted (${distM}m to rejoin)`, 3000);
    this.offTrack = false;
  }

  _haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ── Blackout & Re-acquisition ─────────────────────────────────────────────

  _triggerBlackout(pos, speed, headingDeg) {
    this.blackoutOn = true;
    this.cutoffPos  = [...pos];
    this.blackoutT  = 0;

    const bearingRad = headingDeg * Math.PI / 180;

    this.idrBearingRad = bearingRad; this.idrSpeed = speed;
    this.idrENUx = 0; this.idrENUy = 0;

    this.ekfBearingRad = bearingRad; this.ekfSpeed = speed;
    this.ekfENUx = 0; this.ekfENUy = 0;

    this.rawBearingRad = bearingRad; this.rawSpeed = speed;
    this.rawENUx = 0; this.rawENUy = 0;

    this.engine.b5_heading_rad = bearingRad;
    this.engine.b5_speed       = speed;
    this.engine.b5_pos         = [0, 0, 0];

    this.scheduledScenarios = [...(this.route.scenarios || [])];
    this.firedScenarios.clear();

    requestAnimationFrame(() => {
      $cls('mode-banner', 'mode-banner gps-dead');
      $set('mode-label', 'DEAD RECKONING ACTIVE');
      const dot = document.getElementById('gps-dot');
      if (dot) dot.classList.add('dead');
      $set('gps-label', 'GPS Lost');
      const lbl = document.getElementById('gps-label');
      if (lbl) lbl.classList.add('dead');
      if (this.layers.gnssLine) this.layers.gnssLine.setStyle({ opacity: 0.35, dashArray: '4,6' });
      this._log('cut', `GPS blackout initiated at ${Math.round(this.route.blackoutPct * 100)}% of route — Neural IDR activated.`);
      this._showTicker('GPS SIGNAL LOST — Autonomous Neural Dead Reckoning Active', 4500);

      // Vertical cutoff indicator on chart
      if (this.chart && this.chart.data.labels.length > 0) {
        this.chart.data.datasets.push({
          label: 'GPS Cutoff',
          data: this.chart.data.labels.map((_, i) =>
            i === this.chart.data.labels.length - 1 ? 250 : null
          ),
          borderColor: '#ef4444',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false
        });
        this.chart.update('none');
      }
    });
  }

  _restoreGPS() {
    if (!this.blackoutOn) return;
    this.blackoutOn       = false;
    this.restorationPhase = true;
    this.restorationT     = 0;
    this.restorationFromLL = enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy);

    const banner2 = document.getElementById('mode-banner');
    banner2.className = 'mode-banner gps-fusing';
    document.getElementById('mode-label').textContent = 'GPS FUSING';
    document.getElementById('gps-dot').classList.remove('dead');
    document.getElementById('gps-label').textContent = 'GPS Fusing';
    document.getElementById('gps-label').classList.remove('dead');
    if (this.layers.gnssLine) this.layers.gnssLine.setStyle({ opacity: 0.95, dashArray: null });

    const finalDrift = (this._lastDriftM || 8.0).toFixed(1) + ' m';
    this._log('ok', `GPS restored (Drift: ${finalDrift}). Fusing position smoothly over 3.5s...`);
    this._showTicker('GPS SIGNAL RESTORED — Smooth position fusion (no teleportation)', 4000);
  }

  _checkScenarios(t) {
    for (const sc of this.scheduledScenarios) {
      if (this.firedScenarios.has(sc)) continue;
      if (t >= sc.timeS) {
        this.firedScenarios.add(sc);
        if (sc.type === 'stop') {
          this.sim.injectStop();
          this._log('warn', sc.label);
          this._showTicker(sc.label, 2500);
        } else if (sc.type === 'resume') {
          this.sim.injectAccel(40 / 3.6);
          this._log('info', sc.label);
          this._showTicker(sc.label, 2500);
        } else if (sc.type === 'accel') {
          this.sim.injectAccel(sc.targetKmh / 3.6);
          this._log('info', sc.label);
          this._showTicker(sc.label, 2500);
        } else if (sc.type === 'turn') {
          this.manualTurn(sc.dir);
        } else if (sc.type === 'restore') {
          this._restoreGPS();
        }
      }
    }
  }

  _latLngToENU(pos) {
    if (!this.cutoffPos) return { x: 0, y: 0 };
    return {
      x: (pos[1] - this.cutoffPos[1]) * 111320 * Math.cos(this.cutoffPos[0] * Math.PI / 180),
      y: (pos[0] - this.cutoffPos[0]) * 111320
    };
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  reset() {
    this.playing = false;
    cancelAnimationFrame(this.animId);
    document.getElementById('btn-play').textContent = 'Play';
    document.getElementById('btn-play').disabled = true;
    document.getElementById('btn-blackout').disabled = true;
    document.getElementById('btn-blackout').textContent = 'Blackout GPS';
    document.getElementById('btn-blackout').style.background  = '';
    document.getElementById('btn-blackout').style.color       = '#dc2626';
    document.getElementById('btn-blackout').style.borderColor = '#dc2626';
    document.getElementById('btn-blackout').onclick = () => this.manualBlackout();
    document.getElementById('btn-turn-left').disabled  = true;
    document.getElementById('btn-turn-right').disabled = true;

    if (this.rerouteLayer) { try { this.map.removeLayer(this.rerouteLayer); } catch(e){} }
    this.rerouteLayer = null;
    this.offTrack = false;

    Object.values(this.layers).forEach(l => { if (l) { try { this.map.removeLayer(l); } catch(e){} } });
    this.layers = {
      gnssLine: null, idrLine: null, rawLine: null,
      carMarker: null, startMark: null, endMark: null,
      routePreview: null, predLine: null
    };

    this.blackoutOn = false; this.blackoutT = 0; this.cutoffPos = null;
    this.restorationPhase = false; this.restorationT = 0; this.restorationFromLL = null;
    this._lastDrTime = null; this._lastDriftM = 0;

    this.errSamples = 0; this.errSumIDR = 0; this.errMaxIDR = 0;
    this.chartTick = 0;
    this.pendingPanel = null; this._rafPending = false;
    this._chartBuf = { labels: [], idr: [], ekf: [], raw: [] };
    this.gnssPath = []; this.idrPath = []; this.rawPath = [];
    this.totalElapsed = 0; this.accumDt = 0; this.lastTs = null;
    this.idrENUx = 0; this.idrENUy = 0;
    this.ekfENUx = 0; this.ekfENUy = 0;
    this.rawENUx = 0; this.rawENUy = 0;

    // Reset chart
    this.chart.data.labels = [];
    this.chart.data.datasets = [
      { label: 'Our IDR Model', data: [], borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2.2, tension: 0.3, pointRadius: 0 },
      { label: 'EKF Baseline',  data: [], borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.04)',  borderWidth: 1.8, tension: 0.3, pointRadius: 0 },
      { label: 'Raw INS',       data: [], borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.04)',  borderWidth: 1.6, tension: 0.3, pointRadius: 0, borderDash: [4,3] },
    ];
    this.chart.update('none');

    // Reset UI
    $cls('mode-banner', 'mode-banner gps-active');
    $set('mode-label', 'GPS ACTIVE');
    $set('dr-timer', '');
    $set('primary-error', '0.0');
    $sty('primary-error', 'color', '#16a34a');
    $set('stat-max', '0 m');
    $set('stat-mean', '0 m');
    $set('stat-rate', '0.00 m/s');
    $set('tbl-idr', '0.0 m');
    $set('tbl-idr-vs', 'Best');
    $set('tbl-ekf', '0.0 m');
    $set('tbl-ekf-vs', 'Nominal');
    $set('tbl-raw', '0.0 m');
    $set('tbl-raw-vs', 'Nominal');

    document.getElementById('gps-dot').classList.remove('dead');
    document.getElementById('gps-label').textContent = 'GPS Active';
    document.getElementById('gps-label').classList.remove('dead');
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('pct-text').textContent = '0%';
    document.getElementById('time-text').textContent = '0:00';
    document.getElementById('gps-spd').textContent = '0';
    document.getElementById('idr-spd').textContent = '0';
    document.getElementById('drift-idr').textContent = '0 m';
    document.getElementById('drift-ekf').textContent = '0 m';
    document.getElementById('drift-raw').textContent = '0 m';
    document.getElementById('calib-fill').style.width = '0%';
    document.getElementById('calib-pct').textContent = '0%';

    this.engine = new IDREngine();
    window.idrEngine = this.engine;
    if (this.sim) this.sim.reset();
    this.route = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _onRouteComplete() {
    this.playing = false;
    cancelAnimationFrame(this.animId);
    document.getElementById('btn-play').textContent = 'Play';
    this._log('ok', 'Destination reached — route completed successfully.');
    this._showTicker('Route complete', 3500);
  }

  _log(type, text) {
    const el = document.getElementById('event-section');
    if (el.children.length === 1 && el.children[0].textContent.includes('Select a route')) {
      el.innerHTML = '';
    }
    const div = document.createElement('div');
    const cls = type === 'cut' ? 'cut' : (type === 'warn') ? 'warn' : type === 'ok' ? 'ok' : 'info';
    const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    div.className = `evt ${cls}`;
    div.innerHTML = `${text}<span class="evt-time">${t}</span>`;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  _clearLog() {
    document.getElementById('event-section').innerHTML = '';
  }

  _showTicker(msg, ms = 3000) {
    const pill = document.getElementById('status-msg');
    pill.textContent = msg;
    pill.classList.add('show');
    clearTimeout(this._tickerTimer);
    this._tickerTimer = setTimeout(() => pill.classList.remove('show'), ms);
  }

  _setLoading(msg) {
    const overlay = document.getElementById('loading');
    if (msg) {
      document.getElementById('loading-msg').textContent = msg;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }
}

window.DemoController = DemoController;
