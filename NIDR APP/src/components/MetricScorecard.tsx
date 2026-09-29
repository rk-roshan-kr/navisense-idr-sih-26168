import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EvaluationMetrics } from '../types';
import { CheckCircle2, XCircle } from './Icon';

interface MetricScorecardProps {
  metrics: EvaluationMetrics;
  targetPercent?: number;
}

export const MetricScorecard: React.FC<MetricScorecardProps> = ({
  metrics,
  targetPercent = 20.0,
}) => {
  const isPass = metrics.finalDriftPercent <= targetPercent;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>SCIENTIFIC EVALUATION SCORECARD</Text>
          <Text style={styles.subtitle}>IDR Trajectory vs. Independent Reference GNSS</Text>
        </View>
        <View style={[styles.badge, isPass ? styles.badgePass : styles.badgeFail]}>
          {isPass ? <CheckCircle2 size={16} color="#10B981" /> : <XCircle size={16} color="#EF4444" />}
          <Text style={[styles.badgeText, isPass ? styles.badgeTextPass : styles.badgeTextFail]}>
            {isPass ? 'TARGET MET' : 'TARGET EXCEEDED'}
          </Text>
        </View>
      </View>

      <View style={styles.headlineRow}>
        <View style={styles.headlineBlock}>
          <Text style={styles.headlineLabel}>FINAL DRIFT</Text>
          <Text style={[styles.headlineValue, isPass ? styles.textPass : styles.textFail]}>
            {metrics.finalDriftPercent.toFixed(1)}%
          </Text>
          <Text style={styles.headlineSub}>Target: &lt;{targetPercent.toFixed(0)}%</Text>
        </View>
        <View style={styles.headlineBlock}>
          <Text style={styles.headlineLabel}>FINAL ERROR</Text>
          <Text style={styles.headlineValue}>{metrics.finalErrorM.toFixed(2)} m</Text>
          <Text style={styles.headlineSub}>over {metrics.totalReferenceDistanceM.toFixed(1)} m</Text>
        </View>
        <View style={styles.headlineBlock}>
          <Text style={styles.headlineLabel}>MAX DRIFT</Text>
          <Text style={styles.headlineValue}>{metrics.maxDriftPercent.toFixed(1)}%</Text>
          <Text style={styles.headlineSub}>peak divergence</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>Reference Traveled Distance</Text>
          <Text style={styles.cellValue}>{metrics.totalReferenceDistanceM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>IDR Integrated Distance</Text>
          <Text style={styles.cellValue}>{metrics.totalIdrDistanceM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>Maximum Pointwise Error</Text>
          <Text style={styles.cellValue}>{metrics.maxPointwiseErrorM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>Mean Pointwise Error</Text>
          <Text style={styles.cellValue}>{metrics.meanPointwiseErrorM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>95th-Percentile Error</Text>
          <Text style={styles.cellValue}>{metrics.p95PointwiseErrorM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>Mean Along-Track Error (Longitudinal)</Text>
          <Text style={styles.cellValue}>{metrics.meanAlongTrackErrorM.toFixed(2)} m</Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={styles.cellLabel}>Mean Cross-Track Error (Lateral)</Text>
          <Text style={styles.cellValue}>{metrics.meanCrossTrackErrorM.toFixed(2)} m</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginVertical: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  title: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgePass: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
  },
  badgeFail: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  badgeTextPass: {
    color: '#047857',
  },
  badgeTextFail: {
    color: '#991B1B',
  },
  headlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headlineBlock: {
    alignItems: 'center',
    flex: 1,
  },
  headlineLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '700',
  },
  headlineValue: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    marginVertical: 2,
    fontVariant: ['tabular-nums'],
  },
  headlineSub: {
    color: '#94A3B8',
    fontSize: 9,
  },
  textPass: {
    color: '#047857',
  },
  textFail: {
    color: '#991B1B',
  },
  table: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  cellLabel: {
    color: '#64748B',
    fontSize: 11,
  },
  cellValue: {
    color: '#0F172A',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
