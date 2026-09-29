import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useBlackoutStore } from '../stores/useBlackoutStore';
import { useTelemetryStore } from '../stores/useTelemetryStore';
import { LocationBridge } from '../native/LocationBridge';
import { SensorBridge } from '../native/SensorBridge';
import { IdrBridge } from '../native/IdrBridge';
import { BlackoutBanner } from '../components/BlackoutBanner';
import { LiveHudPuck } from '../components/LiveHudPuck';
import { MapLibreViewer } from '../components/MapLibreViewer';
import { MetricScorecard } from '../components/MetricScorecard';
import { SessionRole } from '../types';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Compass,
  Lock,
  Radio,
  RotateCcw,
  ShieldAlert,
  Zap,
} from '../components/Icon';
import { requestCorePermissions } from '../utils/permissionUtils';

export const TestIdrScreen: React.FC = () => {
  const {
    lifecycle,
    testRole,
    anchor,
    referenceTrajectory,
    idrTrajectory,
    metrics,
    setTestRole,
    startAcquiringLock,
    lockAnchorAndPrepare,
    triggerBlackoutCutoff,
    restoreGnssAndComplete,
    resetTest,
    addReferencePoint,
    addIdrPoint,
  } = useBlackoutStore();

  const { location, idrState, setLocationFix, setIdrState } = useTelemetryStore();
  const [activeSessionId, setActiveSessionId] = useState<string>('');

  useEffect(() => {
    const subLoc = LocationBridge.onLocationUpdate((l) => {
      setLocationFix(l);
      if (testRole === 'REFERENCE_PHONE' || lifecycle === 'ACQUIRING_LOCK' || lifecycle === 'BLACKOUT_ACTIVE') {
        addReferencePoint({
          elapsedRealtimeNanos: l.elapsedRealtimeNanos,
          unixTimeMs: l.unixTimeMs,
          latitude: l.latitude,
          longitude: l.longitude,
          speedMps: l.speedMps,
          headingDeg: l.bearingDeg,
        });
      }
    });

    const subIdr = IdrBridge.onIdrStateUpdate((s) => {
      setIdrState(s);
      if (lifecycle === 'BLACKOUT_ACTIVE') {
        addIdrPoint({
          elapsedRealtimeNanos: 0,
          unixTimeMs: Date.now(),
          latitude: s.latitude,
          longitude: s.longitude,
          eastOffsetM: s.eastOffsetM,
          northOffsetM: s.northOffsetM,
          headingDeg: s.headingDeg,
          speedMps: s.speedMps,
          cumulativeDistanceM: s.cumulativeDistanceM,
          uncertaintyM: s.uncertaintyM,
        });
      }
    });

    return () => {
      subLoc.remove();
      subIdr.remove();
    };
  }, [testRole, lifecycle, addReferencePoint, addIdrPoint, setLocationFix, setIdrState]);

  const handleStartAcquiring = async () => {
    const hasPermission = await requestCorePermissions();
    if (!hasPermission) return;

    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const sid = testRole === 'REFERENCE_PHONE' ? `session_ref_${ts}` : `session_idr_${ts}`;
    setActiveSessionId(sid);

    // Start background sensor recording with native wakelock
    await SensorBridge.startRecording(sid, 'Walking', 'Tester', testRole);
    await startAcquiringLock(sid);
  };

  const handleLockAnchor = async () => {
    const success = await lockAnchorAndPrepare();
    if (!success) {
      Alert.alert('Lock Failed', 'Awaiting valid GNSS fix before freezing anchor.');
    }
  };

  const handleTriggerBlackout = async () => {
    await triggerBlackoutCutoff();
  };

  const handleEndOutage = async () => {
    await restoreGnssAndComplete();
    await SensorBridge.stopRecording();
  };

  const isBlackout = lifecycle === 'BLACKOUT_ACTIVE';
  const currentLat = isBlackout
    ? (idrState?.latitude ?? anchor?.latitude ?? 0)
    : (location?.latitude ?? idrState?.latitude ?? 0);
  const currentLon = isBlackout
    ? (idrState?.longitude ?? anchor?.longitude ?? 0)
    : (location?.longitude ?? idrState?.longitude ?? 0);
  const currentHeading = idrState?.headingDeg ?? location?.bearingDeg ?? 0;
  const currentSpeed = isBlackout ? (idrState?.speedMps ?? 0) : (location?.speedMps ?? 0);
  const distance = idrState?.cumulativeDistanceM ?? 0;
  const uncertainty = idrState?.uncertaintyM ?? 0.5;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ShieldAlert size={20} color="#B8860B" />
          <Text style={styles.title}>TEST IDR: 40m OUTAGE BENCHMARK</Text>
        </View>
        <Text style={styles.subtitle}>
          Strict Programmatic Blackout Isolation • Reference GNSS vs. Pure IMU Rollout
        </Text>
      </View>

      {/* Role Selection */}
      <View style={styles.roleContainer}>
        <TouchableOpacity
          style={[
            styles.roleButton,
            testRole === 'IDR_TEST_PHONE' && styles.roleButtonSelected,
            lifecycle !== 'IDLE' && styles.roleButtonDisabled,
          ]}
          disabled={lifecycle !== 'IDLE'}
          onPress={() => setTestRole('IDR_TEST_PHONE')}>
          <Compass size={16} color={testRole === 'IDR_TEST_PHONE' ? '#B8860B' : '#94A3B8'} />
          <Text
            style={[
              styles.roleButtonText,
              testRole === 'IDR_TEST_PHONE' && styles.roleButtonTextSelected,
            ]}>
            PHONE B: IDR TEST (OUTAGE)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.roleButton,
            testRole === 'REFERENCE_PHONE' && styles.roleButtonSelected,
            lifecycle !== 'IDLE' && styles.roleButtonDisabled,
          ]}
          disabled={lifecycle !== 'IDLE'}
          onPress={() => setTestRole('REFERENCE_PHONE')}>
          <Radio size={16} color={testRole === 'REFERENCE_PHONE' ? '#047857' : '#94A3B8'} />
          <Text
            style={[
              styles.roleButtonText,
              testRole === 'REFERENCE_PHONE' && styles.roleButtonTextSelected,
            ]}>
            PHONE A: REFERENCE GNSS
          </Text>
        </TouchableOpacity>
      </View>

      {/* Blackout State Warning Banner */}
      <BlackoutBanner
        isActive={isBlackout}
        distanceM={distance}
        uncertaintyM={uncertainty}
      />

      {/* Real-time Telemetry Cards */}
      <View style={styles.telemetryCard}>
        <View style={styles.telemetryRow}>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>STATUS</Text>
            <Text style={[styles.telemetryVal, { color: isBlackout ? '#B8860B' : '#047857' }]}>
              {isBlackout ? 'IDR MODE' : location ? 'GNSS ACTIVE' : 'STANDBY'}
            </Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>GNSS ACCESS</Text>
            <Text style={[styles.telemetryVal, { color: isBlackout ? '#991B1B' : '#047857' }]}>
              {isBlackout ? 'DISABLED (0%)' : 'CONNECTED'}
            </Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>DISTANCE</Text>
            <Text style={styles.telemetryVal}>{distance.toFixed(1)} m</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>UNCERTAINTY</Text>
            <Text style={[styles.telemetryVal, { color: '#F87171' }]}>±{uncertainty.toFixed(1)} m</Text>
          </View>
        </View>

        <View style={[styles.telemetryRow, { marginTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 6 }]}>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>SPEED</Text>
            <Text style={styles.telemetryVal}>{currentSpeed.toFixed(2)} m/s</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>HEADING</Text>
            <Text style={styles.telemetryVal}>{Math.round(currentHeading)}°</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>CADENCE</Text>
            <Text style={styles.telemetryVal}>{currentSpeed > 0.3 ? '1.8 Hz' : '0 Hz'}</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>REGIME</Text>
            <Text style={[styles.telemetryVal, { color: '#C084FC' }]}>
              {idrState?.regime ?? (currentSpeed > 0.3 ? 'steady_walk' : 'stationary')}
            </Text>
          </View>
        </View>
      </View>

      {/* Live MapLibre & Vector Trajectory Viewer */}
      <MapLibreViewer
        currentLat={currentLat}
        currentLon={currentLon}
        headingDeg={currentHeading}
        referenceTrajectory={referenceTrajectory}
        idrTrajectory={idrTrajectory}
        anchorLat={anchor?.latitude}
        anchorLon={anchor?.longitude}
        isBlackout={isBlackout}
        uncertaintyM={uncertainty}
      />

      {/* State Machine Action Controls */}
      <View style={styles.actionBlock}>
        {lifecycle === 'IDLE' && (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleStartAcquiring}>
            <Activity size={20} color="#FFFFFF" />
            <Text style={styles.btnText}>1. ACQUIRE INITIAL GNSS FIX</Text>
          </TouchableOpacity>
        )}

        {lifecycle === 'ACQUIRING_LOCK' && (
          <TouchableOpacity style={styles.btnAmber} onPress={handleLockAnchor}>
            <Lock size={20} color="#FFFFFF" />
            <Text style={styles.btnText}>
              2. FREEZE ANCHOR (P0 = {location ? `±${location.accuracyM.toFixed(1)}m` : 'WAITING'})
            </Text>
          </TouchableOpacity>
        )}

        {lifecycle === 'READY_TO_TEST' && (
          <TouchableOpacity style={styles.btnDanger} onPress={handleTriggerBlackout}>
            <AlertTriangle size={20} color="#FFFFFF" />
            <Text style={styles.btnText}>3. START OUTAGE (TRIGGER BLACKOUT)</Text>
          </TouchableOpacity>
        )}

        {lifecycle === 'BLACKOUT_ACTIVE' && (
          <TouchableOpacity style={styles.btnEndOutage} onPress={handleEndOutage}>
            <RotateCcw size={20} color="#FFFFFF" />
            <Text style={styles.btnText}>4. END OUTAGE & RESTORE REFERENCE GNSS</Text>
          </TouchableOpacity>
        )}

        {lifecycle === 'TEST_COMPLETE' && (
          <TouchableOpacity style={styles.btnNeutral} onPress={resetTest}>
            <RotateCcw size={18} color="#CBD5E1" />
            <Text style={styles.btnNeutralText}>START NEW OUTAGE TEST</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 40m Outage Result Summary Card */}
      {metrics && (
        <View style={styles.outageResultCard}>
          <View style={styles.outageResultHeader}>
            <CheckCircle size={18} color={metrics.isTargetMet ? '#10B981' : '#EF4444'} />
            <Text style={styles.outageResultTitle}>40 m OUTAGE RESULT</Text>
            <View style={[styles.verdictBadge, metrics.isTargetMet ? styles.verdictPass : styles.verdictFail]}>
              <Text style={styles.verdictText}>
                {metrics.isTargetMet ? 'QUALITY GATE: PASS' : 'QUALITY GATE: FAIL'}
              </Text>
            </View>
          </View>

          <View style={styles.resultMetricsTable}>
            <View style={styles.metricItemRow}>
              <Text style={styles.metricItemLabel}>Reference distance</Text>
              <Text style={styles.metricItemValue}>{metrics.totalReferenceDistanceM.toFixed(2)} m</Text>
            </View>
            <View style={styles.metricItemRow}>
              <Text style={styles.metricItemLabel}>Endpoint error</Text>
              <Text style={styles.metricItemValue}>{metrics.finalErrorM.toFixed(2)} m</Text>
            </View>
            <View style={styles.metricItemRow}>
              <Text style={styles.metricItemLabel}>Gate drift</Text>
              <Text style={[styles.metricItemValue, metrics.finalDriftPercent <= 20 ? styles.textPass : styles.textFail]}>
                {metrics.finalDriftPercent.toFixed(1)} %
              </Text>
            </View>
            <View style={styles.metricItemRow}>
              <Text style={styles.metricItemLabel}>Maximum point error</Text>
              <Text style={styles.metricItemValue}>{metrics.maxPointwiseErrorM.toFixed(2)} m</Text>
            </View>
            <View style={styles.metricItemRow}>
              <Text style={styles.metricItemLabel}>P95 error</Text>
              <Text style={styles.metricItemValue}>{metrics.p95PointwiseErrorM.toFixed(2)} m</Text>
            </View>
          </View>
        </View>
      )}

      {/* Detailed Pointwise Metric Scorecard */}
      {metrics && <MetricScorecard metrics={metrics} targetPercent={20.0} />}
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
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 8,
    elevation: 1,
  },
  roleButtonSelected: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
  },
  roleButtonDisabled: {
    opacity: 0.5,
  },
  roleButtonText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
  },
  roleButtonTextSelected: {
    color: '#855E15',
    fontWeight: '900',
  },
  telemetryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginVertical: 6,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  telemetryItem: {
    alignItems: 'center',
    flex: 1,
  },
  telemetryLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  telemetryVal: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  actionBlock: {
    marginTop: 10,
    marginBottom: 10,
  },
  btnPrimary: {
    backgroundColor: '#B8860B',
    paddingVertical: 14,
    borderRadius: 10,
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
  btnAmber: {
    backgroundColor: '#B45309',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnDanger: {
    backgroundColor: '#991B1B',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnEndOutage: {
    backgroundColor: '#047857',
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnNeutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  btnNeutralText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  outageResultCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginVertical: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  outageResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  outageResultTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
    flex: 1,
    marginLeft: 6,
  },
  verdictBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  verdictPass: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
  },
  verdictFail: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  verdictText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#047857',
  },
  resultMetricsTable: {
    gap: 6,
  },
  metricItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  metricItemLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  metricItemValue: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  textPass: {
    color: '#047857',
  },
  textFail: {
    color: '#991B1B',
  },
});
