import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Compass, Gauge, Milestone, TrendingUp } from './Icon';

interface LiveHudPuckProps {
  speedMps: number;
  headingDeg: number;
  distanceM: number;
  driftPercent?: number;
  isBlackout: boolean;
}

export const LiveHudPuck: React.FC<LiveHudPuckProps> = ({
  speedMps,
  headingDeg,
  distanceM,
  driftPercent,
  isBlackout,
}) => {
  const speedKmh = (speedMps * 3.6).toFixed(1);

  return (
    <View style={styles.container}>
      <View style={styles.hudCard}>
        <View style={styles.headerRow}>
          <Gauge size={13} color="#B8860B" />
          <Text style={styles.label}>SPEED</Text>
        </View>
        <Text style={styles.value}>{speedKmh}</Text>
        <Text style={styles.unit}>km/h</Text>
      </View>

      <View style={styles.hudCard}>
        <View style={styles.headerRow}>
          <Compass size={13} color="#B8860B" />
          <Text style={styles.label}>HEADING</Text>
        </View>
        <Text style={styles.value}>{Math.round(headingDeg).toString().padStart(3, '0')}°</Text>
        <Text style={styles.unit}>azimuth</Text>
      </View>

      <View style={styles.hudCard}>
        <View style={styles.headerRow}>
          <Milestone size={13} color="#B8860B" />
          <Text style={styles.label}>DISTANCE</Text>
        </View>
        <Text style={styles.value}>{distanceM.toFixed(1)}</Text>
        <Text style={styles.unit}>metres</Text>
      </View>

      {driftPercent !== undefined && (
        <View style={[styles.hudCard, isBlackout && styles.driftCard]}>
          <View style={styles.headerRow}>
            <TrendingUp size={13} color={driftPercent < 20 ? '#047857' : '#991B1B'} />
            <Text style={styles.label}>DRIFT</Text>
          </View>
          <Text style={[styles.value, { color: driftPercent < 20 ? '#047857' : '#991B1B' }]}>
            {driftPercent.toFixed(1)}%
          </Text>
          <Text style={styles.unit}>error/dist</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 6,
  },
  hudCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  driftCard: {
    borderColor: '#B8860B',
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontSize: 8,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 1,
  },
});
