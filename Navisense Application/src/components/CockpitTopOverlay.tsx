import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { theme } from '../theme';
import { IconChevronDown, IconX, IconCheckCircle, IconCompass } from './Icons';
import { PRESET_ROUTES } from '../utils/customRouteSimulator';
import type { TelemetryPacket } from '../types';
import type { ChaosStateOverride } from './ChaosModePanel';
import { formatHeading, formatSafeText } from '../utils/formatters';

interface CockpitTopOverlayProps {
  telemetry: TelemetryPacket | null;
  isPlaying: boolean;
  isBlackout: boolean;
  blackoutElapsedS: number;
  onTogglePlay: () => void;
  onClearPoints: () => void;
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  isLiveCarMode?: boolean;
  onToggleLiveCarMode?: (enableLive: boolean) => void;
  roadName?: string;
  customOrigin?: [number, number] | null;
  customDestination?: [number, number] | null;
  chaosOverride?: ChaosStateOverride;
  isLandscape?: boolean;
}

export const CockpitTopOverlay: React.FC<CockpitTopOverlayProps> = ({
  telemetry,
  isPlaying,
  isBlackout,
  blackoutElapsedS,
  onTogglePlay,
  onClearPoints,
  selectedPresetId,
  onSelectPreset,
  isLiveCarMode = false,
  onToggleLiveCarMode,
  roadName = 'Connaught Place',
  customOrigin,
  customDestination,
  isLandscape = false,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];
  const originCoord = customOrigin || activePreset.origin;
  const destCoord = customDestination || activePreset.destination;

  // Derived Display Values
  const currentSpeed = telemetry?.speed_kmh ?? 0;
  const currentHeading = telemetry?.heading_deg ?? 354;
  const formattedHeading = formatHeading(currentHeading);
  const currentLat = telemetry?.idr_position?.lat ?? originCoord[0];
  const currentLon = telemetry?.idr_position?.lon ?? originCoord[1];
  const errorMargin = telemetry?.point_error_m ?? 1.3;
  const driftRate = telemetry?.drift_pct ?? (isBlackout ? 1.2 : 0.0);
  const elapsedOutage = isBlackout ? blackoutElapsedS : 0.0;
  const timerDisplay = `T+${(telemetry?.blackout_elapsed_s ?? 18.2).toFixed(1)}s`;

  const corridorTitle = isLiveCarMode
    ? 'Real Vehicle Highway (Live Road Navigation)'
    : `${activePreset.name.split(':')[0]} ➔ ${activePreset.name.split('➔')[1] || activePreset.name.split(':')[1] || 'Gateway'} (${activePreset.distanceKm} km)`;

  return (
    <View style={isLandscape ? styles.landscapeContainer : styles.container} pointerEvents="box-none">
      {/* 1. Floating Top Header Card */}
      <View style={styles.topCard}>
        {/* Brand & Subtitle */}
        <View style={styles.headerSubRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>NAVISENSE IDR</Text>
        </View>

        {/* Corridor Title Dropdown Trigger */}
        <TouchableOpacity
          style={styles.corridorTitleRow}
          onPress={() => setDropdownOpen(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.corridorTitleText} numberOfLines={1}>
            {corridorTitle}
          </Text>
          <IconChevronDown size={18} color="#475569" />
        </TouchableOpacity>

        {/* Red / Green GNSS Outage Status Banner */}
        <View
          style={[
            styles.outageBanner,
            isBlackout ? styles.outageBannerActive : styles.outageBannerNormal,
          ]}
        >
          <Text
            style={[
              styles.outageBannerText,
              isBlackout ? styles.outageBannerTextActive : styles.outageBannerTextNormal,
            ]}
            numberOfLines={1}
          >
            {isBlackout
              ? 'GNSS SIGNAL LOST — NAVISENSE IDR ACTIVE'
              : '● ALL SYSTEMS OPTIMAL — HIGH PRECISION GNSS FIX'}
          </Text>
          <Text
            style={[
              styles.outageElapsedText,
              isBlackout ? styles.outageElapsedTextActive : styles.outageElapsedTextNormal,
            ]}
          >
            {isBlackout ? `${elapsedOutage.toFixed(1)}s outage` : '0.0s outage'}
          </Text>
        </View>
      </View>

      {/* 2. Side-by-Side Floating Cards */}
      <View style={styles.cardsRow} pointerEvents="box-none">
        {/* Left Card: CORRIDOR PLANNER */}
        <View style={styles.cardLeft}>
          <Text style={styles.cardTitle}>CORRIDOR PLANNER</Text>
          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {isLiveCarMode
              ? 'Live road navigation active. Using hardware GPS & 50Hz phone IMU.'
              : `${activePreset.name.split(':')[0]} loaded. Click START SIMULATION to begin navigation!`}
          </Text>

          {/* Point A / Origin */}
          <View style={styles.pointRow}>
            <View style={[styles.pointDot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.pointLabel}>POINT A / ORIGIN</Text>
          </View>
          <Text style={styles.pointCoord}>
            {originCoord[0].toFixed(5)}°, {originCoord[1].toFixed(5)}°
          </Text>

          {/* Point B / Destination */}
          <View style={[styles.pointRow, { marginTop: 4 }]}>
            <View style={[styles.pointDot, { backgroundColor: '#2563eb' }]} />
            <Text style={styles.pointLabel}>POINT B / DESTINATION</Text>
          </View>
          <Text style={styles.pointCoord}>
            {destCoord[0].toFixed(5)}°, {destCoord[1].toFixed(5)}°
          </Text>

          {/* Preset Corridors Picker */}
          <Text style={styles.presetPickerLabel}>PRESET CORRIDORS:</Text>
          <TouchableOpacity
            style={styles.presetPickerButton}
            onPress={() => setDropdownOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.presetPickerText} numberOfLines={1}>
              {isLiveCarMode ? 'Live Car Drive' : activePreset.name.split(':')[0]}
            </Text>
            <IconChevronDown size={14} color="#64748b" />
          </TouchableOpacity>

          {/* Action Buttons: Pause / Start + Clear */}
          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              style={[styles.pauseBtn, !isPlaying && styles.startBtn]}
              onPress={onTogglePlay}
              activeOpacity={0.8}
            >
              <Text style={styles.pauseBtnText}>
                {isPlaying ? 'PAUSE NAVIGATION' : 'START NAVIGATION'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.clearBtn}
              onPress={onClearPoints}
              activeOpacity={0.8}
            >
              <Text style={styles.clearBtnText}>CLEAR</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Right Card: TELEMETRY / IDR METRICS DECK */}
        <View style={styles.cardRight}>
          {/* Badge & Monospace Timer */}
          <View style={styles.telemetryTopRow}>
            <View
              style={[
                styles.telemetryBadge,
                isBlackout ? styles.badgeOutage : styles.badgeNormal,
              ]}
            >
              <View
                style={[
                  styles.badgeDot,
                  { backgroundColor: isBlackout ? '#ef4444' : '#10b981' },
                ]}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: isBlackout ? '#0284c7' : '#059669' },
                ]}
              >
                {isBlackout ? 'IDR ACTIVE (OUTAGE)' : 'GNSS ACTIVE (FIXED)'}
              </Text>
            </View>
            <Text style={styles.timerText}>{timerDisplay}</Text>
          </View>

          {/* Massive Speed Display */}
          <View style={styles.speedSection}>
            <Text style={styles.speedNumber}>{currentSpeed.toFixed(1)}</Text>
            <Text style={styles.speedUnit}>KM / H</Text>
          </View>

          {/* 6-Grid Telemetry Metrics */}
          <View style={styles.metricsGrid}>
            {/* Row 1: GPS FIX | IDR EST */}
            <View style={styles.metricRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>GPS FIX</Text>
                <Text
                  style={[
                    styles.metricValue,
                    { color: isBlackout ? '#dc2626' : '#16a34a' },
                  ]}
                >
                  {isBlackout ? 'DENIED' : 'LOCKED'}
                </Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>IDR EST</Text>
                <Text style={styles.metricValueSmall} numberOfLines={1}>
                  {currentLat.toFixed(5)}°, {currentLon.toFixed(5)}°
                </Text>
              </View>
            </View>

            {/* Row 2: HEADING | ERROR MARGIN */}
            <View style={styles.metricRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>HEADING</Text>
                <Text style={styles.metricValue}>{formattedHeading.full}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>ERROR MARGIN</Text>
                <Text style={styles.metricValue}>±{errorMargin.toFixed(1)}m</Text>
              </View>
            </View>

            {/* Row 3: CALIBRATED | DRIFT RATE */}
            <View style={styles.metricRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>CALIBRATED</Text>
                <Text style={styles.metricValue}>95.0% (Custom)</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>DRIFT RATE</Text>
                <Text
                  style={[
                    styles.metricValue,
                    { color: isBlackout && driftRate > 0 ? '#dc2626' : '#1e293b' },
                  ]}
                >
                  {driftRate.toFixed(1)}%
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Corridor Selection & Dual-Mode Modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.modalContainer} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Mission Corridor & Mode</Text>
              <TouchableOpacity onPress={() => setDropdownOpen(false)}>
                <IconX size={20} color="#0f172a" />
              </TouchableOpacity>
            </View>

            {/* Segmented Dual-Mode Toggle */}
            <View style={styles.dualModeContainer}>
              <TouchableOpacity
                style={[styles.dualModeTab, !isLiveCarMode && styles.dualModeTabActive]}
                onPress={() => {
                  if (onToggleLiveCarMode) onToggleLiveCarMode(false);
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.dualModeTabText,
                    !isLiveCarMode && styles.dualModeTabTextActive,
                  ]}
                >
                  🎮 BENCHMARK SIM
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dualModeTab, isLiveCarMode && styles.dualModeTabActiveLive]}
                onPress={() => {
                  if (onToggleLiveCarMode) onToggleLiveCarMode(true);
                  setDropdownOpen(false);
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.dualModeTabText,
                    isLiveCarMode && styles.dualModeTabTextActive,
                  ]}
                >
                  🚗 LIVE CAR DRIVE
                </Text>
              </TouchableOpacity>
            </View>

            {isLiveCarMode ? (
              <View style={styles.liveCarInfoCard}>
                <View style={styles.liveCarIconRow}>
                  <IconCompass size={22} color="#16a34a" />
                  <Text style={styles.liveCarTitle}>Live Vehicle Telemetry Active</Text>
                </View>
                <Text style={styles.liveCarDesc}>
                  The app is reading your phone's real GNSS chipset and 50Hz motion IMU.
                  Place your phone securely on the vehicle dashboard mount and drive on any real road!
                </Text>
                <TouchableOpacity
                  style={styles.liveCarActionBtn}
                  onPress={() => setDropdownOpen(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.liveCarActionBtnText}>RESUME LIVE NAVIGATION</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={styles.corridorList}>
                {PRESET_ROUTES.map((route) => {
                  const isSelected = route.id === selectedPresetId;
                  return (
                    <TouchableOpacity
                      key={route.id}
                      style={[styles.routeItem, isSelected && styles.routeItemSelected]}
                      onPress={() => {
                        onSelectPreset(route.id);
                        if (onToggleLiveCarMode) onToggleLiveCarMode(false);
                        setDropdownOpen(false);
                      }}
                    >
                      <View style={styles.routeItemInfo}>
                        <Text
                          style={[
                            styles.routeItemName,
                            isSelected && styles.routeItemNameSelected,
                          ]}
                        >
                          {route.name}
                        </Text>
                        <Text style={styles.routeItemMeta}>
                          {route.distanceKm} km • {route.city}
                        </Text>
                      </View>
                      {isSelected && <IconCheckCircle size={18} color="#2563eb" />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 6,
    left: 8,
    right: 8,
    zIndex: 100,
  },
  landscapeContainer: {
    position: 'absolute',
    top: 6,
    left: 8,
    width: 380,
    zIndex: 100,
  },
  landscapeCardsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  topCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  brandDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#2563eb',
  },
  brandText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1e293b',
    letterSpacing: 0.8,
  },
  corridorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  corridorTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    marginRight: 6,
  },
  outageBanner: {
    marginTop: 6,
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  outageBannerActive: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  outageBannerNormal: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  outageBannerText: {
    fontSize: 10.5,
    fontWeight: '800',
    flex: 1,
  },
  outageBannerTextActive: {
    color: '#dc2626',
  },
  outageBannerTextNormal: {
    color: '#16a34a',
  },
  outageElapsedText: {
    fontSize: 9.5,
    fontWeight: '700',
    marginLeft: 6,
  },
  outageElapsedTextActive: {
    color: '#ef4444',
  },
  outageElapsedTextNormal: {
    color: '#10b981',
  },

  // 2-Column Floating Cards
  cardsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  cardLeft: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 10.5,
    fontWeight: '900',
    color: '#334155',
    letterSpacing: 0.5,
  },
  cardSubtitle: {
    fontSize: 8,
    color: '#64748b',
    lineHeight: 11,
    marginTop: 2,
    marginBottom: 6,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pointDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pointLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748b',
  },
  pointCoord: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0f172a',
    marginLeft: 11,
    marginTop: 1,
  },
  presetPickerLabel: {
    fontSize: 7.5,
    fontWeight: '800',
    color: '#64748b',
    marginTop: 6,
    marginBottom: 2,
  },
  presetPickerButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
  },
  presetPickerText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
  },
  pauseBtn: {
    flex: 2,
    backgroundColor: '#09131f',
    borderRadius: 16,
    paddingVertical: 5.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtn: {
    backgroundColor: '#2563eb',
  },
  pauseBtnText: {
    color: '#ffffff',
    fontSize: 8.5,
    fontWeight: '800',
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 5.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    color: '#475569',
    fontSize: 8.5,
    fontWeight: '800',
  },

  // Right Telemetry Deck Card
  cardRight: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  telemetryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  telemetryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  badgeOutage: {
    backgroundColor: '#e0f2fe',
  },
  badgeNormal: {
    backgroundColor: '#dcfce7',
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  timerText: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#64748b',
    fontVariant: ['tabular-nums'],
  },
  speedSection: {
    alignItems: 'center',
    marginVertical: 1,
  },
  speedNumber: {
    fontSize: 32,
    fontWeight: '900',
    color: '#09131f',
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
  speedUnit: {
    fontSize: 8,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1,
  },
  metricsGrid: {
    marginTop: 4,
    gap: 3,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricCell: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 7,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#0f172a',
  },
  metricValueSmall: {
    fontSize: 8,
    fontWeight: '800',
    color: '#0f172a',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  dualModeContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
    gap: 4,
  },
  dualModeTab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  dualModeTabActive: {
    backgroundColor: '#09131f',
  },
  dualModeTabActiveLive: {
    backgroundColor: '#16a34a',
  },
  dualModeTabText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
  },
  dualModeTabTextActive: {
    color: '#ffffff',
  },
  liveCarInfoCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  liveCarIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  liveCarTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },
  liveCarDesc: {
    fontSize: 11,
    color: '#15803d',
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 12,
  },
  liveCarActionBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  liveCarActionBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  corridorList: {
    maxHeight: 280,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#f8fafc',
  },
  routeItemSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
    borderWidth: 1,
  },
  routeItemInfo: {
    flex: 1,
  },
  routeItemName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1e293b',
  },
  routeItemNameSelected: {
    color: '#2563eb',
  },
  routeItemMeta: {
    fontSize: 10.5,
    color: '#64748b',
    marginTop: 2,
  },
});
