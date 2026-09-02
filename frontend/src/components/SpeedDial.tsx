import React from 'react';

interface SpeedDialProps {
  speedKmh: number;
  isBlackout: boolean;
  maxSpeed?: number;
}

export const SpeedDial: React.FC<SpeedDialProps> = ({ speedKmh, isBlackout, maxSpeed = 140 }) => {
  const clampedSpeed = Math.max(0, Math.min(maxSpeed, speedKmh));
  const pct = clampedSpeed / maxSpeed;

  const r = 70;
  const cx = 100;
  const cy = 100;
  const arcLength = 2 * Math.PI * r * (240 / 360);
  const strokeOffset = arcLength * (1 - pct);

  const needleAngle = -120 + pct * 240;
  const majorTicks = [0, 20, 40, 60, 80, 100, 120, 140];

  return (
    <div className="speed-dial-wrap">
      <svg width="200" height="175" viewBox="0 0 200 175" className="speed-dial-svg">
        <defs>
          {/* Active Gradient for Speed Arc */}
          <linearGradient id="speedArcGradLight" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="70%" stopColor="#059669" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>

          {/* Needle Shadow */}
          <filter id="needleShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Outer subtle dial ring */}
        <circle
          cx={cx}
          cy={cy}
          r="92"
          fill="#ffffff"
          stroke="#e2e8f0"
          strokeWidth="1.5"
        />

        {/* Background Arc Track */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Active Speed Arc */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke={isBlackout ? 'url(#speedArcGradLight)' : '#059669'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={strokeOffset}
          style={{
            transition: 'stroke-dashoffset 0.12s linear, stroke 0.3s ease'
          }}
        />

        {/* Dial Tick Marks & Numeric Labels */}
        {majorTicks.map((val) => {
          const tickPct = val / maxSpeed;
          const angle = -120 + tickPct * 240;
          const rad = (angle - 90) * (Math.PI / 180);

          const x1 = cx + 80 * Math.cos(rad);
          const y1 = cy + 80 * Math.sin(rad);
          const x2 = cx + 86 * Math.cos(rad);
          const y2 = cy + 86 * Math.sin(rad);

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
                stroke={isActive ? '#0f172a' : '#cbd5e1'}
                strokeWidth={val % 40 === 0 ? 2 : 1}
              />
              <text
                x={tx}
                y={ty}
                fill={isActive ? '#0f172a' : '#94a3b8'}
                fontSize="8.5"
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={isActive ? '800' : '600'}
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
          <polygon
            points={`${cx - 2.5},${cy} ${cx + 2.5},${cy} ${cx},${cy - 68}`}
            fill={isBlackout ? '#2563eb' : '#059669'}
            filter="url(#needleShadow)"
          />
          <line
            x1={cx}
            y1={cy}
            x2={cx}
            y2={cy - 68}
            stroke="#ffffff"
            strokeWidth="1"
          />
        </g>

        {/* Center Hub */}
        <circle cx={cx} cy={cy} r="8" fill="#0f172a" stroke="#ffffff" strokeWidth="2.5" />
        <circle cx={cx} cy={cy} r="3" fill={isBlackout ? '#2563eb' : '#059669'} />
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
