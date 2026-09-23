import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { theme } from '../theme';
import { IconZap, IconRotateCcw } from './Icons';

export type ChaosStateOverride =
  | 'NONE'
  | 'LOADING'
  | 'READY'
  | 'EMPTY_DESTINATION'
  | 'EMPTY_ROUTE'
  | 'PARTIAL_GPS_NO_ROUTE'
  | 'PARTIAL_ROUTE_NO_GPS'
  | 'NULL_DATA'
  | 'ERROR_ROUTE_TIMEOUT'
  | 'OFFLINE_NIDR_ACTIVE'
  | 'DISABLED_PREFLIGHT'
  | 'PERMISSION_DENIED'
  | 'NO_SAVED_SESSIONS'
  | 'MAP_TILES_UNAVAILABLE'
  | 'MODEL_FAILURE'
  | 'SENSOR_FAILURE'
  | 'STORAGE_FULL'
  | 'LONG_TEXT'
  | 'HIGH_UNCERTAINTY'
  | 'STATIONARY_ZERO_SPEED'
  | 'UNKNOWN_HEADING'
  | 'RECONVERGING'
  | 'ARRIVED';

interface ChaosModePanelProps {
  currentOverride: ChaosStateOverride;
  onSelectOverride: (o: ChaosStateOverride) => void;
  onRandomize: () => void;
  onReset: () => void;
  fontScale?: number;
  onSelectFontScale?: (scale: number) => void;
}

