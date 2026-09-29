import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, ShieldCheck } from './Icon';

interface BlackoutBannerProps {
  isActive: boolean;
  distanceM: number;
  uncertaintyM: number;
}

export const BlackoutBanner: React.FC<BlackoutBannerProps> = ({
  isActive,
  distanceM,
  uncertaintyM,
}) => {
  if (!isActive) {
    return (
      <View style={[styles.container, styles.normalContainer]}>
        <ShieldCheck color="#10B981" size={20} />
        <Text style={styles.normalText}>GNSS ACTIVE - READY FOR OUTAGE TEST</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.blackoutContainer]}>
      <View style={styles.headerRow}>
        <AlertTriangle color="#F59E0B" size={22} />
        <Text style={styles.blackoutTitle}>GNSS BLACKOUT ACTIVE</Text>
      </View>
      <Text style={styles.blackoutSubtitle}>
        NAVISENSE IDR PROPAGATING FROM FROZEN ANCHOR
      </Text>
      <View style={styles.statsRow}>
        <Text style={styles.statItem}>Distance: <Text style={styles.statHighlight}>{distanceM.toFixed(1)} m</Text></Text>
        <Text style={styles.statItem}>Uncertainty: <Text style={styles.statHighlight}>+/- {uncertaintyM.toFixed(1)} m</Text></Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  normalContainer: {
    backgroundColor: '#064E3B',
    borderColor: '#059669',
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  normalText: {
    color: '#D1FAE5',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  blackoutContainer: {
    backgroundColor: '#78350F',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  blackoutTitle: {
    color: '#FEF3C7',
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1,
  },
  blackoutSubtitle: {
    color: '#FDE68A',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#92400E',
    paddingTop: 6,
  },
  statItem: {
    color: '#FDE68A',
    fontSize: 12,
  },
  statHighlight: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
