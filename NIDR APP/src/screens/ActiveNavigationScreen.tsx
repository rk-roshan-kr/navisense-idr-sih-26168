/**
 * NaviSense IDR Active Turn-by-Turn Navigation Screen
 *
 * Navigation-first full-screen map experience with real geographic street tiles,
 * live turn maneuver guidance, automatic GNSS blackout detection, and
 * dead-reckoning trajectory continuation.
 *
 * Strictly zero emojis. Premium Royal Theme.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ManeuverIcon } from '../components/ManeuverIcon';
import { InteractiveTileMap } from '../components/InteractiveTileMap';
import { PositionEngine, PositionState } from '../services/PositionEngine';
import { RouteEngine } from '../services/RouteEngine';
import { NavigationProgress, NavigationRoute } from '../types/navigation';
import { CheckCircle, Navigation, ShieldAlert } from '../components/Icon';

interface ActiveNavigationScreenProps {
  route: NavigationRoute;
  onEndNavigation: () => void;
}

export const ActiveNavigationScreen: React.FC<ActiveNavigationScreenProps> = ({
  route,
  onEndNavigation,
}) => {
  const [currentRoute, setCurrentRoute] = useState<NavigationRoute>(route);
  const [position, setPosition] = useState<PositionState>(
    PositionEngine.getCurrentState()
  );
  const [isRerouting, setIsRerouting] = useState<boolean>(false);
  const offRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCurrentRoute(route);
    RouteEngine.setActiveRoute(route);
    PositionEngine.startTracking();

    const unsubscribe = PositionEngine.subscribe((newPos) => {
      setPosition(newPos);
    });

    return () => {
      unsubscribe();
      if (offRouteTimerRef.current) {
        clearTimeout(offRouteTimerRef.current);
      }
    };
  }, [route]);

  // Compute active navigation progress & live path detection along the route
  const progress: NavigationProgress = useMemo(() => {
    return RouteEngine.computeProgress(
      currentRoute,
      { latitude: position.latitude, longitude: position.longitude },
      position.headingDeg,
      position.speedMps,
      position.mode,
      position.accuracyM,
      position.blackoutDurationS,
      position.blackoutDistanceM
    );
  }, [currentRoute, position]);

  // Auto-reroute detection when user deviates from the path (> 45 meters)
  useEffect(() => {
    if (progress.isOffRoute && !isRerouting && !progress.hasArrived) {
      if (!offRouteTimerRef.current) {
        offRouteTimerRef.current = setTimeout(async () => {
          setIsRerouting(true);
          try {
            const recomputed = await RouteEngine.planRouteAsync(
              { latitude: position.latitude, longitude: position.longitude },
              'Current Location',
              currentRoute.destination,
              currentRoute.destinationName,
              currentRoute.travelMode
            );
            setCurrentRoute(recomputed);
            RouteEngine.setActiveRoute(recomputed);
          } catch {
            // Keep current route on network/calculation failure
          } finally {
            setIsRerouting(false);
            offRouteTimerRef.current = null;
          }
        }, 3000);
      }
    } else {
      if (offRouteTimerRef.current) {
        clearTimeout(offRouteTimerRef.current);
        offRouteTimerRef.current = null;
      }
    }
  }, [progress.isOffRoute, isRerouting, progress.hasArrived, position.latitude, position.longitude, currentRoute]);

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.max(1, Math.round(seconds / 60));
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs} h ${remMins} m`;
  };

  const calculateEta = (secondsRemaining: number): string => {
    const etaDate = new Date(Date.now() + secondsRemaining * 1000);
    let hours = etaDate.getHours();
    const mins = etaDate.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minStr = mins < 10 ? `0${mins}` : `${mins}`;
    return `${hours}:${minStr} ${ampm}`;
  };

  const isBlackout = position.mode === 'NIDR_DEAD_RECKONING';
  const isReconverging = position.mode === 'RECONVERGING';

  // Status colors & labels (Imperial Royal Palette)
  let bannerBg = 'rgba(236, 253, 245, 0.95)';
  let bannerBorder = '#047857';
  let bannerTitle = 'GNSS ACTIVE';

  if (isBlackout) {
    bannerBg = 'rgba(254, 243, 199, 0.95)';
    bannerBorder = '#B45309';
    bannerTitle = 'NIDR DEAD RECKONING ACTIVE';
  } else if (isReconverging) {
    bannerBg = 'rgba(238, 242, 255, 0.95)';
    bannerBorder = '#B8860B';
    bannerTitle = 'RECONVERGING GNSS';
  }

  const currentManeuver = progress.currentManeuver || {
    instruction: 'Follow planned route',
    roadName: progress.currentRoadName || currentRoute.destinationName || 'Main Road',
    maneuver: 'straight' as const,
  };

  // Road-snapped display position for the navigation puck
  const displayPosition = {
    latitude: (position.isSnappedToPath && position.snappedLatitude)
      ? position.snappedLatitude
      : position.latitude,
    longitude: (position.isSnappedToPath && position.snappedLongitude)
      ? position.snappedLongitude
      : position.longitude,
  };

  return (
    <View style={styles.container}>
      {/* Real Full-Screen Interactive Tile Map Following Navigation */}
      <InteractiveTileMap
        currentPosition={displayPosition}
        headingDeg={position.isSnappedToPath && position.roadBearingDeg !== undefined ? position.roadBearingDeg : position.headingDeg}
        route={currentRoute}
        mode={position.mode}
        accuracyM={position.accuracyM}
        speedMps={position.speedMps}
      />

      {/* Floating Top Turn Guidance Card */}
      <View style={styles.topGuidanceCard}>
        {/* Live Path Detection Status Pill */}
        <View style={styles.pathStatusRow}>
          <View
            style={[
              styles.pathStatusPill,
              progress.isOffRoute ? styles.pathStatusPillOff : styles.pathStatusPillOn,
            ]}>
            <View
              style={[
                styles.pathStatusDot,
                { backgroundColor: progress.isOffRoute ? '#D97706' : '#047857' },
              ]}
            />
            <Text
              style={[
                styles.pathStatusText,
                { color: progress.isOffRoute ? '#B45309' : '#047857' },
              ]}>
              {progress.isOffRoute
                ? isRerouting
                  ? 'OFF PATH • RE-ROUTING...'
                  : `OFF PATH DETECTED (±${progress.crossTrackErrorM || 0}m)`
                : `PATH DETECTED • ${progress.currentRoadName || 'ON ROAD'} (±${progress.crossTrackErrorM || 0}m)`}
            </Text>
          </View>
          {isRerouting && <ActivityIndicator size="small" color="#B8860B" />}
        </View>

        {/* Next Turn Instruction Row */}
        <View style={styles.maneuverRow}>
          <View style={styles.maneuverIconBox}>
            <ManeuverIcon maneuver={currentManeuver.maneuver} size={32} color="#B8860B" />
          </View>
          <View style={styles.maneuverTextCol}>
            <Text style={styles.maneuverDistanceText}>
              {formatDistance(progress.distanceToNextManeuverM)}
            </Text>
            <Text style={styles.maneuverInstructionText} numberOfLines={1}>
              {currentManeuver.instruction}
            </Text>
            <Text style={styles.roadNameText} numberOfLines={1}>
              {currentManeuver.roadName}
            </Text>
          </View>
        </View>

        {/* Automatic Blackout Warning Alert Bar */}
        {isBlackout && (
          <View style={[styles.blackoutAlertBar, { backgroundColor: bannerBg, borderColor: bannerBorder }]}>
            <View style={styles.alertLeft}>
              <ShieldAlert size={14} color={bannerBorder} />
              <Text style={[styles.blackoutAlertTitle, { color: bannerBorder }]}>
                {bannerTitle}
              </Text>
            </View>
            <Text style={styles.blackoutStatsText}>
              {progress.blackoutDurationS.toFixed(0)}s | {progress.blackoutDistanceM.toFixed(0)}m
            </Text>
          </View>
        )}
      </View>

      {/* Destination Arrival Card */}
      {progress.hasArrived && (
        <View style={styles.arrivalOverlay} pointerEvents="box-none">
          <View style={styles.arrivalCard}>
            <View style={styles.arrivalBadge}>
              <CheckCircle size={32} color="#047857" />
            </View>
            <Text style={styles.arrivalTitle}>DESTINATION REACHED</Text>
            <Text style={styles.arrivalSubtitle}>
              You have arrived at {currentRoute.destinationName}
            </Text>
            <View style={styles.arrivalStatsRow}>
              <View style={styles.arrivalStatCol}>
                <Text style={styles.arrivalStatValue}>
                  {(currentRoute.distanceM / 1000).toFixed(1)} km
                </Text>
                <Text style={styles.arrivalStatLabel}>DISTANCE</Text>
              </View>
              <View style={styles.arrivalStatDivider} />
              <View style={styles.arrivalStatCol}>
                <Text style={styles.arrivalStatValue}>
                  {formatTime(currentRoute.durationS)}
                </Text>
                <Text style={styles.arrivalStatLabel}>DURATION</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.finishTripBtn} onPress={onEndNavigation}>
              <Text style={styles.finishTripBtnText}>FINISH TRIP</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Floating Bottom Navigation HUD Tray */}
      <View style={styles.bottomTray}>
        {/* Metric Summary Strip */}
        <View style={styles.metricsSummaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValueText}>
              {formatTime(progress.timeRemainingS)}
            </Text>
            <Text style={styles.summaryLabelText}>
              {formatDistance(progress.distanceRemainingM)} REMAINING
            </Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryItem}>
            <Text style={styles.summaryValueText}>
              {calculateEta(progress.timeRemainingS)}
            </Text>
            <Text style={styles.summaryLabelText}>EST. ARRIVAL</Text>
          </View>

          <View style={styles.summaryDivider} />

          <View style={styles.summaryItem}>
            <Text style={styles.summaryValueText}>
              {(position.speedMps * 3.6).toFixed(0)} km/h
            </Text>
            <Text style={styles.summaryLabelText}>SPEED</Text>
          </View>

          {/* End Navigation Button */}
          <TouchableOpacity style={styles.endNavButton} onPress={onEndNavigation}>
            <Text style={styles.endNavButtonText}>END</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  topGuidanceCard: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: '#DFD0B8',
    borderWidth: 1.2,
    borderRadius: 14,
    padding: 12,
    elevation: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    gap: 8,
  },
  maneuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  maneuverIconBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#FDFBF7',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  maneuverTextCol: {
    flex: 1,
  },
  maneuverDistanceText: {
    color: '#B8860B',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  maneuverInstructionText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 1,
  },
  roadNameText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  blackoutAlertBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 2,
  },
  alertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  blackoutAlertTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  blackoutStatsText: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  bottomTray: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    elevation: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  metricsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValueText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '900',
  },
  summaryLabelText: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 1,
  },
  summaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  endNavButton: {
    backgroundColor: '#991B1B',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#991B1B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  endNavButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  pathStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pathStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  pathStatusPillOn: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  pathStatusPillOff: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  pathStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pathStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  arrivalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 999,
  },
  arrivalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    elevation: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  arrivalBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ECFDF5',
    borderColor: '#047857',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  arrivalTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  arrivalSubtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 18,
  },
  arrivalStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 20,
  },
  arrivalStatCol: {
    alignItems: 'center',
  },
  arrivalStatValue: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
  },
  arrivalStatLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  arrivalStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#E2E8F0',
  },
  finishTripBtn: {
    backgroundColor: '#B8860B',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  finishTripBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
