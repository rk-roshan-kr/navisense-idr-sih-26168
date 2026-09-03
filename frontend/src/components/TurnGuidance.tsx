import React from 'react';
import type { TelemetryPacket, ScenarioInfo } from '../types';
import { IconArrowUp } from './Icons';

interface TurnGuidanceProps {
  telemetry: TelemetryPacket | null;
  scenario: ScenarioInfo | null;
}

export const TurnGuidance: React.FC<TurnGuidanceProps> = ({ telemetry, scenario }) => {
  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;

  const iconColor = isBlackout ? '#e11d48' : '#059669';

  // Determine maneuver based on scenario and heading
  let ManeuverIcon = <IconArrowUp size={20} color={iconColor} />;
  let maneuverText = isBlackout ? 'GNSS Blackout — NaviSense IDR Active' : 'Continue on Planned Road Corridor';
  let roadName = 'IO-VNBD S3b — Dense Urban Residential (Coventry)';
  let distanceToTurn = isBlackout ? 'GNSS DENIED • IDR TRACKING' : 'IN 400 M';

  if (scenario?.id === 's1') {
    roadName = 'IO-VNBD S1 — Mixed Urban-Suburban (Coventry)';
    maneuverText = isBlackout ? 'GNSS Blackout — NaviSense IDR Active' : 'Follow suburban arterial corridor';
  } else if (scenario?.id === 's4') {
    roadName = 'IO-VNBD S4 — Arterial Highway Circuit (Coventry)';
    maneuverText = isBlackout ? 'GNSS Blackout — NaviSense IDR Active' : 'Follow dual carriageway ring road';
  }

  // Speed limit for road
  const speedLimit = 60;
  const isOverSpeed = speedKmh > speedLimit + 5;

  return (
    <div className="turn-guidance-card">
      {/* Maneuver Arrow & Action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="maneuver-icon-box">
          {ManeuverIcon}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '10px', fontWeight: 800, color: iconColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {distanceToTurn}
          </div>
          <div style={{ fontSize: '12px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
            {maneuverText}
          </div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', marginTop: '1px' }}>
            {roadName}
          </div>
        </div>
      </div>

      {/* Speed Limit Sign Badge */}
      <div className={`speed-limit-sign ${isOverSpeed ? 'overspeed' : ''}`}>
        <span className="speed-limit-num mono">{speedLimit}</span>
      </div>
    </div>
  );
};
