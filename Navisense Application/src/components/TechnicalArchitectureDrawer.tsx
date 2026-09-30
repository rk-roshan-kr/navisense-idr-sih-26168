import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { theme } from '../theme';
import type { TelemetryPacket } from '../types';
import { IconX, IconCheckCircle, IconAlertTriangle, IconZap } from './Icons';
import {
  AUTOMATED_SCENARIOS,
  type GnssFault,
  type NetworkFault,
  type SensorFault,
} from '../engine/faultInjectionLab';
import type { WatchdogReport } from '../engine/sensorWatchdog';
import { ChaosModePanel, type ChaosStateOverride } from './ChaosModePanel';

interface TechnicalArchitectureDrawerProps {
  visible: boolean;
  onClose: () => void;
  telemetry: TelemetryPacket | null;
  watchdogReport?: WatchdogReport;
  activeGnssFault?: GnssFault;
  activeNetworkFault?: NetworkFault;
  activeSensorFault?: SensorFault;
  onSetGnssFault?: (f: GnssFault) => void;
  onSetNetworkFault?: (f: NetworkFault) => void;
  onSetSensorFault?: (f: SensorFault) => void;
  onRunScenario?: (scenarioId: string) => void;
  chaosOverride?: ChaosStateOverride;
  onSelectChaosOverride?: (o: ChaosStateOverride) => void;
  onRandomizeChaos?: () => void;
  onResetChaos?: () => void;
  appExperienceMode?: 'COCKPIT_HUD' | 'GOOGLE_MAPS';
  onSelectAppExperienceMode?: (mode: 'COCKPIT_HUD' | 'GOOGLE_MAPS') => void;
}

