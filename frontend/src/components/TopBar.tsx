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
  scenario: _scenario,
  scenariosList: _scenariosList,
  onSelectScenario: _onSelectScenario,
  isConnected,
  isPlaying,
  onTogglePlay,
  onReset,
  appMode: _appMode,
  onToggleMode: _onToggleMode,
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
      {/* Left: Subdued Breadcrumb Navigation with 3 Preset Corridors */}
      <div className="header-left-zone">
        <div className="brand-dot" />
        <span className="brand-title-mono">NAVISENSE IDR</span>
        <span className="breadcrumb-divider">/</span>
        <select
          value={selectedPresetId ?? 'bangalore'}
          onChange={(e) => onSelectPresetId && onSelectPresetId(e.target.value)}
          className="breadcrumb-select mono"
          title="Select Active Road Corridor Preset"
        >
          <option value="bangalore">Bangalore: ISRO ISTRAC ➔ Indiranagar Flat (17.4 km)</option>
          <option value="delhi">Delhi: Connaught Place ➔ Aerocity Gateway (15.5 km)</option>
          <option value="chandigarh">Chandigarh: Sector 1 Capitol ➔ Sector 35 Hub (5.6 km)</option>
        </select>
      </div>

      {/* Center: 3 Preset Corridor Fast-Pills */}
      <div className="header-center-zone">
        <div className="segmented-switch">
          <button
            onClick={() => onSelectPresetId && onSelectPresetId('bangalore')}
            className={`seg-btn ${(selectedPresetId ?? 'bangalore') === 'bangalore' ? 'seg-active' : ''}`}
          >
            Bangalore (ISRO)
          </button>
          <button
            onClick={() => onSelectPresetId && onSelectPresetId('delhi')}
            className={`seg-btn ${selectedPresetId === 'delhi' ? 'seg-active' : ''}`}
          >
            Delhi (CP ➔ Aerocity)
          </button>
          <button
            onClick={() => onSelectPresetId && onSelectPresetId('chandigarh')}
            className={`seg-btn ${selectedPresetId === 'chandigarh' ? 'seg-active' : ''}`}
          >
            Chandigarh (Sec 1 ➔ 35)
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
        <JudgeScorecard currentDriftPct={currentDriftPct} currentScenarioId={selectedPresetId ?? 'bangalore'} />

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
