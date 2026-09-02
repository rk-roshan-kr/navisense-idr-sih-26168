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
    <header className="absolute top-4 left-6 right-6 z-[1000] flex items-center justify-between glass-panel px-6 py-3 border border-white/10 pointer-events-auto select-none shadow-xl">
      {/* Brand & System Health */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#00d2ff] to-[#00f59b] flex items-center justify-center font-black text-black text-sm shadow-md">
            N
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold text-sm tracking-wider text-white">NAVISENSE IDR</span>
            <span className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">PS 26168 • Offline PNT</span>
          </div>
        </div>

        <div className="h-6 w-px bg-white/10" />

        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#00f59b] shadow-[0_0_8px_#00f59b]' : 'bg-red-500 animate-ping'}`} />
          <span className="text-xs font-semibold text-slate-300">
            {isConnected ? 'LIVE ENGINE' : 'CONNECTING...'}
          </span>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Scenario:</span>
        <select
          value={scenario?.id ?? 'highway'}
          onChange={(e) => onSelectScenario(e.target.value)}
          className="bg-slate-900/90 border border-white/20 text-white text-xs font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#00d2ff] cursor-pointer hover:border-white/40 transition-all shadow-inner"
        >
          {scenariosList.map((s) => (
            <option key={s.id} value={s.id} className="bg-slate-900 text-white">
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="glass-panel-subtle px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-200 hover:text-white hover:bg-white/10 transition-all flex items-center gap-1.5"
        >
          <span>{isPlaying ? '⏸ PAUSE' : '▶ PLAY'}</span>
        </button>
        <button
          onClick={onReset}
          className="glass-panel-subtle px-3 py-1.5 rounded-lg text-xs font-bold text-slate-200 hover:text-white hover:bg-white/10 transition-all"
        >
          <span>↺ REWIND</span>
        </button>
      </div>
    </header>
  );
};
