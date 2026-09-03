import React, { useState } from 'react';
import type { TelemetryPacket } from '../types';

interface RoutePlannerWidgetProps {
  customOrigin: [number, number] | null;
  customDestination: [number, number] | null;
  customRoutePath: [number, number][];
  customStatusMsg: string;
  onSetOrigin: (pt: [number, number]) => void;
  onSelectPreset: (origin: [number, number], destination: [number, number], name: string, id?: string) => void;
  onClearPoints: () => void;
  onStartSimulation: () => void;
  telemetry: TelemetryPacket | null;
  isPlaying: boolean;
}

// IO-VNBD real GPS sessions (Driver A, Coventry UK) — held-out test paths
export const ROUTE_PRESETS = [
  {
    id: 's3b',
    name: 'IO-VNBD S3b — Dense Urban Residential',
    origin: [52.3696, -1.2612] as [number, number],
    destination: [52.3793, -1.2521] as [number, number],
    desc: 'Coventry UK • 3.77 km • 840 turns • Real phone IMU'
  },
  {
    id: 's1',
    name: 'IO-VNBD S1 — Mixed Urban-Suburban',
    origin: [52.4017, -1.5053] as [number, number],
    destination: [52.3984, -1.6034] as [number, number],
    desc: 'Coventry UK • 37.95 km • 4250 turns • Real phone IMU'
  },
  {
    id: 's4',
    name: 'IO-VNBD S4 — Arterial Highway Circuit',
    origin: [52.4025, -1.5054] as [number, number],
    destination: [52.4383, -1.4305] as [number, number],
    desc: 'Coventry UK • 88.42 km • 6248 turns • Real phone IMU'
  }
];

export const RoutePlannerWidget: React.FC<RoutePlannerWidgetProps> = ({
  customOrigin,
  customDestination,
  customRoutePath,
  customStatusMsg,
  onSetOrigin,
  onSelectPreset,
  onClearPoints,
  onStartSimulation,
  telemetry,
  isPlaying
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const hasOrigin = !!customOrigin;
  const hasDestination = !!customDestination;
  const hasRoute = customRoutePath.length > 0;
  const hasTwoPoints = (hasOrigin && hasDestination) || hasRoute;

  const currentCarPos: [number, number] | null = telemetry
    ? [telemetry.idr_position.lat, telemetry.idr_position.lon]
    : null;

  return (
    <div className={`swiss-route-planner ${isMinimized ? 'planner-minimized' : ''}`}>
      {/* 1. Header with Breadcrumb & True Minimize (− / +) */}
      <div
        className="planner-top-bar"
        onClick={() => isMinimized && setIsMinimized(false)}
        style={{ cursor: isMinimized ? 'pointer' : 'default' }}
      >
        <div className="planner-title-group">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="planner-title-tag mono">CORRIDOR PLANNER</span>
            {isMinimized && (
              <span style={{ fontSize: '9px', background: '#ecfdf5', color: '#059669', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>
                ACTIVE CORRIDOR
              </span>
            )}
          </div>
          <span className="planner-status-note">{customStatusMsg}</span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMinimized(!isMinimized);
          }}
          className="planner-minimize-btn"
          title={isMinimized ? "Expand planner" : "Minimize planner"}
        >
          {isMinimized ? '+' : '−'}
        </button>
      </div>

      {/* Body: Collapses cleanly when minimized */}
      {!isMinimized && (
        <>
          {/* 2. Subway-Stop Icon Connector */}
          <div className="subway-connector-card">
            {/* Origin Stop */}
            <div className="subway-stop">
              <div className="subway-node-wrap">
                <span className="subway-dot dot-origin" />
                <span className="subway-track-line" />
              </div>
              <div className="subway-info">
                <div className="subway-label-row">
                  <span className="subway-label">POINT A / ORIGIN</span>
                  {currentCarPos && !hasOrigin && (
                    <button onClick={() => onSetOrigin(currentCarPos)} className="btn-chip-action mono">
                      Use Car GPS
                    </button>
                  )}
                </div>
                <div className="subway-coord-chip mono">
                  {hasOrigin ? `${customOrigin[0].toFixed(5)}°, ${customOrigin[1].toFixed(5)}°` : 'Click on map to set Point A'}
                </div>
              </div>
            </div>

        {/* Destination Stop */}
        <div className="subway-stop">
          <div className="subway-node-wrap">
            <span className="subway-dot dot-dest" />
          </div>
          <div className="subway-info">
            <span className="subway-label">POINT B / DESTINATION</span>
            <div className="subway-coord-chip mono">
              {hasDestination
                ? `${customDestination[0].toFixed(5)}°, ${customDestination[1].toFixed(5)}°`
                : hasOrigin
                ? 'Click on map to set Point B'
                : 'Set Point A first'}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Preset Corridor Selector */}
      <div className="planner-preset-row">
        <span className="preset-label mono">PRESET CORRIDORS:</span>
        <select
          value={
            ROUTE_PRESETS.find(
              (r) => customOrigin && Math.abs(r.origin[0] - customOrigin[0]) < 0.05
            )?.id ?? 'bangalore'
          }
          onChange={(e) => {
            const p = ROUTE_PRESETS.find((r) => r.id === e.target.value);
            if (p) onSelectPreset(p.origin, p.destination, p.name, p.id);
          }}
          className="planner-select mono"
        >
          {ROUTE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.desc.split('•')[0].trim()})
            </option>
          ))}
        </select>
      </div>

      {/* 4. Action Buttons */}
      <div className="planner-footer-actions">
        <button
          onClick={onStartSimulation}
          disabled={!hasTwoPoints}
          className={`btn-primary-slate ${hasTwoPoints ? 'btn-active' : 'btn-disabled'}`}
          style={!hasTwoPoints ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          title={hasTwoPoints ? "Begin Navigation" : "Select Point A (Origin) and Point B (Destination) to Start"}
        >
          {isPlaying ? 'PAUSE NAVIGATION' : hasTwoPoints ? 'START NAVIGATION' : 'SET 2 POINTS TO START'}
        </button>
        <button onClick={onClearPoints} className="btn-secondary-outline" title="Reset points">
          CLEAR
        </button>
      </div>
        </>
      )}
    </div>
  );
};
