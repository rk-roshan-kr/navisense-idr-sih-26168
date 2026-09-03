import React from 'react';
import type { TelemetryPacket } from '../types';
import { SpeedDial } from './SpeedDial';

interface NavigationHUDProps {
  telemetry: TelemetryPacket | null;
}

export const NavigationHUD: React.FC<NavigationHUDProps> = ({ telemetry }) => {
  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;
  const headingDeg = telemetry?.heading_deg ?? 0;
  const driftPct = telemetry?.drift_pct ?? 0;
  const driftM = telemetry?.drift_m ?? 0;

  return (
    <div className="hud-container glass-panel">
      {/* Status Row */}
      <div className="hud-status-row">
        {/* GNSS Status */}
        <div className="hud-indicator-group">
          <span className={`indicator-dot ${!isBlackout ? 'dot-gnss-on' : 'dot-gnss-off'}`} />
          <span className="indicator-name">GNSS</span>
          <span className={`indicator-pill ${!isBlackout ? 'pill-gnss-avail' : 'pill-gnss-lost'}`}>
            {!isBlackout ? 'AVAILABLE' : 'LOST'}
          </span>
        </div>

        {/* IDR Status */}
        <div className="hud-indicator-group">
          <span className="indicator-dot dot-idr-on" />
          <span className="indicator-name">IDR</span>
          <span className={`indicator-pill ${isBlackout ? 'pill-idr-active' : 'pill-idr-ready'}`}>
            {isBlackout ? 'ACTIVE' : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* 1. LARGE HIGH-READABILITY VEHICLE SPEED DIAL */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 0' }}>
        <SpeedDial speedKmh={speedKmh} isBlackout={isBlackout} maxSpeed={140} />
      </div>

      {/* 2. HEADING ROW */}
      <div className="hud-metric-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span className="metric-label">VEHICLE HEADING</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Azimuth orientation</span>
        </div>
        <div className="metric-value-wrap">
          <span className="metric-large-digit mono">
            {String(Math.round(headingDeg)).padStart(3, '0')}°
          </span>
          <span className="heading-cardinal-badge">
            {getCardinalDirection(headingDeg)}
          </span>
        </div>
      </div>

      {/* 3. DRIFT ERROR ROW */}
      <div className="hud-drift-row">
        <div className="drift-info-left">
          <span className="metric-label">CUMULATIVE DRIFT</span>
          <span className="drift-subtext mono">{driftM.toFixed(1)} m deviation</span>
        </div>
        <div className="metric-value-wrap">
          <span className={`drift-pct-digit mono ${driftPct <= 10.0 ? 'drift-good' : driftPct <= 25.0 ? 'drift-mid' : 'drift-bad'}`}>
            {driftPct.toFixed(1)}%
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
