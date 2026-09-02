import React from 'react';
import type { TelemetryPacket, ScenarioInfo } from '../types';

interface BottomBarProps {
  telemetry: TelemetryPacket | null;
  scenario: ScenarioInfo | null;
}

export const BottomBar: React.FC<BottomBarProps> = ({ telemetry, scenario }) => {
  const timestamp = telemetry?.timestamp_s ?? 0;
  const dist = telemetry?.distance_traveled_m ?? 0;
  const totalDist = scenario?.distance_m ?? 5000;
  const pct = Math.min(100, Math.max(0, (dist / Math.max(1, totalDist)) * 100));

  const minutes = Math.floor(timestamp / 60);
  const seconds = Math.floor(timestamp % 60);
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  const isBlackout = telemetry?.blackout_active ?? false;
  const boElapsed = telemetry?.blackout_elapsed_s ?? 0;

  return (
    <div className="legacy-bottom-bar">
      <span className="mono" style={{ fontSize: '13px', fontWeight: 700, minWidth: '45px', color: '#1e293b' }}>
        {timeStr}
      </span>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div className="legacy-progress-track">
          <div
            className="legacy-progress-fill"
            style={{
              width: `${pct}%`,
              background: isBlackout ? '#dc2626' : '#2563eb'
            }}
          />
        </div>
        <span className="mono" style={{ fontSize: '11px', color: '#64748b', minWidth: '130px' }}>
          {(dist / 1000).toFixed(2)} km / {(totalDist / 1000).toFixed(2)} km ({pct.toFixed(0)}%)
        </span>
      </div>

      {isBlackout && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="dot-gnss-off" />
          <span className="mono" style={{ fontSize: '12px', fontWeight: 700, color: '#dc2626' }}>
            OUTAGE: {boElapsed.toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  );
};
