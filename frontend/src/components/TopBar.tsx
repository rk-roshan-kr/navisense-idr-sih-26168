import React from 'react';
import type { ScenarioInfo, TelemetryPacket } from '../types';

interface TopBarProps {
  scenario: ScenarioInfo | null;
  scenariosList: { id: string; name: string; metrics: Record<string, string> }[];
  onSelectScenario: (id: string) => void;
  isConnected: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  telemetry: TelemetryPacket | null;
  onToggleBlackout: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  scenario,
  scenariosList,
  onSelectScenario,
  isConnected,
  isPlaying,
  onTogglePlay,
  onReset,
  telemetry,
  onToggleBlackout
}) => {
  const isBlackout = telemetry?.blackout_active ?? false;

  return (
    <header className="legacy-top-bar">
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="legacy-brand">NaviSense</span>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>SIH 26168</span>
      </div>

      <div className="legacy-sep" />

      {/* Scenario / Route Selector */}
      <select
        value={scenario?.id ?? 'highway'}
        onChange={(e) => onSelectScenario(e.target.value)}
        className="legacy-select"
      >
        {scenariosList.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {/* Primary Actions */}
      <button onClick={onTogglePlay} className="legacy-btn">
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>

      {/* Prominent Blackout Action Button */}
      <button
        onClick={onToggleBlackout}
        className={`legacy-btn ${!isBlackout ? 'btn-blackout' : 'btn-restore'}`}
      >
        {!isBlackout ? '⚠️ Blackout GPS' : '✓ Restore GPS'}
      </button>

      <button onClick={onReset} className="legacy-btn">
        ↺ Reset
      </button>

      <div style={{ flex: 1 }} />

      {/* GPS Status Indicator */}
      <div className="legacy-gps-status">
        <span className={`legacy-gps-dot ${!isBlackout ? 'active' : 'dead'}`} />
        <span className={`legacy-gps-text ${!isBlackout ? 'active' : 'dead'}`}>
          {!isBlackout ? 'GPS Active' : 'GPS Blackout Active'}
        </span>
        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '6px' }}>
          ({isConnected ? '10 Hz Engine' : 'Offline'})
        </span>
      </div>
    </header>
  );
};
