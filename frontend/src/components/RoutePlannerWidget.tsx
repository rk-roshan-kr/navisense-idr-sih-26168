import React from 'react';
import type { TelemetryPacket } from '../types';
import { IconMapPin, IconPlay, IconRotateCcw } from './Icons';

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

// Curated high-fidelity drivable presets around the test geography
export const ROUTE_PRESETS = [
  {
    name: 'City Ring Expressway',
    origin: [52.4082, -1.5106] as [number, number],
    destination: [52.4180, -1.5020] as [number, number],
    desc: 'Urban high-speed loop (1.8 km)'
  },
  {
    name: 'A45 Highway Corridor',
    origin: [52.3950, -1.5500] as [number, number],
    destination: [52.4120, -1.5200] as [number, number],
    desc: 'Dual-carriageway cruising (3.2 km)'
  },
  {
    name: 'University Campus to Center',
    origin: [52.4060, -1.5030] as [number, number],
    destination: [52.4110, -1.5140] as [number, number],
    desc: 'Stop-and-go downtown streets (1.2 km)'
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
    <div className="route-planner-container glass-panel">
      {/* Header */}
      <div className="planner-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="planner-icon-badge">
            <IconMapPin size={16} color="#ffffff" />
          </span>
          <div>
            <div className="planner-title">2-LOCATION ROUTE PLANNER</div>
            <div className="planner-subtitle">Test IDR offline dead reckoning on any route</div>
          </div>
        </div>
        <button onClick={onClose} className="planner-close-btn" title="Close planner">✕</button>
      </div>

      {/* Step Status Banner */}
      <div className={`planner-step-banner ${hasRoute ? 'step-ready' : 'step-picking'}`}>
        <span>{customStatusMsg}</span>
      </div>

      {/* Origin (Point A) Card */}
      <div className={`planner-loc-card ${hasOrigin ? 'loc-set' : 'loc-empty'}`}>
        <div className="loc-card-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="loc-dot-origin" />
            <span className="loc-card-title">POINT A (START / ORIGIN)</span>
          </div>
          {currentCarPos && !hasOrigin && (
            <button
              onClick={() => onSetOrigin(currentCarPos)}
              className="btn-loc-action"
              title="Use current vehicle position"
            >
              Use Car Location
            </button>
          )}
        </div>
        <div className="loc-coords mono">
          {hasOrigin
            ? `${customOrigin[0].toFixed(5)}°, ${customOrigin[1].toFixed(5)}°`
            : '👉 Click anywhere on the map to set Origin'}
        </div>
      </div>

      {/* Destination (Point B) Card */}
      <div className={`planner-loc-card ${hasDestination ? 'loc-set' : 'loc-empty'}`}>
        <div className="loc-card-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="loc-dot-dest" />
            <span className="loc-card-title">POINT B (DESTINATION)</span>
          </div>
        </div>
        <div className="loc-coords mono">
          {hasDestination
            ? `${customDestination[0].toFixed(5)}°, ${customDestination[1].toFixed(5)}°`
            : hasOrigin
            ? '👉 Click anywhere on the map to set Destination'
            : 'Set Point A first'}
        </div>
      </div>

      {/* 1-Click Instant Presets */}
      <div className="planner-presets-section">
        <div className="presets-title">QUICK 1-CLICK TEST PRESETS:</div>
        <div className="presets-list">
          {ROUTE_PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => onSelectPreset(p.origin, p.destination, p.name)}
              className="btn-preset-route"
            >
              <div className="preset-route-name">{p.name}</div>
              <div className="preset-route-desc">{p.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Action Footer */}
      <div className="planner-footer">
        {hasRoute && (
          <button
            onClick={onStartSimulation}
            className={`btn-planner-primary ${isPlaying ? 'btn-pause' : 'btn-play'}`}
          >
            <IconPlay size={14} color="#ffffff" />
            <span>{isPlaying ? 'PAUSE NAVIGATION' : 'START SIMULATION'}</span>
          </button>
        )}
        <button onClick={onClearPoints} className="btn-planner-secondary">
          <IconRotateCcw size={13} />
          <span>Reset Points</span>
        </button>
      </div>
    </div>
  );
};
