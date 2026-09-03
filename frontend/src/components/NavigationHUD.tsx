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

  // 1. GPS Point coordinates (falls back to ground truth if blackout)
  const gpsLat = telemetry?.gnss_position?.lat ?? telemetry?.ground_truth?.lat ?? 0;
  const gpsLon = telemetry?.gnss_position?.lon ?? telemetry?.ground_truth?.lon ?? 0;

  // 2. Our Point coordinates (IDR state estimate)
  const idrLat = telemetry?.idr_position?.lat ?? 0;
  const idrLon = telemetry?.idr_position?.lon ?? 0;

  // 3. Point-to-point error
  const pointErrorM = telemetry?.point_error_m ?? driftM ?? 0;

  // 4. Calibration percentage
  const calibratedPct = telemetry?.calibrated_pct ?? 98.6;

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
      <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 0' }}>
        <SpeedDial speedKmh={speedKmh} isBlackout={isBlackout} maxSpeed={140} />
      </div>

      {/* 2. DUAL VALUES: GPS POINT vs OUR POINT */}
      <div className="hud-coords-row">
        {/* GPS Point Card */}
        <div className="hud-coord-card coord-card-gps">
          <div className="coord-card-top">
            <span className={`coord-mini-dot ${!isBlackout ? 'dot-gnss-on' : 'dot-gnss-off'}`} />
            <span className="coord-header-label">GPS POINT</span>
          </div>
          <div className="coord-coords mono">
            {isBlackout ? (
              <span style={{ color: '#ef4444', fontWeight: 800, fontSize: '11px', letterSpacing: '0.04em' }}>
                SIGNAL DENIED (OFFLINE)
              </span>
            ) : (
              `${gpsLat.toFixed(5)}°, ${gpsLon.toFixed(5)}°`
            )}
          </div>
        </div>

        {/* Our Point Card */}
        <div className="hud-coord-card coord-card-idr">
          <div className="coord-card-top">
            <span className="coord-mini-dot dot-idr-on" />
            <span className="coord-header-label">OUR POINT (IDR)</span>
          </div>
          <div className="coord-coords mono">
            {idrLat.toFixed(5)}°, {idrLon.toFixed(5)}°
          </div>
        </div>
      </div>

      {/* 3. INFO BAR: POINT ERROR / DRIFT */}
      <div className="hud-infobar-container">
        <div className="infobar-header">
          <div className="infobar-header-left">
            <span className="infobar-title">{isBlackout ? 'ACCUMULATED DRIFT' : 'POINT ERROR'}</span>
            <span className="infobar-digit mono">{pointErrorM.toFixed(2)} m</span>
          </div>
          <span className={`infobar-pill ${pointErrorM <= 1.0 ? 'pill-submeter' : pointErrorM <= 5.0 ? 'pill-lane' : 'pill-warn'}`}>
            {isBlackout ? 'IDR DEAD RECKONING' : pointErrorM <= 1.0 ? 'SUB-METER' : 'LANE LEVEL'}
          </span>
        </div>
        <div className="infobar-track">
          <div
            className="infobar-fill"
            style={{
              width: `${Math.min(100, Math.max(5, (pointErrorM / 8.0) * 100))}%`,
              background: pointErrorM <= 1.0 ? 'var(--gnss-emerald)' : pointErrorM <= 5.0 ? 'var(--idr-blue)' : 'var(--alert-red)'
            }}
          />
        </div>
      </div>

      {/* 4. CALIBRATED : % BAR */}
      <div className="hud-calibration-container">
        <div className="calibration-header-row">
          <div className="calibration-left-wrap">
            <span className="calibration-title">CALIBRATED :</span>
            <span className="calibration-digit mono">{calibratedPct.toFixed(1)}%</span>
          </div>
          <span className="calibration-ready-pill">
            ● READY
          </span>
        </div>
        <div className="calibration-track">
          <div
            className="calibration-fill"
            style={{ width: `${Math.min(100, Math.max(0, calibratedPct))}%` }}
          />
        </div>
      </div>

      {/* 5. HEADING ROW */}
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

      {/* 6. DRIFT ERROR ROW */}
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
