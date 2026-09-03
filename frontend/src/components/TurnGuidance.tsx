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

  const iconColor = isBlackout ? '#00d2ff' : '#00f59b';

  // Determine maneuver based on scenario and heading
  let ManeuverIcon = <IconArrowUp size={22} color={iconColor} />;
  let maneuverText = isBlackout ? 'Underpass Tunnel Lockdown (IDR Active)' : 'Continue on Planned Road Corridor';
  let roadName = 'Outer Ring Road (ISRO ISTRAC ➔ Indiranagar)';
  let distanceToTurn = isBlackout ? 'GPS LOCKDOWN' : 'In 400 m';

  if (scenario?.id === 'delhi') {
    roadName = 'NH48 Expressway / Sardar Patel Marg';
    maneuverText = isBlackout ? 'Aerocity Tunnel Lockdown (IDR Active)' : 'Follow NH48 toward Aerocity Gateway';
  } else if (scenario?.id === 'chandigarh') {
    roadName = 'Jan Marg ➔ Madhya Marg Corridor';
    maneuverText = isBlackout ? 'Canopy Canyon Lockdown (IDR Active)' : 'Continue on Jan Marg toward Sector 35';
  }

  // Speed limit for road
  const speedLimit = 60;
  const isOverSpeed = speedKmh > speedLimit + 5;

  return (
    <div className="turn-guidance-card glass-panel">
      {/* Maneuver Arrow & Action */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="maneuver-icon-box">
          {ManeuverIcon}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '11px', fontWeight: 800, color: iconColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {distanceToTurn}
          </div>
          <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
            {maneuverText}
          </div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginTop: '1px' }}>
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
