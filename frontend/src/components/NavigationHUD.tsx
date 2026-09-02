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

  return (
    <div className="hud-container glass-panel">
      {/* Status Row */}
      <div className="hud-status-row">
        {/* GNSS */}
        <div className="hud-indicator-group">
          <span className={`indicator-dot ${!isBlackout ? 'dot-gnss-on' : 'dot-gnss-off'}`} />
          <span className="indicator-name">GNSS</span>
          <span className={`indicator-pill ${!isBlackout ? 'pill-gnss-avail' : 'pill-gnss-lost'}`}>
            {!isBlackout ? 'AVAILABLE' : 'LOST'}
          </span>
        </div>

        {/* IDR */}
        <div className="hud-indicator-group">
          <span className="indicator-dot dot-idr-on" />
          <span className="indicator-name">IDR</span>
          <span className={`indicator-pill ${isBlackout ? 'pill-idr-active' : 'pill-idr-ready'}`}>
            {isBlackout ? 'ACTIVE' : 'READY'}
          </span>
        </div>
      </div>

      {/* 1. SPEED */}
      <div className="hud-metric-row">
        <span className="metric-label">SPEED</span>
        <div className="metric-value-wrap">
          <span className="metric-large-digit mono">{Math.round(speedKmh)}</span>
          <span className="metric-unit">km/h</span>
        </div>
      </div>

      {/* 2. HEADING */}
      <div className="hud-metric-row">
        <span className="metric-label">HEADING</span>
        <div className="metric-value-wrap">
          <span className="metric-large-digit mono">{String(Math.round(headingDeg)).padStart(3, '0')}°</span>
          <span className="heading-cardinal">{getCardinalDirection(headingDeg)}</span>
        </div>
      </div>

      {/* 3. DRIFT % */}
      <div className="hud-drift-row">
        <div className="drift-info-left">
          <span className="metric-label">DRIFT ERROR</span>
          <span className="drift-subtext mono">{driftM.toFixed(1)} m total</span>
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
