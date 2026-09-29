/**
 * NaviSense IDR Route Preview & Pre-Flight Readiness Sheet
 *
 * Presents route summary and the 7-point blackout readiness checklist
 * before navigation starts.
 *
 * Strictly zero emojis.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ManeuverIcon } from './ManeuverIcon';
import { PreflightService } from '../services/PreflightService';
import { RouteEngine } from '../services/RouteEngine';
import { NavigationRoute, PreflightChecklist } from '../types/navigation';

interface RoutePreviewSheetProps {
  route: NavigationRoute;
  onStartNavigation: () => void;
  onCancel: () => void;
}

export const RoutePreviewSheet: React.FC<RoutePreviewSheetProps> = ({
  route,
  onStartNavigation,
  onCancel,
}) => {
  const [checklist, setChecklist] = useState<PreflightChecklist>(
    PreflightService.getChecklist()
  );

  useEffect(() => {
    // Automatically cache route for offline blackout resilience
    RouteEngine.cacheRouteForOffline(route);

    // Evaluate pre-flight readiness
    const initialCheck = PreflightService.evaluateReadiness(route);
    setChecklist(initialCheck);

    const unsubscribe = PreflightService.subscribe((updated) => {
      setChecklist(updated);
    });

    return () => {
      unsubscribe();
    };
  }, [route]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} hr ${remMins} min`;
  };

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const checklistItems = [
    { label: 'Starting location acquired', status: checklist.startingLocationAcquired },
    { label: 'Initial heading acquired', status: checklist.initialHeadingAcquired },
    { label: 'Route calculated', status: checklist.routeCalculated },
    { label: 'Required map area cached', status: checklist.requiredMapAreaCached },
    { label: 'Route geometry cached', status: checklist.routeGeometryCached },
    { label: 'NIDR model ready (pdr_net_v1.pte)', status: checklist.nidrModelReady },
    { label: 'Sensors ready (100 Hz IMU)', status: checklist.sensorsReady },
  ];

  return (
    <View style={styles.sheetContainer}>
      {/* Route Overview Header */}
      <View style={styles.headerRow}>
        <View style={styles.titleCol}>
          <Text style={styles.destinationTitle}>{route.destinationName}</Text>
          <Text style={styles.originSubtitle}>From: {route.originName}</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={onCancel}>
          <Text style={styles.closeBtnText}>X</Text>
        </TouchableOpacity>
      </View>

      {/* Metrics Strip */}
      <View style={styles.metricsRow}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>DISTANCE</Text>
          <Text style={styles.metricValue}>{formatDistance(route.distanceM)}</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>EST. TIME</Text>
          <Text style={styles.metricValue}>{formatDuration(route.durationS)}</Text>
        </View>

        <View style={styles.metricDivider} />

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>MODE</Text>
          <Text style={styles.metricValue}>{route.travelMode.toUpperCase()}</Text>
        </View>
      </View>

      {/* Pre-Flight Blackout Readiness Checklist */}
      <View style={styles.checklistSection}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>PRE-FLIGHT BLACKOUT READINESS</Text>
          <Text style={styles.sectionSubtitle}>
            All parameters verified for offline continuity
          </Text>
        </View>

        <View style={styles.checklistGrid}>
          {checklistItems.map((item, idx) => (
            <View key={`check_${idx}`} style={styles.checkItem}>
              <View
                style={[
                  styles.checkBadge,
                  item.status ? styles.checkBadgeSuccess : styles.checkBadgePending,
                ]}>
                <ManeuverIcon
                  maneuver="check"
                  size={12}
                  color={item.status ? '#047857' : '#94A3B8'}
                />
              </View>
              <Text
                style={[
                  styles.checkLabel,
                  item.status ? styles.checkLabelActive : styles.checkLabelPending,
                ]}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Start Navigation Action Button */}
      <TouchableOpacity
        style={[
          styles.startNavButton,
          !checklist.isReadyToNavigate && styles.startNavButtonDisabled,
        ]}
        disabled={!checklist.isReadyToNavigate}
        onPress={onStartNavigation}>
        <Text style={styles.startNavButtonText}>START NAVIGATION</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  sheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#DFD0B8',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    elevation: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleCol: {
    flex: 1,
    marginRight: 12,
  },
  destinationTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  originSubtitle: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#855E15',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  checklistSection: {
    backgroundColor: '#FDFBF7',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#DFD0B8',
    marginBottom: 16,
  },
  sectionHeader: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#DFD0B8',
    paddingBottom: 6,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    color: '#64748B',
    fontSize: 9,
    marginTop: 1,
  },
  checklistGrid: {
    gap: 6,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    borderWidth: 1,
  },
  checkBadgeSuccess: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  checkBadgePending: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  checkLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  checkLabelActive: {
    color: '#0F172A',
  },
  checkLabelPending: {
    color: '#64748B',
  },
  startNavButton: {
    backgroundColor: '#B8860B',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#855E15',
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  startNavButtonDisabled: {
    backgroundColor: '#E2E8F0',
    borderColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
  },
  startNavButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.0,
  },
});
