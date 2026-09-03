import React from 'react';

interface SpeedDialProps {
  speedKmh: number;
  isBlackout: boolean;
  maxSpeed?: number;
}

export const SpeedDial: React.FC<SpeedDialProps> = ({ speedKmh, isBlackout, maxSpeed = 140 }) => {
  const clampedSpeed = Math.max(0, Math.min(maxSpeed, speedKmh));
  const pct = clampedSpeed / maxSpeed;

  // Geometry: Center (130, 115), Radius 90, 240-degree sweep (-120 to +120)
  const cx = 130;
  const cy = 115;
  const r = 90;
  const arcLength = 2 * Math.PI * r * (240 / 360); // 376.99
  const strokeOffset = arcLength * (1 - pct);

  // Pointer position along the arc ring
  const angle = -120 + pct * 240;
  const rad = (angle - 90) * (Math.PI / 180);
  const pointerX = cx + r * Math.cos(rad);
  const pointerY = cy + r * Math.sin(rad);

  const majorTicks = [0, 20, 40, 60, 80, 100, 120, 140];

  return (
    <div className="speed-dial-wrap">
      <svg width="260" height="210" viewBox="0 0 260 210" className="speed-dial-svg">
        <defs>
          {/* Active Gradient for Speed Arc */}
          <linearGradient id="speedArcGradLight" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="65%" stopColor="#059669" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>

          {/* Pointer Drop Shadow */}
          <filter id="pointerGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0f172a" floodOpacity="0.25" />
          </filter>
        </defs>

        {/* Outer Background Subtle Ring */}
        <circle
          cx={cx}
          cy={cy}
          r="104"
          fill="#ffffff"
          stroke="#e2e8f0"
          strokeWidth="1.5"
        />

        {/* Background Arc Track */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth="12"
          strokeLinecap="round"
        />

        {/* Active Speed Progress Arc */}
        <path
          d={describeArc(cx, cy, r, -120, 120)}
          fill="none"
          stroke={isBlackout ? 'url(#speedArcGradLight)' : '#059669'}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={arcLength}
          strokeDashoffset={strokeOffset}
          style={{
            transition: 'stroke-dashoffset 0.12s linear, stroke 0.3s ease'
          }}
        />

        {/* Dial Ticks & Bold Outer Labels (Positioned outside the arc to prevent collision) */}
        {majorTicks.map((val) => {
          const tickPct = val / maxSpeed;
          const tickAngle = -120 + tickPct * 240;
          const tickRad = (tickAngle - 90) * (Math.PI / 180);

          // Ticks outside the track
          const x1 = cx + 98 * Math.cos(tickRad);
          const y1 = cy + 98 * Math.sin(tickRad);
          const x2 = cx + 104 * Math.cos(tickRad);
          const y2 = cy + 104 * Math.sin(tickRad);

          // Text labels outside
          const tx = cx + 70 * Math.cos(tickRad);
          const ty = cy + 70 * Math.sin(tickRad) + 4;

          const isActive = clampedSpeed >= val;

          return (
            <g key={val}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isActive ? '#0f172a' : '#cbd5e1'}
                strokeWidth={val % 40 === 0 ? 2.5 : 1.5}
              />
              <text
                x={tx}
                y={ty}
                fill={isActive ? '#0f172a' : '#94a3b8'}
                fontSize="10"
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={isActive ? '800' : '600'}
                textAnchor="middle"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Sweeping Active Cursor Pointer on the Ring */}
        <g style={{ transition: 'transform 0.12s linear' }}>
          {/* Pulsing ring behind pointer */}
          <circle
            cx={pointerX}
            cy={pointerY}
            r="10"
            fill={isBlackout ? 'rgba(37, 99, 235, 0.25)' : 'rgba(5, 150, 105, 0.25)'}
          />
          {/* Solid White/Vibrant Pointer */}
          <circle
            cx={pointerX}
            cy={pointerY}
            r="7"
            fill={isBlackout ? '#2563eb' : '#059669'}
            stroke="#ffffff"
            strokeWidth="3"
            filter="url(#pointerGlow)"
          />
        </g>
      </svg>

      {/* Central Large Digital Speed Display (Completely Open, Zero Collision) */}
      <div className="speed-dial-center-val">
        <span className="speed-dial-digit mono">{Math.round(clampedSpeed)}</span>
        <span className="speed-dial-unit">KM / H</span>
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
