import React from 'react';
import type { ScenarioInfo, AppMode, ViewMode } from '../types';
import { JudgeScorecard } from './JudgeScorecard';
import {
  IconEye,
  IconZap,
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
  scenariosList: _scenariosList,
  onSelectScenario: _onSelectScenario,
  isConnected,
  isPlaying,
  onTogglePlay,
  onReset,
  appMode,
  onToggleMode,
  customStatusMsg: _customStatusMsg,
  onClearCustomPoints: _onClearCustomPoints,
  viewMode: _viewMode,
  onToggleViewMode: _onToggleViewMode,
  currentDriftPct,
  showGhostBaseline,
  onToggleGhostBaseline,
  onStartAutoDemo,
  selectedPresetId,
  onSelectPresetId
}) => {
  return (
    <header className="swiss-header-bar">
      {/* Left: Subdued Breadcrumb Navigation */}
      <div className="header-left-zone">
        <div className="brand-dot" />
        <span className="brand-title-mono">NAVISENSE IDR</span>
        <span className="breadcrumb-divider">/</span>
        <select
          value={selectedPresetId ?? 'bangalore'}
          onChange={(e) => onSelectPresetId && onSelectPresetId(e.target.value)}
          className="breadcrumb-select mono"
          title="Select Active Road Corridor"
        >
          <option value="bangalore">Bangalore: ISRO ➔ Indiranagar (17.4 km)</option>
          <option value="delhi">Delhi: Connaught Place ➔ Aerocity (15.5 km)</option>
          <option value="chandigarh">Chandigarh: Sector 1 ➔ Sector 35 (5.6 km)</option>
        </select>
      </div>

      {/* Center: Segmented Mode Selector */}
      <div className="header-center-zone">
        <div className="segmented-switch">
          <button
            onClick={() => onToggleMode('CUSTOM_ROUTE')}
            className={`seg-btn ${appMode === 'CUSTOM_ROUTE' ? 'seg-active' : ''}`}
          >
            2-Point Navigation
          </button>
          <button
            onClick={() => onToggleMode('CANONICAL_DATASET')}
            className={`seg-btn ${appMode === 'CANONICAL_DATASET' ? 'seg-active' : ''}`}
          >
            Dataset Benchmark
          </button>
        </div>
      </div>

      {/* Right: Engine State Chip & Playback Controls */}
      <div className="header-right-zone">
        {/* Engine State Chip */}
        <span className="engine-chip mono">
          <span className={`engine-dot ${isConnected ? 'dot-emerald' : 'dot-rose'}`} />
          {isConnected ? 'ENGINE ONLINE' : 'OFFLINE'}
        </span>

        {/* Judge Scorecard */}
        <JudgeScorecard currentDriftPct={currentDriftPct} currentScenarioId={scenario?.id} />

        {/* Raw INS Ghost Toggle */}
        <button
          onClick={onToggleGhostBaseline}
          className={`btn-ghost-toggle ${showGhostBaseline ? 'ghost-active' : ''}`}
          title="Toggle Raw INS unconstrained quadratic divergence ghost path"
        >
          <IconEye size={12} />
          <span>Raw INS</span>
        </button>

        {/* 60s Tour */}
        <button onClick={onStartAutoDemo} className="btn-icon-pill" title="Run 60-Second Evaluation Tour">
          <IconZap size={12} color="#1d4ed8" />
          <span>60s Tour</span>
        </button>

        {/* Compact Play/Pause */}
        <button
          onClick={onTogglePlay}
          className={`btn-play-pill ${isPlaying ? 'play-active' : ''}`}
          title={isPlaying ? 'Pause Simulation (Space)' : 'Start Simulation (Space)'}
        >
          {isPlaying ? <IconPause size={12} /> : <IconPlay size={12} />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>

        {/* Reset */}
        <button onClick={onReset} className="btn-reset-icon" title="Reset (R)">
          <IconRotateCcw size={12} />
        </button>
      </div>
    </header>
  );
};
