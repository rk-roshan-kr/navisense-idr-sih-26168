import React, { useEffect, useRef, useState } from 'react';
import type { TelemetryPacket, ScenarioInfo, AppMode, ViewMode } from './types';
import { LiveMap } from './components/LiveMap';
import { NavigationHUD } from './components/NavigationHUD';
import { AlertBanner } from './components/AlertBanner';
import { ActionControl } from './components/ActionControl';
import { TechnicalProofDrawer } from './components/TechnicalProofDrawer';
import { RightSidebar } from './components/RightSidebar';
import { TopBar } from './components/TopBar';
import { TurnGuidance } from './components/TurnGuidance';
import { CustomRouteSimulator } from './utils/customRouteSimulator';
import { RoutePlannerWidget, ROUTE_PRESETS } from './components/RoutePlannerWidget';

export const App: React.FC = () => {
  // Mode state: 2-Point Road Navigation by Default (Always Point A -> Point B!)
  const [appMode, setAppMode] = useState<AppMode>('CUSTOM_ROUTE');

  // View state: Simplified by Default vs Detailed Telemetry
  const [viewMode, setViewMode] = useState<ViewMode>('SIMPLIFIED');

  // Judge Baseline: Raw INS Ghost Divergence
  const [showGhostBaseline, setShowGhostBaseline] = useState(false);

  // Backend Dataset streaming state
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(null);
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null);
  const [scenariosList, setScenariosList] = useState<{ id: string; name: string; metrics: Record<string, string> }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Option 2: Choose 2 Points on Map state
  const [selectedPresetId, setSelectedPresetId] = useState<string>('bangalore');
  const [customOrigin, setCustomOrigin] = useState<[number, number] | null>(ROUTE_PRESETS[0].origin);
  const [customDestination, setCustomDestination] = useState<[number, number] | null>(ROUTE_PRESETS[0].destination);
  const [customRoutePath, setCustomRoutePath] = useState<[number, number][]>([]);
  const [customStatusMsg, setCustomStatusMsg] = useState('Bangalore: ISRO ISTRAC to Indiranagar Flat loaded.');

  const wsRef = useRef<WebSocket | null>(null);
  const customSimRef = useRef<CustomRouteSimulator>(new CustomRouteSimulator());
  const customTimerRef = useRef<any>(null);
  const autoDemoTimersRef = useRef<any[]>([]);

  // Mode 2: Handle Map Clicks for Option 2 (Choose 2 Points)
  const handleMapClick = async (lat: number, lon: number) => {
    if (appMode !== 'CUSTOM_ROUTE') return;

    if (!customOrigin) {
      const originPt: [number, number] = [lat, lon];
      setCustomOrigin(originPt);
      setCustomStatusMsg('Point A (Origin) set. Now click on the map to set Point B (Destination)');
    } else if (!customDestination) {
      const destPt: [number, number] = [lat, lon];
      setCustomDestination(destPt);
      setCustomStatusMsg('Calculating route from offline road network...');

      try {
        const path = await customSimRef.current.fetchRoute(customOrigin, destPt);
        setCustomRoutePath(path);
        setCustomStatusMsg('Route ready! Click START SIMULATION to begin navigation');
        const firstPkt = customSimRef.current.step();
        if (firstPkt) setTelemetry(firstPkt);
      } catch (err: any) {
        setCustomStatusMsg(`Routing error: ${err.message}`);
      }
    }
  };

  const handleSetOrigin = (pt: [number, number]) => {
    setCustomOrigin(pt);
    setCustomStatusMsg('Origin set from vehicle. Now click on the map to set Destination (Point B)');
  };

  const handleSelectPreset = async (origin: [number, number], dest: [number, number], name: string) => {
    if (customTimerRef.current) clearInterval(customTimerRef.current);
    customSimRef.current.reset();
    setCustomOrigin(origin);
    setCustomDestination(dest);
    setCustomStatusMsg(`Calculating route for ${name}...`);
    try {
      const path = await customSimRef.current.fetchRoute(origin, dest);
      setCustomRoutePath(path);
      setCustomStatusMsg(`${name} loaded. Click START SIMULATION to begin navigation!`);
      const firstPkt = customSimRef.current.step();
      if (firstPkt) setTelemetry(firstPkt);
    } catch (err: any) {
      setCustomStatusMsg(`Routing error: ${err.message}`);
    }
  };

  const handleSelectPresetById = (presetId: string) => {
    setSelectedPresetId(presetId);
    const target = ROUTE_PRESETS.find((p) => p.id === presetId) || ROUTE_PRESETS[0];
    handleSelectPreset(target.origin, target.destination, target.name);
  };

  const handleClearCustomPoints = () => {
    if (customTimerRef.current) clearInterval(customTimerRef.current);
    customSimRef.current.reset();
    setCustomOrigin(null);
    setCustomDestination(null);
    setCustomRoutePath([]);
    setCustomStatusMsg('Click on the map to choose Origin (Point A)');
    setIsPlaying(false);
  };

  // Automatically initialize with Bangalore ISRO 2-Point Road Corridor on launch
  useEffect(() => {
    handleSelectPresetById('bangalore');
  }, []);

  // Fetch scenarios list on load
  useEffect(() => {
    fetch('http://127.0.0.1:8000/api/scenarios')
      .then((res) => res.json())
      .then((data) => {
        if (data.scenarios) setScenariosList(data.scenarios);
        if (data.active_scenario) setScenario(data.active_scenario);
      })
      .catch((err) => console.error('Failed to fetch scenarios:', err));
  }, []);

  // WebSocket Connection Management (For Mode 1)
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: any;

    function connect() {
      ws = new WebSocket('ws://127.0.0.1:8000/ws/telemetry');

      ws.onopen = () => {
        console.log('[WS] Connected to Navisense live engine');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'telemetry') {
            setTelemetry(msg.data);
          } else if (msg.type === 'scenario_info') {
            setScenario(msg.data);
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('[WS] Error:', err);
        ws.close();
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [appMode]);

  // Mode Switch
  const handleToggleMode = (mode: AppMode) => {
    setAppMode(mode);
    if (mode === 'CUSTOM_ROUTE') {
      if (customRoutePath.length === 0) {
        setCustomStatusMsg('Click on the map to choose Origin (Point A)');
      }
      setIsPlaying(false);
      if (customTimerRef.current) clearInterval(customTimerRef.current);
    } else {
      setIsPlaying(true);
      if (customTimerRef.current) clearInterval(customTimerRef.current);
    }
  };

  // View Mode Toggle (Simplified by default vs Detailed)
  const handleToggleViewMode = () => {
    setViewMode((prev) => (prev === 'SIMPLIFIED' ? 'DETAILED' : 'SIMPLIFIED'));
  };

  const handleToggleGhostBaseline = () => {
    setShowGhostBaseline((prev) => !prev);
  };

  // Control Actions
  const handleToggleBlackout = () => {
    if (appMode === 'CUSTOM_ROUTE') {
      customSimRef.current.toggleBlackout();
      const nextPkt = customSimRef.current.step();
      if (nextPkt) setTelemetry(nextPkt);
    } else {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'toggle_blackout' }));
      }
    }
  };

  const handleSelectScenario = (scenarioId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'select_scenario', scenario_id: scenarioId }));
    }
  };

  // Check whether 2 points are active before allowing simulation to start
  const hasActivePoints = (customOrigin !== null && customDestination !== null) || (scenario !== null) || (customRoutePath.length > 0);

  const handleTogglePlay = () => {
    if (!hasActivePoints && !isPlaying) {
      alert("Please select Point A (Origin) and Point B (Destination) to start navigation simulation.");
      return;
    }

    const nextState = !isPlaying;
    setIsPlaying(nextState);

    // Send immediately via WebSocket to Python runtime
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: nextState ? 'play' : 'pause' }));
    }

    // Also notify HTTP API endpoint
    fetch('http://127.0.0.1:8000/api/playback/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: nextState ? 'play' : 'pause' })
    }).catch(console.error);

    if (appMode === 'CUSTOM_ROUTE') {
      if (nextState) {
        customTimerRef.current = setInterval(() => {
          const pkt = customSimRef.current.step();
          if (pkt) {
            setTelemetry(pkt);
          } else {
            clearInterval(customTimerRef.current);
            setIsPlaying(false);
          }
        }, 100);
      } else {
        if (customTimerRef.current) clearInterval(customTimerRef.current);
      }
    }
  };

  const handleReset = () => {
    autoDemoTimersRef.current.forEach(clearTimeout);
    autoDemoTimersRef.current = [];

    if (appMode === 'CUSTOM_ROUTE') {
      customSimRef.current.reset();
      const firstPkt = customSimRef.current.step();
      if (firstPkt) setTelemetry(firstPkt);
      setIsPlaying(false);
      if (customTimerRef.current) clearInterval(customTimerRef.current);
    } else {
      fetch('http://127.0.0.1:8000/api/playback/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      }).catch(console.error);
    }
  };

  // 60-Second Judge Auto-Demo Sequence
  const handleStartAutoDemo = () => {
    autoDemoTimersRef.current.forEach(clearTimeout);
    autoDemoTimersRef.current = [];

    // 1. Switch to Highway scenario & start playing
    handleSelectScenario('highway');
    setAppMode('CANONICAL_DATASET');
    setIsPlaying(true);
    setShowGhostBaseline(true);

    fetch('http://127.0.0.1:8000/api/playback/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'play' })
    }).catch(console.error);

    // 2. At 5 seconds: trigger GNSS loss
    const t1 = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'toggle_blackout' }));
      }
    }, 5000);

    // 3. At 35 seconds: restore GNSS with smooth reconvergence
    const t2 = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'toggle_blackout' }));
      }
    }, 35000);

    autoDemoTimersRef.current = [t1, t2];
  };

  const currentDriftPct = telemetry?.drift_pct ?? 2.6;

  return (
    <div className="app-viewport">
      {/* 1. Top Navigation Bar with Judge Scorecard & Controls */}
      <TopBar
        scenario={scenario}
        scenariosList={scenariosList}
        onSelectScenario={handleSelectScenario}
        isConnected={isConnected}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
        appMode={appMode}
        onToggleMode={handleToggleMode}
        customStatusMsg={customStatusMsg}
        onClearCustomPoints={handleClearCustomPoints}
        viewMode={viewMode}
        onToggleViewMode={handleToggleViewMode}
        currentDriftPct={currentDriftPct}
        showGhostBaseline={showGhostBaseline}
        onToggleGhostBaseline={handleToggleGhostBaseline}
        onStartAutoDemo={handleStartAutoDemo}
        selectedPresetId={selectedPresetId}
        onSelectPresetId={handleSelectPresetById}
      />

      {/* 2. Main Layout */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Map View */}
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <LiveMap
            telemetry={telemetry}
            scenario={scenario}
            appMode={appMode}
            customOrigin={customOrigin}
            customDestination={customDestination}
            customRoutePath={customRoutePath}
            onMapClick={handleMapClick}
            showGhostBaseline={showGhostBaseline}
          />

          {/* Turn-by-Turn Maneuver Guidance & Street Name */}
          <TurnGuidance telemetry={telemetry} scenario={scenario} />

          {/* Flash Alert Banner */}
          <AlertBanner telemetry={telemetry} />

          {/* 2-Location Route Corridor Planner Card (In-place collapsible with − / +) */}
          <RoutePlannerWidget
            customOrigin={customOrigin}
            customDestination={customDestination}
            customRoutePath={customRoutePath}
            customStatusMsg={customStatusMsg}
            onSetOrigin={handleSetOrigin}
            onSelectPreset={handleSelectPreset}
            onClearPoints={handleClearCustomPoints}
            onStartSimulation={handleTogglePlay}
            telemetry={telemetry}
            isPlaying={isPlaying}
          />

          {/* SIMPLIFIED VIEW (DEFAULT): Cockpit HUD with Vehicle Speed Dial */}
          {viewMode === 'SIMPLIFIED' && <NavigationHUD telemetry={telemetry} />}

          {/* Floating Action Capsule (Center-aligned Bottom Dock per DESIGN.md) */}
          <ActionControl
            telemetry={telemetry}
            onToggleBlackout={handleToggleBlackout}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            hasActivePoints={hasActivePoints}
          />

          {/* Subtle Technical Proof Drawer */}
          {viewMode === 'SIMPLIFIED' && <TechnicalProofDrawer telemetry={telemetry} />}
        </div>

        {/* DETAILED VIEW: Slide-in Telemetry Sidebar */}
        {viewMode === 'DETAILED' && (
          <div style={{ zIndex: 1000, height: '100%', paddingTop: '72px' }}>
            <RightSidebar telemetry={telemetry} onClose={() => setViewMode('SIMPLIFIED')} />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
