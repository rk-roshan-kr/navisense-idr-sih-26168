import React from 'react';
import type { TelemetryPacket } from '../types';

interface RoutePlannerWidgetProps {
  customOrigin: [number, number] | null;
  customDestination: [number, number] | null;
  customRoutePath: [number, number][];
  customStatusMsg: string;
  onSetOrigin: (pt: [number, number]) => void;
  onSelectPreset: (origin: [number, number], destination: [number, number], name: string) => void;
  onClearPoints: () => void;
  onStartSimulation: () => void;
  onClose: () => void;
  telemetry: TelemetryPacket | null;
  isPlaying: boolean;
}

// Curated high-fidelity Indian 2-point drivable presets
export const ROUTE_PRESETS = [
  {
    id: 'bangalore',
    name: 'Bangalore: ISRO ISTRAC to Indiranagar Flat',
    origin: [13.0334, 77.5186] as [number, number],
    destination: [12.9780, 77.6400] as [number, number],
    desc: 'Outer Ring Road (17.4 km) • Underpass GPS Lockdown'
  },
  {
    id: 'delhi',
    name: 'Delhi: Connaught Place to Aerocity Gateway',
    origin: [28.6315, 77.2167] as [number, number],
    destination: [28.5521, 77.1215] as [number, number],
    desc: 'NH48 Expressway (15.5 km) • Airport Tunnel Lockdown'
  },
  {
    id: 'chandigarh',
    name: 'Chandigarh: Sector 1 Capitol to Sector 35 Hub',
    origin: [30.7525, 76.8066] as [number, number],
    destination: [30.7240, 76.7670] as [number, number],
    desc: 'Jan Marg & Madhya Marg (5.6 km) • Canopy Canyon Lockdown'
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
  onClose,
  telemetry,
  isPlaying
}) => {
  const hasOrigin = !!customOrigin;
  const hasDestination = !!customDestination;
  const hasRoute = customRoutePath.length > 0;

  const currentCarPos: [number, number] | null = telemetry
    ? [telemetry.idr_position.lat, telemetry.idr_position.lon]
    : null;

  return (
    <div className="swiss-route-planner">
      {/* 1. Header with Breadcrumb & Close */}
      <div className="planner-top-bar">
        <div className="planner-title-group">
          <span className="planner-title-tag mono">CORRIDOR PLANNER</span>
          <span className="planner-status-note">{customStatusMsg}</span>
        </div>
        <button onClick={onClose} className="planner-close-icon" title="Minimize planner">
          ✕
        </button>
      </div>

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
          onChange={(e) => {
            const p = ROUTE_PRESETS.find((r) => r.id === e.target.value);
            if (p) onSelectPreset(p.origin, p.destination, p.name);
          }}
          className="planner-select mono"
          defaultValue="bangalore"
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
          disabled={!hasRoute}
          className={`btn-primary-slate ${hasRoute ? 'btn-active' : 'btn-disabled'}`}
        >
          {isPlaying ? 'PAUSE NAVIGATION' : 'START NAVIGATION'}
        </button>
        <button onClick={onClearPoints} className="btn-secondary-outline" title="Reset points">
          CLEAR
        </button>
      </div>
    </div>
  );
};
