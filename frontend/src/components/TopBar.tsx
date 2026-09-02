import React from 'react';
import type { ScenarioInfo, AppMode, ViewMode } from '../types';
import { JudgeScorecard } from './JudgeScorecard';

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
  viewMode: ViewMode;
  onToggleViewMode: () => void;
  currentDriftPct: number;
  showGhostBaseline: boolean;
  onToggleGhostBaseline: () => void;
  onStartAutoDemo: () => void;
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
  onClearCustomPoints,
  viewMode,
  onToggleViewMode,
  currentDriftPct,
  showGhostBaseline,
  onToggleGhostBaseline,
  onStartAutoDemo
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

      {/* Mode Switcher Segmented Control (Dataset vs Option 2 Map Click) */}
      <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 0, 0, 0.4)', padding: '3px', borderRadius: '10px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <button
          onClick={() => onToggleMode('CANONICAL_DATASET')}
          style={{
            padding: '5px 12px',
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
            padding: '5px 12px',
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

      {/* Mode 1: Scenario Selector with Benchmark Badges */}
      {appMode === 'CANONICAL_DATASET' ? (
        <div className="scenario-select-box">
          <span className="scenario-label">Scenario:</span>
          <select
            value={scenario?.id ?? 'highway'}
            onChange={(e) => onSelectScenario(e.target.value)}
            className="scenario-select"
          >
            {scenariosList.map((s) => {
              let label = s.name;
              if (s.id === 'highway') label = '🏆 Highway Cruising (Driver D) — 2.6% Drift';
              else if (s.id === 'urban') label = '🚦 Urban Stop-and-Go (Driver A) — 17.9% Drift';
              else if (s.id === 'winding') label = '⛰️ Winding Mountain Route (Driver E) — 54.7% Drift';
              return (
                <option key={s.id} value={s.id}>
                  {label}
                </option>
              );
            })}
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

      {/* Right Controls: Scorecard, Ghost Toggle, View Toggle & Playback */}
      <div className="top-bar-controls">
        {/* Judge Scorecard Modal Button */}
        <JudgeScorecard currentDriftPct={currentDriftPct} currentScenarioId={scenario?.id} />

        {/* Raw INS Divergence Ghost Toggle */}
        <button
          onClick={onToggleGhostBaseline}
          className="btn-control"
          style={{
            background: showGhostBaseline ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.06)',
            borderColor: showGhostBaseline ? '#ef4444' : 'rgba(255, 255, 255, 0.12)',
            color: showGhostBaseline ? '#fca5a5' : '#cbd5e1'
          }}
          title="Toggle Raw INS unconstrained quadratic divergence ghost vehicle"
        >
          {showGhostBaseline ? '👁️ RAW INS GHOST: ON' : '👁️ RAW INS GHOST: OFF'}
        </button>

        {/* 60s Judge Auto-Demo Tour */}
        <button
          onClick={onStartAutoDemo}
          className="btn-control"
          style={{
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.3), rgba(0, 210, 255, 0.3))',
            borderColor: 'var(--idr-blue)',
            color: '#ffffff',
            fontWeight: 800
          }}
          title="Run automated 60-second judge demo sequence"
        >
          🚀 60s TOUR
        </button>

        {/* Detailed Telemetry Toggle */}
        <button
          onClick={onToggleViewMode}
          className="btn-control"
          style={{
            background: viewMode === 'DETAILED' ? 'rgba(37, 99, 235, 0.25)' : 'rgba(255, 255, 255, 0.06)',
            borderColor: viewMode === 'DETAILED' ? 'var(--idr-blue)' : 'rgba(255, 255, 255, 0.12)',
            color: viewMode === 'DETAILED' ? '#ffffff' : '#cbd5e1'
          }}
        >
          {viewMode === 'SIMPLIFIED' ? '📊 DETAILS' : '✕ SIMPLE'}
        </button>

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
