import React from 'react';
import type { TelemetryPacket } from '../types';
import { IconAlertTriangle, IconCheckCircle, IconPlay, IconPause } from './Icons';

interface ActionControlProps {
  telemetry: TelemetryPacket | null;
  onToggleBlackout: () => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  hasActivePoints?: boolean;
}

export const ActionControl: React.FC<ActionControlProps> = ({
  telemetry,
  onToggleBlackout,
  isPlaying,
  onTogglePlay,
  hasActivePoints = true
}) => {
  const isBlackout = telemetry?.blackout_active ?? false;

  return (
    <div className="bottom-dock-capsule">
      {/* Primary Simulation Button: Solid Slate #0F172A */}
      {onTogglePlay && (
        <button
          onClick={hasActivePoints ? onTogglePlay : undefined}
          disabled={!hasActivePoints}
          className={`btn-dock-slate ${!hasActivePoints ? 'btn-disabled' : ''}`}
          style={!hasActivePoints ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          title={hasActivePoints ? "Toggle Navigation Play/Pause" : "Select Point A (Origin) and Point B (Destination) on map to start"}
        >
          {isPlaying ? <IconPause size={14} color="#ffffff" /> : <IconPlay size={14} color="#ffffff" />}
          <span>{isPlaying ? 'PAUSE' : hasActivePoints ? 'START SIMULATION' : 'SELECT 2 POINTS'}</span>
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
