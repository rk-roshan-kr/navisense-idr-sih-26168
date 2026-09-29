import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSessionStore } from '../stores/useSessionStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { SensorBridge } from '../native/SensorBridge';
import { LocationBridge } from '../native/LocationBridge';
import { SensorWaveform } from '../components/SensorWaveform';
import { MovementMode } from '../types';
import { CircleDot, Play, Square, User, Zap } from '../components/Icon';

import { requestCorePermissions } from '../utils/permissionUtils';

const MOVEMENT_MODES: MovementMode[] = [
  'Walking',
  'Running',
  'Vehicle - Windshield',
  'Vehicle - Dashboard',
  'Vehicle - Cupholder',
];

export const CollectDataScreen: React.FC = () => {
  const {
    activeSessionId,
    movementMode,
    participant,
    isRecording,
    setMovementMode,
    setParticipant,
    setActiveSessionId,
    setIsRecording,
  } = useSessionStore();

  const { sensor, location, setSensorTelemetry, setLocationFix } = useTelemetryStore();
  const [sessionNotes, setSessionNotes] = useState('');

  useEffect(() => {
    const subSensor = SensorBridge.onTelemetry((t) => setSensorTelemetry(t));
    const subLoc = LocationBridge.onLocationUpdate((l) => setLocationFix(l));

    return () => {
      subSensor.remove();
      subLoc.remove();
    };
  }, [setSensorTelemetry, setLocationFix]);

  const handleStartRecording = async () => {
    const hasPermission = await requestCorePermissions();
    if (!hasPermission) return;

    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const newSessionId = `session_col_${timestamp}`;

    try {
      await LocationBridge.startLocationTracking(newSessionId);
      await SensorBridge.startRecording(newSessionId, movementMode, participant, 'COLLECT');
      setActiveSessionId(newSessionId);
      setIsRecording(true);
    } catch (e: any) {
      Alert.alert('Recording Error', e.message || 'Failed to start sensor recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      const imuResult = await SensorBridge.stopRecording();
      await LocationBridge.stopLocationTracking();
      setIsRecording(false);
      setActiveSessionId(null);

      Alert.alert(
        'Session Saved',
        `Session: ${imuResult.sessionId}\nSamples: ${imuResult.sampleCount.toLocaleString()}\nRate: ${imuResult.actualRateHz.toFixed(1)} Hz\nSaved to device.`
      );
    } catch (e: any) {
      Alert.alert('Stop Error', e.message || 'Failed to stop recording cleanly');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <CircleDot size={20} color="#B8860B" />
          <Text style={styles.title}>RESEARCH DATA COLLECTOR</Text>
        </View>
        <Text style={styles.subtitle}>
          High-Frequency GNSS + IMU Sensor Benchmark Generator
        </Text>
      </View>

      {/* Sensor Health Status Bar */}
      <View style={styles.statusRow}>
        <View style={[styles.statusChip, sensor ? styles.chipActive : styles.chipInactive]}>
          <Zap size={12} color={sensor ? '#047857' : '#64748B'} />
          <Text style={[styles.chipText, sensor && styles.chipTextActive]}>
            IMU: {sensor ? `${sensor.actualRateHz.toFixed(0)} Hz` : 'OFF'}
          </Text>
        </View>
        <View style={[styles.statusChip, location ? styles.chipActive : styles.chipInactive]}>
          <Text style={[styles.chipText, location && styles.chipTextActive]}>
            GNSS: {location ? `±${location.accuracyM.toFixed(1)}m` : 'SEARCHING'}
          </Text>
        </View>
      </View>

      {/* Metadata Configuration */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>SESSION CONFIGURATION</Text>

        <View style={styles.fieldRow}>
          <User size={16} color="#B8860B" />
          <TextInput
            style={styles.input}
            value={participant}
            onChangeText={setParticipant}
            placeholder="Participant / Contributor ID"
            placeholderTextColor="#94A3B8"
            editable={!isRecording}
          />
        </View>

        <Text style={styles.sectionLabel}>MOVEMENT MODE</Text>
        <View style={styles.modeGrid}>
          {MOVEMENT_MODES.map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.modeButton,
                movementMode === mode && styles.modeButtonSelected,
                isRecording && styles.disabledButton,
              ]}
              disabled={isRecording}
              onPress={() => setMovementMode(mode)}>
              <Text
                style={[
                  styles.modeButtonText,
                  movementMode === mode && styles.modeButtonTextSelected,
                ]}>
                {mode}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Live Waveform Monitor */}
      <SensorWaveform telemetry={sensor} requestedRateHz={100} />

      {/* Recording Control Button */}
      <View style={styles.actionContainer}>
        {!isRecording ? (
          <TouchableOpacity style={styles.startButton} onPress={handleStartRecording}>
            <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.startButtonText}>START RECORDING</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.stopButton} onPress={handleStopRecording}>
            <Square size={18} color="#FFFFFF" fill="#FFFFFF" />
            <Text style={styles.stopButtonText}>STOP &amp; SAVE SESSION</Text>
          </TouchableOpacity>
        )}
      </View>

      {activeSessionId && (
        <View style={styles.activeSessionBadge}>
          <Text style={styles.activeSessionText}>ACTIVE SESSION: {activeSessionId}</Text>
        </View>
      )}
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
  header: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  chipInactive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
  },
  chipText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  chipTextActive: {
    color: '#047857',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardHeader: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 8,
  },
  sectionLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  modeButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  modeButtonSelected: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
  },
  disabledButton: {
    opacity: 0.5,
  },
  modeButtonText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  modeButtonTextSelected: {
    color: '#855E15',
    fontWeight: '800',
  },
  actionContainer: {
    marginTop: 12,
  },
  startButton: {
    backgroundColor: '#B8860B',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 2,
    shadowColor: '#B8860B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  stopButton: {
    backgroundColor: '#991B1B',
    borderRadius: 10,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    elevation: 2,
    shadowColor: '#991B1B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  activeSessionBadge: {
    marginTop: 10,
    alignItems: 'center',
  },
  activeSessionText: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
