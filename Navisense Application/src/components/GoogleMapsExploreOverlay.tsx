import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Keyboard,
} from 'react-native';
import {
  IconSearch,
  IconX,
  IconNavigation,
  IconMapPin,
  IconCompass,
  IconPlay,
  IconPause,
  IconVolume2,
  IconVolumeX,
  IconArrowUp,
  IconTurnRight,
  IconTurnLeft,
  IconCheckCircle,
  IconSatelliteOff,
  IconEye,
} from './Icons';
import { PRESET_ROUTES } from '../utils/customRouteSimulator';
import type { TelemetryPacket } from '../types';

interface GoogleMapsExploreOverlayProps {
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onStartDriving: () => void;
  onStopDriving?: () => void;
  isNavigating?: boolean;
  telemetry?: TelemetryPacket | null;
  isBlackout?: boolean;
  onToggleBlackout?: () => void;
  onSwitchToCockpitHud: () => void;
  onOpenSettings: () => void;
  isLandscape?: boolean;
  destinationCoord?: [number, number] | null;
  originCoord?: [number, number] | null;
  onClearRoute?: () => void;
  isAudioMuted?: boolean;
  onToggleAudioMuted?: () => void;
  showGhostBaseline?: boolean;
  onToggleGhostBaseline?: () => void;
}

