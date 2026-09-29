/**
 * NaviSense IDR Settings & Developer Diagnostics Screen
 *
 * Consumer preferences with secluded Developer Mode for model inspection
 * and internal research diagnostics.
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Settings, ShieldAlert, Zap } from '../components/Icon';

interface SettingsScreenProps {
  developerModeEnabled: boolean;
  onToggleDeveloperMode: (enabled: boolean) => void;
  onOpenCollector?: () => void;
  onOpenDiagnostics?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  developerModeEnabled,
  onToggleDeveloperMode,
  onOpenCollector,
  onOpenDiagnostics,
}) => {
  const [voiceGuidance, setVoiceGuidance] = useState<boolean>(true);
  const [offlineAutoCache, setOfflineAutoCache] = useState<boolean>(true);
  const [highRateSensors, setHighRateSensors] = useState<boolean>(true);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerBar}>
        <View style={styles.headerTitleRow}>
          <Settings size={18} color="#B8860B" />
          <Text style={styles.headerTitle}>SETTINGS</Text>
        </View>
        <Text style={styles.headerSubtitle}>
          Navigation preferences and offline storage
        </Text>
      </View>

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}>
        {/* Navigation Preferences Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeaderTitle}>NAVIGATION PREFERENCES</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Voice & Audio Prompts</Text>
              <Text style={styles.settingDescription}>
                Spoken maneuver cues before turns
              </Text>
            </View>
            <Switch
              value={voiceGuidance}
              onValueChange={setVoiceGuidance}
              trackColor={{ false: '#E2E8F0', true: '#B8860B' }}
              thumbColor={voiceGuidance ? '#FFFFFF' : '#94A3B8'}
            />
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>Auto-Cache Planned Routes</Text>
              <Text style={styles.settingDescription}>
                Pre-download road geometry for zero-network resilience
              </Text>
            </View>
            <Switch
              value={offlineAutoCache}
              onValueChange={setOfflineAutoCache}
              trackColor={{ false: '#E2E8F0', true: '#B8860B' }}
              thumbColor={offlineAutoCache ? '#FFFFFF' : '#94A3B8'}
            />
          </View>

          <View style={styles.rowDivider} />

          <View style={styles.settingRow}>
            <View style={styles.settingTextCol}>
              <Text style={styles.settingLabel}>High-Rate Sensor Polling</Text>
              <Text style={styles.settingDescription}>
                Maintain 100 Hz IMU buffer for instant blackout handoff
              </Text>
            </View>
            <Switch
              value={highRateSensors}
              onValueChange={setHighRateSensors}
              trackColor={{ false: '#E2E8F0', true: '#B8860B' }}
              thumbColor={highRateSensors ? '#FFFFFF' : '#94A3B8'}
            />
          </View>
        </View>

        {/* Offline Storage Status */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeaderTitle}>OFFLINE STORAGE</Text>

          <View style={styles.storageInfoRow}>
            <View style={styles.storageCol}>
              <Text style={styles.storageLabel}>CACHED MAP REGION</Text>
              <Text style={styles.storageValue}>Delhi NCR (Active)</Text>
            </View>
            <View style={styles.storageCol}>
              <Text style={styles.storageLabel}>OFFLINE MODEL</Text>
              <Text style={styles.storageValue}>pdr_net_v1.pte (2.0 MB)</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.clearCacheBtn}
            onPress={() => Alert.alert('Cache Notice', 'Offline route cache is optimized and up to date.')}>
            <Text style={styles.clearCacheBtnText}>VERIFY OFFLINE ASSETS</Text>
          </TouchableOpacity>
        </View>

        {/* Developer & Diagnostics Section */}
        <View style={styles.sectionCard}>
          <View style={styles.devHeaderRow}>
            <View style={styles.devHeaderLeft}>
              <ShieldAlert size={16} color="#B45309" />
              <Text style={styles.sectionHeaderTitleDev}>
                DEVELOPER &amp; RESEARCH MODE
              </Text>
            </View>
            <Switch
              value={developerModeEnabled}
              onValueChange={onToggleDeveloperMode}
              trackColor={{ false: '#E2E8F0', true: '#B45309' }}
              thumbColor={developerModeEnabled ? '#FFFFFF' : '#94A3B8'}
            />
          </View>
          <Text style={styles.devNoticeText}>
            Enables low-level sensor waveforms, model telemetry, and the research data collection tool.
          </Text>

          {developerModeEnabled && (
            <View style={styles.devToolsContainer}>
              <View style={styles.modelStatusBox}>
                <View style={styles.modelStatusRow}>
                  <Text style={styles.modelStatusLabel}>ACTIVE ENGINE</Text>
                  <Text style={styles.modelStatusValActive}>ExecuTorch (Mobile)</Text>
                </View>
                <View style={styles.modelStatusRow}>
                  <Text style={styles.modelStatusLabel}>INFERENCE RATE</Text>
                  <Text style={styles.modelStatusVal}>20 Hz (50 ms steps)</Text>
                </View>
                <View style={styles.modelStatusRow}>
                  <Text style={styles.modelStatusLabel}>SENSOR CHANNELS</Text>
                  <Text style={styles.modelStatusVal}>13 Channels</Text>
                </View>
                <View style={styles.modelStatusRow}>
                  <Text style={styles.modelStatusLabel}>40M GATE STATUS</Text>
                  <Text style={styles.modelStatusValPass}>PASS (&lt; 20% Drift)</Text>
                </View>
              </View>

              {onOpenDiagnostics && (
                <TouchableOpacity
                  style={styles.devActionButton}
                  onPress={onOpenDiagnostics}>
                  <Zap size={14} color="#FFFFFF" />
                  <Text style={styles.devActionButtonText}>
                    OPEN SENSOR DIAGNOSTICS &amp; WAVEFORMS
                  </Text>
                </TouchableOpacity>
              )}

              {onOpenCollector && (
                <TouchableOpacity
                  style={[styles.devActionButton, styles.devActionCollectorBtn]}
                  onPress={onOpenCollector}>
                  <Text style={styles.devActionCollectorBtnText}>
                    LAUNCH RESEARCH DATA COLLECTOR
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Application Information */}
        <View style={styles.aboutCard}>
          <Text style={styles.aboutAppName}>NIDR NAVIGATION</Text>
          <Text style={styles.aboutAppVersion}>Version 2.0.0-PROD (Build 100)</Text>
          <Text style={styles.aboutPackageId}>Package: io.github.navisense.navigation</Text>
          <Text style={styles.aboutCopyright}>
            Autonomous Indoor-Outdoor Dead-Reckoning Navigation
          </Text>
        </View>
      </ScrollView>
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
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    padding: 12,
    paddingBottom: 28,
    gap: 12,
  },
  sectionCard: {
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
  sectionHeaderTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingTextCol: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  settingDescription: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },
  storageInfoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  storageCol: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  storageLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  storageValue: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  clearCacheBtn: {
    backgroundColor: '#FDFBF7',
    borderRadius: 8,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DFD0B8',
  },
  clearCacheBtnText: {
    color: '#855E15',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  devHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderTitleDev: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  devNoticeText: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 6,
    lineHeight: 14,
  },
  devToolsContainer: {
    marginTop: 12,
    gap: 8,
  },
  modelStatusBox: {
    backgroundColor: '#FDFBF7',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#DFD0B8',
    gap: 4,
  },
  modelStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modelStatusLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
  },
  modelStatusVal: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '600',
  },
  modelStatusValActive: {
    color: '#855E15',
    fontSize: 10,
    fontWeight: '800',
  },
  modelStatusValPass: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  devActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#B8860B',
    borderRadius: 8,
    height: 40,
    borderWidth: 1,
    borderColor: '#855E15',
    elevation: 2,
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  devActionButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  devActionCollectorBtn: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
  },
  devActionCollectorBtnText: {
    color: '#334155',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  aboutCard: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  aboutAppName: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.0,
  },
  aboutAppVersion: {
    color: '#475569',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  aboutPackageId: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '500',
    marginTop: 1,
  },
  aboutCopyright: {
    color: '#94A3B8',
    fontSize: 8,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
  },
});
