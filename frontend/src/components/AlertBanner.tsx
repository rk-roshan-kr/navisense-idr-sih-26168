import React, { useEffect, useState } from 'react';
import type { TelemetryPacket } from '../types';
import { IconAlertTriangle, IconCheckCircle } from './Icons';

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
      setShowRestore(true);
      const timer = setTimeout(() => setShowRestore(false), 4000);
      return () => clearTimeout(timer);
    }
    setPrevBlackout(isBlackout);
  }, [isBlackout]);

  if (isBlackout) {
    return (
      <div className="alert-banner-wrap">
        <div className="banner-pill-loss">
          <IconAlertTriangle size={17} color="#ffffff" />
          <span className="banner-title">
            GNSS SIGNAL LOST — NAVISENSE IDR ACTIVE
          </span>
          <span className="banner-elapsed-badge mono">
            {elapsed.toFixed(1)}s outage
          </span>
        </div>
      </div>
    );
  }

  if (showRestore) {
    return (
      <div className="alert-banner-wrap">
        <div className="banner-pill-restore">
          <IconCheckCircle size={17} color="#030712" />
          <span>GNSS RESTORED — SMOOTH RECONVERGENCE ENGAGED</span>
        </div>
      </div>
    );
  }

  return null;
};
