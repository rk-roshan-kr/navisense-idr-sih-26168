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
import { theme } from '../theme';
import {
  IconSearch,
  IconX,
  IconNavigation,
  IconMapPin,
  IconCompass,
  IconPlay,
} from './Icons';
import { PRESET_ROUTES } from '../utils/customRouteSimulator';
import type { TelemetryPacket } from '../types';

interface GoogleMapsExploreOverlayProps {
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  onStartDriving: () => void;
  onSwitchToCockpitHud: () => void;
  onOpenSettings: () => void;
  isLandscape?: boolean;
  destinationCoord?: [number, number] | null;
  originCoord?: [number, number] | null;
  onClearRoute?: () => void;
}

export const GoogleMapsExploreOverlay: React.FC<GoogleMapsExploreOverlayProps> = ({
  selectedPresetId,
  onSelectPreset,
  onStartDriving,
  onSwitchToCockpitHud,
  onOpenSettings,
  isLandscape = false,
  destinationCoord,
  originCoord,
  onClearRoute,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];

  const destinationTitle = activePreset.name.split('➔')[1]?.trim() ||
    activePreset.name.split(':')[1]?.trim() ||
    activePreset.name;

  const originTitle = activePreset.name.split('➔')[0]?.split(':')[0]?.trim() || 'My Location';

  // Search filter - matches name, city, destination or keywords
  const queryLower = searchQuery.toLowerCase().trim();
  const filteredPresets = PRESET_ROUTES.filter((r) =>
    r.name.toLowerCase().includes(queryLower) ||
    r.city.toLowerCase().includes(queryLower) ||
    r.id.toLowerCase().includes(queryLower)
  );

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
                    Select Delhi, Bangalore, or Chandigarh, or tap START for Live Car Drive
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
            <Text style={styles.featureText}>Offline Vector Tiles</Text>
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
    backgroundColor: '#188038',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  greenEtaText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  distanceText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5f6368',
  },
  fastestRouteText: {
    fontSize: 12,
    fontWeight: '600',
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
    color: '#70757a',
    marginTop: 3,
  },
  settingsMiniBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#f1f3f4',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Feature Pills */
  featureRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e8eaed',
  },
  featureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  featureText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3c4043',
  },

  /* Sheet Action Buttons */
  sheetActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  startDrivingBtn: {
    flex: 3,
    backgroundColor: '#1a73e8',
    borderRadius: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  startDrivingBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  hudQuickBtn: {
    flex: 2,
    backgroundColor: '#f1f3f4',
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudQuickBtnText: {
    color: '#3c4043',
    fontSize: 12,
    fontWeight: '800',
  },
});
