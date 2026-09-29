/**
 * NaviSense IDR Main Application Navigator
 *
 * Consumer navigation app tabs:
 * 1. Navigate (Plan route & active turn-by-turn guidance)
 * 2. Routes (Cached offline routes)
 * 3. Settings (Preferences & hidden developer mode)
 * 4. Diagnostics (Only displayed when Developer Mode is enabled in Settings)
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationHomeScreen } from '../screens/NavigationHomeScreen';
import { ActiveNavigationScreen } from '../screens/ActiveNavigationScreen';
import { SavedRoutesScreen } from '../screens/SavedRoutesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TestIdrScreen } from '../screens/TestIdrScreen';
import { CollectDataScreen } from '../screens/CollectDataScreen';
import { NavigationRoute } from '../types/navigation';
import { Compass, MapPin, Navigation, Settings, ShieldAlert } from '../components/Icon';

type TabKey = 'navigate' | 'routes' | 'settings' | 'diagnostics' | 'collector';

export const AppNavigator: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('navigate');
  const [activeRoute, setActiveRoute] = useState<NavigationRoute | null>(null);
  const [isNavigating, setIsNavigating] = useState<boolean>(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState<boolean>(false);

  const handleStartNavigation = (route: NavigationRoute) => {
    setActiveRoute(route);
    setIsNavigating(true);
  };

  const handleEndNavigation = () => {
    setIsNavigating(false);
    setActiveRoute(null);
  };

  const handleSelectSavedRoute = (route: NavigationRoute) => {
    setActiveRoute(route);
    setIsNavigating(true);
    setActiveTab('navigate');
  };

  return (
    <View style={styles.container}>
      {/* Screen Canvas Area */}
      <View style={styles.content}>
        {activeTab === 'navigate' && (
          <>
            {isNavigating && activeRoute ? (
              <ActiveNavigationScreen
                route={activeRoute}
                onEndNavigation={handleEndNavigation}
              />
            ) : (
              <NavigationHomeScreen
                onStartNavigation={handleStartNavigation}
                onOpenSettings={() => setActiveTab('settings')}
              />
            )}
          </>
        )}

        {activeTab === 'routes' && (
          <SavedRoutesScreen onSelectRoute={handleSelectSavedRoute} />
        )}

        {activeTab === 'settings' && (
          <SettingsScreen
            developerModeEnabled={developerModeEnabled}
            onToggleDeveloperMode={setDeveloperModeEnabled}
            onOpenDiagnostics={() => setActiveTab('diagnostics')}
            onOpenCollector={() => setActiveTab('collector')}
          />
        )}

        {activeTab === 'diagnostics' && <TestIdrScreen />}

        {activeTab === 'collector' && <CollectDataScreen />}
      </View>

      {/* Consumer Bottom Navigation Bar (Hidden during active turn-by-turn navigation) */}
      {!isNavigating && (
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'navigate' && styles.tabItemActive]}
            onPress={() => setActiveTab('navigate')}>
            <Navigation
              size={18}
              color={activeTab === 'navigate' ? '#B8860B' : '#64748B'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'navigate' && styles.tabLabelActive,
              ]}>
              MAP & NAV
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'routes' && styles.tabItemActive]}
            onPress={() => setActiveTab('routes')}>
            <MapPin
              size={18}
              color={activeTab === 'routes' ? '#B8860B' : '#64748B'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'routes' && styles.tabLabelActive,
              ]}>
              ROUTES
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'settings' && styles.tabItemActive]}
            onPress={() => setActiveTab('settings')}>
            <Settings
              size={18}
              color={activeTab === 'settings' ? '#B8860B' : '#64748B'}
            />
            <Text
              style={[
                styles.tabLabel,
                activeTab === 'settings' && styles.tabLabelActive,
              ]}>
              SETTINGS
            </Text>
          </TouchableOpacity>

          {/* Developer Diagnostics Tab (Only visible when Developer Mode is enabled) */}
          {developerModeEnabled && (
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'diagnostics' && styles.tabItemActiveDev]}
              onPress={() => setActiveTab('diagnostics')}>
              <ShieldAlert
                size={18}
                color={activeTab === 'diagnostics' ? '#B45309' : '#64748B'}
              />
              <Text
                style={[
                  styles.tabLabel,
                  activeTab === 'diagnostics' && styles.tabLabelDevActive,
                ]}>
                DIAGNOSTICS
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    height: 58,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 4,
    paddingTop: 4,
    elevation: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#B8860B',
    marginTop: -2,
  },
  tabItemActiveDev: {
    borderTopWidth: 2,
    borderTopColor: '#B45309',
    marginTop: -2,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  tabLabelActive: {
    color: '#B8860B',
    fontWeight: '900',
  },
  tabLabelDevActive: {
    color: '#B45309',
    fontWeight: '900',
  },
});
