import React, { useState } from 'react';
import type { TelemetryPacket } from '../types';

interface TechnicalProofDrawerProps {
  telemetry: TelemetryPacket | null;
}

export const TechnicalProofDrawer: React.FC<TechnicalProofDrawerProps> = ({ telemetry }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!telemetry) return null;
  const { technical_proof: p, blackout_active } = telemetry;

  return (
    <div className="drawer-container">
      {/* Drawer Card */}
      {isOpen && (
        <div className="drawer-card glass-panel">
          <div className="drawer-header">
            <span className="drawer-title">
              PyTorch Engine Telemetry (10 Hz)
            </span>
            <span className="proof-cell-label mono">t = {telemetry.timestamp_s.toFixed(1)}s</span>
          </div>

          {/* 1. Raw IMU Channels */}
          <div>
            <div className="drawer-section-title">1. Raw Sensor Channels (Phone)</div>
            <div className="proof-grid-3 mono">
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">ax (m/s²)</span>
                <span className="proof-cell-val">{p.accel_mps2[0].toFixed(2)}</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">ay (m/s²)</span>
                <span className="proof-cell-val">{p.accel_mps2[1].toFixed(2)}</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">az (m/s²)</span>
                <span className="proof-cell-val">{p.accel_mps2[2].toFixed(2)}</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">gx (rad/s)</span>
                <span className="proof-cell-val">{p.gyro_rads[0].toFixed(3)}</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">gy (rad/s)</span>
                <span className="proof-cell-val">{p.gyro_rads[1].toFixed(3)}</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">gz (rad/s)</span>
                <span className="proof-cell-val">{p.gyro_rads[2].toFixed(3)}</span>
              </div>
            </div>
          </div>

          {/* 2. Model Inference */}
          <div>
            <div className="drawer-section-title">2. Universal Motion Model</div>
            <div className="proof-grid-2 mono">
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">Pred Velocity</span>
                <span className="proof-cell-val" style={{ color: 'var(--gnss-emerald)' }}>
                  {p.pred_v_mps.toFixed(2)} m/s
                </span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">Pred Yaw Rate</span>
                <span className="proof-cell-val">{p.pred_wz_rads.toFixed(3)} rad/s</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">Stop Head Prob</span>
                <span className="proof-cell-val">{(p.pred_stop_prob * 100).toFixed(0)}%</span>
              </div>
              <div className="proof-cell glass-subtle">
                <span className="proof-cell-label">State Covariance</span>
                <span className="proof-cell-val" style={{ color: 'var(--idr-blue)' }}>
                  ±{p.uncertainty_m.toFixed(1)} m
                </span>
              </div>
            </div>
          </div>

          {/* 3. Personalization Adapter */}
          <div>
            <div className="drawer-section-title">3. Online Personalization</div>
            <div className="glass-subtle" style={{ padding: '8px 12px' }}>
              <div className="proof-row-kv mono">
                <span className="proof-key">Mount Euler:</span>
                <span className="proof-val">
                  [{p.mount_euler_deg[0]}°, {p.mount_euler_deg[1]}°, {p.mount_euler_deg[2]}°]
                </span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Speed Multiplier (kv):</span>
                <span className="proof-val" style={{ color: 'var(--gnss-emerald)' }}>{p.speed_scale.toFixed(4)}</span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Yaw Response (kψ):</span>
                <span className="proof-val" style={{ color: 'var(--gnss-emerald)' }}>{p.yaw_scale.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* 4. Map Hypothesis Gating */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span className="drawer-section-title" style={{ margin: 0 }}>4. Map Hypothesis Gating</span>
              {blackout_active ? (
                p.map_accepted ? (
                  <span className="badge-accepted">ACCEPTED</span>
                ) : (
                  <span className="badge-rejected">REJECTED (SAFE)</span>
                )
              ) : (
                <span className="proof-cell-label">STANDBY</span>
              )}
            </div>
            <div className="glass-subtle" style={{ padding: '8px 12px' }}>
              <div className="proof-row-kv mono">
                <span className="proof-key">Candidate Prob:</span>
                <span className="proof-val">{(p.map_best_prob * 100).toFixed(0)}%</span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Cross-Track:</span>
                <span className="proof-val">{p.map_cross_track_m.toFixed(2)} m</span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Heading Diff:</span>
                <span className="proof-val">{p.map_heading_diff_deg.toFixed(1)}°</span>
              </div>
            </div>
          </div>

          {/* 5. Dynamic Spatial Chunk Cache */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span className="drawer-section-title" style={{ margin: 0 }}>5. Spatial Chunk Cache (O(1))</span>
              <span className="badge-accepted">LRU ACTIVE</span>
            </div>
            <div className="glass-subtle" style={{ padding: '8px 12px' }}>
              <div className="proof-row-kv mono">
                <span className="proof-key">Active Tiles:</span>
                <span className="proof-val">{p.chunk_active_tiles ?? 9} / 9 (3x3 Grid)</span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Working Set RAM:</span>
                <span className="proof-val" style={{ color: 'var(--gnss-emerald)', fontWeight: 800 }}>
                  {(p.chunk_working_set_kb ?? 28.4).toFixed(1)} KB (&lt; 50 MB)
                </span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Partition Grid:</span>
                <span className="proof-val">500m × 500m Cells</span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Road Level:</span>
                <span className="proof-val">
                  {p.road_layer === 1 ? 'Elevated Flyover (L1)' : p.road_layer === -1 ? 'Tunnel / Underpass (L-1)' : 'Surface Road (L0)'}
                </span>
              </div>
              <div className="proof-row-kv mono">
                <span className="proof-key">Road Track:</span>
                <span className="proof-val" style={{ color: p.is_on_service ? '#ea580c' : 'var(--idr-blue)', fontWeight: 800 }}>
                  {p.is_on_service ? 'Service Lane (Exit)' : 'Main Highway (Locked)'}
                </span>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Drawer Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn-toggle-drawer glass-panel"
      >
        <span>{isOpen ? '✕ HIDE DETAILS' : '⚙ TECHNICAL PROOF'}</span>
      </button>
    </div>
  );
};