export const ChaosModePanel: React.FC<ChaosModePanelProps> = ({
  currentOverride,
  onSelectOverride,
  onRandomize,
  onReset,
  fontScale = 1.0,
  onSelectFontScale,
}) => {
  const CHAOS_CATEGORIES: {
    category: string;
    options: { id: ChaosStateOverride; label: string; desc: string }[];
  }[] = [
    {
      category: 'Baseline & Active States',
      options: [
        { id: 'NONE', label: 'Default Live', desc: 'Authoritative telemetry loop' },
        { id: 'READY', label: 'Ready State', desc: 'Corridor planned, start available' },
        { id: 'OFFLINE_NIDR_ACTIVE', label: 'Offline NIDR Mode', desc: 'Net OFF + GPS OFF + NIDR Continues' },
        { id: 'RECONVERGING', label: 'Reconverging State', desc: 'GPS reacquired, fusing trajectory' },
        { id: 'ARRIVED', label: 'Arrived State', desc: 'Trip summary and zero drift' },
      ],
    },
    {
      category: 'Empty, Null & Missing States',
      options: [
        { id: 'EMPTY_DESTINATION', label: 'No Destination', desc: 'Empty destination selector' },
        { id: 'EMPTY_ROUTE', label: 'No Route', desc: 'Corridor route unavailable' },
        { id: 'NULL_DATA', label: 'All Nulls', desc: 'null speed, heading, ETA, drift' },
        { id: 'NO_SAVED_SESSIONS', label: 'No Saved Sessions', desc: 'Empty past navigation sessions' },
        { id: 'MAP_TILES_UNAVAILABLE', label: 'No Map Data', desc: 'Vector tiles unavailable' },
      ],
    },
    {
      category: 'Partial & Degraded States',
      options: [
        { id: 'PARTIAL_GPS_NO_ROUTE', label: 'GPS On, Route Off', desc: 'Position without road corridor' },
        { id: 'PARTIAL_ROUTE_NO_GPS', label: 'Route On, GPS Off', desc: 'Corridor planned, position pending' },
        { id: 'STATIONARY_ZERO_SPEED', label: 'Stationary (0 km/h)', desc: 'Zero velocity update (ZUPT)' },
        { id: 'UNKNOWN_HEADING', label: 'Unknown Heading', desc: 'Heading unavailable (not 0°)' },
        { id: 'HIGH_UNCERTAINTY', label: 'High Drift (±128.4m)', desc: 'Uncertainty expansion test' },
      ],
    },
    {
      category: 'Error, Crash & Hardware Failures',
      options: [
        { id: 'ERROR_ROUTE_TIMEOUT', label: 'Route Timeout', desc: '3-layer error with [RETRY]' },
        { id: 'MODEL_FAILURE', label: 'Model Load Failed', desc: 'Kotlin TFLite crash mapped cleanly' },
        { id: 'SENSOR_FAILURE', label: 'IMU Disconnected', desc: 'Hardware HAL interrupt' },
        { id: 'PERMISSION_DENIED', label: 'Permission Denied', desc: 'Location access revoked' },
        { id: 'STORAGE_FULL', label: 'Storage Full', desc: 'Cache write failed safely' },
        { id: 'DISABLED_PREFLIGHT', label: 'Start Blocked', desc: 'Button disabled with reason list' },
        { id: 'LOADING', label: 'Loading State', desc: 'Preparing offline tiles & model' },
        { id: 'LONG_TEXT', label: 'Extreme Long Text', desc: 'Multi-line bounded wrapping test' },
      ],
    },
  ];

  const FONT_SCALES = [1.0, 1.15, 1.3, 1.5, 2.0];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleBadge}>
          <IconZap size={14} color={theme.colors.idrBlue} />
          <Text style={styles.titleBadgeText}>UI CHAOS & EDGE-CASE SUITE</Text>
        </View>
        <View style={styles.quickButtons}>
          <TouchableOpacity style={styles.randomBtn} onPress={onRandomize} activeOpacity={0.7}>
            <Text style={styles.randomBtnText}>🎲 RANDOMIZE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetBtn} onPress={onReset} activeOpacity={0.7}>
            <IconRotateCcw size={12} color={theme.colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.description}>
        Inject synthetic edge-case states to guarantee every screen handles loading, null, empty, partial, offline, and error states without crashing:
      </Text>

      {/* Font Scaling Simulator */}
      {onSelectFontScale && (
        <View style={styles.fontScaleRow}>
          <Text style={styles.fontScaleLabel}>Simulate Android Font Scale:</Text>
          <View style={styles.fontScalePills}>
            {FONT_SCALES.map((scale) => (
              <TouchableOpacity
                key={scale}
                style={[styles.scalePill, fontScale === scale && styles.scalePillActive]}
                onPress={() => onSelectFontScale(scale)}
                activeOpacity={0.7}
              >
                <Text style={[styles.scalePillText, fontScale === scale && styles.scalePillTextActive]}>
                  {Math.round(scale * 100)}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {CHAOS_CATEGORIES.map((cat, cIdx) => (
        <View key={cIdx} style={styles.categoryBlock}>
          <Text style={styles.categoryTitle}>{cat.category}</Text>
          <View style={styles.pillsGrid}>
            {cat.options.map((opt) => {
              const isActive = currentOverride === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.pill, isActive && styles.pillActive]}
                  onPress={() => onSelectOverride(opt.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pillLabel, isActive && styles.pillLabelActive]}>{opt.label}</Text>
                  <Text style={styles.pillDesc} numberOfLines={1}>
                    {opt.desc}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    ...theme.shadows.subtle,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  titleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.idrBgSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  titleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.idrBlue,
    letterSpacing: 0.5,
  },
  quickButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  randomBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  randomBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  resetBtn: {
    backgroundColor: '#f1f5f9',
    padding: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  description: {
    fontSize: 10,
    color: theme.colors.textMuted,
    lineHeight: 14,
    marginBottom: 8,
  },
  fontScaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    marginBottom: 10,
  },
  fontScaleLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  fontScalePills: {
    flexDirection: 'row',
    gap: 4,
  },
  scalePill: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
  },
  scalePillActive: {
    backgroundColor: theme.colors.idrBlue,
    borderColor: theme.colors.idrBlue,
  },
  scalePillText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  scalePillTextActive: {
    color: '#ffffff',
  },
  categoryBlock: {
    marginTop: 8,
  },
  categoryTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  pillsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    flexBasis: '48%',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 8,
    padding: 8,
  },
  pillActive: {
    backgroundColor: theme.colors.idrBgSoft,
    borderColor: theme.colors.idrBlue,
  },
  pillLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  pillLabelActive: {
    color: theme.colors.idrBlue,
  },
  pillDesc: {
    fontSize: 9,
    color: theme.colors.textMuted,
  },
});
