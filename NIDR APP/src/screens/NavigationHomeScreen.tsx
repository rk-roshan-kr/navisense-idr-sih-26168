/**
 * NaviSense IDR Main Navigation-First Maps Application Screen
 *
 * Full-screen interactive real geographic map with live geocoding search,
 * dynamic OSRM road-network route planning, category discovery,
 * travel mode toggles, and seamless turn-by-turn navigation launch.
 *
 * Strictly zero emojis. Premium Royal Theme.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { InteractiveTileMap } from '../components/InteractiveTileMap';
import { ModeIcon } from '../components/ManeuverIcon';
import { RoutePreviewSheet } from '../components/RoutePreviewSheet';
import { PositionEngine, PositionState } from '../services/PositionEngine';
import { RouteEngine } from '../services/RouteEngine';
import { NavigationRoute, PresetDestination, RoutePoint, TravelMode } from '../types/navigation';
import { CheckCircle, Compass, Crosshair, MapPin, Navigation, Search, X } from '../components/Icon';

interface NavigationHomeScreenProps {
  onStartNavigation: (route: NavigationRoute) => void;
  onOpenSettings: () => void;
}

export const NavigationHomeScreen: React.FC<NavigationHomeScreenProps> = ({
  onStartNavigation,
  onOpenSettings,
}) => {
  const [position, setPosition] = useState<PositionState>(
    PositionEngine.getCurrentState()
  );
  const [originText, setOriginText] = useState<string>('Current Location');
  const [destinationText, setDestinationText] = useState<string>('');
  const [selectedDestination, setSelectedDestination] = useState<PresetDestination | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('Walk');
  const [plannedRoute, setPlannedRoute] = useState<NavigationRoute | null>(null);
  const [showPreviewSheet, setShowPreviewSheet] = useState<boolean>(false);
  const [isRouting, setIsRouting] = useState<boolean>(false);

  // Live Geocoding Search State
  const [searchResults, setSearchResults] = useState<PresetDestination[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const initLocation = async () => {
      if (Platform.OS === 'android') {
        try {
          const perms = [
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
          ];
          if (Number(Platform.Version) >= 29) {
            perms.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
          }
          await PermissionsAndroid.requestMultiple(perms);
        } catch {}
      }
      PositionEngine.startTracking();
    };

    initLocation();

    const unsubscribe = PositionEngine.subscribe((newPos) => {
      setPosition(newPos);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Calculate straight-line distance from user to a destination
  const getDistanceToDestination = useCallback(
    (dest: RoutePoint): string => {
      const dMeters = RouteEngine.haversineDistance(
        { latitude: position.latitude, longitude: position.longitude },
        dest
      );
      if (dMeters < 1000) return `${Math.round(dMeters)} m`;
      return `${(dMeters / 1000).toFixed(1)} km`;
    },
    [position]
  );

  // Dynamic Route Planner
  const planRouteToDestination = useCallback(
    async (
      destPoint: RoutePoint,
      destName: string,
      mode: TravelMode = travelMode
    ) => {
      setIsRouting(true);
      const originPoint: RoutePoint = {
        latitude: position.latitude,
        longitude: position.longitude,
      };

      try {
        const route = await RouteEngine.planRouteAsync(
          originPoint,
          originText,
          destPoint,
          destName,
          mode
        );
        setPlannedRoute(route);
      } catch {
        const fallbackRoute = RouteEngine.planRoute(
          originPoint,
          originText,
          destPoint,
          destName,
          mode
        );
        setPlannedRoute(fallbackRoute);
      } finally {
        setIsRouting(false);
      }
    },
    [position, originText, travelMode]
  );

  // Handle Search Input Text Change with Live Geocoding
  const handleDestinationTextChange = (text: string) => {
    setDestinationText(text);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (text.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      const results = await RouteEngine.searchPlacesAsync(text, {
        latitude: position.latitude,
        longitude: position.longitude,
      });
      setSearchResults(results);
      setIsSearching(false);
    }, 350);
  };

  // Select place from search suggestions
  const handleSelectPlace = (place: PresetDestination) => {
    Keyboard.dismiss();
    setSelectedDestination(place);
    setDestinationText(place.name);
    setSearchResults([]);
    planRouteToDestination(
      { latitude: place.latitude, longitude: place.longitude },
      place.name,
      travelMode
    );
  };

  // Map Tap to select coordinate anywhere on the map
  const handleMapCoordinateSelected = async (lat: number, lon: number) => {
    Keyboard.dismiss();
    setSearchResults([]);
    setIsRouting(true);

    const placeName = await RouteEngine.reverseGeocodeAsync(lat, lon);
    setDestinationText(placeName);
    const destPoint = { latitude: lat, longitude: lon };
    setSelectedDestination({
      id: `map_tap_${Date.now()}`,
      name: placeName,
      subtitle: `Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}`,
      latitude: lat,
      longitude: lon,
      category: 'Map Pin',
    });

    await planRouteToDestination(destPoint, placeName, travelMode);
  };

  // Travel Mode Switch
  const handleTravelModeChange = (mode: TravelMode) => {
    setTravelMode(mode);
    if (plannedRoute && selectedDestination) {
      planRouteToDestination(
        { latitude: selectedDestination.latitude, longitude: selectedDestination.longitude },
        selectedDestination.name,
        mode
      );
    }
  };

  const isBlackout = position.mode === 'NIDR_DEAD_RECKONING';

  return (
    <TouchableWithoutFeedback onPress={() => {
      Keyboard.dismiss();
      setSearchResults([]);
    }}>
      <View style={styles.container}>
        {/* Full-Screen Real Geographic Tile Map (Hero Layer) */}
        <InteractiveTileMap
          currentPosition={{
            latitude: position.isSnappedToPath && position.snappedLatitude ? position.snappedLatitude : position.latitude,
            longitude: position.isSnappedToPath && position.snappedLongitude ? position.snappedLongitude : position.longitude,
          }}
          headingDeg={position.isSnappedToPath && position.roadBearingDeg !== undefined ? position.roadBearingDeg : position.headingDeg}
          route={plannedRoute}
          mode={position.mode}
          accuracyM={position.accuracyM}
          speedMps={position.speedMps}
          isSnappedToPath={position.isSnappedToPath}
          onSelectMapCoordinate={handleMapCoordinateSelected}
        />

        {/* Top Floating Navigation Header */}
        <View style={styles.topFloatingHeader}>
          {/* Brand & Live Status Row */}
          <View style={styles.headerStatusRow}>
            <View style={styles.brandBadge}>
              <Navigation size={15} color="#B8860B" />
              <Text style={styles.brandTitle}>NIDR</Text>
              <Text style={styles.brandSubtitle}>MAPS</Text>
            </View>

            {/* GNSS / Blackout Status Pill */}
            <View
              style={[
                styles.gnssStatusPill,
                isBlackout ? styles.gnssStatusPillBlackout : styles.gnssStatusPillActive,
              ]}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isBlackout
                      ? '#B8860B'
                      : position.hasAcquiredFix || position.latitude !== 0
                      ? '#047857'
                      : '#94A3B8',
                  },
                ]}
              />
              <Text
                style={[
                  styles.gnssStatusText,
                  {
                    color: isBlackout
                      ? '#B8860B'
                      : position.hasAcquiredFix || position.latitude !== 0
                      ? '#047857'
                      : '#64748B',
                  },
                ]}>
                {isBlackout
                  ? 'NIDR DEAD RECKONING'
                  : position.hasAcquiredFix || position.latitude !== 0
                  ? `GNSS FIXED (±${position.accuracyM.toFixed(1)}m)`
                  : 'ACQUIRING GNSS...'}
              </Text>
            </View>
          </View>

          {/* Live Real-Time Coordinates & Blackout Toggle Bar */}
          <View style={styles.coordsBanner}>
            <View style={styles.coordsCol}>
              <Text style={styles.coordsBannerLabel}>LIVE COORDINATES</Text>
              <Text style={styles.coordsBannerText}>
                {position.latitude !== 0
                  ? `${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}`
                  : 'ACQUIRING FIX...'}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.blackoutToggleBtn,
                isBlackout ? styles.blackoutToggleBtnActive : styles.blackoutToggleBtnInactive,
              ]}
              onPress={() => {
                PositionEngine.setSimulatedBlackout(!isBlackout);
              }}>
              <Text
                style={[
                  styles.blackoutToggleText,
                  isBlackout ? styles.blackoutToggleTextActive : styles.blackoutToggleTextInactive,
                ]}>
                {isBlackout ? 'RESTORE GPS' : 'TEST GPS OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Live Physical Sensor Dead Reckoning Telemetry HUD Card */}
          {isBlackout && (
            <View style={styles.liveIdrCard}>
              <View style={styles.liveIdrHeaderRow}>
                <View style={styles.liveIdrBadge}>
                  <Compass size={13} color="#B8860B" />
                  <Text style={styles.liveIdrBadgeText}>PHONE IMU SENSORS ACTIVE</Text>
                </View>
                <Text style={styles.liveIdrSubText}>DEAD RECKONING LIVE</Text>
              </View>

              <View style={styles.liveMetricsGrid}>
                <View style={styles.liveMetricItem}>
                  <Text style={styles.liveMetricValue}>
                    {position.blackoutDistanceM.toFixed(1)} m
                  </Text>
                  <Text style={styles.liveMetricLabel}>WALK DISTANCE</Text>
                </View>
                <View style={styles.liveMetricItem}>
                  <Text style={styles.liveMetricValue}>
                    {position.stepCount || 0}
                  </Text>
                  <Text style={styles.liveMetricLabel}>STEPS</Text>
                </View>
                <View style={styles.liveMetricItem}>
                  <Text style={styles.liveMetricValue}>
                    {Math.round(position.headingDeg)}°
                  </Text>
                  <Text style={styles.liveMetricLabel}>AZIMUTH</Text>
                </View>
                <View style={styles.liveMetricItem}>
                  <Text style={styles.liveMetricValue}>
                    ±{position.accuracyM.toFixed(1)} m
                  </Text>
                  <Text style={styles.liveMetricLabel}>UNCERTAINTY</Text>
                </View>
              </View>
            </View>
          )}

          {/* Floating Search / Destination Input Card */}
          <View style={styles.searchCard}>
            <View style={styles.inputRow}>
              <View style={styles.pointDot} />
              <TextInput
                style={styles.textInput}
                value={destinationText}
                onChangeText={handleDestinationTextChange}
                placeholder="Where to? (Search place or tap map)"
                placeholderTextColor="#94A3B8"
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (searchResults.length > 0) {
                    handleSelectPlace(searchResults[0]);
                  }
                }}
              />
              {isSearching ? (
                <ActivityIndicator size="small" color="#B8860B" />
              ) : destinationText.length > 0 ? (
                <TouchableOpacity
                  onPress={() => {
                    setDestinationText('');
                    setSelectedDestination(null);
                    setPlannedRoute(null);
                    setSearchResults([]);
                  }}>
                  <X size={16} color="#94A3B8" />
                </TouchableOpacity>
              ) : (
                <Search size={16} color="#94A3B8" />
              )}
            </View>

            {/* Travel Mode Selector */}
            <View style={styles.modesRow}>
              {(['Walk', 'Run', 'Cycle', 'Drive'] as TravelMode[]).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.modeChip,
                    travelMode === mode && styles.modeChipActive,
                  ]}
                  onPress={() => handleTravelModeChange(mode)}>
                  <Text
                    style={[
                      styles.modeChipText,
                      travelMode === mode && styles.modeChipTextActive,
                    ]}>
                    {mode.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Live Search Results Dropdown */}
          {searchResults.length > 0 && (
            <View style={styles.searchResultsDropdown}>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                style={styles.searchResultsList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => handleSelectPlace(item)}>
                    <View style={styles.searchResultIcon}>
                      <MapPin size={16} color="#B8860B" />
                    </View>
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.searchResultSubtitle} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    </View>
                    <Text style={styles.searchResultDistance}>
                      {getDistanceToDestination({
                        latitude: item.latitude,
                        longitude: item.longitude,
                      })}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>

        {/* Bottom Floating Navigation Action Card */}
        {plannedRoute && !showPreviewSheet && (
          <View style={styles.bottomFloatingCard}>
            <View style={styles.routeQuickInfo}>
              <View style={styles.routeHeaderCol}>
                <Text style={styles.destNameText} numberOfLines={1}>
                  {plannedRoute.destinationName}
                </Text>
                <Text style={styles.routeStatsText}>
                  {isRouting
                    ? 'Calculating live road geometry...'
                    : `${(plannedRoute.distanceM / 1000).toFixed(1)} km • ${Math.round(
                        plannedRoute.durationS / 60
                      )} min ${plannedRoute.travelMode} • ${plannedRoute.maneuvers.length} turns`}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.detailsBtn}
                onPress={() => setShowPreviewSheet(true)}>
                <Text style={styles.detailsBtnText}>PREVIEW</Text>
              </TouchableOpacity>
            </View>

            {/* Primary Navigation Launch Button */}
            <TouchableOpacity
              style={[
                styles.startNavButton,
                isRouting && { opacity: 0.7 },
              ]}
              disabled={isRouting}
              onPress={() => onStartNavigation(plannedRoute)}>
              {isRouting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Navigation size={18} color="#FFFFFF" />
                  <Text style={styles.startNavButtonText}>START NAVIGATION</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Full Route Pre-flight Sheet */}
        {showPreviewSheet && plannedRoute && (
          <RoutePreviewSheet
            route={plannedRoute}
            onStartNavigation={() => {
              setShowPreviewSheet(false);
              onStartNavigation(plannedRoute);
            }}
            onCancel={() => setShowPreviewSheet(false)}
          />
        )}
      </View>
    </TouchableWithoutFeedback>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topFloatingHeader: {
    position: 'absolute',
    top: 10,
    left: 14,
    right: 14,
    gap: 8,
  },
  headerStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  brandTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  brandSubtitle: {
    color: '#B8860B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  gnssStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  gnssStatusPillActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#047857',
    borderWidth: 1,
  },
  gnssStatusPillBlackout: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#B8860B',
    borderWidth: 1.5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  gnssStatusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  coordsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  coordsCol: {
    flex: 1,
  },
  coordsBannerLabel: {
    color: '#855E15',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  coordsBannerText: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.3,
  },
  blackoutToggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  blackoutToggleBtnInactive: {
    backgroundColor: '#FFFBEB',
    borderColor: '#B8860B',
  },
  blackoutToggleBtnActive: {
    backgroundColor: '#047857',
    borderColor: '#047857',
  },
  blackoutToggleText: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  blackoutToggleTextInactive: {
    color: '#855E15',
  },
  blackoutToggleTextActive: {
    color: '#FFFFFF',
  },
  liveIdrCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: '#B8860B',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 10,
    elevation: 5,
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    gap: 8,
  },
  liveIdrHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 6,
  },
  liveIdrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveIdrBadgeText: {
    color: '#855E15',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  liveIdrSubText: {
    color: '#047857',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  liveMetricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveMetricItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#FDFBF7',
    borderColor: '#EFE6D5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    marginHorizontal: 2,
  },
  liveMetricValue: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
  },
  liveMetricLabel: {
    color: '#855E15',
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  searchCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderColor: '#DFD0B8',
    borderWidth: 1.2,
    borderRadius: 14,
    padding: 10,
    elevation: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    gap: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  pointDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B8860B',
  },
  textInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
  },
  modesRow: {
    flexDirection: 'row',
    gap: 6,
  },
  modeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    paddingVertical: 6,
    borderRadius: 6,
  },
  modeChipActive: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 1.5,
  },
  modeChipText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
  },
  modeChipTextActive: {
    color: '#855E15',
    fontWeight: '800',
  },
  searchResultsDropdown: {
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 220,
    elevation: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    overflow: 'hidden',
  },
  searchResultsList: {
    paddingVertical: 4,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomColor: '#F1F5F9',
    borderBottomWidth: 1,
    gap: 10,
  },
  searchResultIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FDFBF7',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  searchResultSubtitle: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 1,
  },
  searchResultDistance: {
    color: '#B8860B',
    fontSize: 11,
    fontWeight: '800',
  },
  bottomFloatingCard: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.97)',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    elevation: 5,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    gap: 10,
  },
  routeQuickInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeHeaderCol: {
    flex: 1,
    marginRight: 8,
  },
  destNameText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  routeStatsText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  detailsBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailsBtnText: {
    color: '#855E15',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  startNavButton: {
    backgroundColor: '#B8860B',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 3,
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  startNavButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
});
