import React from 'react';

interface SpeedDialProps {
  speedKmh: number;
  isBlackout: boolean;
  maxSpeed?: number;
}

export const SpeedDial: React.FC<SpeedDialProps> = ({ speedKmh, isBlackout, maxSpeed = 140 }) => {
  const clampedSpeed = Math.max(0, Math.min(maxSpeed, speedKmh));
  const pct = clampedSpeed / maxSpeed;

  // Arc geometry: 240-degree sweep from -120 deg (left) to +120 deg (right)
  // Total arc length for radius 70: 2 * PI * 70 * (240 / 360) = 293.2
  const r = 70;
  const cx = 100;
  const cy = 100;
  const arcLength = 2 * Math.PI * r * (240 / 360);
  const strokeOffset = arcLength * (1 - pct);

  // Needle angle: -120 deg (at 0 km/h) to +120 deg (at max km/h)
  const needleAngle = -120 + pct * 240;

  // Major ticks (0, 20, 40, 60, 80, 100, 120, 140)
  const majorTicks = [0, 20, 40, 60, 80, 100, 120, 140];

  return (
    <div className="speed-dial-wrap">
      <svg width="200" height="175" viewBox="0 0 200 175" className="speed-dial-svg">
        <defs>
          {/* Glowing Arc Gradient */}
          <linearGradient id="speedArcGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00d2ff" />
            <stop offset="70%" stopColor="#00f59b" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>

          {/* Needle Glow Filter */}
          <filter id="needleGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Outer subtle dial ring */}
        <circle
          cx={cx}
          cy={cy}
          r="92"
          fill="none"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth="1.5"
        />

        {/* Background Arc Track */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth="9"
          strokeLinecap="round"
        />

        {/* Active Speed Arc */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke={isBlackout ? 'url(#speedArcGrad)' : '#00f59b'}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={strokeOffset}
          style={{
            transition: 'stroke-dashoffset 0.12s linear, stroke 0.3s ease',
            filter: `drop-shadow(0 0 8px ${isBlackout ? 'rgba(0, 210, 255, 0.6)' : 'rgba(0, 245, 155, 0.6)'})`
          }}
        />

        {/* Dial Tick Marks & Numeric Labels */}
        {majorTicks.map((val) => {
          const tickPct = val / maxSpeed;
          const angle = -120 + tickPct * 240;
          const rad = (angle - 90) * (Math.PI / 180);

          // Inner and outer tick positions
          const x1 = cx + 80 * Math.cos(rad);
          const y1 = cy + 80 * Math.sin(rad);
          const x2 = cx + 86 * Math.cos(rad);
          const y2 = cy + 86 * Math.sin(rad);

          // Text label position
          const tx = cx + 55 * Math.cos(rad);
          const ty = cy + 55 * Math.sin(rad) + 3;

          const isActive = clampedSpeed >= val;

          return (
            <g key={val}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.25)'}
                strokeWidth={val % 40 === 0 ? 2 : 1}
              />
              <text
                x={tx}
                y={ty}
                fill={isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.35)'}
                fontSize="8.5"
                fontFamily="'JetBrains Mono', monospace"
                fontWeight="700"
                textAnchor="middle"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Rotating Needle */}
        <g
          transform={`rotate(${needleAngle}, ${cx}, ${cy})`}
          style={{ transition: 'transform 0.12s linear' }}
        >
          {/* Tapered Pointer */}
          <polygon
            points={`${cx - 2},${cy} ${cx + 2},${cy} ${cx},${cy - 68}`}
            fill={isBlackout ? '#00d2ff' : '#00f59b'}
            filter="url(#needleGlow)"
          />
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - 68}
            stroke="#ffffff"
            strokeWidth="1.5"
          />
        </g>

        {/* Center Hub */}
        <circle cx={cx} cy={cy} r="8" fill="#0b111c" stroke="#ffffff" strokeWidth="2" />
        <circle cx={cx} cy={cy} r="3.5" fill={isBlackout ? '#00d2ff' : '#00f59b'} />
      </svg>

      {/* Central Digital Readout */}
      <div className="speed-dial-center-val">
        <span className="speed-dial-digit mono">{Math.round(clampedSpeed)}</span>
        <span className="speed-dial-unit">KM/H</span>
      </div>

      {/* Sensor/Model Source Badge */}
      <div className="speed-source-badge">
        <span className={`dot-source ${!isBlackout ? 'dot-gnss-on' : 'dot-idr-on'}`} />
        <span className="source-label">
          {!isBlackout ? 'CAN / GNSS' : 'IDR INERTIAL'}
        </span>
      </div>
    </div>
  );
};

// SVG arc helper
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  };
}

function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
}
