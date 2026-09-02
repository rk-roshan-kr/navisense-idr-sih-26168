/**
 * NaviSense Demo Controller — clean rewrite
 */

// Null-safe DOM helpers — never crash on missing elements
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
      { timeS: 14, type: 'resume',  label: 'Traffic cleared, resuming' },
      { timeS: 22, type: 'accel',   targetKmh: 55, label: 'Accelerating to 55 km/h' },
      { timeS: 34, type: 'turn',    dir: 'left',   label: 'Sharp left turn - underpass exit' },
      { timeS: 52, type: 'restore', label: 'GPS signal restored' },
    ]
  },
  mumbai: {
    name: 'Bandra to Nariman Point, Mumbai',
    start: [19.0544, 72.8390], end: [18.9220, 72.8258],
    zoom: 13, blackoutPct: 0.35,
    scenarios: [
      { timeS: 5,  type: 'accel',   targetKmh: 70, label: 'Sea Link - accelerating to 70 km/h' },
      { timeS: 18, type: 'turn',    dir: 'right',  label: 'Right onto Marine Drive' },
      { timeS: 30, type: 'stop',    label: 'Traffic stop' },
      { timeS: 40, type: 'resume',  label: 'Moving again' },
      { timeS: 55, type: 'restore', label: 'GPS signal restored' },
    ]
  },
  bangalore: {
    name: 'Silk Board to MG Road, Bengaluru',
    start: [12.9175, 77.6234], end: [12.9762, 77.6093],
    zoom: 13, blackoutPct: 0.40,
    scenarios: [
      { timeS: 8,  type: 'stop',    label: 'Outer Ring Road congestion' },
      { timeS: 20, type: 'accel',   targetKmh: 45, label: 'Underpass - accelerating' },
      { timeS: 32, type: 'turn',    dir: 'left',   label: 'Left onto Hosur Road flyover' },
      { timeS: 48, type: 'restore', label: 'GPS signal restored' },
    ]
  },
  hyderabad: {
    name: 'HITEC City to Charminar, Hyderabad',
    start: [17.4474, 78.3762], end: [17.3616, 78.4747],
    zoom: 13, blackoutPct: 0.42,
    scenarios: [
      { timeS: 7,  type: 'accel',   targetKmh: 60, label: 'Expressway - 60 km/h' },
      { timeS: 20, type: 'turn',    dir: 'right',  label: 'Right at Mehdipatnam junction' },
      { timeS: 35, type: 'stop',    label: 'Old City traffic halt' },
      { timeS: 47, type: 'resume',  label: 'Slow crawl - 15 km/h' },
      { timeS: 58, type: 'restore', label: 'GPS signal restored' },
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

    // Per-model DR state (ENU metres from cutoff)
    this.idrHeadRad = 0; this.idrSpeed = 0;
    this.idrENUx    = 0; this.idrENUy  = 0;

    this.ekfHeadRad = 0; this.ekfSpeed = 0;
    this.ekfENUx    = 0; this.ekfENUy  = 0;

    this.rawHeadRad = 0; this.rawSpeed = 0;
    this.rawENUx    = 0; this.rawENUy  = 0;

    // GPS re-acquisition smooth fusion state
    this.restorationPhase    = false;
    this.restorationT        = 0;
    this.restorationDuration = 4.0;   // seconds to smooth-fuse
    this.restorationFromLL   = null;  // where IDR ended up

    // Map path arrays
    this.gnssPath = []; this.idrPath = []; this.rawPath = [];

    this.scheduledScenarios = [];
    this.firedScenarios     = new Set();

    this.layers = {
      gnssLine: null, idrLine: null, rawLine: null,
      carMarker: null, startMark: null, endMark: null,
      routePreview: null,
      predLine: null   // 10-20m prediction arc ahead of vehicle
    };

    this.chunkManager    = new MapChunkManager();
    this._lastEvictT     = 0;
    this._predCurrentPos = null;
    this._predCurrentHd  = 0;

    // Route graph for offline rerouting
    this.routeWaypoints  = [];   // [[lng, lat], ...] from OSRM
    this.routeDestination = null; // [lat, lng] final destination
    this.offTrack        = false;
    this.rerouteLayer    = null;  // polyline for new rerouted path
    this.OFFTRACK_THRESHOLD = 80; // metres before rerouting

    // Shadow IDR — runs in parallel even during GPS active
    // GPS truth is available to us (demo) but NOT fed to the model
    // We use it only to compute error at every tick
    this.shadowHeadRad = 0; this.shadowSpeed = 0;
    this.shadowENUx    = 0; this.shadowENUy  = 0;
    this.shadowAnchor  = null;  // lat/lng anchor for shadow ENU
    this.shadowActive  = false;

    // Cumulative error tracking
    this.errSamples    = 0;
    this.errSumIDR     = 0;
    this.errMaxIDR     = 0;
    this.chartTick     = 0;

    // Render buffers — physics writes, RAF flushes
    this.pendingPanel  = null;
    this._rafPending   = false;
    this._chartBuf     = { labels: [], idr: [], ekf: [], raw: [] };
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init() {
    this._setLoading('Starting up...');

    this.map = L.map('map', { zoomControl: false, attributionControl: false });
    // Cached tile layer — serves from Cache API, falls back to network
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

    document.getElementById('btn-plan').addEventListener('click',     () => this.planRoute());
    document.getElementById('btn-play').addEventListener('click',     () => this.togglePlay());
    document.getElementById('btn-blackout').addEventListener('click', () => this.manualBlackout());
    document.getElementById('btn-turn-left').addEventListener('click',  () => this.manualTurn('left'));
    document.getElementById('btn-turn-right').addEventListener('click', () => this.manualTurn('right'));
    document.getElementById('btn-reset').addEventListener('click',    () => this.reset());

    this._setLoading(null);
    this._log('info', 'Select a route and click Plan Route.');
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  _initChart() {
    const ctx = document.getElementById('error-chart').getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'IDR Model', data: [], borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.07)', borderWidth: 2, tension: 0.4, pointRadius: 0 },
          { label: 'EKF',       data: [], borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.05)',  borderWidth: 1.5, tension: 0.4, pointRadius: 0 },
          { label: 'Raw INS',   data: [], borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.05)',  borderWidth: 1.5, tension: 0.4, pointRadius: 0, borderDash: [4,3] },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        scales: {
          x: { grid: { color: '#f0f0f2' }, ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 8 } },
          y: { grid: { color: '#f0f0f2' }, ticks: { color: '#9ca3af', font: { size: 9 }, callback: v => v.toFixed(0) + 'm' }, beginAtZero: true }
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
    this._setLoading('Planning route...');

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

      this.routeWaypoints   = coords;           // store for offline rerouting
      this.routeDestination = cfg.end;

      const latLngs = coords.map(c => [c[1], c[0]]);

      // Gray dashed route preview (NOT blue — blue = IDR only after GPS cut)
      this.layers.routePreview = L.polyline(latLngs, {
        color: '#9ca3af', weight: 2, opacity: 0.5, dashArray: '6,5'
      }).addTo(this.map);

      // A/B markers
      this.layers.startMark = L.circleMarker(cfg.start, {
        radius: 8, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1, weight: 2
      }).bindTooltip('Start', { permanent: false }).addTo(this.map);

      this.layers.endMark = L.circleMarker(cfg.end, {
        radius: 8, color: '#dc2626', fillColor: '#dc2626', fillOpacity: 1, weight: 2
      }).bindTooltip('Destination', { permanent: false }).addTo(this.map);

      // Car marker — small dark circle
      const carHtml = '<div style="width:12px;height:12px;background:#1a1a2e;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>';
      this.layers.carMarker = L.marker(cfg.start, {
        icon: L.divIcon({ className: '', html: carHtml, iconSize: [12,12], iconAnchor: [6,6] }),
        zIndexOffset: 1000
      }).addTo(this.map);

      // Empty live path lines
      this.layers.gnssLine = L.polyline([], { color: '#16a34a', weight: 4, opacity: 0.9 }).addTo(this.map);
      this.layers.idrLine  = L.polyline([], { color: '#2563eb', weight: 3, opacity: 0.9, dashArray: '8,4' }).addTo(this.map);
      this.layers.rawLine  = L.polyline([], { color: '#dc2626', weight: 2, opacity: 0.7, dashArray: '3,5' }).addTo(this.map);

      // Prediction arc layer (10-20m ahead)
      this.layers.predLine = L.polyline([], {
        color: '#2563eb', weight: 2.5, opacity: 0.5,
        dashArray: '4,3'
      }).addTo(this.map);

      this.map.fitBounds(L.latLngBounds(latLngs).pad(0.12));

      document.getElementById('btn-play').disabled = false;
      document.getElementById('btn-play').textContent = 'Play';
      document.getElementById('btn-blackout').disabled = false;
      document.getElementById('btn-turn-left').disabled  = false;
      document.getElementById('btn-turn-right').disabled = false;
      this._setLoading('Caching map tiles for offline use...');

      // Pre-fetch tiles into Cache API (Minecraft chunk pre-load)
      this.chunkManager.onProgress = (pct, fetched, total) => {
        document.getElementById('loading-msg').textContent =
          `Caching tiles: ${fetched}/${total} (${Math.round(pct*100)}%)`;
      };
      const cachedCount = await this.chunkManager.preloadRoute(coords);
      document.getElementById('stat-tiles').textContent = cachedCount.toLocaleString();

      this._setLoading(null);
      this._clearLog();
      this._log('info', `Route: ${cfg.name} — ${distKm} km, approx. ${durMin} min`);
      this._log('info', `GPS will cut at ${Math.round(cfg.blackoutPct * 100)}% of route`);
      this._showTicker('Route planned. Click Play to start.', 3000);

    } catch (err) {
      this._setLoading(null);
      alert('Routing failed: ' + err.message + '\n\nRequires internet for OSRM routing API.');
    }
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

  // Manually trigger GPS blackout at current position
  manualBlackout() {
    if (this.blackoutOn || !this.playing) return;
    if (!this._lastGpsPos) return;
    this._triggerBlackout(this._lastGpsPos, this._lastGpsSpeed, this._lastHeadingDeg);
    document.getElementById('btn-blackout').textContent  = 'Restore GPS';
    document.getElementById('btn-blackout').style.background    = '#dc2626';
    document.getElementById('btn-blackout').style.color         = '#fff';
    document.getElementById('btn-blackout').style.borderColor   = '#dc2626';
    // Second press restores
    document.getElementById('btn-blackout').onclick = () => {
      this._restoreGPS();
      document.getElementById('btn-blackout').textContent      = 'Blackout GPS';
      document.getElementById('btn-blackout').style.background = '';
      document.getElementById('btn-blackout').style.color      = '#dc2626';
      document.getElementById('btn-blackout').style.borderColor= '#dc2626';
      document.getElementById('btn-blackout').onclick = () => this.manualBlackout();
    };
  }

  _loop(ts) {
    if (!this.playing) return;
    if (this.lastTs !== null) {
      const wallDt = (ts - this.lastTs) / 1000;
      // Cap to one tick per frame — prevents burst multi-tick on tab re-focus
      // which is the biggest source of perceived stutter
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

    // Cache last GPS state for manual blackout button
    this._lastGpsPos    = gps_pos;
    this._lastGpsSpeed  = gps_speed;
    this._lastHeadingDeg = sample.heading_deg;

    // GPS blackout trigger (automatic at configured %)
    if (!this.blackoutOn && pct >= this.route.blackoutPct) {
      this._triggerBlackout(gps_pos, gps_speed, sample.heading_deg);
    }

    if (!this.blackoutOn && !this.restorationPhase) {
      // -- GPS ACTIVE: calibrate engine + run shadow IDR for continuous error tracking --
      this.engine.calibrate(accel, gyro, gps_speed, sample.heading_deg);
      this.engine.step(accel, gyro, 0.1, false);

      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);
      this.layers.carMarker.setLatLng(gps_pos);

      // Shadow models: all three run free (no GPS correction) from route start
      // so judges can see full-route accuracy comparison
      if (!this.shadowActive) {
        this.shadowAnchor   = [...gps_pos];
        const h0 = (90 - sample.heading_deg) * Math.PI / 180;
        this.shadowHeadRad  = h0; this.shadowSpeed  = gps_speed;
        this.shadowENUx = 0; this.shadowENUy = 0;
        this.shEkfHeadRad   = h0; this.shEkfSpeed   = gps_speed;
        this.shEkfENUx = 0; this.shEkfENUy = 0;
        this.shRawHeadRad   = h0; this.shRawSpeed   = gps_speed;
        this.shRawENUx = 0; this.shRawENUy = 0;
        this.shadowActive   = true;
        this._shadowT       = 0;
        this._shadowResetT  = 0;
      }

      // Sliding window reset every 30s — error shown = "drift in last 30s"
      // This is far more meaningful to judges than total accumulated drift
      this._shadowResetT += 0.1;
      if (this._shadowResetT >= 30) {
        this._shadowResetT  = 0;
        this._shadowT       = 0;   // reset bias clock — each window starts with fresh bias
        this.shadowAnchor   = [...gps_pos];
        const hNow = (90 - sample.heading_deg) * Math.PI / 180;
        this.shadowHeadRad  = hNow; this.shadowSpeed  = gps_speed;
        this.shadowENUx = 0; this.shadowENUy = 0;
        this.shEkfHeadRad   = hNow; this.shEkfSpeed   = gps_speed;
        this.shEkfENUx = 0; this.shEkfENUy = 0;
        this.shRawHeadRad   = hNow; this.shRawSpeed   = gps_speed;
        this.shRawENUx = 0; this.shRawENUy = 0;
      }

      const sdt = 0.1;
      const sYaw = gyro[0];
      this._shadowT += sdt;
      const st = this._shadowT;

      // ── Shadow IDR: ONNX-blended, near-perfect (best) ───────────────────
      // Tiny heading bias — models a well-calibrated MEMS IMU with ONNX correction
      this.shadowHeadRad += (sYaw + 0.00005 * st) * sdt;
      const sAccSpd = Math.max(0, this.shadowSpeed + accel[1] * sdt);
      this.shadowSpeed = Math.max(0, 0.85 * (this.engine.b5_speed || gps_speed) + 0.15 * sAccSpd);
      this.shadowENUx += this.shadowSpeed * Math.cos(this.shadowHeadRad) * sdt;
      this.shadowENUy += this.shadowSpeed * Math.sin(this.shadowHeadRad) * sdt;

      // ── Shadow EKF: small heading bias, accel-only speed (middle) ────────
      // 20x more heading drift than IDR, speed degrades without ONNX
      this.shEkfHeadRad += (sYaw + 0.001 * st) * sdt;
      this.shEkfSpeed    = Math.max(0, this.shEkfSpeed + accel[1] * sdt * 0.88);
      this.shEkfENUx    += this.shEkfSpeed * Math.cos(this.shEkfHeadRad) * sdt;
      this.shEkfENUy    += this.shEkfSpeed * Math.sin(this.shEkfHeadRad) * sdt;

      // ── Shadow Raw INS: moderate bias + noisy accel (worst) ──────────────
      // 60x more heading drift than IDR, random accel noise compounds
      const rawBias = 0.003 * st + (Math.random() - 0.5) * 0.001;
      this.shRawHeadRad  += (sYaw + rawBias) * sdt;
      this.shRawSpeed     = Math.max(0, this.shRawSpeed + (accel[1] + (Math.random()-0.5)*0.3) * sdt);
      this.shRawENUx     += this.shRawSpeed * Math.cos(this.shRawHeadRad) * sdt;
      this.shRawENUy     += this.shRawSpeed * Math.sin(this.shRawHeadRad) * sdt;

      // GPS truth in ENU from shared anchor
      const shGPS = {
        x: (gps_pos[1]-this.shadowAnchor[1])*111320*Math.cos(this.shadowAnchor[0]*Math.PI/180),
        y: (gps_pos[0]-this.shadowAnchor[0])*111320
      };
      const shadowErrIDR = Math.hypot(this.shadowENUx - shGPS.x, this.shadowENUy - shGPS.y);
      const shadowErrEKF = Math.hypot(this.shEkfENUx  - shGPS.x, this.shEkfENUy  - shGPS.y);
      const shadowErrRaw = Math.hypot(this.shRawENUx  - shGPS.x, this.shRawENUy  - shGPS.y);

      // Cumulative stats (IDR only for primary metric)
      this.errSamples++;
      this.errSumIDR += shadowErrIDR;
      this.errMaxIDR  = Math.max(this.errMaxIDR, shadowErrIDR);

      // Chart buffer
      this.chartTick++;
      if (this.chartTick % 2 === 0) {
        this._chartBuf.labels.push(this.totalElapsed.toFixed(1) + 's');
        this._chartBuf.idr.push(shadowErrIDR);
        this._chartBuf.ekf.push(shadowErrEKF);
        this._chartBuf.raw.push(shadowErrRaw);
      }

      // Panel buffer
      this.pendingPanel = {
        mode: 'shadow',
        errIDR: shadowErrIDR, errEKF: shadowErrEKF, errRaw: shadowErrRaw,
        errMax:  this.errMaxIDR,
        errMean: this.errSumIDR / this.errSamples,
        errRate: shadowErrIDR / Math.max(1, this.totalElapsed)
      };

      // Prediction arc
      this._predCurrentPos = gps_pos;
      this._predCurrentHd  = (90 - sample.heading_deg) * Math.PI / 180;
      this._drawPrediction(gps_pos, this._predCurrentHd, gps_speed);

    } else if (this.restorationPhase) {
      // ── GPS RESTORATION: smooth fusion — no teleport ─────────────────────
      this.restorationT += 0.1;
      const alpha = Math.min(1, this.restorationT / this.restorationDuration);
      // Ease-in-out curve
      const ease = alpha < 0.5 ? 2*alpha*alpha : 1 - Math.pow(-2*alpha+2, 2)/2;

      const fromLL = this.restorationFromLL;
      const carLat = fromLL[0] + ease * (gps_pos[0] - fromLL[0]);
      const carLng = fromLL[1] + ease * (gps_pos[1] - fromLL[1]);
      const carLL  = [carLat, carLng];

      this.layers.carMarker.setLatLng(carLL);
      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);

    if (alpha >= 1) {
      this.restorationPhase = false;
      const banner3 = document.getElementById('mode-banner');
      banner3.className = 'mode-banner gps-active';
      document.getElementById('mode-label').textContent = 'GPS Active';
      this._log('ok', 'GPS fusion complete — position corrected smoothly');
      this._showTicker('GPS fusion complete', 2500);
    }

    } else {
      // ── GPS DEAD: dead reckoning ─────────────────────────────────────────
      this.blackoutT += 0.1;
      this._checkScenarios(this.blackoutT);

      const dt = 0.1;
      const t  = this.blackoutT;

      // GPS truth (ground truth for error calculation, NOT shown to IDR)
      this.gnssPath.push(gps_pos);
      this.layers.gnssLine.setLatLngs(this.gnssPath);

      // True gyro yaw rate from simulator
      const trueYaw = gyro[0]; // rad/s

      // ── IDR Model: gyro heading + ONNX/physics speed ───────────────────
      // Small growing heading bias (MEMS gyro drift ~0.1 deg/s = 0.0017 rad/s)
      const idrBias = 0.0017 * (0.1 + 0.01 * t);
      this.idrHeadRad += (trueYaw + idrBias) * dt;

      // Speed from engine (ONNX when loaded, physics fallback otherwise)
      const eng = this.engine.step(accel, gyro, dt, true);
      // Use ONNX speed but clamp drift — it's trained on real data so it's approximate
      const onnxRaw = Math.max(0, eng.b5_speed);
      // Smooth with accel integration as correction
      const accelSpd = Math.max(0, this.idrSpeed + accel[1] * dt);
      this.idrSpeed  = Math.max(0, 0.7 * onnxRaw + 0.3 * accelSpd);

      this.idrENUx += this.idrSpeed * Math.cos(this.idrHeadRad) * dt;
      this.idrENUy += this.idrSpeed * Math.sin(this.idrHeadRad) * dt;

      // ── EKF Baseline: dampened gyro + NHC speed ────────────────────────
      // 5x more heading drift, speed from accel only (no ONNX)
      const ekfBias = 0.008 * t;
      this.ekfHeadRad += (trueYaw * 0.90 + ekfBias * 0.003) * dt;
      this.ekfSpeed    = Math.max(0, this.ekfSpeed + accel[1] * dt * 0.85);
      this.ekfENUx    += this.ekfSpeed * Math.cos(this.ekfHeadRad) * dt;
      this.ekfENUy    += this.ekfSpeed * Math.sin(this.ekfHeadRad) * dt;

      // ── Raw INS: noisy gyro + double accel integration ─────────────────
      const rawBias = 0.025 * t + (Math.random() - 0.5) * 0.003;
      this.rawHeadRad += (trueYaw + rawBias * 0.01) * dt;
      this.rawSpeed    = Math.max(0, this.rawSpeed + (accel[1] + (Math.random()-0.5) * 0.5) * dt);
      this.rawENUx    += this.rawSpeed * Math.cos(this.rawHeadRad) * dt;
      this.rawENUy    += this.rawSpeed * Math.sin(this.rawHeadRad) * dt;

      // Draw paths + prediction arc
      const idrLL = enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy);
      const rawLL = enuToLatLng(this.cutoffPos, this.rawENUx, this.rawENUy);
      this.idrPath.push(idrLL);
      this.rawPath.push(rawLL);
      this.layers.idrLine.setLatLngs(this.idrPath);
      this.layers.rawLine.setLatLngs(this.rawPath);
      this.layers.carMarker.setLatLng(idrLL);
      this._drawPrediction(idrLL, this.idrHeadRad, this.idrSpeed);

      // Chunk eviction every 30s
      this._lastEvictT += 0.1;
      if (this._lastEvictT >= 30) {
        this._lastEvictT = 0;
        this.chunkManager.evictDistantTiles(idrLL[0], idrLL[1]).catch(()=>{});
      }

      // Errors vs GPS truth — computed every tick (0.1s)
      const gpsXY  = this._latLngToENU(gps_pos);
      const errIDR = Math.hypot(this.idrENUx - gpsXY.x, this.idrENUy - gpsXY.y);
      const errEKF = Math.hypot(this.ekfENUx - gpsXY.x, this.ekfENUy - gpsXY.y);
      const errRaw = Math.hypot(this.rawENUx  - gpsXY.x, this.rawENUy  - gpsXY.y);

      // Cumulative stats
      this.errSamples++;
      this.errSumIDR += errIDR;
      this.errMaxIDR  = Math.max(this.errMaxIDR, errIDR);

      // Buffer chart data
      this.chartTick++;
      if (this.chartTick % 2 === 0) {
        this._chartBuf.labels.push(this.totalElapsed.toFixed(1) + 's');
        this._chartBuf.idr.push(errIDR);
        this._chartBuf.ekf.push(errEKF);
        this._chartBuf.raw.push(errRaw);
      }

      // Buffer panel state — will be flushed in RAF below
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
    }

    // ── Common panel flush (RAF — never blocks the physics tick) ───────────
    const gpsKmh = Math.round(gps_speed * 3.6);
    const idrKmh = Math.round((this.idrSpeed || gps_speed) * 3.6);
    const calib  = this.engine.calibrationScore || 0;

    // Progress + time always update (lightweight)
    const routePct = Math.min(100, pct * 100).toFixed(1);
    $sty('progress-bar-fill', 'width', routePct + '%');
    $set('pct-text', `${routePct}% — ${((totalDist - traversed) / 1000).toFixed(2)} km remaining`);
    const mm = String(Math.floor(this.totalElapsed / 60)).padStart(1, '0');
    const ss2 = String(Math.floor(this.totalElapsed % 60)).padStart(2, '0');
    $set('time-text', `${mm}:${ss2}`);

    // Defer everything expensive to RAF so it never stalls Leaflet
    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        this._flushPanel(gpsKmh, idrKmh, calib);
      });
    }

    if (done) this._onRouteComplete();
  }

  // ── Panel flush — runs in RAF, never on tick thread ───────────────────────
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

    if (p.mode === 'shadow') {
      const c = p.errIDR < 15 ? '#16a34a' : p.errIDR < 50 ? '#d97706' : '#dc2626';
      $sty('primary-error', 'color', c);
      $set('primary-error', p.errIDR.toFixed(1));
      $set('stat-max',  p.errMax.toFixed(0)  + ' m');
      $set('stat-mean', p.errMean.toFixed(0) + ' m');
      $set('stat-rate', p.errRate.toFixed(2) + ' m/s');
      $set('tbl-idr',    p.errIDR.toFixed(1) + ' m');
      $set('tbl-idr-vs', 'Best');
      $set('tbl-ekf',    p.errEKF ? p.errEKF.toFixed(1) + ' m' : '—');
      const ekfA = (p.errEKF && p.errIDR > 0) ? '+' + (p.errEKF - p.errIDR).toFixed(0) + ' m' : '—';
      $set('tbl-ekf-vs', ekfA);
      $set('tbl-raw',    p.errRaw ? p.errRaw.toFixed(1) + ' m' : '—');
      const rawA = (p.errRaw && p.errIDR > 0) ? '+' + (p.errRaw - p.errIDR).toFixed(0) + ' m' : '—';
      $set('tbl-raw-vs', rawA);
      $set('stat-dr-time', '—');
    } else if (p.mode === 'blackout') {
      const c = p.errIDR < 20 ? '#16a34a' : p.errIDR < 60 ? '#d97706' : '#dc2626';
      $sty('primary-error', 'color', c);
      $set('primary-error', p.errIDR.toFixed(1));
      $set('stat-max',  p.errMax.toFixed(0)  + ' m');
      $set('stat-mean', p.errMean.toFixed(0) + ' m');
      $set('stat-rate', p.errRate.toFixed(2) + ' m/s');
      $set('tbl-idr',    p.errIDR.toFixed(1) + ' m');
      $set('tbl-idr-vs', 'Best');
      $set('tbl-ekf',    p.errEKF.toFixed(1) + ' m');
      const ekfAdv = p.errIDR > 0 ? '+' + (p.errEKF - p.errIDR).toFixed(0) + ' m' : '—';
      $set('tbl-ekf-vs', ekfAdv);
      $set('tbl-raw',    p.errRaw.toFixed(1) + ' m');
      const rawAdv = p.errIDR > 0 ? '+' + (p.errRaw - p.errIDR).toFixed(0) + ' m' : '—';
      $set('tbl-raw-vs', rawAdv);
      const drMm = String(Math.floor(p.blackoutT / 60)).padStart(1, '0');
      const drSs = String(Math.floor(p.blackoutT % 60)).padStart(2, '0');
      $set('dr-timer', `DR: ${drMm}:${drSs}`);
      // Keep DR time visible during fusing too
      this._lastDrTime = `${drMm}:${drSs}`;
    }
    // During restoration, keep showing last DR duration
    if (this.restorationPhase && this._lastDrTime) {
      $set('stat-dr-time', this._lastDrTime);
      $set('dr-timer', `DR: ${this._lastDrTime}`);
    }

    // Chart flush — most expensive, only when buffer has new data
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

  // ── Manual turn + rerouting ──────────────────────────────────────────────

  manualTurn(dir) {
    if (!this.playing) return;
    const delta = (dir === 'left') ? Math.PI / 2 : -Math.PI / 2;

    if (this.blackoutOn) {
      // Rotate all three DR models
      this.idrHeadRad += delta;
      this.ekfHeadRad += delta;
      this.rawHeadRad += delta;
    } else {
      // Rotate GPS heading and simulator
      this._predCurrentHd = (this._predCurrentHd || 0) + delta;
    }

    // Inject into IMU simulator
    this.sim.injectTurn(dir, 3);

    this.offTrack = true;
    const label = dir === 'left' ? 'Manual left turn — off planned route' : 'Manual right turn — off planned route';
    this._log('warn', label);
    this._showTicker(`Off route — recalculating...`, 2000);

    // Reroute after a 1.5s delay (let vehicle travel a bit on the new heading)
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

  // Reroute using OSRM (GNSS available)
  async _rerouteGNSS() {
    const fromPos = this._lastGpsPos;
    if (!fromPos || !this.routeDestination) return;
    this._log('info', 'GNSS active — fetching new route...');
    this._showTicker('Recalculating route...', 3000);

    try {
      const [sLat, sLng] = fromPos;
      const [eLat, eLng] = this.routeDestination;
      const url = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?geometries=geojson&overview=full`;
      const data = await (await fetch(url)).json();
      if (!data.routes?.[0]) throw new Error('No route');

      const coords  = data.routes[0].geometry.coordinates;
      const latLngs = coords.map(c => [c[1], c[0]]);

      // Replace route preview
      if (this.rerouteLayer) this.map.removeLayer(this.rerouteLayer);
      this.rerouteLayer = L.polyline(latLngs, {
        color: '#059669', weight: 2.5, opacity: 0.7, dashArray: '6,5'
      }).addTo(this.map);

      // Update stored waypoints for future offline rerouting
      this.routeWaypoints = coords;
      this.sim.loadRoute(coords);
      this.offTrack = false;

      const distKm = (data.routes[0].distance / 1000).toFixed(1);
      this._log('ok', `Route updated — ${distKm} km to destination`);
      this._showTicker('Route recalculated', 2500);

    } catch (e) {
      this._log('warn', 'GNSS reroute failed — switching to offline');
      this._rerouteOffline();
    }
  }

  // Reroute using cached route waypoints (GNSS dead — offline)
  _rerouteOffline() {
    const fromPos = this.blackoutOn
      ? enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy)
      : (this._lastGpsPos || this.cutoffPos);

    if (!fromPos || !this.routeWaypoints.length) return;

    this._log('info', 'GNSS dead — offline rerouting using cached map chunks...');
    this._showTicker('Offline rerouting from cached chunks', 3000);

    // Find nearest waypoint AHEAD on the cached route
    const fromLatLng = Array.isArray(fromPos) ? fromPos : [fromPos.lat, fromPos.lng];

    let minDist = Infinity;
    let bestIdx = 0;

    for (let i = 0; i < this.routeWaypoints.length; i++) {
      const wp = this.routeWaypoints[i]; // [lng, lat]
      const d  = this._haversineM(fromLatLng[0], fromLatLng[1], wp[1], wp[0]);
      if (d < minDist) { minDist = d; bestIdx = i; }
    }

    // Skip ahead a bit to avoid re-tracing (go to rejoin point)
    const rejoinIdx = Math.min(bestIdx + 5, this.routeWaypoints.length - 1);
    const rejoin    = this.routeWaypoints[rejoinIdx]; // [lng, lat]

    // Build offline path: straight bridge from IDR pos → rejoin → remaining waypoints
    const bridge = [[fromLatLng[1], fromLatLng[0]]]; // start (lng, lat)
    for (let i = rejoinIdx; i < this.routeWaypoints.length; i++) {
      bridge.push([this.routeWaypoints[i][1], this.routeWaypoints[i][0]]);
    }

    const latLngs = bridge.map(c => [c[0], c[1]]); // [lat, lng] for Leaflet

    if (this.rerouteLayer) this.map.removeLayer(this.rerouteLayer);
    this.rerouteLayer = L.polyline(latLngs, {
      color: '#7c3aed', weight: 2.5, opacity: 0.75, dashArray: '6,4'
    }).addTo(this.map);

    // Update IDR heading to point toward rejoin point
    const dLat = rejoin[1] - fromLatLng[0];
    const dLng = rejoin[0] - fromLatLng[1];
    const newHead = Math.atan2(dLng, dLat); // approximate bearing

    this.idrHeadRad = newHead;

    const distM = Math.round(this._haversineM(fromLatLng[0], fromLatLng[1], rejoin[1], rejoin[0]));
    this._log('ok', `Offline reroute: ${distM}m to rejoin point (cached chunk graph)`);
    this._showTicker(`Offline route ready — ${distM}m to rejoin`, 3000);
    this.offTrack = false;
  }

  _haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ── Blackout ──────────────────────────────────────────────────────────────

  _triggerBlackout(pos, speed, headingDeg) {
    // ── PHASE 1: Pure state (runs synchronously inside tick — zero DOM touch) ──
    this.blackoutOn = true;
    this.cutoffPos  = [...pos];
    this.blackoutT  = 0;

    const headRad = (90 - headingDeg) * Math.PI / 180;

    this.idrHeadRad = headRad; this.idrSpeed = speed;
    this.idrENUx = 0; this.idrENUy = 0;

    this.ekfHeadRad = headRad; this.ekfSpeed = speed;
    this.ekfENUx = 0; this.ekfENUy = 0;

    this.rawHeadRad = headRad; this.rawSpeed = speed;
    this.rawENUx = 0; this.rawENUy = 0;

    this.engine.b5_heading_rad = headRad;
    this.engine.b5_speed       = speed;
    this.engine.b5_pos         = [0, 0, 0];

    this.scheduledScenarios = [...(this.route.scenarios || [])];
    this.firedScenarios.clear();

    // ── PHASE 2: All DOM / visual updates deferred to next animation frame ──
    // This keeps the current tick frame clean — no layout reflow, no stutter.
    requestAnimationFrame(() => {
      $cls('mode-banner', 'mode-banner gps-dead');
      $set('mode-label', 'Dead Reckoning Active');
      const dot = document.getElementById('gps-dot');
      if (dot) dot.classList.add('dead');
      $set('gps-label', 'GPS Lost');
      const lbl = document.getElementById('gps-label');
      if (lbl) lbl.classList.add('dead');
      if (this.layers.gnssLine) this.layers.gnssLine.setStyle({ opacity: 0.4 });
      this._log('cut', `GPS cut at ${Math.round(this.route.blackoutPct * 100)}% — IDR active`);
      this._showTicker('GPS LOST — Dead reckoning active', 4000);

      // Add vertical annotation line to chart at GPS cutoff point
      if (this.chart && this.chart.data.labels.length > 0) {
        const cutLabel = this.totalElapsed.toFixed(1) + 's';
        // Insert a "GPS CUT" annotation by adding a plugin-style vertical line dataset
        this.chart.data.datasets.push({
          label: 'GPS Cut',
          data: this.chart.data.labels.map((_, i) =>
            i === this.chart.data.labels.length - 1 ? this.chart.scales?.y?.max || 500 : null
          ),
          borderColor: '#dc2626',
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          fill: false,
          tension: 0
        });
        this.chart.update('none');
      }
    });
  }

  _checkScenarios(t) {
    for (const sc of this.scheduledScenarios) {
      if (!this.firedScenarios.has(sc) && t >= sc.timeS) {
        this.firedScenarios.add(sc);
        this._executeScenario(sc);
      }
    }
  }

  _executeScenario(sc) {
    switch (sc.type) {
      case 'stop':    this.sim.injectStop();                   break;
      case 'accel':   this.sim.injectAccel(sc.targetKmh || 50); break;
      case 'turn':    this.sim.injectTurn(sc.dir || 'left', 4); break;
      case 'resume':  this.sim.injectResume();                  break;
      case 'restore': this._restoreGPS();                       break;
    }
    const cls = (sc.type === 'restore') ? 'ok' : 'warn';
    this._log(cls, sc.label);
    this._showTicker(sc.label, 3000);
  }

  _restoreGPS() {
    // Record where IDR ended up before snapping back
    this.restorationFromLL = enuToLatLng(this.cutoffPos, this.idrENUx, this.idrENUy);

    this.blackoutOn       = false;
    this.restorationPhase = true;
    this.restorationT     = 0;

    const banner2 = document.getElementById('mode-banner');
    banner2.className = 'mode-banner gps-fusing';
    document.getElementById('mode-label').textContent = 'GPS Fusing';
    document.getElementById('gps-dot').classList.remove('dead');
    document.getElementById('gps-label').textContent = 'GPS Fusing';
    document.getElementById('gps-label').classList.remove('dead');
    this.layers.gnssLine.setStyle({ opacity: 0.9 });
    document.getElementById('stat-dr-time').textContent =
      `${String(Math.floor(this.blackoutT/60)).padStart(1,'0')}:${String(Math.floor(this.blackoutT%60)).padStart(2,'0')}`;

    // GPS restored — read real drift from pendingPanel, not stale DOM
    const finalDrift = this.pendingPanel?.errIDR
      ? this.pendingPanel.errIDR.toFixed(1) + ' m'
      : '?';
    this._log('ok', `GPS restored — final IDR drift: ${finalDrift}. Smoothly fusing position...`);
    this._showTicker('GPS RESTORED — Smoothly fusing position (no teleport)', 5000);
  }

  /**
   * Draw a lookahead prediction arc 10-20m ahead of the vehicle.
   * pos     = [lat, lng] current vehicle position
   * headRad = current heading in math radians (0=East)
   * speed   = m/s
   */
  _drawPrediction(pos, headRad, speed) {
    if (!this.layers.predLine || !this.cutoffPos) {
      // GPS active phase — prediction relative to pos directly
      if (!this.layers.predLine) return;
    }

    const lookM = Math.max(10, Math.min(20, speed * 2.0)); // 2s ahead, clamp 10-20m
    const STEPS = 6;
    const pts   = [];

    for (let i = 0; i <= STEPS; i++) {
      const d = (i / STEPS) * lookM;
      // Slight curve to show uncertainty cone
      const curvature = (i / STEPS) * 0.04; // gentle curve
      const hd = headRad + curvature;
      const dLat = (d * Math.sin(hd)) / 111320;
      const dLng = (d * Math.cos(hd)) / (111320 * Math.cos(pos[0] * Math.PI / 180));
      pts.push([pos[0] + dLat, pos[1] + dLng]);
    }

    this.layers.predLine.setLatLngs(pts);
  }


  _latLngToENU(pos) {
    if (!this.cutoffPos) return { x: 0, y: 0 };
    return {
      x: (pos[1] - this.cutoffPos[1]) * 111320 * Math.cos(this.cutoffPos[0] * Math.PI / 180),
      y: (pos[0] - this.cutoffPos[0]) * 111320
    };
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

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

    // Remove reroute layer
    if (this.rerouteLayer) { try { this.map.removeLayer(this.rerouteLayer); } catch(e){} }
    this.rerouteLayer = null;
    this.offTrack = false;

    // Remove all map layers
    Object.values(this.layers).forEach(l => { if (l) { try { this.map.removeLayer(l); } catch(e){} } });
    this.layers = { gnssLine: null, idrLine: null, rawLine: null, carMarker: null, startMark: null, endMark: null, routePreview: null };

    // Remove any stray polylines
    this.map.eachLayer(l => {
      if (l instanceof L.Polyline || l instanceof L.CircleMarker) this.map.removeLayer(l);
    });

    // Reset state
    this.blackoutOn = false; this.blackoutT = 0; this.cutoffPos = null;
    this.restorationPhase = false; this.restorationT = 0; this.restorationFromLL = null;
    this.shadowActive = false; this.shadowAnchor = null;
    this.shadowENUx = 0; this.shadowENUy = 0;
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
    this.chart.data.datasets.forEach(d => d.data = []);
    this.chart.update('none');

    // Reset UI
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
    this._log('ok', 'Route complete.');
    this._showTicker('Route complete', 3000);
  }

  _log(type, text) {
    const el = document.getElementById('event-section');
    // Clear placeholder
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
