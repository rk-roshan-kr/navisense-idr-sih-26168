import React, { useState, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  Activity,
  Compass,
  Cpu,
  Database,
  FolderArchive,
  GitCompare,
  Navigation,
  Radio,
  Settings,
  ShieldAlert,
  Zap,
} from '../components/Icon';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { IdrBridge } from '../native/IdrBridge';
import { EngineType, MockScenario } from '../types';

interface HomeScreenProps {
  onNavigate: (tab: 'collect' | 'test' | 'sessions' | 'compare') => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate }) => {
  const telemetry = useTelemetryStore((s) => s.sensor);
  const location = useTelemetryStore((s) => s.location);

  const [selectedEngine, setSelectedEngine] = useState<EngineType>('MOCK');
  const [selectedScenario, setSelectedScenario] = useState<MockScenario>('MOCK_40M');

  const handleEngineChange = async (engine: EngineType, scenario: MockScenario = 'MOCK_40M') => {
    setSelectedEngine(engine);
    setSelectedScenario(scenario);
    await IdrBridge.setEngineType(engine, scenario);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Hero Brand Header */}
      <View style={styles.heroCard}>
        <View style={styles.brandBadge}>
          <Zap size={14} color="#B8860B" />
          <Text style={styles.brandBadgeText}>SYSTEM OPERATIONAL • FROZEN CONTRACT</Text>
        </View>

        <Text style={styles.heroTitle}>NIDR</Text>
        <Text style={styles.heroSubtitle}>Neural Inertial Dead Reckoning</Text>
        <Text style={styles.heroDesc}>
          High-frequency native pedestrian dead reckoning with decoupled model inference and GNSS blackout isolation.
        </Text>
      </View>

      {/* Real-time Hardware & Model Telemetry HUD */}
      <View style={styles.statusGrid}>
        <View style={styles.statusTile}>
          <View style={styles.tileHeader}>
            <Activity size={14} color="#B8860B" />
            <Text style={styles.tileLabel}>IMU STREAM</Text>
          </View>
          <Text style={styles.tileValue}>
            {telemetry ? `${telemetry.actualRateHz.toFixed(0)} Hz` : 'STANDBY'}
          </Text>
          <Text style={styles.tileSub}>500Hz Native Ring</Text>
        </View>

        <View style={styles.statusTile}>
          <View style={styles.tileHeader}>
            <Radio size={14} color={location ? '#10B981' : '#F59E0B'} />
            <Text style={styles.tileLabel}>GNSS LOCK</Text>
          </View>
          <Text style={[styles.tileValue, { color: location ? '#10B981' : '#F59E0B' }]}>
            {location ? `±${location.accuracyM.toFixed(1)}m` : 'SEARCHING'}
          </Text>
          <Text style={styles.tileSub}>{location ? 'Anchor Ready' : 'Awaiting Fix'}</Text>
        </View>

        <View style={styles.statusTile}>
          <View style={styles.tileHeader}>
            <Cpu size={14} color="#A855F7" />
            <Text style={styles.tileLabel}>MODEL ENGINE</Text>
          </View>
          <Text style={[styles.tileValue, { color: '#C084FC' }]}>
            {selectedEngine === 'MOCK' ? 'MOCK HARNESS' : 'EXECUTORCH'}
          </Text>
          <Text style={styles.tileSub}>
            {selectedEngine === 'MOCK' ? selectedScenario : 'pdr_net_v1.pte'}
          </Text>
        </View>
      </View>

      {/* Primary Action Hub Cards */}
      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>MISSION CONTROL</Text>

        {/* 1. TEST IDR */}
        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardPrimary]}
          onPress={() => onNavigate('test')}>
          <View style={styles.actionIconBadge}>
            <Compass size={24} color="#B8860B" />
          </View>
          <View style={styles.actionTextContainer}>
            <View style={styles.actionTitleRow}>
              <Text style={styles.actionTitle}>TEST IDR</Text>
              <View style={styles.pillActive}>
                <Text style={styles.pillText}>PRIMARY TEST</Text>
              </View>
            </View>
            <Text style={styles.actionDescription}>
              Run physical 40 m outage benchmark with hard software blackout isolation and live trajectory map.
            </Text>
          </View>
        </TouchableOpacity>

        {/* 2. COLLECT DATA */}
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => onNavigate('collect')}>
          <View style={[styles.actionIconBadge, { backgroundColor: '#064E3B' }]}>
            <Database size={24} color="#34D399" />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitle}>COLLECT DATA</Text>
            <Text style={styles.actionDescription}>
              Synchronized 17-channel IMU + GNSS ground truth data recorder for multi-phone contributor collection.
            </Text>
          </View>
        </TouchableOpacity>

        {/* 3. TRAJECTORY COMPARISON */}
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => onNavigate('compare')}>
          <View style={[styles.actionIconBadge, { backgroundColor: '#3B0764' }]}>
            <GitCompare size={24} color="#C084FC" />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitle}>TRAJECTORY COMPARISON</Text>
            <Text style={styles.actionDescription}>
              Post-test audit overlay: Reference GNSS vs IDR Dead-Reckoning, along-track drift, and Quality Gate verdict.
            </Text>
          </View>
        </TouchableOpacity>

        {/* 4. SESSION HISTORY */}
        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => onNavigate('sessions')}>
          <View style={[styles.actionIconBadge, { backgroundColor: '#E2E8F0' }]}>
            <FolderArchive size={24} color="#94A3B8" />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitle}>SESSION HISTORY</Text>
            <Text style={styles.actionDescription}>
              Browse persistent sessions, inspect sensor sample counts, canonical files, and trajectory packages.
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Model Engine Selector & Scenario Switcher */}
      <View style={styles.harnessSection}>
        <View style={styles.harnessHeader}>
          <Settings size={16} color="#94A3B8" />
          <Text style={styles.harnessTitle}>MODEL ENGINE & TEST HARNESS SELECTION</Text>
        </View>

        <View style={styles.engineToggleRow}>
          <TouchableOpacity
            style={[styles.engineToggleBtn, selectedEngine === 'MOCK' && styles.engineToggleBtnActive]}
            onPress={() => handleEngineChange('MOCK', selectedScenario)}>
            <Text style={[styles.engineToggleText, selectedEngine === 'MOCK' && styles.engineToggleTextActive]}>
              MOCK ENGINE (TEST HARNESS)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.engineToggleBtn, selectedEngine === 'EXECUTORCH' && styles.engineToggleBtnActive]}
            onPress={() => handleEngineChange('EXECUTORCH')}>
            <Text style={[styles.engineToggleText, selectedEngine === 'EXECUTORCH' && styles.engineToggleTextActive]}>
              EXECUTORCH (.PTE)
            </Text>
          </TouchableOpacity>
        </View>

        {selectedEngine === 'MOCK' && (
          <View style={styles.scenarioChipsContainer}>
            <Text style={styles.scenarioLabel}>DETERMINISTIC TEST SCENARIO:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {(
                [
                  'MOCK_40M',
                  'MOCK_STRAIGHT',
                  'MOCK_LEFT_TURN',
                  'MOCK_RIGHT_TURN',
                  'MOCK_CURVE',
                  'MOCK_STOP',
                  'MOCK_S_CURVE',
                ] as MockScenario[]
              ).map((sc) => (
                <TouchableOpacity
                  key={sc}
                  style={[styles.scenarioChip, selectedScenario === sc && styles.scenarioChipActive]}
                  onPress={() => handleEngineChange('MOCK', sc)}>
                  <Text style={[styles.scenarioChipText, selectedScenario === sc && styles.scenarioChipTextActive]}>
                    {sc.replace('MOCK_', '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  brandBadgeText: {
    color: '#B8860B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroTitle: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  heroSubtitle: {
    color: '#B8860B',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  heroDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  statusGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statusTile: {
    flex: 1,
    backgroundColor: '#0B132B',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  tileLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tileValue: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  tileSub: {
    color: '#64748B',
    fontSize: 9,
    marginTop: 2,
  },
  actionsSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  actionCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 10,
  },
  actionCardPrimary: {
    borderColor: '#B8860B',
    backgroundColor: '#07152B',
  },
  actionIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0F2744',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionDescription: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  pillActive: {
    backgroundColor: '#855E15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
  },
  harnessSection: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  harnessHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  harnessTitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  engineToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  engineToggleBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  engineToggleBtnActive: {
    backgroundColor: '#0F2744',
    borderColor: '#B8860B',
  },
  engineToggleText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
  },
  engineToggleTextActive: {
    color: '#B8860B',
    fontWeight: '900',
  },
  scenarioChipsContainer: {
    marginTop: 4,
  },
  scenarioLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
    marginBottom: 6,
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  scenarioChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2937',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  scenarioChipActive: {
    backgroundColor: '#1E1B4B',
    borderColor: '#6366F1',
  },
  scenarioChipText: {
    color: '#94A3B8',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  scenarioChipTextActive: {
    color: '#A5B4FC',
    fontWeight: '900',
  },
});
