import React from 'react';
import type { TelemetryPacket } from '../types';
import { IconAlertTriangle, IconCheckCircle, IconPlay, IconPause } from './Icons';

interface ActionControlProps {
  telemetry: TelemetryPacket | null;
  onToggleBlackout: () => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
}

export const ActionControl: React.FC<ActionControlProps> = ({
  telemetry,
  onToggleBlackout,
  isPlaying,
  onTogglePlay
}) => {
  const isBlackout = telemetry?.blackout_active ?? false;

  return (
    <div className="bottom-dock-capsule">
      {/* Primary Simulation Button: Solid Slate #0F172A */}
      {onTogglePlay && (
        <button onClick={onTogglePlay} className="btn-dock-slate" title="Toggle Navigation Play/Pause">
          {isPlaying ? <IconPause size={14} color="#ffffff" /> : <IconPlay size={14} color="#ffffff" />}
          <span>{isPlaying ? 'PAUSE' : 'START SIMULATION'}</span>
        </button>
      )}

      {/* Muted Outline GNSS Loss Button with Red Hover State */}
      <button
        onClick={onToggleBlackout}
        className={`btn-dock-loss ${isBlackout ? 'loss-engaged' : ''}`}
        title="Inject simulated GNSS outage"
      >
        {!isBlackout ? (
          <>
            <IconAlertTriangle size={14} />
            <span>SIMULATE GNSS LOSS</span>
          </>
        ) : (
          <>
            <IconCheckCircle size={14} color="#10b981" />
            <span>RESTORE GNSS FIX</span>
          </>
        )}
      </button>
    </div>
  );
};
