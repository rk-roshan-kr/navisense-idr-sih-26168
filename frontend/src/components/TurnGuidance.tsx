import React from 'react';
import type { TelemetryPacket, ScenarioInfo } from '../types';
import { IconArrowUp, IconTurnLeft, IconTurnRight } from './Icons';

interface TurnGuidanceProps {
  telemetry: TelemetryPacket | null;
  scenario: ScenarioInfo | null;
}

export const TurnGuidance: React.FC<TurnGuidanceProps> = ({ telemetry, scenario }) => {
  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;
  const headingDeg = telemetry?.heading_deg ?? 0;

  const iconColor = isBlackout ? '#00d2ff' : '#00f59b';

  // Determine maneuver based on scenario and heading
  let ManeuverIcon = <IconArrowUp size={22} color={iconColor} />;
  let maneuverText = 'Continue straight';
  let roadName = 'A4053 Ringway / Highway';
  let distanceToTurn = 'In 350 m';

  if (scenario?.id === 'urban') {
    roadName = 'B4101 Spon End ➔ Hearsall Lane';
    if (headingDeg >= 170 && headingDeg <= 230) {
      ManeuverIcon = <IconTurnLeft size={22} color={iconColor} />;
      maneuverText = 'Turn left onto Hearsall Lane';
      distanceToTurn = 'Now';
    } else {
      ManeuverIcon = <IconArrowUp size={22} color={iconColor} />;
      maneuverText = 'Follow Spon End';
      distanceToTurn = 'In 180 m';
    }
  } else if (scenario?.id === 'winding') {
    roadName = 'B4113 Country Route';
    ManeuverIcon = <IconTurnRight size={22} color={iconColor} />;
    maneuverText = 'Sharp bend ahead (91°)';
    distanceToTurn = 'In 120 m';
  }

  // Speed limit for road
  const speedLimit = scenario?.id === 'highway' ? 70 : 50;
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
