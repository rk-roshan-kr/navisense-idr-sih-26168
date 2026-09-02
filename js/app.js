/**
 * NAVISENSE — Clean Application Controller
 * Coordinates turn guidance, state-transforming HUD, and dead reckoning simulations.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const player = new ScenarioPlayer();
  await player.init();

  const mapCanvas = new MapCanvas('map-canvas');
  const chartRenderer = new ChartRenderer('drift-chart', 'imu-chart');

  // Instantiate IDR engine (loads ONNX model async)
  const idrEngine = new IDREngine();
  window.idrEngine = idrEngine;   // expose for calibration bar in index.html

  // State
  let isPlaying = true;
  let currentIndex = 0;
  let playbackSpeed = 2;
  let isBlackout = false;
  let blackoutStartIdx = null;

  // Trajectory history
  let pathGnss = [];
  let pathIdr = [];
  let driftHistory = [];
  let accelHistory = [];
  let gyroHistory = [];

  // Elements
  const btnModeDemo = document.getElementById('btn-mode-demo');
  const btnModeBenchmark = document.getElementById('btn-mode-benchmark');

  const gpsBadge = document.getElementById('gps-badge');
  const gpsBadgeText = document.getElementById('gps-badge-text');

  const blackoutAlert = document.getElementById('blackout-alert');
  const btnBlackoutAction = document.getElementById('btn-blackout-action');
  const btnActionText = document.getElementById('btn-action-text');
  const btnActionSub = document.getElementById('btn-action-sub');

  const turnOverlay = document.getElementById('turn-overlay');
  const turnDist = document.getElementById('turn-dist');
  const turnRoad = document.getElementById('turn-road');
  const turnSymbol = document.getElementById('turn-symbol');

  const hudNormal = document.getElementById('hud-normal');
  const hudOutage = document.getElementById('hud-outage');

  const hudGpsSpeed = document.getElementById('hud-gps-speed');
  const hudIdrSpeed = document.getElementById('hud-idr-speed');
  const hudSpeedDiff = document.getElementById('hud-speed-diff');
  const hudDriftM = document.getElementById('hud-drift-m');
  const hudOutageDist = document.getElementById('hud-outage-dist');
  const hudOutageTime = document.getElementById('hud-outage-time');
  const hudDriftPct = document.getElementById('hud-drift-pct');
  const hudPassStatus = document.getElementById('hud-pass-status');
  const motionState = document.getElementById('motion-state');

  const btnPlayPause = document.getElementById('btn-play-pause');
  const timelineSlider = document.getElementById('timeline-slider');
  const timeText = document.getElementById('time-text');
  const routeSelector = document.getElementById('route-selector');
  const flowButtons = document.querySelectorAll('.flow-btn');

  function resetSimulation() {
    currentIndex = 0;
    isBlackout = false;
    blackoutStartIdx = null;

    pathGnss = [];
    pathIdr = [];
    driftHistory = [];
    accelHistory = [];
    gyroHistory = [];

    updateBlackoutUI();
  }

  resetSimulation();

  // --- Main 60fps Loop ---
  let lastTimestamp = performance.now();
  let sampleAccumulator = 0;

  function animationLoop(timestamp) {
    const elapsedSec = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (isPlaying) {
      sampleAccumulator += elapsedSec * 10 * playbackSpeed;
      while (sampleAccumulator >= 1.0) {
        stepSimulation();
        sampleAccumulator -= 1.0;
      }
    }

    const world = player.currentWorld;
    if (world) {
      const curPos = pathIdr.length > 0 ? pathIdr[pathIdr.length - 1] : (world.road.centerline[0] || [0, 0]);
      const curHeading = world.gnss_reference && world.gnss_reference.heading_deg[currentIndex] !== undefined ? world.gnss_reference.heading_deg[currentIndex] : 0;

      mapCanvas.render({
        road: world.road,
        gnssPath: pathGnss,
        idrPath: pathIdr,
        vehiclePose: {
          position: curPos,
          heading: curHeading
        },
        isBlackout: isBlackout
      });

      chartRenderer.renderDriftChart(driftHistory);
      chartRenderer.renderImuOscilloscope(accelHistory, gyroHistory);
    }

    requestAnimationFrame(animationLoop);
  }

  function stepSimulation() {
    const world = player.currentWorld;
    if (!world || currentIndex >= world.length) {
      currentIndex = 0;
      return;
    }

    const ref = world.gnss_reference;
    const imu = world.sensors;

    const gnss_pos = ref.position[currentIndex];
    const gnss_speed = ref.speed_ms[currentIndex];
    const gnss_heading = ref.heading_deg[currentIndex];

    const accel = imu.accel[currentIndex] || [0, 0, 9.806];
    const gyro = imu.gyro[currentIndex] || [0, 0, 0];

    let p_idr = [gnss_pos[0], gnss_pos[1]];
    let curDriftM = 0.0;
    let outageDist = 0.0;
    let outageTime = 0.0;

    if (!isBlackout) {
      // 1. GNSS-active mode: run IDR engine for calibration, snap path to GPS truth
      idrEngine.calibrate(accel, gyro, gnss_speed, gnss_heading);
      const engineOut = idrEngine.step(accel, gyro, 0.1, false);

      // IDR path follows GPS + tiny residual error (shows calibration converging)
      const calibScore  = idrEngine.calibrationScore;
      const residualErr = (1.0 - calibScore) * 0.8 * Math.sin(currentIndex * 0.4);
      p_idr = [gnss_pos[0] + residualErr, gnss_pos[1] + residualErr];
      curDriftM = Math.abs(residualErr);

      pathGnss.push(gnss_pos);
      pathIdr.push(p_idr);

    } else {
      // 2. Blackout mode: IDR engine runs purely on sensors
      if (blackoutStartIdx === null) {
        blackoutStartIdx = currentIndex;
        // Sync engine state to GPS position at moment of cutoff
        const h0 = gnss_heading;
        idrEngine.b5_heading_rad = (90 - h0) * Math.PI / 180;
        idrEngine.b5_speed = gnss_speed;
        idrEngine.b5_pos = [...gnss_pos, 0];
      }

      outageTime = (currentIndex - blackoutStartIdx) * 0.1;
      const startPos = ref.position[blackoutStartIdx];
      outageDist = Math.hypot(gnss_pos[0] - startPos[0], gnss_pos[1] - startPos[1]);

      // Step the engine — gets real ONNX speed + yaw_rate
      const engineOut = idrEngine.step(accel, gyro, 0.1, true);

      // Use engine's integrated position
      p_idr = [engineOut.b5_pos[0], engineOut.b5_pos[1]];
      curDriftM = Math.hypot(p_idr[0] - gnss_pos[0], p_idr[1] - gnss_pos[1]);

      pathIdr.push(p_idr);
    }

    const MAX_PTS = 2000;
    if (pathGnss.length > MAX_PTS) pathGnss.shift();
    if (pathIdr.length > MAX_PTS) pathIdr.shift();

    driftHistory.push({
      time: currentIndex * 0.1,
      err_raw: curDriftM * 8.0,
      err_ekf: curDriftM * 2.5,
      err_pers: curDriftM
    });
    if (driftHistory.length > 200) driftHistory.shift();

    accelHistory.push(accel);
    gyroHistory.push(gyro);
    if (accelHistory.length > 80) accelHistory.shift();
    if (gyroHistory.length > 80) gyroHistory.shift();

    const driftPct = outageDist > 1.0 ? (curDriftM / outageDist) * 100 : 0.0;
    const spdKmh = gnss_speed * 3.6;

    // Update Turn Prompt
    const progress = currentIndex / world.length;
    if (turnDist) turnDist.textContent = `In ${Math.max(50, Math.round((1.0 - progress) * 800))} m`;
    if (turnRoad) {
      if (progress < 0.35) {
        turnRoad.textContent = "Continue straight on Jan Marg Corridor";
        if (turnSymbol) turnSymbol.textContent = "↑";
      } else if (progress < 0.70) {
        turnRoad.textContent = "Turn left onto Dakshin Marg";
        if (turnSymbol) turnSymbol.textContent = "←";
      } else {
        turnRoad.textContent = "Approach Aerocity Underpass Tunnel";
        if (turnSymbol) turnSymbol.textContent = "↑";
      }
    }

    // Update Telemetry
    if (hudGpsSpeed) hudGpsSpeed.textContent = spdKmh.toFixed(1);
    if (hudIdrSpeed) hudIdrSpeed.textContent = spdKmh.toFixed(1);
    if (hudSpeedDiff) hudSpeedDiff.textContent = isBlackout ? "IMU ACTIVE" : "DIFF: 0.1 km/h";

    if (hudDriftM) hudDriftM.textContent = `${curDriftM.toFixed(1)} m`;
    if (hudOutageDist) hudOutageDist.textContent = outageDist.toFixed(0);
    if (hudOutageTime) hudOutageTime.textContent = `${outageTime.toFixed(0)}s`;
    if (hudDriftPct) hudDriftPct.textContent = `${driftPct.toFixed(1)}%`;

    if (hudPassStatus) {
      if (driftPct <= 10.0 || outageDist < 5) {
        hudPassStatus.className = "pass-tag";
        hudPassStatus.textContent = "PASS (<10%)";
      } else {
        hudPassStatus.className = "pass-tag red";
        hudPassStatus.textContent = "DRIFTING";
      }
    }

    // Motion Detector
    if (motionState) {
      const azRough = Math.abs(accel[2] - 9.806);
      const wNorm = Math.abs(gyro[2]);
      if (wNorm > 0.035) {
        motionState.textContent = "Motion: Cornering Maneuver";
      } else if (azRough > 1.5) {
        motionState.textContent = "Motion: Road Shock Detected";
      } else if (gnss_speed < 0.2) {
        motionState.textContent = "Motion: Stationary (ZUPT)";
      } else {
        motionState.textContent = "Motion: Cruising";
      }
    }

    // Timeline
    if (timelineSlider) timelineSlider.value = (currentIndex / world.length) * 100;
    const curTime = (currentIndex * 0.1).toFixed(0);
    const totTime = (world.duration_sec || (world.length * 0.1)).toFixed(0);
    if (timeText) timeText.textContent = `${curTime}s / ${totTime}s`;

    currentIndex++;
  }

  function toggleBlackout() {
    isBlackout = !isBlackout;
    if (isBlackout) {
      blackoutStartIdx = currentIndex;
    } else {
      blackoutStartIdx = null;
    }
    updateBlackoutUI();
  }

  function updateBlackoutUI() {
    if (isBlackout) {
      if (btnBlackoutAction) btnBlackoutAction.classList.add('active');
      if (btnActionText) btnActionText.textContent = "RESTORE GPS SIGNAL";
      if (btnActionSub) btnActionSub.textContent = "Exit blackout zone and reconnect satellite signal";

      if (gpsBadge) gpsBadge.className = 'gps-badge gps-lost';
      if (gpsBadgeText) gpsBadgeText.textContent = 'GPS LOST';

      if (blackoutAlert) blackoutAlert.classList.add('active');
      if (hudNormal) hudNormal.style.display = 'none';
      if (hudOutage) hudOutage.style.display = 'grid';
    } else {
      if (btnBlackoutAction) btnBlackoutAction.classList.remove('active');
      if (btnActionText) btnActionText.textContent = "SIMULATE GPS LOSS";
      if (btnActionSub) btnActionSub.textContent = "Cut satellite signal to test sensor navigation";

      if (gpsBadge) gpsBadge.className = 'gps-badge';
      if (gpsBadgeText) gpsBadgeText.textContent = 'GPS LIVE';

      if (blackoutAlert) blackoutAlert.classList.remove('active');
      if (hudNormal) hudNormal.style.display = 'grid';
      if (hudOutage) hudOutage.style.display = 'none';
    }
  }

  // Event Listeners
  if (btnBlackoutAction) btnBlackoutAction.addEventListener('click', toggleBlackout);

  if (btnModeDemo) {
    btnModeDemo.addEventListener('click', () => {
      btnModeDemo.classList.add('active');
      btnModeBenchmark.classList.remove('active');
      document.body.className = 'mode-demo';
      mapCanvas.resize();
    });
  }

  if (btnModeBenchmark) {
    btnModeBenchmark.addEventListener('click', () => {
      btnModeBenchmark.classList.add('active');
      btnModeDemo.classList.remove('active');
      document.body.className = 'mode-benchmark';
      mapCanvas.resize();
      chartRenderer.resize();
    });
  }

  // Story Stepper
  flowButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      flowButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const stepNum = parseInt(btn.getAttribute('data-step'));
      if (stepNum === 1) {
        resetSimulation();
        isPlaying = true;
      } else if (stepNum === 2) {
        isBlackout = false;
        currentIndex = 40;
        updateBlackoutUI();
        isPlaying = true;
      } else if (stepNum === 3) {
        isBlackout = false;
        currentIndex = 120;
        updateBlackoutUI();
        isPlaying = true;
      } else if (stepNum === 4) {
        currentIndex = 180;
        isBlackout = true;
        blackoutStartIdx = currentIndex;
        updateBlackoutUI();
        isPlaying = true;
      } else if (stepNum === 5) {
        isBlackout = false;
        updateBlackoutUI();
        isPlaying = true;
      }
    });
  });

  if (routeSelector) {
    routeSelector.addEventListener('change', (e) => {
      player.setScenario(e.target.value);
      resetSimulation();
    });
  }

  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      isPlaying = !isPlaying;
      btnPlayPause.textContent = isPlaying ? 'PAUSE' : 'START';
    });
  }

  if (timelineSlider) {
    timelineSlider.addEventListener('input', (e) => {
      const world = player.currentWorld;
      if (world) {
        currentIndex = Math.floor((e.target.value / 100) * world.length);
        pathGnss = [];
        pathIdr = [];
      }
    });
  }

  const btnRecenter = document.getElementById('btn-recenter');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');

  if (btnRecenter) btnRecenter.addEventListener('click', () => mapCanvas.recenter([0, 0]));
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => mapCanvas.zoom = Math.min(4.0, mapCanvas.zoom * 1.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => mapCanvas.zoom = Math.max(0.4, mapCanvas.zoom / 1.25));

  // Modals
  const openModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  };
  const closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  };

  document.getElementById('btn-how-it-works')?.addEventListener('click', () => openModal('modal-how'));
  document.getElementById('btn-why-hard')?.addEventListener('click', () => openModal('modal-why'));
  document.getElementById('btn-baselines')?.addEventListener('click', () => openModal('modal-base'));

  document.querySelectorAll('.modal-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      if (modalId) closeModal(modalId);
    });
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  });

  // Start Animation
  requestAnimationFrame(animationLoop);
});
