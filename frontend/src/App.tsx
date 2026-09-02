import React, { useEffect, useRef, useState } from 'react';
import type { TelemetryPacket, ScenarioInfo } from './types';
import { LiveMap } from './components/LiveMap';
import { NavigationHUD } from './components/NavigationHUD';
import { AlertBanner } from './components/AlertBanner';
import { ActionControl } from './components/ActionControl';
import { TechnicalProofDrawer } from './components/TechnicalProofDrawer';
import { TopBar } from './components/TopBar';

export const App: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryPacket | null>(null);
  const [scenario, setScenario] = useState<ScenarioInfo | null>(null);
  const [scenariosList, setScenariosList] = useState<{ id: string; name: string; metrics: Record<string, string> }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);

  // Fetch scenarios list on load
  useEffect(() => {
    fetch('http://localhost:8000/api/scenarios')
      .then((res) => res.json())
      .then((data) => {
        if (data.scenarios) setScenariosList(data.scenarios);
        if (data.active_scenario) setScenario(data.active_scenario);
      })
      .catch((err) => console.error('Failed to fetch scenarios:', err));
  }, []);

  // WebSocket Connection Management
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimer: any;

    function connect() {
      ws = new WebSocket('ws://localhost:8000/ws/telemetry');

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
        console.warn('[WS] Connection closed, retrying in 2s...');
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
  }, []);

  // Control Actions
  const handleToggleBlackout = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'toggle_blackout' }));
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
    fetch('http://localhost:8000/api/playback/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: nextState ? 'play' : 'pause' })
    }).catch(console.error);
  };

  const handleReset = () => {
    fetch('http://localhost:8000/api/playback/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' })
    }).catch(console.error);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#070a0f]">
      {/* Top Header Bar */}
      <TopBar
        scenario={scenario}
        scenariosList={scenariosList}
        onSelectScenario={handleSelectScenario}
        isConnected={isConnected}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        onReset={handleReset}
      />

      {/* Full-Screen Dominant Live Map */}
      <div className="absolute inset-0 z-0">
        <LiveMap telemetry={telemetry} scenario={scenario} />
      </div>

      {/* Alert Banner for Instant Blackout Status */}
      <AlertBanner telemetry={telemetry} />

      {/* Primary Navigation HUD (Speed, Heading, Drift) */}
      <NavigationHUD telemetry={telemetry} />

      {/* Floating Action Button (Simulate GNSS Loss) */}
      <ActionControl telemetry={telemetry} onToggleBlackout={handleToggleBlackout} />

      {/* Technical Proof Drawer for Engineering Judges */}
      <TechnicalProofDrawer telemetry={telemetry} />
    </div>
  );
};

export default App;
