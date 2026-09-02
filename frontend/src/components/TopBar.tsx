import React from 'react';
import type { ScenarioInfo, AppMode } from '../types';

interface TopBarProps {
  scenario: ScenarioInfo | null;
  scenariosList: { id: string; name: string; metrics: Record<string, string> }[];
  onSelectScenario: (id: string) => void;
  isConnected: boolean;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  appMode: AppMode;
  onToggleMode: (mode: AppMode) => void;
  customStatusMsg: string;
  onClearCustomPoints: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  scenario,
  scenariosList,
  onSelectScenario,
  isConnected,
  isPlaying,
  onTogglePlay,
  onReset,
  appMode,
  onToggleMode,
  customStatusMsg,
  onClearCustomPoints
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
          <span>{isConnected ? 'LIVE ENGINE' : 'CONNECTING...'}</span>
        </div>
      </div>

      {/* Mode Switcher Segmented Control */}
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.4)', padding: '3px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <button
          onClick={() => onToggleMode('CANONICAL_DATASET')}
          style={{
            padding: '6px 14px',
            fontSize: '11px',
            fontWeight: 800,
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            background: appMode === 'CANONICAL_DATASET' ? 'var(--idr-blue)' : 'transparent',
            color: appMode === 'CANONICAL_DATASET' ? '#030712' : '#94a3b8',
            transition: 'all 0.2s',
            letterSpacing: '0.04em'
          }}
        >
          1. DATASET SCENARIOS
        </button>
        <button
          onClick={() => onToggleMode('CUSTOM_ROUTE')}
          style={{
            padding: '6px 14px',
            fontSize: '11px',
            fontWeight: 800,
            borderRadius: '7px',
            border: 'none',
            cursor: 'pointer',
            background: appMode === 'CUSTOM_ROUTE' ? 'var(--gnss-emerald)' : 'transparent',
            color: appMode === 'CUSTOM_ROUTE' ? '#030712' : '#94a3b8',
            transition: 'all 0.2s',
            letterSpacing: '0.04em'
          }}
        >
          2. CHOOSE 2 POINTS ON MAP
        </button>
      </div>

      {/* Mode 1: Scenario Selector */}
      {appMode === 'CANONICAL_DATASET' ? (
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
      ) : (
        /* Mode 2: Interactive Prompt & Clear Button */
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gnss-emerald)', letterSpacing: '0.04em' }}>
            {customStatusMsg}
          </span>
          <button onClick={onClearCustomPoints} className="btn-control">
            ↺ CLEAR POINTS
          </button>
        </div>
      )}

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
