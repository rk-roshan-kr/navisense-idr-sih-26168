import React, { useEffect, useState } from 'react';
import type { TelemetryPacket } from '../types';

interface AlertBannerProps {
  telemetry: TelemetryPacket | null;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ telemetry }) => {
  const [prevBlackout, setPrevBlackout] = useState(false);
  const [showRestore, setShowRestore] = useState(false);

  const isBlackout = telemetry?.blackout_active ?? false;
  const elapsed = telemetry?.blackout_elapsed_s ?? 0;

  useEffect(() => {
    if (prevBlackout && !isBlackout) {
      // Just restored
      setShowRestore(true);
      const timer = setTimeout(() => setShowRestore(false), 4000);
      return () => clearTimeout(timer);
    }
    setPrevBlackout(isBlackout);
  }, [isBlackout]);

  if (isBlackout) {
    return (
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none animate-bounce">
        <div className="bg-[#ef4444]/95 border-2 border-red-400 text-white px-6 py-3 rounded-full shadow-[0_0_30px_rgba(239,68,68,0.7)] flex items-center gap-3 backdrop-blur-md">
          <span className="w-3 h-3 rounded-full bg-white animate-ping" />
          <span className="text-sm font-black tracking-wider uppercase">
            GNSS SIGNAL LOST — NAVISENSE IDR ACTIVE
          </span>
          <span className="bg-black/30 px-2 py-0.5 rounded text-xs mono font-bold text-amber-200">
            {elapsed.toFixed(1)}s outage
          </span>
        </div>
      </div>
    );
  }

  if (showRestore) {
    return (
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none transition-all duration-500">
        <div className="bg-[#00f59b]/90 border border-emerald-300 text-black px-6 py-2.5 rounded-full shadow-[0_0_25px_rgba(0,245,155,0.6)] flex items-center gap-2 backdrop-blur-md">
          <span className="text-sm font-extrabold tracking-wide uppercase">
            ✓ GNSS RESTORED — SMOOTH RECONVERGENCE ENGAGED
          </span>
        </div>
      </div>
    );
  }

  return null;
};
