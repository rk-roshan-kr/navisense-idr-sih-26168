import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { theme } from './src/theme';
import type { TelemetryPacket } from './src/types';
import { TopBar } from './src/components/TopBar';
import { NavigationCard } from './src/components/NavigationCard';
import { LiveMap } from './src/components/LiveMap';
import { TechnicalArchitectureDrawer } from './src/components/TechnicalArchitectureDrawer';
import { RoutePlannerModal } from './src/components/RoutePlannerModal';
import { PreflightCheckModal } from './src/components/PreflightCheckModal';
import { CustomRouteSimulator, PRESET_ROUTES } from './src/utils/customRouteSimulator';

import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { ScreenErrorBoundary } from './src/components/ScreenErrorBoundary';
import type { ChaosStateOverride } from './src/components/ChaosModePanel';

// Fault-Tolerant Engine Modules
import { SensorWatchdog, type WatchdogReport } from './src/engine/sensorWatchdog';
import { OutputValidator } from './src/engine/outputValidator';
import { NavigationSupervisor, type SupervisoryStatus } from './src/engine/navigationSupervisor';
import {
  FaultInjectionLab,
  type GnssFault,
  type NetworkFault,
  type SensorFault,
} from './src/engine/faultInjectionLab';

export default function App() {
  // Core Engine References (Native-like Mission Core)
  const simRef = useRef<CustomRouteSimulator>(new CustomRouteSimulator());
  const watchdogRef = useRef<SensorWatchdog>(new SensorWatchdog(10));
  const validatorRef = useRef<OutputValidator>(new OutputValidator());
  const supervisorRef = useRef<NavigationSupervisor>(new NavigationSupervisor());
  const faultLabRef = useRef<FaultInjectionLab>(new FaultInjectionLab());

  const wsRef = useRef<WebSocket | null>(null);
  const autoDemoTimersRef = useRef<any[]>([]);
  const simIntervalRef = useRef<any>(null);

  // Authoritative State Machine Signals
  const [selectedPresetId, setSelectedPresetId] = useState<string>('delhi');
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [customOrigin, setCustomOrigin] = useState<[number, number] | null>(null);
  const [customDestination, setCustomDestination] = useState<[number, number] | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showGhostBaseline, setShowGhostBaseline] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('Delhi: Connaught Place ➔ Aerocity Gateway (15.5 km) loaded.');

  // Fault Lab States
  const [activeGnssFault, setActiveGnssFault] = useState<GnssFault>('NONE');
  const [activeNetworkFault, setActiveNetworkFault] = useState<NetworkFault>('ONLINE');
  const [activeSensorFault, setActiveSensorFault] = useState<SensorFault>('NONE');
  const [watchdogReport, setWatchdogReport] = useState<WatchdogReport>(watchdogRef.current.getReport());
  const [supervisoryStatus, setSupervisoryStatus] = useState<SupervisoryStatus>(
    supervisorRef.current.evaluate(false, false, 4.2, watchdogRef.current.getReport(), true, 1, 0, false)
  );

  // Modals
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showRoutePlanner, setShowRoutePlanner] = useState<boolean>(false);
  const [showPreflightModal, setShowPreflightModal] = useState<boolean>(false);
  const [chaosOverride, setChaosOverride] = useState<ChaosStateOverride>('NONE');

  // Initialize with Delhi preset route on load
  useEffect(() => {
    const coords = simRef.current.loadPreset('delhi');
    setRouteCoordinates(coords);
    const initialPacket = simRef.current.step();
    if (initialPacket) {
      setTelemetry(initialPacket);
    }
  }, []);

  // 10 Hz State Machine & Telemetry Tick
  useEffect(() => {
    if (isPlaying) {
      simIntervalRef.current = setInterval(() => {
        const monotonicNow = Date.now();

        // 1. Sensor Watchdog check
        const report = watchdogRef.current.recordSample(
          monotonicNow,
          activeSensorFault !== 'DROP_GYRO',
          activeSensorFault !== 'DROP_GYRO'
        );
        setWatchdogReport(report);

        // 2. Step physics simulation
        let nextPacket = simRef.current.step();

        if (nextPacket) {
          // 3. Inject active fault states if configured
          if (activeGnssFault === 'JUMP_20M') {
            // Check innovation gate
            const innovation = validatorRef.current.validateGnssSample(
              nextPacket.idr_position.lat,
              nextPacket.idr_position.lon,
              nextPacket.idr_position.lat + 0.0003, // ~33m jump
              nextPacket.idr_position.lon + 0.0003
            );
            if (!innovation.accept) {
              // Innovation gate successfully rejects anomalous jump!
              nextPacket.point_error_m = 25.0;
            }
          } else if (activeGnssFault === 'BAD_ACCURACY') {
            nextPacket.point_error_m = 28.5;
          }

          // 4. Output Validator on Neural Predictions
          const validation = validatorRef.current.validateNeuralOutput(
            nextPacket.technical_proof.pred_v_mps,
            nextPacket.technical_proof.pred_wz_rads,
            nextPacket.technical_proof.uncertainty_m
          );

          if (!validation.valid) {
            nextPacket.technical_proof.pred_v_mps = validation.sanitizedVelocityMps;
            nextPacket.technical_proof.uncertainty_m = validation.sanitizedUncertaintyM;
          }

          // 5. Authoritative Navigation Supervisor Evaluation
          const sup = supervisorRef.current.evaluate(
            true,
            nextPacket.blackout_active || activeGnssFault === 'BLACKOUT',
            nextPacket.point_error_m ?? 4.2,
            report,
            validation.valid,
            1,
            nextPacket.speed_kmh,
            false
          );
          setSupervisoryStatus(sup);

          setTelemetry(nextPacket);
        } else {
          // Reached end of corridor
          setIsPlaying(false);
          supervisorRef.current.setNavigationState('ARRIVED');
          setStatusMsg('Reached destination! Simulation completed.');
        }
      }, 100);
    } else {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    }

    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
      }
    };
  }, [isPlaying, activeGnssFault, activeSensorFault]);

  // Optional WebSocket connection to backend python server (127.0.0.1:8000)
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: any;

    function connect() {
      try {
        ws = new WebSocket('ws://127.0.0.1:8000/ws/telemetry');

        ws.onopen = () => {
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'telemetry') {
              setTelemetry(msg.data);
            }
          } catch (e) {
            // Ignore parse error
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setIsConnected(false);
          ws.close();
        };

        wsRef.current = ws;
      } catch (err) {
        setIsConnected(false);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Handlers
  const handleTogglePlay = () => {
    if (!isPlaying) {
      setIsPlaying(true);
      simRef.current.isPlaying = true;
      supervisorRef.current.setNavigationState('NAVIGATING');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'play' }));
      }
    } else {
      // Pause
      setIsPlaying(false);
      simRef.current.isPlaying = false;
      supervisorRef.current.setNavigationState('IDLE');
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'pause' }));
      }
    }
  };

  const handleProceedFromPreflight = () => {
    setIsPlaying(true);
    simRef.current.isPlaying = true;
    supervisorRef.current.setNavigationState('NAVIGATING');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'play' }));
    }
  };

  const handleReset = () => {
    autoDemoTimersRef.current.forEach(clearTimeout);
    autoDemoTimersRef.current = [];
    setIsPlaying(false);
    simRef.current.reset();
    watchdogRef.current.reset();
    validatorRef.current.reset();
    faultLabRef.current.resetAllFaults();
    setActiveGnssFault('NONE');
    setActiveNetworkFault('ONLINE');
    setActiveSensorFault('NONE');

    const packet = simRef.current.step();
    if (packet) setTelemetry(packet);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'pause' }));
    }
  };

  const handleToggleBlackout = () => {
    const next = simRef.current.toggleBlackout();
    setActiveGnssFault(next ? 'BLACKOUT' : 'NONE');

    // If simulation was paused, auto-start it so the driver sees the outage in action!
    if (!isPlaying) {
      setIsPlaying(true);
      simRef.current.isPlaying = true;
      supervisorRef.current.setNavigationState('NAVIGATING');
    }

    if (telemetry) {
      setTelemetry({
        ...telemetry,
        blackout_active: next,
        mode: next ? 'PSEUDO_GNSS' : 'NORMAL_GNSS',
        gnss_available: !next,
        blackout_elapsed_s: 0,
      });
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'toggle_blackout' }));
    }
  };

  const handleToggleGhostBaseline = () => {
    setShowGhostBaseline((prev) => !prev);
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    setIsPlaying(false);
    const coords = simRef.current.loadPreset(presetId);
    setRouteCoordinates(coords);
    setCustomOrigin(null);
    setCustomDestination(null);

    const active = PRESET_ROUTES.find((p) => p.id === presetId) || PRESET_ROUTES[0];
    setStatusMsg(`${active.name} loaded. Ready to navigate.`);

    const packet = simRef.current.step();
    if (packet) setTelemetry(packet);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'select_scenario', scenario_id: presetId }));
    }
  };

  const handleClearPoints = () => {
    setCustomOrigin(null);
    setCustomDestination(null);
    handleReset();
    setStatusMsg('Cleared custom points. Reset to corridor origin.');
  };

  // Fault Lab Toggles
  const handleSetGnssFault = (f: GnssFault) => {
    setActiveGnssFault(f);
    faultLabRef.current.setGnssFault(f);
    if (f === 'BLACKOUT') {
      simRef.current.toggleBlackout(true);
    } else {
      simRef.current.toggleBlackout(false);
    }
  };

  const handleSetNetworkFault = (f: NetworkFault) => {
    setActiveNetworkFault(f);
    faultLabRef.current.setNetworkFault(f);
  };

  const handleSetSensorFault = (f: SensorFault) => {
    setActiveSensorFault(f);
    faultLabRef.current.setSensorFault(f);
    watchdogRef.current.injectSensorFault(f as any);
  };

  // Run Automated Evaluation Scenarios (Scenarios A through F)
  const handleRunScenario = (scenarioId: string) => {
    autoDemoTimersRef.current.forEach(clearTimeout);
    autoDemoTimersRef.current = [];

    handleReset();
    handleSelectPreset('delhi');
    setIsPlaying(true);
    setShowDiagnostics(false);

    if (scenarioId === 'scenario_a') {
      // Scenario A: Tunnel Outage & Smooth Recovery (60s)
      setShowGhostBaseline(true);
      setStatusMsg('Scenario A: Normal GNSS for 5s...');

      const t1 = setTimeout(() => {
        handleSetGnssFault('BLACKOUT');
        setStatusMsg('Scenario A: Tunnel Outage active (NIDR tracking)...');
      }, 5000);

      const t2 = setTimeout(() => {
        handleSetGnssFault('NONE');
        setStatusMsg('Scenario A: GNSS Restored! Smooth reconvergence active.');
      }, 40000);

      autoDemoTimersRef.current = [t1, t2];
    } else if (scenarioId === 'scenario_b') {
      // Scenario B: Hard Braking & ZUPT stop
      setStatusMsg('Scenario B: Vehicle braking to zero velocity...');
      const t1 = setTimeout(() => {
        simRef.current.speedMps = 0.0;
        setStatusMsg('Scenario B: Stationary at intersection (ZUPT active)...');
      }, 6000);
      const t2 = setTimeout(() => {
        simRef.current.speedMps = 14.0;
        setStatusMsg('Scenario B: Accelerating out of stop.');
      }, 15000);
      autoDemoTimersRef.current = [t1, t2];
    } else if (scenarioId === 'scenario_c') {
      // Scenario C: Cellular Offline Mode
      handleSetNetworkFault('OFFLINE');
      setStatusMsg('Scenario C: Offline mode active (Offline route and vector tiles cached).');
    }
  };

  // Chaos Mode Handlers
  const handleSelectChaosOverride = (o: ChaosStateOverride) => {
    setChaosOverride(o);
  };

  const handleRandomizeChaos = () => {
    const options: ChaosStateOverride[] = [
      'LOADING',
      'READY',
      'EMPTY_DESTINATION',
      'EMPTY_ROUTE',
      'PARTIAL_GPS_NO_ROUTE',
      'PARTIAL_ROUTE_NO_GPS',
      'NULL_DATA',
      'ERROR_ROUTE_TIMEOUT',
      'OFFLINE_NIDR_ACTIVE',
      'DISABLED_PREFLIGHT',
      'PERMISSION_DENIED',
      'NO_SAVED_SESSIONS',
      'MAP_TILES_UNAVAILABLE',
      'MODEL_FAILURE',
      'SENSOR_FAILURE',
      'STORAGE_FULL',
      'LONG_TEXT',
      'HIGH_UNCERTAINTY',
      'STATIONARY_ZERO_SPEED',
      'UNKNOWN_HEADING',
      'RECONVERGING',
      'ARRIVED',
    ];
    const randomChoice = options[Math.floor(Math.random() * options.length)];
    setChaosOverride(randomChoice);
  };

  const handleResetChaos = () => {
    setChaosOverride('NONE');
  };

  const isBlackout = telemetry?.blackout_active ?? false;
  const blackoutElapsedS = telemetry?.blackout_elapsed_s ?? 0;
  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeContainer} edges={['top', 'left', 'right']}>
          <StatusBar style="dark" />

          {/* 1. Full-Bleed Map View with Floating Apple Maps Turn Header */}
          <View style={styles.mapWrapper}>
            <ScreenErrorBoundary screenName="Vector Map Display">
              <LiveMap
                telemetry={telemetry}
                routeCoordinates={routeCoordinates}
                showGhostBaseline={showGhostBaseline}
                onToggleGhostBaseline={handleToggleGhostBaseline}
                customOrigin={customOrigin}
                customDestination={customDestination}
              />
            </ScreenErrorBoundary>

            {/* Floating Apple Maps Turn-by-Turn Automotive HUD */}
            <TopBar
              isConnected={isConnected}
              isPlaying={isPlaying}
              isBlackout={isBlackout}
              blackoutElapsedS={blackoutElapsedS}
              onTogglePlay={handleTogglePlay}
              onReset={handleReset}
              showGhostBaseline={showGhostBaseline}
              onToggleGhostBaseline={handleToggleGhostBaseline}
              onStartAutoDemo={() => handleRunScenario('scenario_a')}
              selectedPresetId={selectedPresetId}
              onSelectPreset={handleSelectPreset}
              telemetry={telemetry}
              roadName={activePreset.name.split(':')[0]}
              chaosOverride={chaosOverride}
            />
          </View>

          {/* 2. Lower Driver Cockpit & Primary Automotive Control Deck */}
          <ScreenErrorBoundary screenName="Navigation Guidance HUD">
            <NavigationCard
              telemetry={telemetry}
              totalDistanceKm={activePreset.distanceKm}
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onToggleBlackout={handleToggleBlackout}
              onOpenDiagnostics={() => setShowDiagnostics(true)}
              onOpenRoutePlanner={() => setShowRoutePlanner(true)}
              onStartAutoDemo={() => handleRunScenario('scenario_a')}
              onReset={handleReset}
              roadName={activePreset.name.split(':')[0]}
              chaosOverride={chaosOverride}
              onRetryRoute={() => handleSelectPreset(selectedPresetId)}
            />
          </ScreenErrorBoundary>

          {/* 4. Underlying Technical Architecture & Failure Lab Drawer */}
          <ScreenErrorBoundary screenName="Technical Diagnostics Drawer">
            <TechnicalArchitectureDrawer
              visible={showDiagnostics}
              onClose={() => setShowDiagnostics(false)}
              telemetry={telemetry}
              watchdogReport={watchdogReport}
              activeGnssFault={activeGnssFault}
              activeNetworkFault={activeNetworkFault}
              activeSensorFault={activeSensorFault}
              onSetGnssFault={handleSetGnssFault}
              onSetNetworkFault={handleSetNetworkFault}
              onSetSensorFault={handleSetSensorFault}
              onRunScenario={handleRunScenario}
              chaosOverride={chaosOverride}
              onSelectChaosOverride={handleSelectChaosOverride}
              onRandomizeChaos={handleRandomizeChaos}
              onResetChaos={handleResetChaos}
            />
          </ScreenErrorBoundary>

          {/* 5. Pre-flight Verification Modal */}
          <PreflightCheckModal
            visible={showPreflightModal}
            onClose={() => setShowPreflightModal(false)}
            onProceed={handleProceedFromPreflight}
            corridorName={activePreset.name}
          />

          {/* 6. Point A ➔ Point B Corridor & Route Planner Modal */}
          <RoutePlannerModal
            visible={showRoutePlanner}
            onClose={() => setShowRoutePlanner(false)}
            selectedPresetId={selectedPresetId}
            onSelectPreset={handleSelectPreset}
            customOrigin={customOrigin}
            customDestination={customDestination}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            onClearPoints={handleClearPoints}
            statusMsg={statusMsg}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  mapWrapper: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#f1f5f9',
  },
});
