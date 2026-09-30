import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { theme } from '../theme';
import {
  IconArrowUp,
  IconAlertTriangle,
  IconChevronDown,
  IconX,
  IconCheckCircle,
  IconCompass,
} from './Icons';
import { PRESET_ROUTES } from '../utils/customRouteSimulator';
import type { TelemetryPacket } from '../types';
import type { ChaosStateOverride } from './ChaosModePanel';
import { formatAccuracy, formatSafeText } from '../utils/formatters';

interface TopBarProps {
  isConnected: boolean;
  isPlaying: boolean;
  isBlackout: boolean;
  blackoutElapsedS: number;
  onTogglePlay: () => void;
  onReset: () => void;
  showGhostBaseline: boolean;
  onToggleGhostBaseline: () => void;
  onStartAutoDemo: () => void;
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  telemetry?: TelemetryPacket | null;
  roadName?: string;
  chaosOverride?: ChaosStateOverride;
  isLiveCarMode?: boolean;
  onToggleLiveCarMode?: (enableLive: boolean) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  isBlackout,
  blackoutElapsedS,
  selectedPresetId,
  onSelectPreset,
  telemetry,
  roadName = 'Connaught Place',
  chaosOverride = 'NONE',
  isLiveCarMode = false,
  onToggleLiveCarMode,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];

  // Robust formatted strings
  const displayRoad = formatSafeText(roadName, activePreset.name.split(':')[0], 40);
  const rawPointError = chaosOverride === 'NULL_DATA' ? null : telemetry?.point_error_m ?? 2.8;
  const formattedAccuracy = formatAccuracy(rawPointError);
  const rawDrift = chaosOverride === 'HIGH_UNCERTAINTY'
    ? 128.4
    : chaosOverride === 'NULL_DATA'
    ? null
    : telemetry?.drift_m ?? 0;
  const formattedUncertainty = formatAccuracy(rawDrift !== null && rawDrift > 0 ? rawDrift : (rawDrift === null ? null : 1.1));

  return (
    <View style={styles.floatingWrapper} pointerEvents="box-none">
      {/* ── FLOATING APPLE MAPS TURN-BY-TURN HUD CARD ── */}
      <TouchableOpacity
        style={[
          styles.turnCard,
          isBlackout && styles.turnCardBlackout,
          isLiveCarMode && !isBlackout && styles.turnCardLiveCar,
        ]}
        onPress={() => setDropdownOpen(true)}
        activeOpacity={0.88}
        accessibilityLabel="Navigation Mode & Route Selection"
      >
        {/* Left: Maneuver Icon Capsule */}
        <View
          style={[
            styles.maneuverCapsule,
            isBlackout && styles.maneuverCapsuleBlackout,
            isLiveCarMode && !isBlackout && styles.maneuverCapsuleLiveCar,
          ]}
        >
          {isBlackout ? (
            <IconAlertTriangle size={22} color="#ffffff" />
          ) : isLiveCarMode ? (
            <IconCompass size={22} color={theme.colors.idrBlue} />
          ) : (
            <IconArrowUp size={22} color={theme.colors.gnssEmerald} />
          )}
        </View>

        {/* Center: Turn Instructions & Route Context */}
        <View style={styles.instructionBlock}>
          {!isBlackout ? (
            !isLiveCarMode ? (
              <>
                <View style={styles.primaryRow}>
                  <Text style={styles.distanceCallout}>In 350 m</Text>
                  <Text style={styles.maneuverPrimary} numberOfLines={1}>
                    Continue straight
                  </Text>
                </View>
                <Text style={styles.roadSubtitle} numberOfLines={1}>
                  {displayRoad} ➔ {activePreset.name.split('➔')[1]?.trim() || 'Destination'}
                </Text>
              </>
            ) : (
              <>
                <View style={styles.primaryRow}>
                  <Text style={styles.liveCarCallout}>LIVE CAR DRIVE</Text>
                  <Text style={styles.liveCarPrimary} numberOfLines={1}>
                    Real Phone GPS Active
                  </Text>
                </View>
                <Text style={styles.roadSubtitle} numberOfLines={1}>
                  Tracking live vehicle motion via 50Hz phone IMU
                </Text>
              </>
            )
          ) : (
            <>
              <View style={styles.primaryRow}>
                <Text style={styles.blackoutCallout}>GNSS LOST</Text>
                <Text style={styles.blackoutPrimary} numberOfLines={1}>
                  {isLiveCarMode ? 'REAL NIDR TRACKING' : 'NIDR DEAD RECKONING'}
                </Text>
              </View>
              <Text style={styles.blackoutSubtitle} numberOfLines={1}>
                Outage: {blackoutElapsedS.toFixed(1)}s • Drift: {formattedUncertainty}
              </Text>
            </>
          )}
        </View>

        {/* Right: Real-time Status Badge & Dropdown Trigger */}
        <View style={styles.badgeSection}>
          <View
            style={[
              styles.statusPill,
              isBlackout && styles.statusPillBlackout,
              isLiveCarMode && !isBlackout && styles.statusPillLiveCar,
            ]}
          >
            <View
              style={[
                styles.statusPulseDot,
                isBlackout && styles.statusPulseDotBlackout,
                isLiveCarMode && !isBlackout && styles.statusPulseDotLiveCar,
              ]}
            />
            <Text
              style={[
                styles.statusText,
                isBlackout && styles.statusTextBlackout,
                isLiveCarMode && !isBlackout && styles.statusTextLiveCar,
              ]}
              numberOfLines={1}
            >
              {!isBlackout ? (isLiveCarMode ? 'REAL GPS' : 'GNSS') : 'IDR'}
            </Text>
          </View>
          <View style={styles.accuracyTag}>
            <Text
              style={[
                styles.accuracyText,
                isBlackout && styles.accuracyTextBlackout,
                isLiveCarMode && !isBlackout && styles.accuracyTextLiveCar,
              ]}
            >
              {!isBlackout ? formattedAccuracy : `±${(rawDrift || 1.1).toFixed(1)}m`}
            </Text>
          </View>
          <IconChevronDown size={14} color={isBlackout ? '#94a3b8' : theme.colors.textMuted} />
        </View>
      </TouchableOpacity>

      {/* Corridor & Dual-Mode Selection Modal Sheet */}
      <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalSub}>NAVIGATION OPERATION MODE</Text>
                <Text style={styles.modalTitle}>Choose Mode & Track</Text>
              </View>
              <TouchableOpacity onPress={() => setDropdownOpen(false)} style={styles.modalCloseBtn}>
                <IconX size={18} color={theme.colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* ── DUAL MODE SELECTOR SEGMENT ── */}
            <View style={styles.modeSegmentWrap}>
              <TouchableOpacity
                style={[styles.segmentBtn, !isLiveCarMode && styles.segmentBtnActive]}
                onPress={() => onToggleLiveCarMode && onToggleLiveCarMode(false)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, !isLiveCarMode && styles.segmentTextActive]}>
                  🎮 BENCHMARK SIM
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, isLiveCarMode && styles.segmentBtnLiveActive]}
                onPress={() => {
                  if (onToggleLiveCarMode) onToggleLiveCarMode(true);
                  setDropdownOpen(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, isLiveCarMode && styles.segmentTextLiveActive]}>
                  LIVE CAR DRIVE
                </Text>
              </TouchableOpacity>
            </View>

            {/* Mode Description Banner */}
            <View style={[styles.modeInfoBox, isLiveCarMode && styles.modeInfoBoxLive]}>
              <Text style={[styles.modeInfoTitle, isLiveCarMode && styles.modeInfoTitleLive]}>
                {isLiveCarMode
                  ? 'REAL CAR DRIVE ACTIVE'
                  : 'HACKATHON BENCHMARK SIMULATOR ACTIVE'}
              </Text>
              <Text style={styles.modeInfoDesc}>
                {isLiveCarMode
                  ? 'Streaming live hardware GPS coordinates and 50Hz accelerometer/gyroscope measurements from this phone on real roads.'
                  : 'Deterministic automotive simulation along pre-calibrated tracks with standardized blackout zones for judge evaluation.'}
              </Text>
            </View>

            {/* Benchmark Track List (Available in Simulator Mode) */}
            <Text style={styles.sectionHeader}>
              {isLiveCarMode ? 'BENCHMARK TRACKS (TAP TO SWITCH TO SIM)' : 'EVALUATION CORRIDORS'}
            </Text>

            <ScrollView style={styles.corridorList}>
              {PRESET_ROUTES.map((item) => {
                const isSelected = !isLiveCarMode && selectedPresetId === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.corridorOption,
                      isSelected && styles.corridorOptionSelected,
                    ]}
                    onPress={() => {
                      if (onToggleLiveCarMode) onToggleLiveCarMode(false);
                      onSelectPreset(item.id);
                      setDropdownOpen(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.corridorInfo}>
                      <Text
                        style={[
                          styles.optionName,
                          isSelected && styles.optionTextSelected,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.optionCity}>
                        {item.city} • {item.distanceKm} km • GNSS Lockdown zone at {Math.round(item.lockdown[0] * 100)}%
                      </Text>
                    </View>
                    {isSelected && <IconCheckCircle size={18} color={theme.colors.idrBlue} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  floatingWrapper: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 50,
  },
  // Apple Maps Turn-by-Turn Card
  turnCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  turnCardLiveCar: {
    borderColor: '#93c5fd',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
  },
  turnCardBlackout: {
    backgroundColor: '#0f172a',
    borderColor: '#f43f5e',
    borderWidth: 1.5,
  },
  // Left: Maneuver Icon Capsule
  maneuverCapsule: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  maneuverCapsuleLiveCar: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  maneuverCapsuleBlackout: {
    backgroundColor: '#e11d48',
    borderColor: '#f43f5e',
  },
  // Center: Text Group
  instructionBlock: {
    flex: 1,
    marginRight: 8,
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  distanceCallout: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.gnssEmerald,
  },
  maneuverPrimary: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    flex: 1,
  },
  liveCarCallout: {
    fontSize: 12,
    fontWeight: '900',
    color: theme.colors.idrBlue,
    letterSpacing: 0.3,
  },
  liveCarPrimary: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    flex: 1,
  },
  roadSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  blackoutCallout: {
    fontSize: 12,
    fontWeight: '900',
    color: '#fda4af',
    letterSpacing: 0.4,
  },
  blackoutPrimary: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    flex: 1,
  },
  blackoutSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
  },
  // Right: Badge & Dropdown
  badgeSection: {
    alignItems: 'flex-end',
    gap: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    gap: 4,
  },
  statusPillLiveCar: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  statusPillBlackout: {
    backgroundColor: '#4c0519',
    borderColor: '#f43f5e',
  },
  statusPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.gnssEmerald,
  },
  statusPulseDotLiveCar: {
    backgroundColor: theme.colors.idrBlue,
  },
  statusPulseDotBlackout: {
    backgroundColor: '#f43f5e',
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.gnssEmerald,
    letterSpacing: 0.4,
  },
  statusTextLiveCar: {
    color: theme.colors.idrBlue,
  },
  statusTextBlackout: {
    color: '#fda4af',
  },
  accuracyTag: {
    marginTop: 1,
  },
  accuracyText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  accuracyTextLiveCar: {
    color: theme.colors.idrBlue,
  },
  accuracyTextBlackout: {
    color: '#94a3b8',
  },
  // Modal Sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '82%',
    padding: 18,
    ...theme.shadows.card,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  modalSub: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.idrBlue,
    letterSpacing: 0.8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  // Mode Segmented Control
  modeSegmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentBtnLiveActive: {
    backgroundColor: theme.colors.idrBlue,
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 0.3,
  },
  segmentTextActive: {
    color: theme.colors.textPrimary,
  },
  segmentTextLiveActive: {
    color: '#ffffff',
  },
  // Mode Info Callout
  modeInfoBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 12,
  },
  modeInfoBoxLive: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  modeInfoTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.slateDark,
    marginBottom: 3,
  },
  modeInfoTitleLive: {
    color: theme.colors.idrBlue,
  },
  modeInfoDesc: {
    fontSize: 10.5,
    color: theme.colors.textMuted,
    lineHeight: 15,
  },
  sectionHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 2,
  },
  corridorList: {
    maxHeight: 250,
  },
  corridorOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    marginBottom: 8,
    backgroundColor: '#f8fafc',
  },
  corridorOptionSelected: {
    backgroundColor: theme.colors.idrBgSoft,
    borderColor: theme.colors.idrBlue,
  },
  corridorInfo: {
    flex: 1,
    marginRight: 8,
  },
  optionName: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  optionTextSelected: {
    color: theme.colors.idrBlue,
  },
  optionCity: {
    fontSize: 10,
    color: theme.colors.textMuted,
  },
});
