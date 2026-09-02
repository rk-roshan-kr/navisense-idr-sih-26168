import React from 'react';
import type { TelemetryPacket } from '../types';
import { IconAlertTriangle, IconCheckCircle } from './Icons';

interface ActionControlProps {
  telemetry: TelemetryPacket | null;
  onToggleBlackout: () => void;
}

export const ActionControl: React.FC<ActionControlProps> = ({ telemetry, onToggleBlackout }) => {
  const isBlackout = telemetry?.blackout_active ?? false;

  return (
    <div className="action-button-wrap">
      <button
        onClick={onToggleBlackout}
        className={`btn-blackout-action ${!isBlackout ? 'btn-loss-state' : 'btn-restore-state'}`}
      >
        {!isBlackout ? (
          <>
            <IconAlertTriangle size={18} color="#ffffff" />
            <span>SIMULATE GNSS LOSS</span>
          </>
        ) : (
          <>
            <IconCheckCircle size={18} color="#030712" />
            <span>RESTORE GNSS SIGNAL</span>
          </>
        )}
      </button>
    </div>
  );
};
