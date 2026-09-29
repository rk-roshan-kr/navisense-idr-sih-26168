/**
 * NaviSense IDR Saved & Offline Routes Screen
 *
 * Displays locally cached routes available for zero-connectivity navigation.
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteEngine } from '../services/RouteEngine';
import { NavigationRoute } from '../types/navigation';
import { MapPin, Navigation } from '../components/Icon';

interface SavedRoutesScreenProps {
  onSelectRoute: (route: NavigationRoute) => void;
}

export const SavedRoutesScreen: React.FC<SavedRoutesScreenProps> = ({
  onSelectRoute,
}) => {
  const [routes, setRoutes] = useState<NavigationRoute[]>(
    RouteEngine.getSavedRoutes()
  );

  const formatDistance = (meters: number): string => {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerBar}>
        <View style={styles.headerTitleRow}>
          <Navigation size={18} color="#B8860B" />
          <Text style={styles.headerTitle}>OFFLINE ROUTES</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Cached locally for zero-network navigation
        </Text>
      </View>

      {/* Route List */}
      <FlatList
        data={routes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.routeCard}>
            <View style={styles.cardTopRow}>
              <View style={styles.titleCol}>
                <Text style={styles.destName}>{item.destinationName}</Text>
                <Text style={styles.originName}>From: {item.originName}</Text>
              </View>
              <View style={styles.cachedBadge}>
                <Text style={styles.cachedBadgeText}>OFFLINE READY</Text>
              </View>
            </View>

            <View style={styles.cardMetricsRow}>
              <View style={styles.metricChip}>
                <Text style={styles.metricChipLabel}>DISTANCE</Text>
                <Text style={styles.metricChipValue}>
                  {formatDistance(item.distanceM)}
                </Text>
              </View>

              <View style={styles.metricChip}>
                <Text style={styles.metricChipLabel}>TIME</Text>
                <Text style={styles.metricChipValue}>
                  {formatDuration(item.durationS)}
                </Text>
              </View>

              <View style={styles.metricChip}>
                <Text style={styles.metricChipLabel}>MODE</Text>
                <Text style={styles.metricChipValue}>{item.travelMode}</Text>
              </View>

              <TouchableOpacity
                style={styles.navigateButton}
                onPress={() => onSelectRoute(item)}>
                <Text style={styles.navigateButtonText}>NAVIGATE</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <MapPin size={32} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>NO CACHED ROUTES</Text>
            <Text style={styles.emptySubtitle}>
              Plan a route on the main screen to automatically save it for offline use.
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
    gap: 10,
  },
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  titleCol: {
    flex: 1,
    marginRight: 10,
  },
  destName: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  originName: {
    color: '#475569',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  cachedBadge: {
    backgroundColor: '#FDFBF7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#DFD0B8',
  },
  cachedBadgeText: {
    color: '#855E15',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cardMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricChip: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricChipLabel: {
    color: '#64748B',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricChipValue: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  navigateButton: {
    flex: 1,
    height: 36,
    backgroundColor: '#B8860B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#855E15',
    marginLeft: 4,
    elevation: 2,
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  navigateButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
});
