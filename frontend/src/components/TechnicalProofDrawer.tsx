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
    <div className="absolute bottom-8 right-6 z-[1000] pointer-events-auto select-none">
      {/* Drawer Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-panel px-4 py-2 text-xs font-bold tracking-wider text-slate-300 hover:text-white hover:border-white/30 flex items-center gap-2 transition-all shadow-lg"
      >
        <span>{isOpen ? '✕ HIDE DETAILS' : '⚙ TECHNICAL PROOF'}</span>
      </button>

      {/* Expanded Proof Card */}
      {isOpen && (
        <div className="glass-panel p-5 w-[380px] max-h-[480px] overflow-y-auto mt-2 flex flex-col gap-4 border border-white/15 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-xs font-black tracking-widest text-[#00d2ff] uppercase">
              PyTorch Engine Telemetry (10 Hz)
            </span>
            <span className="text-[10px] text-slate-400 mono">t = {telemetry.timestamp_s.toFixed(1)}s</span>
          </div>

          {/* 1. Raw IMU Channels */}
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-bold text-slate-400">1. RAW SENSOR CHANNELS (PHONE)</span>
            <div className="grid grid-cols-3 gap-1.5 text-[11px] mono">
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">ax (m/s²)</div>
                <div className="font-bold text-slate-200">{p.accel_mps2[0].toFixed(2)}</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">ay (m/s²)</div>
                <div className="font-bold text-slate-200">{p.accel_mps2[1].toFixed(2)}</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">az (m/s²)</div>
                <div className="font-bold text-slate-200">{p.accel_mps2[2].toFixed(2)}</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">gx (rad/s)</div>
                <div className="font-bold text-slate-200">{p.gyro_rads[0].toFixed(3)}</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">gy (rad/s)</div>
                <div className="font-bold text-slate-200">{p.gyro_rads[1].toFixed(3)}</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">gz (rad/s)</div>
                <div className="font-bold text-slate-200">{p.gyro_rads[2].toFixed(3)}</div>
              </div>
            </div>
          </div>

          {/* 2. Model Inference */}
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-bold text-slate-400">2. UNIVERSAL MOTION MODEL</span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] mono">
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">Pred Velocity</div>
                <div className="font-bold text-[#00f59b]">{p.pred_v_mps.toFixed(2)} m/s</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">Pred Yaw Rate</div>
                <div className="font-bold text-slate-200">{p.pred_wz_rads.toFixed(3)} rad/s</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">Stop Head Prob</div>
                <div className="font-bold text-slate-200">{(p.pred_stop_prob * 100).toFixed(0)}%</div>
              </div>
              <div className="glass-panel-subtle p-2">
                <div className="text-slate-500">State Covariance</div>
                <div className="font-bold text-[#00d2ff]">±{p.uncertainty_m.toFixed(1)} m</div>
              </div>
            </div>
          </div>

          {/* 3. Personalization Adapter */}
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="font-bold text-slate-400">3. ONLINE PERSONALIZATION</span>
            <div className="glass-panel-subtle p-2.5 text-[11px] mono flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Mount Euler:</span>
                <span className="font-bold text-slate-200">
                  [{p.mount_euler_deg[0]}°, {p.mount_euler_deg[1]}°, {p.mount_euler_deg[2]}°]
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Speed Multiplier (kv):</span>
                <span className="font-bold text-emerald-400">{p.speed_scale.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Yaw Response (kψ):</span>
                <span className="font-bold text-emerald-400">{p.yaw_scale.toFixed(4)}</span>
              </div>
            </div>
          </div>

          {/* 4. Map Hypothesis Gating */}
          <div className="flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-400">4. MAP HYPOTHESIS GATING</span>
              {blackout_active ? (
                p.map_accepted ? (
                  <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded font-black border border-emerald-500/30">
                    ACCEPTED
                  </span>
                ) : (
                  <span className="bg-amber-500/20 text-amber-400 text-[10px] px-2 py-0.5 rounded font-black border border-amber-500/30">
                    REJECTED (SAFE)
                  </span>
                )
              ) : (
                <span className="text-[10px] text-slate-500">STANDBY</span>
              )}
            </div>
            <div className="glass-panel-subtle p-2.5 text-[11px] mono flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Candidate Probability:</span>
                <span className="font-bold text-slate-200">{(p.map_best_prob * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cross-Track Residual:</span>
                <span className="font-bold text-slate-200">{p.map_cross_track_m.toFixed(2)} m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Heading Difference:</span>
                <span className="font-bold text-slate-200">{p.map_heading_diff_deg.toFixed(1)}°</span>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
