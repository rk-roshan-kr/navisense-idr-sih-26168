import React from 'react';
import type { TelemetryPacket } from '../types';

interface NavigationHUDProps {
  telemetry: TelemetryPacket | null;
}

export const NavigationHUD: React.FC<NavigationHUDProps> = ({ telemetry }) => {
  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;
  const headingDeg = telemetry?.heading_deg ?? 0;
  const driftPct = telemetry?.drift_pct ?? 0;
  const driftM = telemetry?.drift_m ?? 0;

  return (
    <div className="absolute top-20 right-6 z-[1000] flex flex-col gap-3 pointer-events-auto select-none">
      {/* Primary Navigation Status & Three Big Numbers Card */}
      <div className="glass-panel p-5 w-[310px] flex flex-col gap-4 border border-white/10 shadow-2xl">
        
        {/* Status Indicators */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          {/* GNSS Indicator */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${!isBlackout ? 'bg-[#00f59b] shadow-[0_0_10px_#00f59b]' : 'bg-[#ef4444] shadow-[0_0_10px_#ef4444]'}`} />
            <span className="text-xs font-semibold tracking-wider text-slate-300">GNSS</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${!isBlackout ? 'bg-[#00f59b]/15 text-[#00f59b]' : 'bg-[#ef4444]/15 text-[#ef4444] animate-pulse'}`}>
              {!isBlackout ? 'AVAILABLE' : 'LOST'}
            </span>
          </div>

          {/* IDR Indicator */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full bg-[#00d2ff] ${isBlackout ? 'shadow-[0_0_12px_#00d2ff] animate-ping' : ''}`} />
            <span className="text-xs font-semibold tracking-wider text-slate-300">IDR</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${isBlackout ? 'bg-[#00d2ff]/20 text-[#00d2ff] border border-[#00d2ff]/30' : 'bg-slate-700/50 text-slate-400'}`}>
              {isBlackout ? 'ACTIVE' : 'READY'}
            </span>
          </div>
        </div>

        {/* 1. SPEED (Large Digit) */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold tracking-widest text-slate-400">SPEED</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-extrabold text-white mono tracking-tight">
              {Math.round(speedKmh)}
            </span>
            <span className="text-sm font-semibold text-slate-400">km/h</span>
          </div>
        </div>

        {/* 2. HEADING (Compass Azimuth) */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold tracking-widest text-slate-400">HEADING</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-extrabold text-white mono tracking-tight">
              {String(Math.round(headingDeg)).padStart(3, '0')}°
            </span>
            <span className="text-xs font-semibold text-[#00d2ff]">
              {getCardinalDirection(headingDeg)}
            </span>
          </div>
        </div>

        {/* 3. DRIFT % (The Headline Validation Metric) */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-widest text-slate-400">DRIFT ERROR</span>
            <span className="text-[11px] text-slate-500 mono">{driftM.toFixed(1)} m total</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-3xl font-black mono tracking-tight ${driftPct <= 10.0 ? 'text-[#00f59b]' : driftPct <= 25.0 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
              {driftPct.toFixed(1)}%
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};

function getCardinalDirection(deg: number): string {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const idx = Math.round((deg % 360) / 45);
  return cardinals[idx];
}
