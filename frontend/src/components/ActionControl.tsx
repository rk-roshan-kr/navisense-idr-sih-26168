import React from 'react';
import type { TelemetryPacket } from '../types';

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
            <span>⚠️</span>
            <span>SIMULATE GNSS LOSS</span>
          </>
        ) : (
          <>
            <span>✓</span>
            <span>RESTORE GNSS SIGNAL</span>
          </>
        )}
      </button>
    </div>
  );
};
