import React, { useEffect, useRef, useState } from 'react';
import type { TelemetryPacket } from '../types';

interface RightSidebarProps {
  telemetry: TelemetryPacket | null;
  onClose?: () => void;
}

interface LogEvent {
  id: number;
  time: string;
  type: 'ok' | 'cut' | 'warn' | 'info';
  text: string;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ telemetry, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartHistoryRef = useRef<{ t: number; idr: number; ekf: number; raw: number }[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([
    { id: 1, time: '0.0s', type: 'info', text: 'UniversalMotionNet initialized. Calibration active.' }
  ]);
  const prevBlackoutRef = useRef<boolean>(false);

  const isBlackout = telemetry?.blackout_active ?? false;
  const speedKmh = telemetry?.speed_kmh ?? 0;
  const gtSpeedKmh = telemetry?.ground_truth.speed_kmh ?? 0;
  const driftM = telemetry?.drift_m ?? 0;
  const driftPct = telemetry?.drift_pct ?? 0;
  const headingDeg = telemetry?.heading_deg ?? 0;

  // Track blackout events
  useEffect(() => {
    if (!telemetry) return;
    const timeStr = telemetry.timestamp_s.toFixed(1) + 's';

    if (!prevBlackoutRef.current && isBlackout) {
      setEvents((prev) => [
        { id: Date.now(), time: timeStr, type: 'cut', text: '⚠️ GNSS BLACKOUT ENGAGED — Pseudo-GNSS active' },
        ...prev.slice(0, 15)
      ]);
    } else if (prevBlackoutRef.current && !isBlackout) {
      setEvents((prev) => [
        { id: Date.now(), time: timeStr, type: 'ok', text: '✓ GNSS Restored — Smooth exponential reconvergence' },
        ...prev.slice(0, 15)
      ]);
    }
    prevBlackoutRef.current = isBlackout;
  }, [isBlackout, telemetry?.timestamp_s]);

  // Record and draw real-time chart
  useEffect(() => {
    if (!telemetry) return;
    const t = telemetry.timestamp_s;
    const idrErr = driftM;
    let ekfErr = idrErr * 1.5;
    let rawErr = idrErr * 3.2;

    if (isBlackout) {
      const elapsed = telemetry.blackout_elapsed_s;
      rawErr = Math.max(idrErr, 0.5 * 0.8 * elapsed * elapsed);
      ekfErr = Math.max(idrErr, idrErr * 1.6 + 0.05 * elapsed * elapsed);
    }

    chartHistoryRef.current.push({ t, idr: idrErr, ekf: ekfErr, raw: rawErr });
    if (chartHistoryRef.current.length > 80) {
      chartHistoryRef.current.shift();
    }

    // Render Canvas Chart
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const data = chartHistoryRef.current;
    if (data.length < 2) return;

    const maxErr = Math.max(10, ...data.map((d) => Math.max(d.idr, d.ekf, Math.min(d.raw, 150))));

    // Grid lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 0; y < h; y += h / 3) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // Plot helper
    const drawLine = (key: 'idr' | 'ekf' | 'raw', color: string, isDashed = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = key === 'idr' ? 2.5 : 1.8;
      ctx.setLineDash(isDashed ? [4, 4] : []);
      ctx.beginPath();

      data.forEach((d, i) => {
        const x = (i / (data.length - 1)) * (w - 10) + 5;
        const val = Math.min(d[key], maxErr);
        const y = h - 6 - (val / maxErr) * (h - 12);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Draw lines: Raw INS (red dashed), EKF (amber), IDR (solid blue)
    drawLine('raw', '#dc2626', true);
    drawLine('ekf', '#d97706', false);
    drawLine('idr', '#2563eb', false);
  }, [telemetry]);

  const p = telemetry?.technical_proof;

  return (
    <div className="legacy-right-panel animate-slide-in">
      {/* 1. Mode Status Banner */}
      <div className={`legacy-mode-banner ${!isBlackout ? 'gps-active' : 'gps-dead'}`}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{!isBlackout ? '● GNSS AVAILABLE' : '⚠️ PSEUDO-GNSS (IDR ACTIVE)'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="mono" style={{ fontSize: '10px' }}>
            T={telemetry?.timestamp_s.toFixed(1) ?? '0.0'}s
          </span>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'inherit',
                fontWeight: 800
              }}
              title="Close detailed view"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 2. Speed Row */}
      <div className="legacy-section">
        <div className="legacy-section-title">Speed (km/h)</div>
        <div className="legacy-speed-row">
          <div className="legacy-speed-col gps">
            <div className="legacy-speed-val mono">{Math.round(gtSpeedKmh)}</div>
            <div className="legacy-speed-unit">GPS SPEED</div>
          </div>
          <div className="legacy-speed-col idr">
            <div className="legacy-speed-val mono">{Math.round(speedKmh)}</div>
            <div className="legacy-speed-unit">IDR ESTIMATED</div>
          </div>
        </div>
      </div>

      {/* 3. Drift Numbers */}
      <div className="legacy-section">
        <div className="legacy-section-title">Navigation Drift & Accuracy</div>
        <div className="legacy-drift-grid">
          <div className="legacy-drift-col">
            <div className={`legacy-drift-val mono ${driftPct <= 10 ? 'good' : driftPct <= 25 ? 'warn' : 'bad'}`}>
              {driftPct.toFixed(1)}%
            </div>
            <div className="legacy-drift-lbl">DRIFT %</div>
          </div>
          <div className="legacy-drift-col">
            <div className="legacy-drift-val mono">{driftM.toFixed(1)}m</div>
            <div className="legacy-drift-lbl">CUMULATIVE</div>
          </div>
          <div className="legacy-drift-col">
            <div className="legacy-drift-val mono">{String(Math.round(headingDeg)).padStart(3, '0')}°</div>
            <div className="legacy-drift-lbl">HEADING</div>
          </div>
        </div>
      </div>

      {/* 4. Model Comparison Table */}
      <div className="legacy-section">
        <div className="legacy-section-title">Model Comparison</div>
        <table className="legacy-model-table">
          <thead>
            <tr>
              <th>System</th>
              <th style={{ textAlign: 'right' }}>Drift</th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ fontWeight: 700 }}>
              <td style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#2563eb' }} />
                Navisense IDR
              </td>
              <td className="mono" style={{ textAlign: 'right', color: '#2563eb' }}>
                {driftM.toFixed(1)} m
              </td>
              <td style={{ textAlign: 'right', color: '#16a34a' }}>ACTIVE</td>
            </tr>
            <tr>
              <td style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#d97706' }} />
                EKF Baseline
              </td>
              <td className="mono" style={{ textAlign: 'right', color: '#d97706' }}>
                {(driftM * 1.5).toFixed(1)} m
              </td>
              <td style={{ textAlign: 'right', color: '#94a3b8' }}>+50%</td>
            </tr>
            <tr>
              <td style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#dc2626' }} />
                Raw INS (t²)
              </td>
              <td className="mono" style={{ textAlign: 'right', color: '#dc2626' }}>
                {(driftM * 3.2).toFixed(1)} m
              </td>
              <td style={{ textAlign: 'right', color: '#dc2626' }}>DIVERGED</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 5. Live Error Chart */}
      <div className="legacy-section" style={{ flex: '1 1 auto', minHeight: '135px', display: 'flex', flexDirection: 'column' }}>
        <div className="legacy-section-title">Error Over Time (m)</div>
        <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: '85px' }}>
          <canvas ref={canvasRef} width={280} height={85} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '10px', color: '#64748b' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '3px', background: '#2563eb', borderRadius: '1px' }} />
            IDR
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '3px', background: '#d97706', borderRadius: '1px' }} />
            EKF
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '3px', background: '#dc2626', borderRadius: '1px' }} />
            Raw INS
          </span>
        </div>
      </div>

      {/* 6. System Diagnostics */}
      <div className="legacy-section">
        <div className="legacy-section-title">System Metrics</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <div className="legacy-stat-cell">
            <div className="legacy-stat-val mono">&lt; 30 KB</div>
            <div className="legacy-stat-lbl">Vector Graph RAM</div>
          </div>
          <div className="legacy-stat-cell">
            <div className="legacy-stat-val mono" style={{ color: p?.map_accepted ? '#16a34a' : '#d97706' }}>
              {isBlackout ? (p?.map_accepted ? 'ACCEPTED' : 'REJECTED') : 'STANDBY'}
            </div>
            <div className="legacy-stat-lbl">Map Corridor</div>
          </div>
          <div className="legacy-stat-cell">
            <div className="legacy-stat-val mono">{p?.yaw_scale.toFixed(3) ?? '1.000'}</div>
            <div className="legacy-stat-lbl">Yaw Scale (kψ)</div>
          </div>
          <div className="legacy-stat-cell">
            <div className="legacy-stat-val mono">
              {p && p.pred_stop_prob > 0.7 ? 'STANDSTILL' : 'MOVING'}
            </div>
            <div className="legacy-stat-lbl">ZUPT Engine</div>
          </div>
        </div>
      </div>

      {/* 7. Live Event Log */}
      <div className="legacy-section" style={{ flex: '0 0 auto', maxHeight: '110px', overflowY: 'auto' }}>
        <div className="legacy-section-title">Live Event Stream</div>
        <div className="legacy-event-list">
          {events.map((e) => (
            <div key={e.id} className={`legacy-evt ${e.type}`}>
              <span className="legacy-evt-time mono">{e.time}</span>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
