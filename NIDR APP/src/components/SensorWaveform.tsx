import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SensorTelemetry } from '../types';
import { Activity } from './Icon';

interface SensorWaveformProps {
  telemetry: SensorTelemetry | null;
  requestedRateHz?: number;
}

export const SensorWaveform: React.FC<SensorWaveformProps> = ({
  telemetry,
  requestedRateHz = 100,
}) => {
  if (!telemetry) {
    return (
      <View style={styles.emptyContainer}>
        <Activity size={18} color="#B8860B" />
        <Text style={styles.emptyText}>Awaiting hardware sensor stream...</Text>
      </View>
    );
  }

  const { ax, ay, az, gx, gy, gz, normA, actualRateHz, sampleCount } = telemetry;
  const gravityDeviation = Math.abs(normA - 9.81);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Activity size={16} color="#B8860B" />
          <Text style={styles.title}>LIVE HARDWARE SENSOR STREAM</Text>
        </View>
        <View style={styles.rateBadge}>
          <Text style={styles.rateText}>
            {actualRateHz.toFixed(1)} Hz <Text style={styles.rateSub}>({requestedRateHz} req)</Text>
          </Text>
        </View>
      </View>

      <View style={styles.channelGrid}>
        <View style={styles.channelColumn}>
          <Text style={styles.columnHeader}>ACCELERATION (m/s²)</Text>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>X:</Text>
            <Text style={styles.axisValue}>{ax.toFixed(2)}</Text>
          </View>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>Y:</Text>
            <Text style={styles.axisValue}>{ay.toFixed(2)}</Text>
          </View>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>Z:</Text>
            <Text style={styles.axisValue}>{az.toFixed(2)}</Text>
          </View>
          <View style={styles.normRow}>
            <Text style={styles.normLabel}>||a||:</Text>
            <Text style={[styles.normValue, gravityDeviation < 0.5 ? styles.normGood : styles.normActive]}>
              {normA.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.channelColumn}>
          <Text style={styles.columnHeader}>GYROSCOPE (rad/s)</Text>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>Gx:</Text>
            <Text style={styles.axisValue}>{gx.toFixed(3)}</Text>
          </View>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>Gy:</Text>
            <Text style={styles.axisValue}>{gy.toFixed(3)}</Text>
          </View>
          <View style={styles.axisRow}>
            <Text style={styles.axisLabel}>Gz:</Text>
            <Text style={styles.axisValue}>{gz.toFixed(3)}</Text>
          </View>
          <View style={styles.normRow}>
            <Text style={styles.normLabel}>Samples:</Text>
            <Text style={styles.normValue}>{sampleCount.toLocaleString()}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  emptyContainer: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginVertical: 6,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rateBadge: {
    backgroundColor: '#FDFBF7',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rateText: {
    color: '#855E15',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rateSub: {
    fontSize: 9,
    color: '#B8860B',
  },
  channelGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  channelColumn: {
    flex: 1,
  },
  columnHeader: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 1,
  },
  axisLabel: {
    color: '#64748B',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  axisValue: {
    color: '#0F172A',
    fontSize: 11,
    fontFamily: 'monospace',
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  normRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  normLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
  },
  normValue: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  normGood: {
    color: '#047857',
  },
  normActive: {
    color: '#B45309',
  },
});
