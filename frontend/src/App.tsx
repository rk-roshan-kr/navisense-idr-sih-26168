import React, { useEffect, useRef, useState } from 'react';
import type { TelemetryPacket, ScenarioInfo, AppMode } from './types';
import { LiveMap } from './components/LiveMap';
import { NavigationHUD } from './components/NavigationHUD';
import { AlertBanner } from './components/AlertBanner';
import { ActionControl } from './components/ActionControl';
import { TechnicalProofDrawer } from './components/TechnicalProofDrawer';
import { TopBar } from './components/TopBar';
import { CustomRouteSimulator } from './utils/customRouteSimulator';

export const App: React.FC = () => {
  // Mode state
  const [appMode, setAppMode] = useState<AppMode>('CANONICAL_DATASET');

  // Backend Dataset streaming state
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(null);
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null);
  const [scenariosList, setScenariosList] = useState<{ id: string; name: string; metrics: Record<string, string> }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  // Option 2: Choose 2 Points on Map state
  const [customOrigin, setCustomOrigin] = useState<[number, number] | null>(null);
  const [customDestination, setCustomDestination] = useState<[number, number] | null>(null);
  const [customRoutePath, setCustomRoutePath] = useState<[number, number][]>([]);
  const [customStatusMsg, setCustomStatusMsg] = useState('📍 Click on the map to choose Origin (Point A)');

  const wsRef = useRef<WebSocket | null>(null);
  const customSimRef = useRef<CustomRouteSimulator>(new CustomRouteSimulator());
  const customTimerRef = useRef<any>(null);

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
            if (appMode === 'CANONICAL_DATASET') {
              setTelemetry(msg.data);
            }
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

  // Mode 2: Handle Map Clicks for Option 2 (Choose 2 Points)
  const handleMapClick = async (lat: number, lon: number) => {
    if (appMode !== 'CUSTOM_ROUTE') return;

    if (!customOrigin) {
      const originPt: [number, number] = [lat, lon];
      setCustomOrigin(originPt);
      setCustomStatusMsg('📍 Origin set! Now click on the map to set Destination (Point B)');
    } else if (!customDestination) {
      const destPt: [number, number] = [lat, lon];
      setCustomDestination(destPt);
      setCustomStatusMsg('⏳ Planning route with vector road network...');

      try {
        const path = await customSimRef.current.fetchRoute(customOrigin, destPt);
        setCustomRoutePath(path);
        setCustomStatusMsg('✓ Route planned! Click ▶ PLAY to start navigation');
        // Produce initial step
        const firstPkt = customSimRef.current.step();
        if (firstPkt) setTelemetry(firstPkt);
      } catch (err: any) {
        setCustomStatusMsg(`⚠️ Routing error: ${err.message}`);
      }
    }
  };

  const handleClearCustomPoints = () => {
    if (customTimerRef.current) clearInterval(customTimerRef.current);
    customSimRef.current.reset();
    setCustomOrigin(null);
    setCustomDestination(null);
    setCustomRoutePath([]);
    setCustomStatusMsg('📍 Click on the map to choose Origin (Point A)');
    setIsPlaying(false);
  };

  // Mode Switch
  const handleToggleMode = (mode: AppMode) => {
    setAppMode(mode);
    if (mode === 'CUSTOM_ROUTE') {
      if (customRoutePath.length === 0) {
        setCustomStatusMsg('📍 Click on the map to choose Origin (Point A)');
      }
      setIsPlaying(false);
      if (customTimerRef.current) clearInterval(customTimerRef.current);
    } else {
      setIsPlaying(true);
      if (customTimerRef.current) clearInterval(customTimerRef.current);
    }
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

  const handleTogglePlay = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);

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
    } else {
      fetch('http://127.0.0.1:8000/api/playback/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextState ? 'play' : 'pause' })
      }).catch(console.error);
    }
  };

  const handleReset = () => {
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

  return (
    <div className="app-viewport">
      {/* 1. Header with Mode Selector (Option 1 vs Option 2) */}
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
      />

      {/* 2. Full-Screen Dominant Dark Automotive Map */}
      <div className="map-fullscreen">
        <LiveMap
          telemetry={telemetry}
          scenario={scenario}
          appMode={appMode}
          customOrigin={customOrigin}
          customDestination={customDestination}
          customRoutePath={customRoutePath}
          onMapClick={handleMapClick}
        />
      </div>

      {/* 3. Flash Alert Banner */}
      <AlertBanner telemetry={telemetry} />

      {/* 4. Primary Navigation HUD (Speed, Heading, Drift) */}
      <NavigationHUD telemetry={telemetry} />

      {/* 5. Giant Floating Action Button */}
      <ActionControl telemetry={telemetry} onToggleBlackout={handleToggleBlackout} />

      {/* 6. Technical Proof Drawer */}
      <TechnicalProofDrawer telemetry={telemetry} />
    </div>
  );
};

export default App;