export const GoogleMapsExploreOverlay: React.FC<GoogleMapsExploreOverlayProps> = ({
  selectedPresetId,
  onSelectPreset,
  onStartDriving,
  onStopDriving,
  isNavigating = false,
  telemetry,
  isBlackout = false,
  onToggleBlackout,
  onSwitchToCockpitHud,
  onOpenSettings,
  isLandscape = false,
  destinationCoord,
  originCoord,
  onClearRoute,
  isAudioMuted = false,
  onToggleAudioMuted,
  showGhostBaseline = false,
  onToggleGhostBaseline,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];

  const destinationTitle = destinationCoord
    ? `Custom Pin (${destinationCoord[0].toFixed(4)}°, ${destinationCoord[1].toFixed(4)}°)`
    : activePreset.name.split('➔')[1]?.trim() ||
      activePreset.name.split(':')[1]?.trim() ||
      activePreset.name;

  const originTitle = originCoord
    ? `Point (${originCoord[0].toFixed(4)}°, ${originCoord[1].toFixed(4)}°)`
    : activePreset.name.split('➔')[0]?.split(':')[0]?.trim() || 'My Location';

  // Derived in-navigation values
  const distTravelledM = telemetry?.distance_traveled_m ?? 0;
  const totalDistM = activePreset.distanceKm * 1000;
  const remainingM = Math.max(100, totalDistM - distTravelledM);
  const remainingKm = (remainingM / 1000).toFixed(1);
  const speedKmh = Math.round(telemetry?.speed_kmh ?? 48);
  const etaMinutes = Math.max(1, Math.round((remainingM / 1000 / Math.max(15, speedKmh)) * 60));
  const blackoutElapsedS = telemetry?.blackout_elapsed_s ?? 0;
  const errorMargin = telemetry?.point_error_m ?? 2.1;

  // Clock ETA
  const now = new Date();
  now.setMinutes(now.getMinutes() + etaMinutes);
  const clockEta = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  // Next maneuver calculation
  const nextTurnM = Math.max(50, 450 - (Math.floor(distTravelledM) % 450));
  const maneuverCycle = Math.floor(distTravelledM / 450) % 3;

  // Search filter
  const queryLower = searchQuery.toLowerCase().trim();
  const filteredPresets = PRESET_ROUTES.filter(
    (r) =>
      r.name.toLowerCase().includes(queryLower) ||
      r.city.toLowerCase().includes(queryLower) ||
      r.id.toLowerCase().includes(queryLower)
  );

  // -------------------------------------------------------------
  // STATE A: ACTIVE IN-APP GOOGLE MAPS NAVIGATION HUD
  // -------------------------------------------------------------
  if (isNavigating) {
    return (
      <View style={styles.container} pointerEvents="box-none">
        {/* 1. Top Turn-by-Turn Instruction Banner (Google Maps Emerald Green #065f46) */}
        <View style={[styles.navTopContainer, isLandscape && styles.navTopLandscape]} pointerEvents="box-none">
          <View style={styles.navTurnCard}>
            <View style={styles.navTurnMainRow}>
              {/* Maneuver Arrow Circle */}
              <View style={styles.turnIconWrap}>
                {maneuverCycle === 1 ? (
                  <IconTurnRight size={26} color="#ffffff" />
                ) : maneuverCycle === 2 ? (
                  <IconTurnLeft size={26} color="#ffffff" />
                ) : (
                  <IconArrowUp size={26} color="#ffffff" />
                )}
              </View>

              {/* Maneuver Texts */}
              <View style={styles.turnTextCol}>
                <Text style={styles.turnDistText}>In {nextTurnM} m</Text>
                <Text style={styles.turnActionText} numberOfLines={1}>
                  {maneuverCycle === 1
                    ? 'Turn right onto Connaught Outer Cir'
                    : maneuverCycle === 2
                    ? 'Turn left towards Corridor Expressway'
                    : `Continue along ${activePreset.name.split(':')[0]}`}
                </Text>
                <Text style={styles.turnSubText} numberOfLines={1}>
                  Navisense IDR Dead-Reckoning Active • Autonomous Corridor Follow
                </Text>
              </View>
            </View>

            {/* Sub-bar: GNSS / IDR Status Chip + Ghost IMU Toggle */}
            <View style={styles.navTurnSubBar}>
              {isBlackout ? (
                <View style={styles.gnssBadgeOutage}>
                  <View style={styles.redDotPulse} />
                  <IconSatelliteOff size={13} color="#fca5a5" />
                  <Text style={styles.gnssBadgeOutageText}>
                    IDR TUNNEL MODE • T+{blackoutElapsedS.toFixed(1)}s (±{errorMargin.toFixed(1)}m)
                  </Text>
                </View>
              ) : (
                <View style={styles.gnssBadgeNormal}>
                  <View style={styles.greenDotPulse} />
                  <IconCheckCircle size={13} color="#34d399" />
                  <Text style={styles.gnssBadgeNormalText}>
                    GPS 3D FIX LOCKED • High Precision Fusion (±{errorMargin.toFixed(1)}m)
                  </Text>
                </View>
              )}

              {onToggleGhostBaseline && (
                <TouchableOpacity
                  style={[styles.ghostToggleBtn, showGhostBaseline && styles.ghostToggleBtnActive]}
                  onPress={onToggleGhostBaseline}
                  activeOpacity={0.8}
                >
                  <IconEye size={12} color={showGhostBaseline ? '#ffffff' : '#94a3b8'} />
                  <Text
                    style={[
                      styles.ghostToggleText,
                      showGhostBaseline && styles.ghostToggleTextActive,
                    ]}
                  >
                    GHOST B1
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Floating Trajectory Color Legend Pill */}
          <View style={styles.trajectoryLegendPill}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#1a73e8' }]} />
              <Text style={styles.legendText}>Route</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#00e5ff' }]} />
              <Text style={styles.legendText}>IDR Active</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
              <Text style={styles.legendText}>GNSS Sat</Text>
            </View>
            {showGhostBaseline && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#f97316' }]} />
                <Text style={styles.legendText}>Raw IMU</Text>
              </View>
            )}
          </View>
        </View>

        {/* 2. Bottom In-App Google Maps Navigation Bar */}
        <View style={[styles.navBottomBar, isLandscape && styles.navBottomBarLandscape]}>
          {/* Left: ETA, Remaining Km, Speed */}
          <View style={styles.navEtaCol}>
            <View style={styles.navEtaTopRow}>
              <Text style={styles.navEtaGreen}>{etaMinutes} min</Text>
              <View style={styles.speedPill}>
                <Text style={styles.speedPillText}>{speedKmh} km/h</Text>
              </View>
            </View>
            <Text style={styles.navRemainingText}>
              {remainingKm} km • Arrival {clockEta}
            </Text>
          </View>

          {/* Right Action Controls */}
          <View style={styles.navActionsRow}>
            {/* Outage Toggle (Simulate Blackout / Restore GPS) */}
            {onToggleBlackout && (
              <TouchableOpacity
                style={[
                  styles.blackoutNavBtn,
                  isBlackout ? styles.blackoutNavBtnActive : styles.blackoutNavBtnNormal,
                ]}
                onPress={onToggleBlackout}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.blackoutNavBtnText,
                    isBlackout && styles.blackoutNavBtnTextActive,
                  ]}
                >
                  {isBlackout ? 'RESTORE GNSS' : 'BLACKOUT'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Audio Mute/Unmute */}
            {onToggleAudioMuted && (
              <TouchableOpacity
                style={styles.navIconBtn}
                onPress={onToggleAudioMuted}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isAudioMuted ? (
                  <IconVolumeX size={18} color="#94a3b8" />
                ) : (
                  <IconVolume2 size={18} color="#1a73e8" />
                )}
              </TouchableOpacity>
            )}

            {/* Instant Mode Switch to Automotive Cockpit HUD */}
            <TouchableOpacity
              style={styles.navHudSwitchBtn}
              onPress={onSwitchToCockpitHud}
              activeOpacity={0.8}
            >
              <IconNavigation size={13} color="#38bdf8" />
              <Text style={styles.navHudSwitchText}>HUD</Text>
            </TouchableOpacity>

            {/* Stop / End Navigation Button */}
            <TouchableOpacity
              style={styles.navEndBtn}
              onPress={onStopDriving || onStartDriving}
              activeOpacity={0.8}
            >
              <IconX size={16} color="#ffffff" />
              <Text style={styles.navEndBtnText}>END</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------
  // STATE B: GOOGLE MAPS EXPLORE & ROUTE PREVIEW
  // -------------------------------------------------------------
  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* 1. Google Maps Search & Quick Filter Chips (Top) */}
      <View style={[styles.topSection, isLandscape && styles.topSectionLandscape]} pointerEvents="box-none">
        {/* Floating Google Maps Search Bar */}
        <View style={styles.searchBar}>
          <View style={styles.searchIconWrap}>
            <IconSearch size={20} color="#1a73e8" />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search destination, corridor or highway..."
            placeholderTextColor="#70757a"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => {
                setSearchQuery('');
                Keyboard.dismiss();
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <IconX size={18} color="#5f6368" />
            </TouchableOpacity>
          )}

          {/* Audio Mute / Unmute Button */}
          {onToggleAudioMuted && (
            <TouchableOpacity
              style={styles.audioMuteBtn}
              onPress={onToggleAudioMuted}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isAudioMuted ? (
                <IconVolumeX size={17} color="#94a3b8" />
              ) : (
                <IconVolume2 size={17} color="#1a73e8" />
              )}
            </TouchableOpacity>
          )}

          {/* Switch to Cockpit HUD Profile Badge */}
          <TouchableOpacity
            style={styles.modeSwitchBadge}
            onPress={onSwitchToCockpitHud}
            activeOpacity={0.8}
          >
            <Text style={styles.modeSwitchText}>HUD</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Destination Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
          style={styles.chipsContainer}
        >
          {PRESET_ROUTES.map((route) => {
            const isSelected = route.id === selectedPresetId;
            return (
              <TouchableOpacity
                key={route.id}
                style={[styles.chip, isSelected && styles.chipActive]}
                onPress={() => {
                  onSelectPreset(route.id);
                  setSearchQuery('');
                  Keyboard.dismiss();
                }}
                activeOpacity={0.7}
              >
                <IconMapPin size={13} color={isSelected ? '#ffffff' : '#ea4335'} />
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                  {route.name.split(':')[0]} ({route.distanceKm} km)
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Search Results Dropdown (if user is typing) */}
        {searchQuery.length > 0 && (
          <View style={styles.searchResultsCard}>
            {filteredPresets.length > 0 ? (
              filteredPresets.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.searchResultItem}
                  onPress={() => {
                    onSelectPreset(r.id);
                    setSearchQuery('');
                    Keyboard.dismiss();
                  }}
                >
                  <IconMapPin size={16} color="#ea4335" />
                  <View style={styles.searchResultInfo}>
                    <Text style={styles.searchResultTitle}>{r.name}</Text>
                    <Text style={styles.searchResultSubtitle}>
                      {r.distanceKm} km • {r.city} • OpenFreeMap 3D Vector Corridor
                    </Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={[styles.searchResultItem, { paddingVertical: 12 }]}>
                <IconSearch size={16} color="#94a3b8" />
                <View style={styles.searchResultInfo}>
                  <Text style={[styles.searchResultTitle, { color: '#64748b' }]}>
                    No offline corridor matches "{searchQuery}"
                  </Text>
                  <Text style={styles.searchResultSubtitle}>
                    Select Delhi, Bangalore, or Chandigarh, or tap START DRIVING
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </View>

      {/* 2. Google Maps Route Bottom Sheet */}
      <View style={[styles.bottomSheet, isLandscape && styles.bottomSheetLandscape]}>
        {/* Destination & ETA Row */}
        <View style={styles.sheetHeaderRow}>
          <View style={styles.sheetTitleCol}>
            <View style={styles.etaBadgeRow}>
              <View style={styles.greenEtaPill}>
                <Text style={styles.greenEtaText}>
                  {Math.round(activePreset.distanceKm * 1.2)} min
                </Text>
              </View>
              <Text style={styles.distanceText}>({activePreset.distanceKm} km)</Text>
              <Text style={styles.fastestRouteText}>• Fastest route</Text>
              {destinationCoord && onClearRoute && (
                <TouchableOpacity onPress={onClearRoute} style={styles.clearPinBtn}>
                  <Text style={styles.clearPinText}>CLEAR PIN</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.destName} numberOfLines={1}>
              {destinationTitle}
            </Text>
            <Text style={styles.routeViaText} numberOfLines={1}>
              From {originTitle} • Navisense IDR Ready (GNSS Blackout Resilient)
            </Text>
          </View>

          {/* Compass / Recenter mini icon */}
          <TouchableOpacity
            style={styles.settingsMiniBtn}
            onPress={onOpenSettings}
            activeOpacity={0.8}
          >
            <IconCompass size={20} color="#1a73e8" />
          </TouchableOpacity>
        </View>

        {/* Feature Pills */}
        <View style={styles.featureRow}>
          <View style={styles.featurePill}>
            <View style={[styles.featureDot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.featureText}>3D Buildings Extruded</Text>
          </View>
          <View style={styles.featurePill}>
            <View style={[styles.featureDot, { backgroundColor: '#2563eb' }]} />
            <Text style={styles.featureText}>Dual AI Dead-Reckoning</Text>
          </View>
          <View style={styles.featurePill}>
            <View style={[styles.featureDot, { backgroundColor: '#f59e0b' }]} />
            <Text style={styles.featureText}>Multi-Trajectory Visualizer</Text>
          </View>
        </View>

        {/* Google Maps Primary "START DRIVING" Button */}
        <View style={styles.sheetActionsRow}>
          <TouchableOpacity
            style={styles.startDrivingBtn}
            onPress={onStartDriving}
            activeOpacity={0.85}
          >
            <IconNavigation size={20} color="#ffffff" />
            <Text style={styles.startDrivingBtnText}>START DRIVING</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.hudQuickBtn}
            onPress={onSwitchToCockpitHud}
            activeOpacity={0.8}
          >
            <Text style={styles.hudQuickBtnText}>COCKPIT HUD</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    justifyContent: 'space-between',
  },
  topSection: {
    paddingTop: Platform.OS === 'android' ? 10 : 16,
    paddingHorizontal: 12,
  },
  topSectionLandscape: {
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%',
  },

  /* Google Maps Search Bar */
  searchBar: {
    backgroundColor: '#ffffff',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e8eaed',
  },
  searchIconWrap: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#202124',
    fontWeight: '500',
    paddingVertical: 0,
  },
  iconBtn: {
    padding: 6,
    marginLeft: 4,
  },
  modeSwitchBadge: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 6,
  },
  modeSwitchText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  audioMuteBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  clearPinBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  clearPinText: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#b91c1c',
    letterSpacing: 0.4,
  },

  /* Quick Destination Chips */
  chipsContainer: {
    marginTop: 8,
  },
  chipsScroll: {
    gap: 8,
    paddingRight: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dadce0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  chipActive: {
    backgroundColor: '#1a73e8',
    borderColor: '#1a73e8',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3c4043',
  },
  chipTextActive: {
    color: '#ffffff',
  },

  /* Search Results Card */
  searchResultsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    marginTop: 8,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#e8eaed',
    maxHeight: 220,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#202124',
  },
  searchResultSubtitle: {
    fontSize: 10.5,
    color: '#70757a',
    marginTop: 2,
  },

  /* Google Maps Bottom Sheet */
  bottomSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'android' ? 16 : 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e8eaed',
  },
  bottomSheetLandscape: {
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
    borderRadius: 22,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sheetTitleCol: {
    flex: 1,
    marginRight: 10,
  },
  etaBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  greenEtaPill: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  greenEtaText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#137333',
  },
  distanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5f6368',
  },
  fastestRouteText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#188038',
  },
  destName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#202124',
    letterSpacing: -0.2,
  },
  routeViaText: {
    fontSize: 11.5,
    color: '#5f6368',
    marginTop: 2,
  },
  settingsMiniBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f3f4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  featureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  featureText: {
    fontSize: 10.5,
    color: '#475569',
    fontWeight: '600',
  },
  sheetActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  startDrivingBtn: {
    flex: 1,
    backgroundColor: '#1a73e8',
    borderRadius: 24,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  startDrivingBtnText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  hudQuickBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    height: 48,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  hudQuickBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  /* -------------------------------------------------------------
     IN-APP GOOGLE MAPS NAVIGATION HUD STYLING
     ------------------------------------------------------------- */
  navTopContainer: {
    paddingTop: Platform.OS === 'android' ? 10 : 16,
    paddingHorizontal: 12,
  },
  navTopLandscape: {
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%',
  },
  navTurnCard: {
    backgroundColor: '#065f46',
    borderRadius: 18,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#047857',
  },
  navTurnMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  turnIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#10b981',
  },
  turnTextCol: {
    flex: 1,
  },
  turnDistText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -0.3,
  },
  turnActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 1,
  },
  turnSubText: {
    fontSize: 10.5,
    color: '#a7f3d0',
    marginTop: 2,
    fontWeight: '500',
  },
  navTurnSubBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  gnssBadgeNormal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10b981',
  },
  greenDotPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  gnssBadgeNormalText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#d1fae5',
  },
  gnssBadgeOutage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  redDotPulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  gnssBadgeOutageText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fecaca',
  },
  ghostToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  ghostToggleBtnActive: {
    backgroundColor: '#f97316',
    borderColor: '#ea580c',
  },
  ghostToggleText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#cbd5e1',
    letterSpacing: 0.4,
  },
  ghostToggleTextActive: {
    color: '#ffffff',
  },

  /* Trajectory Legend Floating Pill */
  trajectoryLegendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#e2e8f0',
  },

  /* Bottom In-App Navigation Bar */
  navBottomBar: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 14 : 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e8eaed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navBottomBarLandscape: {
    maxWidth: 620,
    alignSelf: 'center',
    width: '100%',
    borderRadius: 22,
    marginBottom: 8,
    borderBottomWidth: 1,
  },
  navEtaCol: {
    flex: 1,
    marginRight: 10,
  },
  navEtaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navEtaGreen: {
    fontSize: 22,
    fontWeight: '900',
    color: '#059669',
    letterSpacing: -0.3,
  },
  speedPill: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  speedPillText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#38bdf8',
  },
  navRemainingText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
  },
  navActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blackoutNavBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  blackoutNavBtnNormal: {
    backgroundColor: '#0f172a',
    borderColor: '#dc2626',
  },
  blackoutNavBtnActive: {
    backgroundColor: '#dc2626',
    borderColor: '#b91c1c',
  },
  blackoutNavBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#ef4444',
    letterSpacing: 0.4,
  },
  blackoutNavBtnTextActive: {
    color: '#ffffff',
  },
  navIconBtn: {
    padding: 7,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navHudSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#334155',
  },
  navHudSwitchText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#38bdf8',
    letterSpacing: 0.4,
  },
  navEndBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ef4444',
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  navEndBtnText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
});
