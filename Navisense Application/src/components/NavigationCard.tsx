import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { theme } from '../theme';
import type { TelemetryPacket } from '../types';
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconArrowUp,
  IconActivity,
  IconLayers,
  IconRotateCcw,
  IconRadio,
  IconShieldAlert,
  IconZap,
  IconPlay,
  IconPause,
} from './Icons';
import {
  formatDistance,
  formatSpeed,
  formatHeading,
  formatEta,
  formatAccuracy,
  formatDriftPct,
  formatSafeText,
} from '../utils/formatters';
import type { ChaosStateOverride } from './ChaosModePanel';
import { RobustButton } from './RobustButton';
import { ControlledStatusBadge } from './ControlledStatusBadge';
import { mapToTriLayerError } from '../utils/nativeErrorMapper';
import { STRINGS } from '../i18n/strings';

interface NavigationCardProps {
  telemetry: TelemetryPacket | null;
  totalDistanceKm?: number;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onToggleBlackout: () => void;
  onOpenDiagnostics: () => void;
  onOpenRoutePlanner: () => void;
  onStartAutoDemo?: () => void;
  onReset?: () => void;
  roadName?: string;
  chaosOverride?: ChaosStateOverride;
  onRetryRoute?: () => void;
}

export const NavigationCard: React.FC<NavigationCardProps> = ({
  telemetry,
  totalDistanceKm = 15.5,
  isPlaying = false,
  onTogglePlay,
  onToggleBlackout,
  onOpenDiagnostics,
  onOpenRoutePlanner,
  onStartAutoDemo,
  onReset,
  roadName = 'MG Road Corridor',
  chaosOverride = 'NONE',
  onRetryRoute,
}) => {
  const handleSafeAction = (action?: () => void) => {
    if (action) {
      action();
    }
  };

  // ══════════════ 1. CHAOS / EDGE-CASE STATE EVALUATION ══════════════

  // 1. LOADING STATE (Requirement 1 & 25)
  if (chaosOverride === 'LOADING') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color={theme.colors.idrBlue} />
          <Text style={styles.loadingTitle}>Preparing Offline Navigation</Text>
          <Text style={styles.loadingSub}>Verifying 3×3 spatial tile cache & universal motion net weights...</Text>
        </View>
      </View>
    );
  }

  // 2. READY STATE (Requirement 1)
  if (chaosOverride === 'READY') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.readyBox}>
          <View style={styles.readyHeaderRow}>
            <ControlledStatusBadge status="ROUTE READY" size="sm" />
            <Text style={styles.readyDistText}>15.5 km Corridor</Text>
          </View>
          <Text style={styles.readyTitle}>Connaught Place ➔ Aerocity Gateway</Text>
          <Text style={styles.readyDesc}>Preflight checklist passed. All vehicle sensor streams calibrated.</Text>
          <RobustButton
            label="COMMENCE NAVIGATION"
            onPress={() => handleSafeAction(onToggleBlackout)}
            variant="primary"
          />
        </View>
      </View>
    );
  }

  // 3. EMPTY STATES (Requirement 3)
  if (chaosOverride === 'EMPTY_DESTINATION') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.emptyStateBox}>
          <Text style={styles.emptyStateHeader}>Destination</Text>
          <Text style={styles.emptyStateTitle}>{STRINGS.navigation.noDestination}</Text>
          <Text style={styles.emptyStateDesc}>Select an evaluation road corridor or pick Point A and Point B.</Text>
          <RobustButton
            label={STRINGS.navigation.selectDestination}
            icon={<IconLayers size={16} color="#ffffff" />}
            onPress={() => handleSafeAction(onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  if (chaosOverride === 'EMPTY_ROUTE') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.emptyStateBox}>
          <Text style={styles.emptyStateTitle}>{STRINGS.navigation.noRoute}</Text>
          <Text style={styles.emptyStateDesc}>{STRINGS.navigation.checkConnectionOrSelect}</Text>
          <RobustButton
            label="SELECT ROAD CORRIDOR"
            icon={<IconLayers size={16} color="#ffffff" />}
            onPress={() => handleSafeAction(onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  if (chaosOverride === 'NO_SAVED_SESSIONS') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.emptyStateBox}>
          <Text style={styles.emptyStateTitle}>{STRINGS.navigation.noSavedRoutes}</Text>
          <Text style={styles.emptyStateDesc}>Past dead reckoning telemetry runs will be archived here for replay.</Text>
          <RobustButton
            label="PLAN NEW CORRIDOR"
            variant="secondary"
            onPress={() => handleSafeAction(onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  if (chaosOverride === 'MAP_TILES_UNAVAILABLE') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.emptyStateBox}>
          <ControlledStatusBadge status="OFFLINE MODE" size="sm" />
          <Text style={styles.emptyStateTitle}>{STRINGS.navigation.mapDataUnavailable}</Text>
          <Text style={styles.emptyStateDesc}>Local vector tile renderer fell back to high-contrast dead reckoning grid.</Text>
          <RobustButton
            label="RELOAD TILE CACHE"
            variant="secondary"
            onPress={() => handleSafeAction(onRetryRoute || onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  // 4. PARTIAL-DATA STATES (Requirement 6)
  if (chaosOverride === 'PARTIAL_GPS_NO_ROUTE') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.partialBox}>
          <View style={styles.partialBadgeRow}>
            <ControlledStatusBadge status="GNSS CONNECTED" size="sm" />
            <ControlledStatusBadge status="ROUTE UNAVAILABLE" size="sm" />
          </View>
          <Text style={styles.partialTitle}>Position Available • Route Corridor Uncached</Text>
          <Text style={styles.partialDesc}>
            GNSS satellite lock active (±4.2 m). Turn guidance paused until corridor is chosen.
          </Text>
          <RobustButton
            label="LOAD ROUTE CORRIDOR"
            onPress={() => handleSafeAction(onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  if (chaosOverride === 'PARTIAL_ROUTE_NO_GPS') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.partialBox}>
          <View style={styles.partialBadgeRow}>
            <ControlledStatusBadge status="ROUTE READY" size="sm" />
            <ControlledStatusBadge status="POSITION UNAVAILABLE" size="sm" />
          </View>
          <Text style={styles.partialTitle}>Route Available • Initial Position Pending</Text>
          <Text style={styles.partialDesc}>
            Planned corridor loaded. Acquiring satellite constellation or vehicle origin fix...
          </Text>
          <RobustButton
            label="COMMENCE WITH LAST KNOWN FIX"
            variant="secondary"
            onPress={() => handleSafeAction(onToggleBlackout)}
          />
        </View>
      </View>
    );
  }

  // 5. FIRST-CLASS OFFLINE STATE (Requirement 19: Valid operating mode, NOT an error!)
  if (chaosOverride === 'OFFLINE_NIDR_ACTIVE') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.offlineBox}>
          <View style={styles.offlineHeader}>
            <View style={styles.offlinePill}>
              <IconZap size={14} color="#7e22ce" />
              <Text style={styles.offlinePillText}>FIRST-CLASS OFFLINE MODE</Text>
            </View>
            <Text style={styles.offlineSubhead}>Zero Cloud / Zero GNSS Dependency</Text>
          </View>
          <Text style={styles.offlineTitle}>OFFLINE NIDR ACTIVE — NAVIGATION CONTINUES</Text>
          <Text style={styles.offlineDesc}>
            Cellular network and GNSS constellation are both offline. Navigation continues uninterrupted using onboard Universal Motion Net and cached spatial road chunks.
          </Text>
          <View style={styles.offlineMetricsRow}>
            <View style={styles.offlineMetricItem}>
              <Text style={styles.offlineMetricVal}>48 km/h</Text>
              <Text style={styles.offlineMetricLabel}>Vehicle Speed</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.offlineMetricItem}>
              <Text style={styles.offlineMetricVal}>083° E</Text>
              <Text style={styles.offlineMetricLabel}>Azimuth</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.offlineMetricItem}>
              <Text style={[styles.offlineMetricVal, { color: theme.colors.idrBlue }]}>±3.8 m</Text>
              <Text style={styles.offlineMetricLabel}>IDR Drift</Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // 6. RECONVERGING STATE (Requirement 20)
  if (chaosOverride === 'RECONVERGING') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.reconvergingBox}>
          <View style={styles.reconvergingHeader}>
            <ControlledStatusBadge status="RECONVERGING" size="sm" />
            <Text style={styles.reconvergingPct}>82% Blended</Text>
          </View>
          <Text style={styles.reconvergingTitle}>GNSS SIGNAL REACQUIRED</Text>
          <Text style={styles.reconvergingDesc}>
            Smoothly blending dead reckoning trajectory with satellite fix. Step-discontinuity suppressed via Kalman innovation filter.
          </Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: '82%' }]} />
          </View>
        </View>
      </View>
    );
  }

  // 7. DISABLED / PREFLIGHT BLOCKED STATE (Requirement 16)
  if (chaosOverride === 'DISABLED_PREFLIGHT') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.disabledBox}>
          <Text style={styles.disabledTitle}>Start Navigation Blocked</Text>
          <Text style={styles.disabledSub}>Safety invariants prevent navigation initiation under incomplete hardware states:</Text>
          <RobustButton
            label="START NAVIGATION"
            onPress={() => {}}
            state="DISABLED"
            disabledReasons={[
              'Destination corridor not selected',
              'Vehicle IMU sensor uncalibrated',
              'Local road chunk cache missing',
            ]}
          />
        </View>
      </View>
    );
  }

  // 8. 3-LAYER ERROR STATES & NATIVE FAILURES (Requirement 5 & 18)
  const isNativeError =
    chaosOverride === 'ERROR_ROUTE_TIMEOUT' ||
    chaosOverride === 'MODEL_FAILURE' ||
    chaosOverride === 'SENSOR_FAILURE' ||
    chaosOverride === 'PERMISSION_DENIED' ||
    chaosOverride === 'STORAGE_FULL';

  if (isNativeError) {
    const errorCode =
      chaosOverride === 'MODEL_FAILURE'
        ? 'MODEL_LOAD_FAILED'
        : chaosOverride === 'SENSOR_FAILURE'
        ? 'SENSOR_UNAVAILABLE'
        : chaosOverride === 'PERMISSION_DENIED'
        ? 'GNSS_PERMISSION_REVOKED'
        : chaosOverride === 'STORAGE_FULL'
        ? 'STORAGE_FULL'
        : 'ROUTE_FETCH_TIMEOUT';

    const triLayer = mapToTriLayerError(errorCode);

    return (
      <View style={styles.cardContainer}>
        <View style={styles.errorBox}>
          <View style={styles.errorIconWrap}>
            <IconAlertTriangle size={20} color={theme.colors.alertRose} />
          </View>
          <Text style={styles.errorTitle}>{triLayer.userMessage}</Text>
          <Text style={styles.errorDesc}>{triLayer.userDescription}</Text>
          <View style={styles.techBadge}>
            <Text style={styles.techBadgeText}>Diagnostic: {triLayer.technicalDiagnosticCode}</Text>
          </View>
          <View style={styles.errorButtonRow}>
            <RobustButton
              label={triLayer.recoveryActionLabel}
              onPress={() => handleSafeAction(onRetryRoute || onOpenRoutePlanner)}
              variant="primary"
            />
          </View>
        </View>
      </View>
    );
  }

  // 9. ARRIVED STATE (Requirement 13)
  if (chaosOverride === 'ARRIVED') {
    return (
      <View style={styles.cardContainer}>
        <View style={styles.arrivedBox}>
          <View style={styles.arrivedIconWrap}>
            <IconCheckCircle size={22} color={theme.colors.gnssEmerald} />
          </View>
          <Text style={styles.arrivedTitle}>{STRINGS.navigation.destinationReached}</Text>
          <Text style={styles.arrivedDesc}>{STRINGS.navigation.destinationReachedDesc}</Text>
          <RobustButton
            label="START NEW NAVIGATION"
            icon={<IconLayers size={16} color="#ffffff" />}
            onPress={() => handleSafeAction(onOpenRoutePlanner)}
          />
        </View>
      </View>
    );
  }

  // ══════════════ 2. EXTRACT & SANITIZE METRICS WITH FORMATTERS ══════════════
  const isBlackout = telemetry?.blackout_active ?? false;
  const rawSpeed = chaosOverride === 'NULL_DATA'
    ? null
    : chaosOverride === 'STATIONARY_ZERO_SPEED'
    ? 0
    : telemetry?.speed_kmh ?? 0;

  const rawHeading = chaosOverride === 'NULL_DATA' || chaosOverride === 'UNKNOWN_HEADING'
    ? null
    : telemetry?.heading_deg ?? 83;

  const rawDrift = chaosOverride === 'HIGH_UNCERTAINTY'
    ? 128.4
    : chaosOverride === 'NULL_DATA'
    ? null
    : telemetry?.drift_m ?? 0;

  const rawPointError = chaosOverride === 'NULL_DATA' ? null : telemetry?.point_error_m ?? 4.2;
  const rawDistTraveled = telemetry?.distance_traveled_m ?? 0;
  const blackoutElapsed = telemetry?.blackout_elapsed_s ?? 0;

  // Remaining distance & ETA
  const totalMeters = (totalDistanceKm || 15.5) * 1000;
  const remainingMeters = Math.max(0, totalMeters - rawDistTraveled);
  const avgSpeedKmh = Math.max(25, rawSpeed || 0);
  const remainingMinutes = (remainingMeters / 1000 / avgSpeedKmh) * 60;

  // Formatted Strings (Guaranteed non-null, finite)
  const formattedDist = formatDistance(chaosOverride === 'NULL_DATA' ? null : remainingMeters);
  const formattedEta = formatEta(chaosOverride === 'NULL_DATA' ? null : remainingMinutes);
  const formattedSpeed = formatSpeed(rawSpeed);
  const headingObj = formatHeading(rawHeading);
  const formattedAccuracy = formatAccuracy(rawPointError);
  const formattedUncertainty = formatAccuracy(rawDrift !== null && rawDrift > 0 ? rawDrift : (rawDrift === null ? null : 7.2));
  const formattedDriftRate = formatDriftPct(chaosOverride === 'NULL_DATA' ? null : telemetry?.drift_pct ?? 1.2);

  const displayRoadName = chaosOverride === 'LONG_TEXT'
    ? 'NH-44 / Delhi-Gurgaon Expressway / Aerocity Gateway Service Corridor Terminal-3 Extended Flyover'
    : formatSafeText(roadName, 'Planned Road Corridor', 50);

  const displayManeuver = chaosOverride === 'LONG_TEXT'
    ? 'Continue straight past exit ramp toward Terminal-3 multi-level departure elevated deck'
    : STRINGS.navigation.continueStraight;

  return (
    <View style={styles.cardContainer}>
      {!isBlackout ? (
        /* ══════════ 3. NORMAL GNSS NAVIGATION STATE ══════════ */
        <View style={styles.contentWrap}>
          {/* Distance & ETA Row (Adaptive Flex Layout) */}
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricBigText} numberOfLines={1}>
                {formattedDist}
              </Text>
              <Text style={styles.metricSubText}>Remaining</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricBigText, { color: theme.colors.gnssEmerald }]} numberOfLines={1}>
                {formattedEta}
              </Text>
              <Text style={styles.metricSubText}>Estimated Arrival</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricBigText} numberOfLines={1}>
                {formattedSpeed}
              </Text>
              <Text style={styles.metricSubText}>KM / H</Text>
            </View>
          </View>

          {/* Status Line: Controlled Status Badge */}
          <View style={styles.statusLine}>
            <View style={styles.statusLeft}>
              <ControlledStatusBadge status="GNSS CONNECTED" size="sm" />
              <Text style={styles.statusAccuracy}>({formattedAccuracy})</Text>
            </View>
            <Text style={styles.statusHeading} numberOfLines={1}>
              {headingObj.full}
            </Text>
          </View>
        </View>
      ) : (
        /* ══════════ 4. GNSS BLACKOUT STATE (NIDR ACTIVE) ══════════ */
        <View style={styles.contentWrap}>
          {/* Alert Header Box */}
          <View style={styles.alertHeader}>
            <View style={styles.alertIconWrap}>
              <IconAlertTriangle size={18} color="#ffffff" />
            </View>
            <View style={styles.alertTitles}>
              <Text style={styles.alertMainTitle} numberOfLines={1}>
                {STRINGS.navigation.gnssSignalLost}
              </Text>
              <Text style={styles.alertSubtitle} numberOfLines={1}>
                {STRINGS.navigation.nidrDeadReckoningActive}
              </Text>
            </View>
            <View style={styles.outageTimer}>
              <Text style={styles.outageTimerText}>{blackoutElapsed.toFixed(1)}s</Text>
            </View>
          </View>

          {/* Uncertainty Callout */}
          <View style={styles.uncertaintyCallout}>
            <Text style={styles.uncertaintyTitle} numberOfLines={1}>
              Uncertainty: {formattedUncertainty}
            </Text>
            <Text style={styles.uncertaintyNote} numberOfLines={1} ellipsizeMode="tail">
              Tracking along corridor • {formattedSpeed} km/h • Drift {formattedDriftRate}
            </Text>
          </View>
        </View>
      )}

      {/* ══════════ 5. PRIMARY DRIVER ACTIONS (ROW 1) ══════════ */}
      <View style={styles.primaryActionRow}>
        <TouchableOpacity
          style={[styles.driveBtn, isPlaying && styles.driveBtnPlaying]}
          onPress={() => handleSafeAction(onTogglePlay)}
          activeOpacity={0.8}
        >
          {isPlaying ? (
            <IconPause size={15} color="#ffffff" />
          ) : (
            <IconPlay size={15} color="#ffffff" />
          )}
          <Text style={styles.primaryBtnText} numberOfLines={1}>
            {isPlaying ? 'PAUSE DRIVE' : 'START DRIVE'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.blackoutBtn, isBlackout && styles.restoreBtn]}
          onPress={() => handleSafeAction(onToggleBlackout)}
          activeOpacity={0.8}
        >
          {isBlackout ? (
            <>
              <IconCheckCircle size={15} color="#ffffff" />
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                RESTORE GNSS
              </Text>
            </>
          ) : (
            <>
              <IconAlertTriangle size={15} color="#ffffff" />
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                SIMULATE GNSS LOSS
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* ══════════ 6. SECONDARY MISSION TOOLS (ROW 2) ══════════ */}
      <View style={styles.secondaryActionRow}>
        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => handleSafeAction(onStartAutoDemo)}
          activeOpacity={0.75}
        >
          <IconZap size={13} color={theme.colors.idrBlue} />
          <Text style={[styles.toolBtnText, { color: theme.colors.idrBlue }]} numberOfLines={1}>
            60s TOUR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => handleSafeAction(onOpenDiagnostics)}
          activeOpacity={0.75}
        >
          <IconActivity size={13} color={theme.colors.textPrimary} />
          <Text style={styles.toolBtnText} numberOfLines={1}>
            5 MODULES
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => handleSafeAction(onOpenRoutePlanner)}
          activeOpacity={0.75}
        >
          <IconLayers size={13} color={theme.colors.textPrimary} />
          <Text style={styles.toolBtnText} numberOfLines={1}>
            CORRIDORS
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolBtn}
          onPress={() => handleSafeAction(onReset)}
          activeOpacity={0.75}
        >
          <IconRotateCcw size={13} color={theme.colors.textMuted} />
          <Text style={[styles.toolBtnText, { color: theme.colors.textMuted }]} numberOfLines={1}>
            RESET
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: theme.colors.borderLight,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 22,
    ...theme.shadows.card,
  },
  contentWrap: {
    minHeight: 130,
    justifyContent: 'space-between',
  },
  // Ready State
  readyBox: {
    paddingVertical: 4,
    gap: 8,
  },
  readyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  readyDistText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  readyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  readyDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    lineHeight: 16,
    marginBottom: 6,
  },
  // Empty State
  emptyStateBox: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  emptyStateHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  emptyStateDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 16,
  },
  // Loading State
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  loadingTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  loadingSub: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  // Partial State
  partialBox: {
    paddingVertical: 6,
    gap: 6,
  },
  partialBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 2,
  },
  partialTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  partialDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    lineHeight: 15,
    marginBottom: 6,
  },
  // First-Class Offline State
  offlineBox: {
    paddingVertical: 6,
    gap: 6,
  },
  offlineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#faf5ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  offlinePillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#7e22ce',
  },
  offlineSubhead: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  offlineTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#6b21a8',
  },
  offlineDesc: {
    fontSize: 10,
    color: theme.colors.textMuted,
    lineHeight: 14,
  },
  offlineMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    marginTop: 4,
  },
  offlineMetricItem: {
    alignItems: 'center',
    flex: 1,
  },
  offlineMetricVal: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  offlineMetricLabel: {
    fontSize: 9,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  // Reconverging State
  reconvergingBox: {
    paddingVertical: 6,
    gap: 6,
  },
  reconvergingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reconvergingPct: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563eb',
  },
  reconvergingTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  reconvergingDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    lineHeight: 15,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563eb',
  },
  // Disabled State
  disabledBox: {
    paddingVertical: 6,
    gap: 4,
  },
  disabledTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  disabledSub: {
    fontSize: 11,
    color: theme.colors.textMuted,
    lineHeight: 15,
    marginBottom: 6,
  },
  // Error Box
  errorBox: {
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  errorIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fef2f2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.alertRose,
  },
  errorDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
  },
  techBadge: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    marginTop: 2,
    marginBottom: 6,
  },
  techBadgeText: {
    fontSize: 9,
    fontFamily: 'monospace',
    color: theme.colors.textMuted,
  },
  errorButtonRow: {
    width: '100%',
    marginTop: 4,
  },
  // Arrived Box
  arrivedBox: {
    alignItems: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  arrivedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ecfdf5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrivedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.gnssEmerald,
  },
  arrivedDesc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: 8,
  },
  // Normal Navigation Elements
  maneuverBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  maneuverIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  maneuverTextGroup: {
    flex: 1,
  },
  primaryDirection: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    lineHeight: 19,
  },
  secondaryDirection: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    marginVertical: 4,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricBigText: {
    fontSize: 17,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  metricSubText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: theme.colors.borderLight,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusAccuracy: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  statusHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  // Blackout State Elements
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.alertRose,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 8,
  },
  alertIconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertTitles: {
    flex: 1,
  },
  alertMainTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  alertSubtitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  outageTimer: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  outageTimerText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  uncertaintyCallout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.idrBgSoft,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 4,
  },
  uncertaintyTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.idrBlue,
  },
  uncertaintyNote: {
    fontSize: 9,
    fontWeight: '600',
    color: '#475569',
    maxWidth: '55%',
  },
  blackoutManeuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 2,
  },
  maneuverIconBoxIdr: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: theme.colors.idrBgSoft,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blackoutManeuverText: {
    flex: 1,
  },
  blackoutManeuverPrimary: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  blackoutManeuverSub: {
    fontSize: 10,
    color: theme.colors.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
  // Action Row
  primaryActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  driveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.colors.gnssEmerald,
    paddingVertical: 11,
    borderRadius: 10,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  driveBtnPlaying: {
    backgroundColor: '#f59e0b',
    shadowColor: '#d97706',
  },
  blackoutBtn: {
    flex: 1.35,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.colors.alertRose,
    paddingVertical: 11,
    borderRadius: 10,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  restoreBtn: {
    backgroundColor: theme.colors.gnssEmerald,
    shadowColor: '#059669',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  secondaryActionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  toolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 8,
    borderRadius: 8,
  },
  toolBtnText: {
    color: theme.colors.textPrimary,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
