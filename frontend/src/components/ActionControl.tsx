import React from 'react';
import type { TelemetryPacket } from '../types';

interface ActionControlProps {
  telemetry: TelemetryPacket | null;
  onToggleBlackout: () => void;
}

export const ActionControl: React.FC<ActionControlProps> = ({ telemetry, onToggleBlackout }) => {
  const isBlackout = telemetry?.blackout_active ?? false;

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto select-none">
      <button
        onClick={onToggleBlackout}
        className={`px-8 py-4 rounded-full font-black text-base tracking-wider uppercase transition-all duration-200 transform active:scale-95 shadow-2xl flex items-center gap-3 border ${
          !isBlackout
            ? 'bg-gradient-to-r from-[#f59e0b] to-[#ef4444] text-white border-red-300 hover:brightness-110 shadow-[0_0_25px_rgba(245,158,11,0.5)]'
            : 'bg-gradient-to-r from-[#00f59b] to-[#00d2ff] text-slate-950 border-emerald-300 hover:brightness-110 shadow-[0_0_25px_rgba(0,245,155,0.6)] animate-pulse'
        }`}
      >
        {!isBlackout ? (
          <>
            <span className="text-xl">⚠️</span>
            <span>SIMULATE GNSS LOSS</span>
          </>
        ) : (
          <>
            <span className="text-xl">✓</span>
            <span>RESTORE GNSS SIGNAL</span>
          </>
        )}
      </button>
    </div>
  );
};
