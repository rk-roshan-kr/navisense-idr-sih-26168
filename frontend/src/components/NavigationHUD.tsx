import React from 'react';
import type { TelemetryPacket } from '../types';

interface NavigationHUDProps {
  telemetry: TelemetryPacket | null;
}

export const NavigationHUD: React.FC<NavigationHUDProps> = ({ telemetry }) => {
  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;
  const headingDeg = telemetry?.heading_deg ?? 0;
  const driftPct = telemetry?.drift_pct ?? 0;
  const driftM = telemetry?.drift_m ?? 0;
  const pointErrorM = telemetry?.point_error_m ?? driftM ?? 0;
  const calibratedPct = telemetry?.calibrated_pct ?? 0.0;

  // 1. GPS coordinates vs IDR state estimate
  const gpsLat = telemetry?.gnss_position?.lat ?? telemetry?.ground_truth?.lat ?? 0;
  const gpsLon = telemetry?.gnss_position?.lon ?? telemetry?.ground_truth?.lon ?? 0;
  const idrLat = telemetry?.idr_position?.lat ?? 0;
  const idrLon = telemetry?.idr_position?.lon ?? 0;

  return (
    <div className="telemetry-instrument-card">
      {/* 1. Header Engine Status Chip */}
      <div className="instrument-status-row">
        <span className={`status-pill ${!isBlackout ? 'pill-gnss-locked' : 'pill-idr-active'}`}>
          <span className={`status-dot ${!isBlackout ? 'dot-emerald' : 'dot-rose'}`} />
          {!isBlackout ? 'GNSS LOCKED' : 'IDR ACTIVE (OUTAGE)'}
        </span>
        <span className="timestamp-badge mono">
          T+{telemetry?.timestamp_s.toFixed(1) ?? '0.0'}s
        </span>
      </div>

      {/* 2. Pure Typographic Speed Display (DESIGN.md: 44px bold text with 11px uppercase mono beneath) */}
      <div className="instrument-speed-block">
        <div className="speed-digit mono">{speedKmh}</div>
        <div className="speed-unit mono">KM / H</div>
      </div>

      {/* 3. Inline Coordinate Indicators */}
      <div className="instrument-coords-row">
        <div className="coord-item">
          <span className="coord-label">GPS FIX</span>
          <span className="coord-val mono">
            {isBlackout ? 'DENIED' : `${gpsLat.toFixed(5)}°, ${gpsLon.toFixed(5)}°`}
          </span>
        </div>
        <div className="coord-item">
          <span className="coord-label">IDR EST</span>
          <span className="coord-val mono">
            {idrLat !== 0 ? `${idrLat.toFixed(5)}°, ${idrLon.toFixed(5)}°` : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* 4. Tight 2-Column Key-Value Telemetry Grid */}
      <div className="telemetry-grid">
        <div className="grid-cell">
          <span className="grid-key">HEADING</span>
          <span className="grid-val mono">
            {String(Math.round(headingDeg)).padStart(3, '0')}° {getCardinalDirection(headingDeg)}
          </span>
        </div>
        <div className="grid-cell">
          <span className="grid-key">ERROR MARGIN</span>
          <span className="grid-val mono">
            {isBlackout ? `±${driftM.toFixed(1)}m` : `±${pointErrorM.toFixed(2)}m (Sub-meter)`}
          </span>
        </div>
        <div className="grid-cell">
          <span className="grid-key">CALIBRATED</span>
          <span className="grid-val mono">
            {calibratedPct >= 90 ? `${calibratedPct.toFixed(1)}% (Custom)` : `${calibratedPct.toFixed(1)}% (Online)`}
          </span>
        </div>
        <div className="grid-cell">
          <span className="grid-key">DRIFT RATE</span>
          <span className={`grid-val mono ${isBlackout ? 'text-rose' : 'text-slate'}`}>
            {isBlackout ? `${driftPct.toFixed(1)}%` : '< 0.5%'}
          </span>
        </div>
      </div>
    </div>
  );
};

function getCardinalDirection(deg: number): string {
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  const idx = Math.round((deg % 360) / 45);
  return cardinals[idx];
}