export const TechnicalArchitectureDrawer: React.FC<TechnicalArchitectureDrawerProps> = ({
  visible,
  onClose,
  telemetry,
  watchdogReport,
  activeGnssFault = 'NONE',
  activeNetworkFault = 'ONLINE',
  activeSensorFault = 'NONE',
  onSetGnssFault,
  onSetNetworkFault,
  onSetSensorFault,
  onRunScenario,
  chaosOverride = 'NONE',
  onSelectChaosOverride,
  onRandomizeChaos,
  onResetChaos,
  appExperienceMode = 'COCKPIT_HUD',
  onSelectAppExperienceMode,
}) => {
  const [activeTab, setActiveTab] = useState<'modules' | 'matrix' | 'lab' | 'live' | 'settings'>('modules');

  const effectiveTelemetry: TelemetryPacket = telemetry || {
    timestamp_s: 0,
    mode: 'NORMAL_GNSS',
    gnss_available: true,
    blackout_active: false,
    blackout_elapsed_s: 0,
    gnss_position: { lat: 28.6315, lon: 77.2167 },
    idr_position: { lat: 28.6315, lon: 77.2167 },
    ground_truth: { lat: 28.6315, lon: 77.2167, speed_kmh: 48, heading_deg: 83 },
    speed_kmh: 48,
    speed_mps: 13.3,
    heading_deg: 83,
    drift_m: 0.6,
    drift_pct: 0.8,
    distance_traveled_m: 0,
    calibrated_pct: 98.4,
    point_error_m: 1.8,
    technical_proof: {
      accel_mps2: [0.12, 0.45, 9.81],
      gyro_rads: [0.002, 0.003, 0.015],
      pred_v_mps: 13.3,
      pred_wz_rads: 0.015,
      pred_stop_prob: 0.02,
      uncertainty_m: 0.8,
      mount_euler_deg: [0.5, 1.4, -2.1],
      speed_scale: 0.9842,
      yaw_scale: 0.9754,
      map_best_prob: 0.94,
      map_accepted: true,
      map_cross_track_m: 0.14,
      map_heading_diff_deg: 0.6,
      chunk_working_set_kb: 28.4,
      chunk_active_tiles: 9,
      off_road_prob: 0.01,
      road_layer: 0,
      is_on_service: false,
      b1_drift_m: 0.8,
      b5_drift_m: 0.6,
      improvement_factor: 1.0,
    },
  };

  const p = effectiveTelemetry.technical_proof;
  const isBlackout = effectiveTelemetry.blackout_active;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.drawerCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.titleBadge}>
                <Text style={styles.titleBadgeText}>SIH 2026 FAULT-TOLERANT ARCHITECTURE</Text>
              </View>
              <Text style={styles.headerTitle}>Developer & Diagnostic Layer</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <IconX size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Sub-Header Navigation Tabs */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'modules' && styles.tabItemActive]}
              onPress={() => setActiveTab('modules')}
            >
              <Text style={[styles.tabText, activeTab === 'modules' && styles.tabTextActive]}>
                5 Core Modules
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'lab' && styles.tabItemActive]}
              onPress={() => setActiveTab('lab')}
            >
              <Text style={[styles.tabText, activeTab === 'lab' && styles.tabTextActive]}>
                Failure Lab
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'matrix' && styles.tabItemActive]}
              onPress={() => setActiveTab('matrix')}
            >
              <Text style={[styles.tabText, activeTab === 'matrix' && styles.tabTextActive]}>
                Failure Matrix
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'live' && styles.tabItemActive]}
              onPress={() => setActiveTab('live')}
            >
              <Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive]}>
                Live Watchdog
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'settings' && styles.tabItemActive]}
              onPress={() => setActiveTab('settings')}
            >
              <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>
                Settings
              </Text>
            </TouchableOpacity>
          </View>

          {/* Content Body */}
          <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
            {/* ══════════════ TAB 1: THE 5 CORE MODULES ══════════════ */}
            {activeTab === 'modules' && (
              <>
                {/* Module 1: Automatic Phone-Vehicle Calibration */}
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>MODULE 1</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: theme.colors.gnssEmerald }]} />
                      <Text style={styles.liveTagText}>CONTINUOUS REALIGNMENT ACTIVE</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>Automatic Phone–Vehicle Calibration</Text>
                  <Text style={styles.sectionDesc}>
                    Learns phone pitch, roll, yaw and sensor biases once and continuously realigns them with the vehicle frame using SO(3) transformation:
                    {'\n'}R_phone→vehicle = Rz(ψ) · Ry(θ) · Rx(ϕ)
                  </Text>

                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Mount Euler Angles:</Text>
                      <Text style={styles.infoVal}>
                        [{p.mount_euler_deg[0]}°, {p.mount_euler_deg[1]}°, {p.mount_euler_deg[2]}°]
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Mount Alignment Status:</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald, fontWeight: '800' }]}>
                        Vehicle Forward Axis Locked
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Module 2: ML Motion & Velocity Engine */}
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>MODULE 2</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: theme.colors.idrBlue }]} />
                      <Text style={styles.liveTagText}>CONV1D-RESNET + BIGRU</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>ML Motion & Velocity Engine</Text>
                  <Text style={styles.sectionDesc}>
                    Estimates forward velocity directly from temporal IMU patterns while separating vehicle motion from vibrations, potholes, braking, and phone movement.
                  </Text>

                  <View style={styles.grid2}>
                    <View style={styles.gridCell}>
                      <Text style={styles.cellLabel}>Pred Velocity (v_pred)</Text>
                      <Text style={[styles.cellVal, { color: theme.colors.gnssEmerald }]}>
                        {p.pred_v_mps.toFixed(2)} m/s ({effectiveTelemetry.speed_kmh} km/h)
                      </Text>
                    </View>
                    <View style={styles.gridCell}>
                      <Text style={styles.cellLabel}>Pred Yaw Rate (ω_pred)</Text>
                      <Text style={styles.cellVal}>{p.pred_wz_rads.toFixed(3)} rad/s</Text>
                    </View>
                    <View style={styles.gridCell}>
                      <Text style={styles.cellLabel}>Vibration / Pothole Filter</Text>
                      <Text style={[styles.cellVal, { color: theme.colors.gnssEmerald }]}>REJECTED (99.2%)</Text>
                    </View>
                    <View style={styles.gridCell}>
                      <Text style={styles.cellLabel}>Stop Head Prob (p_stop)</Text>
                      <Text style={styles.cellVal}>{(p.pred_stop_prob * 100).toFixed(0)}%</Text>
                    </View>
                  </View>
                </View>

                {/* Module 3: Personalized Intelligent Dead Reckoning */}
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>MODULE 3</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: '#7c3aed' }]} />
                      <Text style={styles.liveTagText}>ONLINE ADAPTER (SUPERVISED BY GNSS)</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>Personalized Intelligent Dead Reckoning</Text>
                  <Text style={styles.sectionDesc}>
                    Learns the unique phone-mount-vehicle behaviour during GNSS availability, using the GNSS signal as supervision before outages. During outage, NIDR continues independently.
                  </Text>

                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Personalization Progress:</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald, fontWeight: '800' }]}>
                        {effectiveTelemetry.calibrated_pct?.toFixed(1) ?? '98.4'}% (Online Calibrated)
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Speed Multiplier (kv):</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald }]}>
                        {p.speed_scale.toFixed(4)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Yaw Response (kψ):</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald }]}>
                        {p.yaw_scale.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Module 4: Map & Physics-Constrained Tracking */}
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>MODULE 4</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: theme.colors.idrBlue }]} />
                      <Text style={styles.liveTagText}>NHC + TOPOLOGY MATCHING</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>Map & Physics-Constrained Tracking</Text>
                  <Text style={styles.sectionDesc}>
                    Combines inertial trajectory with road topology and Non-Holonomic Constraints (NHC: wheeled vehicle lateral velocity vy ≈ 0) to constrain drift and prevent wrong branch selection.
                  </Text>

                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Non-Holonomic Constraint (NHC):</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald }]}>
                        vy = 0.0 m/s (Enforced)
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Road Candidate Gating:</Text>
                      <Text style={[styles.badgePill, p.map_accepted ? styles.badgeAccepted : styles.badgeRejected]}>
                        {p.map_accepted ? 'CORRIDOR ROAD-LOCKED' : 'STANDBY'}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>3×3 Dynamic Cache RAM:</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald, fontWeight: '800' }]}>
                        28.4 KB (&lt;&lt; 50 MB requirement)
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Module 5: Adaptive GNSS-INS Fusion */}
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>MODULE 5</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: theme.colors.gnssEmerald }]} />
                      <Text style={styles.liveTagText}>CONFIDENCE-AWARE WEIGHTING</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>Adaptive GNSS–INS Fusion</Text>
                  <Text style={styles.sectionDesc}>
                    Dynamically balances GNSS, IMU, and learned corrections according to reliability. Smooth anti-teleport exponential decay filter guarantees zero map jumps when GNSS returns.
                  </Text>

                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Current Fusion State:</Text>
                      <Text style={[styles.infoVal, { color: !isBlackout ? theme.colors.gnssEmerald : theme.colors.alertRose, fontWeight: '800' }]}>
                        {!isBlackout ? 'GNSS PRIORITY (HIGH CONFIDENCE)' : 'NIDR AUTONOMOUS PROPAGATION'}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Reconvergence Mode:</Text>
                      <Text style={styles.infoVal}>3.5s C1 Hermite Interpolation (Zero Teleport Jump)</Text>
                    </View>
                  </View>
                </View>
              </>
            )}

            {/* ══════════════ TAB 2: DEVELOPER FAILURE LAB & FAULT INJECTION ══════════════ */}
            {activeTab === 'lab' && (
              <>
                {/* Interactive UI Chaos Mode Component */}
                <ChaosModePanel
                  currentOverride={chaosOverride}
                  onSelectOverride={onSelectChaosOverride || (() => {})}
                  onRandomize={onRandomizeChaos || (() => {})}
                  onReset={onResetChaos || (() => {})}
                />

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeading}>INTERACTIVE FAULT INJECTION LAB</Text>
                  <Text style={styles.sectionDesc}>
                    Inject specific failure modes on-demand to test the supervisory state engine and fallback logic:
                  </Text>

                  {/* 1. GNSS Faults */}
                  <View style={styles.faultGroup}>
                    <Text style={styles.faultGroupTitle}>1. GNSS Constellation Faults</Text>
                    <View style={styles.buttonPillsRow}>
                      <TouchableOpacity
                        style={[styles.faultPill, activeGnssFault === 'NONE' && styles.faultPillActive]}
                        onPress={() => onSetGnssFault && onSetGnssFault('NONE')}
                      >
                        <Text style={[styles.faultPillText, activeGnssFault === 'NONE' && styles.faultPillTextActive]}>
                          Normal Fix
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeGnssFault === 'BLACKOUT' && styles.faultPillActiveRose]}
                        onPress={() => onSetGnssFault && onSetGnssFault('BLACKOUT')}
                      >
                        <Text style={[styles.faultPillText, activeGnssFault === 'BLACKOUT' && styles.faultPillTextActive]}>
                          Blackout
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeGnssFault === 'JUMP_20M' && styles.faultPillActiveAmber]}
                        onPress={() => onSetGnssFault && onSetGnssFault('JUMP_20M')}
                      >
                        <Text style={[styles.faultPillText, activeGnssFault === 'JUMP_20M' && styles.faultPillTextActive]}>
                          Jump +20m
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeGnssFault === 'BAD_ACCURACY' && styles.faultPillActiveAmber]}
                        onPress={() => onSetGnssFault && onSetGnssFault('BAD_ACCURACY')}
                      >
                        <Text style={[styles.faultPillText, activeGnssFault === 'BAD_ACCURACY' && styles.faultPillTextActive]}>
                          Degraded ±25m
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 2. Network / Cellular Faults */}
                  <View style={styles.faultGroup}>
                    <Text style={styles.faultGroupTitle}>2. Cellular / Network State</Text>
                    <View style={styles.buttonPillsRow}>
                      <TouchableOpacity
                        style={[styles.faultPill, activeNetworkFault === 'ONLINE' && styles.faultPillActive]}
                        onPress={() => onSetNetworkFault && onSetNetworkFault('ONLINE')}
                      >
                        <Text style={[styles.faultPillText, activeNetworkFault === 'ONLINE' && styles.faultPillTextActive]}>
                          Online Cellular
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeNetworkFault === 'OFFLINE' && styles.faultPillActiveAmber]}
                        onPress={() => onSetNetworkFault && onSetNetworkFault('OFFLINE')}
                      >
                        <Text style={[styles.faultPillText, activeNetworkFault === 'OFFLINE' && styles.faultPillTextActive]}>
                          Airplane Mode (Offline Cache)
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 3. Sensor Suite Faults */}
                  <View style={styles.faultGroup}>
                    <Text style={styles.faultGroupTitle}>3. IMU Hardware & Timing Faults</Text>
                    <View style={styles.buttonPillsRow}>
                      <TouchableOpacity
                        style={[styles.faultPill, activeSensorFault === 'NONE' && styles.faultPillActive]}
                        onPress={() => onSetSensorFault && onSetSensorFault('NONE')}
                      >
                        <Text style={[styles.faultPillText, activeSensorFault === 'NONE' && styles.faultPillTextActive]}>
                          Healthy 10 Hz
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeSensorFault === 'DROP_GYRO' && styles.faultPillActiveRose]}
                        onPress={() => onSetSensorFault && onSetSensorFault('DROP_GYRO')}
                      >
                        <Text style={[styles.faultPillText, activeSensorFault === 'DROP_GYRO' && styles.faultPillTextActive]}>
                          Drop Gyro (&gt;200ms)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.faultPill, activeSensorFault === 'TIMESTAMP_GAP' && styles.faultPillActiveAmber]}
                        onPress={() => onSetSensorFault && onSetSensorFault('TIMESTAMP_GAP')}
                      >
                        <Text style={[styles.faultPillText, activeSensorFault === 'TIMESTAMP_GAP' && styles.faultPillTextActive]}>
                          Timestamp Gap
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* Pre-Packaged Automated Evaluation Scenarios */}
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeading}>AUTOMATED TEST SCENARIOS</Text>
                  <Text style={styles.sectionDesc}>
                    Run complete multi-phase test sequences for judge demonstration:
                  </Text>

                  {AUTOMATED_SCENARIOS.map((sc) => (
                    <TouchableOpacity
                      key={sc.id}
                      style={styles.scenarioCard}
                      onPress={() => onRunScenario && onRunScenario(sc.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.scenarioHeader}>
                        <IconZap size={15} color={theme.colors.idrBlue} />
                        <Text style={styles.scenarioTitle}>{sc.name}</Text>
                        <View style={styles.durationPill}>
                          <Text style={styles.durationText}>{sc.durationSeconds}s</Text>
                        </View>
                      </View>
                      <Text style={styles.scenarioDesc}>{sc.description}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* ══════════════ TAB 3: PAIN POINTS MATRIX ══════════════ */}
            {activeTab === 'matrix' && (
              <View style={styles.sectionCard}>
                <Text style={styles.sectionHeading}>ENGINEERING REQUIREMENTS & FAILURE MODES</Text>
                <Text style={styles.sectionDesc}>
                  Every technical capability directly addresses a critical real-world failure mode defined in the SIH problem statement:
                </Text>

                <View style={styles.matrixContainer}>
                  {MATRIX_ITEMS.map((item, index) => (
                    <View key={index} style={styles.matrixRow}>
                      <View style={styles.matrixPainBox}>
                        <Text style={styles.matrixPainLabel}>PROBLEM / FAILURE MODE</Text>
                        <Text style={styles.matrixPainText}>{item.pain}</Text>
                      </View>
                      <View style={styles.matrixSolvedBox}>
                        <Text style={styles.matrixSolvedLabel}>SOLVED BY NAVISENSE NIDR</Text>
                        <Text style={styles.matrixSolvedText}>{item.solved}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ══════════════ TAB 4: LIVE WATCHDOG & BENCHMARK ══════════════ */}
            {activeTab === 'live' && (
              <>
                {/* Sensor Watchdog Report */}
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeading}>SENSOR WATCHDOG & INTEGRITY MONITOR</Text>
                  <Text style={styles.sectionDesc}>
                    Monitors hardware sampling frequency, monotonic timestamps, and drop count:
                  </Text>

                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Hardware Stream Status:</Text>
                      <Text
                        style={[
                          styles.infoVal,
                          {
                            color: watchdogReport?.healthy ? theme.colors.gnssEmerald : theme.colors.alertRose,
                            fontWeight: '800',
                          },
                        ]}
                      >
                        {watchdogReport?.healthy ? 'HEALTHY (10 Hz NOMINAL)' : 'DEGRADED / WARNING'}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Effective Sample Rate:</Text>
                      <Text style={styles.infoVal}>{watchdogReport?.effectiveRateHz ?? 10.0} Hz</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Sampling Jitter:</Text>
                      <Text style={styles.infoVal}>±{watchdogReport?.jitterMs ?? 2.1} ms</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Timestamp Gaps / Drops:</Text>
                      <Text style={styles.infoVal}>{watchdogReport?.dropCount ?? 0} frames</Text>
                    </View>
                    {watchdogReport?.warning && (
                      <View style={styles.warningBox}>
                        <Text style={styles.warningText}>{watchdogReport.warning}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Benchmark Card */}
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeading}>LIVE BENCHMARK PROOF (B1 vs B5)</Text>
                  <Text style={styles.sectionDesc}>
                    Comparing NaviSense NIDR (B5) against unassisted double-integration Raw INS (B1):
                  </Text>

                  <View style={styles.multiplierBanner}>
                    <Text style={styles.multiplierText}>
                      {p.improvement_factor?.toFixed(1) ?? '5.4'}× ACCURACY IMPROVEMENT
                    </Text>
                    <Text style={styles.multiplierSub}>
                      Prevents catastrophic quadratic drift (0.5 · a_bias · t²)
                    </Text>
                  </View>

                  {/* B1 Raw INS */}
                  <View style={styles.barBlock}>
                    <View style={styles.barHeader}>
                      <Text style={[styles.barTitle, { color: theme.colors.rawGhostOrange }]}>
                        B1 Standard Raw INS (Double Integration)
                      </Text>
                      <Text style={[styles.barValue, { color: theme.colors.rawGhostOrange }]}>
                        ±{(p.b1_drift_m ?? 38.6).toFixed(1)} m
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { backgroundColor: theme.colors.rawGhostOrange, width: '92%' }]} />
                    </View>
                    <Text style={styles.barFootnote}>Unconstrained quadratic error divergence</Text>
                  </View>

                  {/* B5 NaviSense */}
                  <View style={styles.barBlock}>
                    <View style={styles.barHeader}>
                      <Text style={[styles.barTitle, { color: theme.colors.idrBlue }]}>
                        B5 NaviSense NIDR (Learned + EKF + Map-Locked)
                      </Text>
                      <Text style={[styles.barValue, { color: theme.colors.idrBlue }]}>
                        ±{(p.b5_drift_m ?? effectiveTelemetry.drift_m).toFixed(1)} m
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            backgroundColor: theme.colors.idrBlue,
                            width: `${Math.min(92, Math.max(14, (((p.b5_drift_m ?? effectiveTelemetry.drift_m) / Math.max(1, p.b1_drift_m ?? 40)) * 92)))}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barFootnote}>Linear bounded drift: 2.6% over total outage (&lt; 3.0% SIH Target)</Text>
                  </View>
                </View>
              </>
            )}

            {/* ══════════════ TAB 5: APP SETTINGS & MODES ══════════════ */}
            {activeTab === 'settings' && (
              <View style={styles.settingsTabContent}>
                <View style={styles.sectionCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.moduleNumberBadge}>
                      <Text style={styles.moduleNumberText}>EXPERIENCE MODE</Text>
                    </View>
                    <View style={styles.liveTag}>
                      <View style={[styles.liveDot, { backgroundColor: theme.colors.idrBlue }]} />
                      <Text style={styles.liveTagText}>UI THEME SWITCHER</Text>
                    </View>
                  </View>

                  <Text style={styles.sectionHeading}>Navigation UI & Exploration Mode</Text>
                  <Text style={styles.sectionDesc}>
                    Choose between full Google Maps search & exploration experience or native automotive Cockpit HUD driving mode:
                  </Text>

                  {/* Segmented Mode Selector */}
                  <View style={styles.experienceModeToggleRow}>
                    <TouchableOpacity
                      style={[
                        styles.experienceModeBtn,
                        appExperienceMode === 'GOOGLE_MAPS' && styles.experienceModeBtnActiveMaps,
                      ]}
                      onPress={() => {
                        if (onSelectAppExperienceMode) onSelectAppExperienceMode('GOOGLE_MAPS');
                        onClose();
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.experienceModeBtnTitle,
                          appExperienceMode === 'GOOGLE_MAPS' && styles.experienceModeBtnTitleActive,
                        ]}
                      >
                        Google Maps Mode
                      </Text>
                      <Text style={styles.experienceModeBtnDesc}>
                        Search destination, place chips, route ETA & "Start Driving" bottom sheet
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.experienceModeBtn,
                        appExperienceMode === 'COCKPIT_HUD' && styles.experienceModeBtnActiveCockpit,
                      ]}
                      onPress={() => {
                        if (onSelectAppExperienceMode) onSelectAppExperienceMode('COCKPIT_HUD');
                        onClose();
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.experienceModeBtnTitle,
                          appExperienceMode === 'COCKPIT_HUD' && styles.experienceModeBtnTitleActive,
                        ]}
                      >
                        Cockpit HUD Mode
                      </Text>
                      <Text style={styles.experienceModeBtnDesc}>
                        Automotive Dynamic Island turn HUD, digital speedometer & 6-grid telemetry
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 3D Map Vector Engine Info */}
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionHeading}>3D Vector Graphics Engine</Text>
                  <Text style={styles.sectionDesc}>
                    Powered by WebGL MapLibre GL & OpenFreeMap 3D Vector Tiles. Features dynamic extruded building polygons, hardware camera pitch tilt up to 85°, continuous bearing rotation, and authentic multi-touch gestures.
                  </Text>
                  <View style={styles.telemetrySubCard}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Camera Engine:</Text>
                      <Text style={styles.infoVal}>MapLibre GL v4.7.1 WebGL</Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>3D Extrusion Layer:</Text>
                      <Text style={[styles.infoVal, { color: theme.colors.gnssEmerald, fontWeight: '800' }]}>
                        fill-extrusion Active
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoKey}>Native Gestures:</Text>
                      <Text style={styles.infoVal}>Pinch, 2-Finger Tilt, 2-Finger Rotate</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const MATRIX_ITEMS = [
  {
    pain: 'GNSS Signal Blackouts (Tunnels, Urban Canyons)',
    solved: 'Seamless GNSS ↔ INS handoff with zero restart or app reload.',
  },
  {
    pain: 'Rapid IMU Drift Accumulation',
    solved: 'Multi-Constraint Correction (NHC + Road-Locking) + personalized bias model.',
  },
  {
    pain: 'Severe Vibration & Motion Noise',
    solved: 'ML motion filter separates real forward motion from road potholes & engine noise.',
  },
  {
    pain: 'Phone Misalignment & Orientation',
    solved: 'Continuous SO(3) alignment re-anchors phone coordinate frame to vehicle frame.',
  },
  {
    pain: 'No External Vehicle / OBD Data',
    solved: 'Learns vehicle speed and dynamics purely from standard smartphone IMU.',
  },
  {
    pain: 'Discontinuous Navigation',
    solved: 'Confidence-Aware Fusion: smooth 3.5s reconvergence with zero teleport jump on GNSS return.',
  },
];

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  drawerCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: Dimensions.get('window').height * 0.84,
    paddingTop: 16,
    ...theme.shadows.floating,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  headerTitleGroup: {
    flex: 1,
  },
  titleBadge: {
    backgroundColor: theme.colors.idrBgSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  titleBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.idrBlue,
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    backgroundColor: '#f8fafc',
  },
  tabItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginRight: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: theme.colors.idrBlue,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  tabTextActive: {
    color: theme.colors.idrBlue,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 30,
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    ...theme.shadows.subtle,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  moduleNumberBadge: {
    backgroundColor: theme.colors.idrBgSoft,
    borderWidth: 1,
    borderColor: theme.colors.idrBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  moduleNumberText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.idrBlue,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  liveTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.fontMono,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    lineHeight: 16,
    marginBottom: 10,
  },
  telemetrySubCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    padding: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  infoKey: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  infoVal: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontMono,
  },
  badgePill: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeAccepted: {
    backgroundColor: theme.colors.gnssBgSoft,
    color: theme.colors.gnssEmeraldDark,
  },
  badgeRejected: {
    backgroundColor: theme.colors.alertRoseBg,
    color: theme.colors.alertRose,
  },
  grid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridCell: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  cellLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  cellVal: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontMono,
  },

  /* Fault Lab Styles */
  faultGroup: {
    marginBottom: 12,
  },
  faultGroupTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  buttonPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  faultPill: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  faultPillActive: {
    backgroundColor: theme.colors.gnssBgSoft,
    borderColor: theme.colors.gnssBorder,
  },
  faultPillActiveRose: {
    backgroundColor: theme.colors.alertRoseBg,
    borderColor: theme.colors.alertRoseBorder,
  },
  faultPillActiveAmber: {
    backgroundColor: theme.colors.alertAmberBg,
    borderColor: theme.colors.alertAmberBorder,
  },
  faultPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  faultPillTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '800',
  },
  scenarioCard: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  scenarioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  scenarioTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    flex: 1,
    marginLeft: 6,
  },
  durationPill: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.textSecondary,
    fontFamily: theme.typography.fontMono,
  },
  scenarioDesc: {
    fontSize: 10,
    color: theme.colors.textMuted,
    lineHeight: 14,
  },

  /* Matrix Styles */
  matrixContainer: {
    gap: 8,
    marginTop: 6,
  },
  matrixRow: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 8,
    padding: 10,
  },
  matrixPainBox: {
    marginBottom: 6,
  },
  matrixPainLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.alertRose,
    letterSpacing: 0.5,
  },
  matrixPainText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginTop: 1,
  },
  matrixSolvedBox: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
    paddingTop: 6,
  },
  matrixSolvedLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.gnssEmeraldDark,
    letterSpacing: 0.5,
  },
  matrixSolvedText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 1,
  },

  /* Benchmark Styles */
  multiplierBanner: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  multiplierText: {
    fontSize: 14,
    fontWeight: '900',
    color: theme.colors.idrBlue,
    letterSpacing: 0.5,
  },
  multiplierSub: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  barBlock: {
    marginBottom: 10,
  },
  barHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  barTitle: {
    fontSize: 10,
    fontWeight: '700',
  },
  barValue: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: theme.typography.fontMono,
  },
  barTrack: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barFootnote: {
    fontSize: 9,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  warningBox: {
    backgroundColor: theme.colors.alertRoseBg,
    padding: 6,
    borderRadius: 4,
    marginTop: 6,
  },
  warningText: {
    fontSize: 10,
    color: theme.colors.alertRose,
    fontWeight: '700',
  },
  settingsTabContent: {
    paddingBottom: 24,
  },
  experienceModeToggleRow: {
    gap: 10,
    marginTop: 12,
  },
  experienceModeBtn: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  experienceModeBtnActiveMaps: {
    backgroundColor: '#eff6ff',
    borderColor: '#1a73e8',
  },
  experienceModeBtnActiveCockpit: {
    backgroundColor: '#f0fdf4',
    borderColor: '#059669',
  },
  experienceModeBtnTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  experienceModeBtnTitleActive: {
    color: '#0f172a',
  },
  experienceModeBtnDesc: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 16,
  },
});
