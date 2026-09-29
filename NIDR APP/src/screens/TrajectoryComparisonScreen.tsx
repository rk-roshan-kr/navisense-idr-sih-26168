import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSessionStore } from '../stores/useSessionStore';
import { SessionBridge } from '../native/SessionBridge';
import { calculateEvaluationMetrics } from '../utils/trajectoryMetrics';
import { MetricScorecard } from '../components/MetricScorecard';
import { MapLibreViewer } from '../components/MapLibreViewer';
import { EvaluationMetrics, TrajectoryPoint } from '../types';
import { BarChart2, GitCompare, Layers } from '../components/Icon';

export const TrajectoryComparisonScreen: React.FC = () => {
  const { sessions, loadSessions } = useSessionStore();

  const [selectedRefSessionId, setSelectedRefSessionId] = useState<string>('');
  const [selectedIdrSessionId, setSelectedIdrSessionId] = useState<string>('');
  const [refPoints, setRefPoints] = useState<TrajectoryPoint[]>([]);
  const [idrPoints, setIdrPoints] = useState<TrajectoryPoint[]>([]);
  const [metrics, setMetrics] = useState<EvaluationMetrics | null>(null);
  const [isComparing, setIsComparing] = useState<boolean>(false);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleRunComparison = async () => {
    if (!selectedRefSessionId || !selectedIdrSessionId) {
      Alert.alert('Selection Required', 'Select both a Reference session and an IDR session.');
      return;
    }

    setIsComparing(true);
    try {
      const refData = await SessionBridge.readSessionTrajectories(selectedRefSessionId);
      const idrData = await SessionBridge.readSessionTrajectories(selectedIdrSessionId);

      setRefPoints(refData.gnssPoints);
      setIdrPoints(idrData.gnssPoints);

      const computed = calculateEvaluationMetrics(refData.gnssPoints, idrData.gnssPoints, 20.0);
      setMetrics(computed);

      if (!computed) {
        Alert.alert('Comparison Notice', 'Not enough points found in sessions for comparison.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to compare sessions');
    } finally {
      setIsComparing(false);
    }
  };

  const centerLat = idrPoints[0]?.latitude ?? refPoints[0]?.latitude ?? 0;
  const centerLon = idrPoints[0]?.longitude ?? refPoints[0]?.longitude ?? 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <GitCompare size={20} color="#B8860B" />
          <Text style={styles.title}>TRAJECTORY COMPARISON</Text>
        </View>
        <Text style={styles.subtitle}>
          Post-Test Pointwise Verification Against Independent Reference GNSS
        </Text>
      </View>

      {/* Session Selectors */}
      <View style={styles.selectorCard}>
        <Text style={styles.selectorTitle}>1. SELECT REFERENCE PHONE SESSION (GT)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {sessions
            .filter((s) => s.role === 'REFERENCE_PHONE' || s.role === 'COLLECT')
            .map((s) => (
              <TouchableOpacity
                key={s.sessionId}
                style={[
                  styles.sessionChip,
                  selectedRefSessionId === s.sessionId && styles.refChipSelected,
                ]}
                onPress={() => setSelectedRefSessionId(s.sessionId)}>
                <Text
                  style={[
                    styles.chipText,
                    selectedRefSessionId === s.sessionId && styles.chipTextSelected,
                  ]}>
                  {s.sessionId}
                </Text>
              </TouchableOpacity>
            ))}
        </ScrollView>

        <Text style={[styles.selectorTitle, { marginTop: 12 }]}>
          2. SELECT IDR TEST PHONE SESSION (OUTAGE)
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
          {sessions
            .filter((s) => s.role === 'IDR_TEST_PHONE' || s.role === 'COLLECT')
            .map((s) => (
              <TouchableOpacity
                key={s.sessionId}
                style={[
                  styles.sessionChip,
                  selectedIdrSessionId === s.sessionId && styles.idrChipSelected,
                ]}
                onPress={() => setSelectedIdrSessionId(s.sessionId)}>
                <Text
                  style={[
                    styles.chipText,
                    selectedIdrSessionId === s.sessionId && styles.chipTextSelected,
                  ]}>
                  {s.sessionId}
                </Text>
              </TouchableOpacity>
            ))}
        </ScrollView>

        <TouchableOpacity
          style={[styles.compareButton, isComparing && styles.disabledButton]}
          disabled={isComparing}
          onPress={handleRunComparison}>
          <BarChart2 size={18} color="#FFFFFF" />
          <Text style={styles.compareButtonText}>
            {isComparing ? 'CALCULATING POINTWISE DRIFT...' : 'EVALUATE DRIFT & TRAJECTORY'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Trajectory Map Overlay */}
      {refPoints.length > 0 && (
        <MapLibreViewer
          currentLat={centerLat}
          currentLon={centerLon}
          headingDeg={0}
          referenceTrajectory={refPoints}
          idrTrajectory={idrPoints}
          isBlackout={true}
        />
      )}

      {/* Scientific Scorecard */}
      {metrics && <MetricScorecard metrics={metrics} targetPercent={20.0} />}

      {/* Pointwise Breakdown Samples */}
      {metrics && metrics.pointwiseErrors.length > 0 && (
        <View style={styles.breakdownCard}>
          <View style={styles.breakdownHeader}>
            <Layers size={14} color="#94A3B8" />
            <Text style={styles.breakdownTitle}>POINTWISE ERROR TRACE SAMPLE</Text>
          </View>
          <View style={styles.traceHeaderRow}>
            <Text style={styles.traceHeaderCell}>Ref Dist (m)</Text>
            <Text style={styles.traceHeaderCell}>Error (m)</Text>
            <Text style={styles.traceHeaderCell}>Instant Drift %</Text>
          </View>
          {metrics.pointwiseErrors.slice(0, 10).map((pt, idx) => (
            <View key={idx} style={styles.traceRow}>
              <Text style={styles.traceCell}>{pt.referenceDistanceM.toFixed(1)} m</Text>
              <Text style={styles.traceCell}>{pt.errorM.toFixed(2)} m</Text>
              <Text style={[styles.traceCell, pt.driftPercent < 20 ? styles.textGood : styles.textHigh]}>
                {pt.driftPercent.toFixed(1)}%
              </Text>
            </View>
          ))}
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
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },
  selectorCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  selectorTitle: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  sessionChip: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
  },
  refChipSelected: {
    backgroundColor: '#ECFDF5',
    borderColor: '#047857',
    borderWidth: 1.5,
  },
  idrChipSelected: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 1.5,
  },
  chipText: {
    color: '#64748B',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  chipTextSelected: {
    color: '#0F172A',
    fontWeight: '700',
  },
  compareButton: {
    backgroundColor: '#B8860B',
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  disabledButton: {
    opacity: 0.5,
  },
  compareButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  breakdownCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  breakdownTitle: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  traceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  traceHeaderCell: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  traceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  traceCell: {
    color: '#0F172A',
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'center',
  },
  textGood: {
    color: '#047857',
    fontWeight: '700',
  },
  textHigh: {
    color: '#B45309',
    fontWeight: '700',
  },
});
