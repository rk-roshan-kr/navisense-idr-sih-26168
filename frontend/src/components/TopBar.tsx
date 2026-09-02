import React from 'react';
import type { ScenarioInfo } from '../types';

interface TopBarProps {
  scenario: ScenarioInfo | null;
  scenariosList: { id: string; name: string; metrics: Record<string, string> }[];
  onSelectScenario: (id: string) => void;
  isConnected: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  scenario,
  scenariosList,
  onSelectScenario,
  isConnected,
  isPlaying,
  onTogglePlay,
  onReset
}) => {
  return (
    <header className="top-bar-container glass-panel">
      {/* Brand & System Health */}
      <div className="top-bar-brand">
        <div className="brand-icon">N</div>
        <div>
          <div className="brand-title">NAVISENSE IDR</div>
          <div className="brand-subtitle">PS 26168 • OFFLINE PNT</div>
        </div>

        <div className="top-bar-divider" />

        <div className="status-badge">
          <span className={isConnected ? 'dot-online' : 'dot-offline'} />
          <span>{isConnected ? 'LIVE ENGINE (10 Hz)' : 'CONNECTING...'}</span>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="scenario-select-box">
        <span className="scenario-label">Scenario:</span>
        <select
          value={scenario?.id ?? 'highway'}
          onChange={(e) => onSelectScenario(e.target.value)}
          className="scenario-select"
        >
          {scenariosList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Playback Controls */}
      <div className="top-bar-controls">
        <button onClick={onTogglePlay} className="btn-control">
          {isPlaying ? '⏸ PAUSE' : '▶ PLAY'}
        </button>
        <button onClick={onReset} className="btn-control">
          ↺ REWIND
        </button>
      </div>
    </header>
  );
};
