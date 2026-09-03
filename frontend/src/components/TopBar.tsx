import React from 'react';
import type { ScenarioInfo, AppMode, ViewMode } from '../types';
import { JudgeScorecard } from './JudgeScorecard';
import {
  IconEye,
  IconZap,
  IconActivity,
  IconPlay,
  IconPause,
  IconRotateCcw
} from './Icons';

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
  selectedPresetId?: string;
  onSelectPresetId?: (id: string) => void;
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
  customStatusMsg: _customStatusMsg,
  onClearCustomPoints,
  viewMode,
  onToggleViewMode,
  currentDriftPct,
  showGhostBaseline,
  onToggleGhostBaseline,
  onStartAutoDemo,
  selectedPresetId,
  onSelectPresetId
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

      {/* Mode Switcher Segmented Control (Clean Light Segmented Control) */}
      {/* Mode Switcher Segmented Control (Point A -> Point B Navigation vs Benchmark) */}
      <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', padding: '3px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <button
          onClick={() => onToggleMode('CUSTOM_ROUTE')}
          style={{
            padding: '6px 15px',
            fontSize: '11px',
            fontWeight: 800,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            background: appMode === 'CUSTOM_ROUTE' ? '#0284c7' : 'transparent',
            color: appMode === 'CUSTOM_ROUTE' ? '#ffffff' : '#64748b',
            boxShadow: appMode === 'CUSTOM_ROUTE' ? '0 2px 4px rgba(2, 132, 199, 0.25)' : 'none',
            transition: 'all 0.15s',
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}
        >
          <span>2-Point Road Navigation (Point A ➔ Point B)</span>
        </button>
        <button
          onClick={() => onToggleMode('CANONICAL_DATASET')}
          style={{
            padding: '6px 14px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            background: appMode === 'CANONICAL_DATASET' ? '#ffffff' : 'transparent',
            color: appMode === 'CANONICAL_DATASET' ? '#0f172a' : '#64748b',
            boxShadow: appMode === 'CANONICAL_DATASET' ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
            transition: 'all 0.15s',
            letterSpacing: '0.02em'
          }}
        >
          Raw Dataset Benchmark
        </button>
      </div>

      {/* Mode 1: Scenario Selector / Mode 2: Indian Route Selector */}
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
              if (s.id === 'highway') label = 'Highway Cruising (Driver D) — 2.6% Drift';
              else if (s.id === 'urban') label = 'Urban Stop-and-Go (Driver A) — 17.9% Drift';
              else if (s.id === 'winding') label = 'Winding Mountain Route (Driver E) — 54.7% Drift';
              return (
                <option key={s.id} value={s.id}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>
      ) : (
        /* Mode 2: 3 Indian Preset Routes Dropdown */
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="scenario-select-box">
            <span className="scenario-label">Route:</span>
            <select
              value={selectedPresetId ?? 'bangalore'}
              onChange={(e) => onSelectPresetId && onSelectPresetId(e.target.value)}
              className="scenario-select"
            >
              <option value="bangalore">Bangalore: ISRO ISTRAC to Indiranagar Flat (17.4 km)</option>
              <option value="delhi">Delhi: Connaught Place to Aerocity Gateway (15.5 km)</option>
              <option value="chandigarh">Chandigarh: Sector 1 Capitol to Sector 35 Hub (5.6 km)</option>
            </select>
          </div>
          <button onClick={onClearCustomPoints} className="btn-control" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <IconRotateCcw size={12} />
            <span>Clear</span>
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
            background: showGhostBaseline ? '#fef2f2' : '#f8fafc',
            borderColor: showGhostBaseline ? '#fca5a5' : '#cbd5e1',
            color: showGhostBaseline ? '#b91c1c' : '#475569',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          title="Toggle Raw INS unconstrained quadratic divergence ghost vehicle"
        >
          <IconEye size={13} color={showGhostBaseline ? '#b91c1c' : '#475569'} />
          <span>{showGhostBaseline ? 'Raw INS: On' : 'Raw INS: Off'}</span>
        </button>

        {/* 60s Judge Auto-Demo Tour */}
        <button
          onClick={onStartAutoDemo}
          className="btn-control"
          style={{
            background: '#eff6ff',
            borderColor: '#bfdbfe',
            color: '#1d4ed8',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          title="Run automated 60-second judge demo sequence"
        >
          <IconZap size={13} color="#2563eb" />
          <span>60s Tour</span>
        </button>

        {/* Detailed Telemetry Toggle */}
        <button
          onClick={onToggleViewMode}
          className="btn-control"
          style={{
            background: viewMode === 'DETAILED' ? '#eff6ff' : '#f8fafc',
            borderColor: viewMode === 'DETAILED' ? '#bfdbfe' : '#cbd5e1',
            color: viewMode === 'DETAILED' ? '#1d4ed8' : '#475569',
            display: 'flex',
            alignItems: 'center',
            gap: '5px'
          }}
        >
          <IconActivity size={13} />
          <span>{viewMode === 'SIMPLIFIED' ? 'Details' : 'Simple'}</span>
        </button>

        {/* Play / Pause */}
        <button onClick={onTogglePlay} className="btn-control" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isPlaying ? (
            <>
              <IconPause size={11} />
              <span>Pause</span>
            </>
          ) : (
            <>
              <IconPlay size={11} />
              <span>Play</span>
            </>
          )}
        </button>

        <button onClick={onReset} className="btn-control" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <IconRotateCcw size={11} />
          <span>Rewind</span>
        </button>
      </div>
    </header>
  );
};
