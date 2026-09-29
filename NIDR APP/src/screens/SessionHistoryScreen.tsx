import React, { useEffect } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSessionStore } from '../stores/useSessionStore';
import { SessionBridge } from '../native/SessionBridge';
import { SessionInfo } from '../types';
import { Archive, Database, Download, RefreshCw, Share2, Trash2 } from '../components/Icon';

export const SessionHistoryScreen: React.FC = () => {
  const { sessions, isLoading, loadSessions, deleteSession } = useSessionStore();

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleExportZip = async (sessionId: string) => {
    try {
      const zipPath = await SessionBridge.exportSessionZip(sessionId);
      Alert.alert(
        'Session Exported',
        `ZIP archive saved to Downloads folder:\n${zipPath}\nReady for workstation GPU training.`
      );
    } catch (e: any) {
      Alert.alert('Export Failed', e.message || 'Could not export session archive');
    }
  };

  const handleShareZip = async (sessionId: string) => {
    try {
      await SessionBridge.shareSessionZip(sessionId);
    } catch (e: any) {
      Alert.alert('Share Failed', e.message || 'Could not open share dialog');
    }
  };

  const handleExportAll = async () => {
    try {
      const zipPath = await SessionBridge.exportAllSessionsZip();
      Alert.alert(
        'All Datasets Exported',
        `Master archive with timelog manifest generated at:\n${zipPath}\nIncludes dataset_timelog_manifest.json and CSV.`
      );
    } catch (e: any) {
      Alert.alert('Export Failed', e.message || 'No sessions to export');
    }
  };

  const handleShareAll = async () => {
    try {
      await SessionBridge.shareAllSessionsZip();
    } catch (e: any) {
      Alert.alert('Share Failed', e.message || 'Could not share master dataset ZIP');
    }
  };

  const handleDelete = (sessionId: string) => {
    Alert.alert(
      'Delete Session',
      `Permanently delete ${sessionId} from device storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSession(sessionId),
        },
      ]
    );
  };

  const renderSessionItem = ({ item }: { item: SessionInfo }) => {
    const imuKb = ((item.imuFileSize ?? 0) / 1024).toFixed(0);
    const gnssKb = ((item.gnssFileSize ?? 0) / 1024).toFixed(0);
    const dateStr = item.startUnixTimeMs ? new Date(item.startUnixTimeMs).toLocaleString() : 'Unknown';

    return (
      <View style={styles.sessionCard}>
        <View style={styles.cardHeader}>
          <View style={styles.badgeContainer}>
            <View
              style={[
                styles.roleBadge,
                item.role === 'REFERENCE_PHONE'
                  ? styles.roleBadgeRef
                  : item.role === 'IDR_TEST_PHONE'
                  ? styles.roleBadgeIdr
                  : styles.roleBadgeCol,
              ]}>
              <Text style={styles.roleBadgeText}>{item.role}</Text>
            </View>
            <Text style={styles.modeText}>{item.movementMode}</Text>
          </View>
          <Text style={styles.dateText}>{dateStr}</Text>
        </View>

        <Text style={styles.sessionIdText}>{item.sessionId}</Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaItem}>
            Device: <Text style={styles.metaHighlight}>{item.deviceModel}</Text>
          </Text>
          <Text style={styles.metaItem}>
            Samples: <Text style={styles.metaHighlight}>{(item.imuSampleCount ?? 0).toLocaleString()}</Text>
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaItem}>
            IMU File: <Text style={styles.metaHighlight}>{imuKb} KB</Text>
          </Text>
          <Text style={styles.metaItem}>
            Rate: <Text style={styles.metaHighlight}>{(item.actualRateHz ?? 0).toFixed(1)} Hz</Text>
          </Text>
          <Text style={styles.metaItem}>
            GNSS: <Text style={styles.metaHighlight}>{gnssKb} KB</Text>
          </Text>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => handleShareZip(item.sessionId)}>
            <Share2 size={14} color="#10B981" />
            <Text style={styles.shareButtonText}>SHARE</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.exportButton}
            onPress={() => handleExportZip(item.sessionId)}>
            <Download size={14} color="#B8860B" />
            <Text style={styles.exportButtonText}>SAVE ZIP</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDelete(item.sessionId)}>
            <Trash2 size={14} color="#EF4444" />
            <Text style={styles.deleteButtonText}>DELETE</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Database size={20} color="#B8860B" />
          <Text style={styles.title}>SESSION ARCHIVES</Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={loadSessions}>
          <RefreshCw size={16} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Batch Export All Datasets Banner */}
      {sessions.length > 0 && (
        <View style={styles.batchActionsRow}>
          <TouchableOpacity style={styles.exportAllButton} onPress={handleExportAll}>
            <Download size={14} color="#F59E0B" />
            <Text style={styles.exportAllButtonText}>EXPORT ALL (ZIP + TIMELOG)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareAllButton} onPress={handleShareAll}>
            <Share2 size={14} color="#10B981" />
            <Text style={styles.shareAllButtonText}>SHARE ALL</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={renderSessionItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Archive size={32} color="#334155" />
            <Text style={styles.emptyText}>No recorded sessions found.</Text>
            <Text style={styles.emptySub}>
              Sessions recorded in Mode 1 or Mode 2 appear here.
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
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  refreshButton: {
    padding: 6,
  },
  batchActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  exportAllButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 1.5,
    paddingVertical: 8,
    borderRadius: 8,
  },
  exportAllButtonText: {
    color: '#855E15',
    fontSize: 11,
    fontWeight: '800',
  },
  shareAllButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#F0FDF4',
    borderColor: '#047857',
    borderWidth: 1,
    paddingVertical: 8,
    borderRadius: 8,
  },
  shareAllButtonText: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingBottom: 30,
  },
  sessionCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  roleBadgeCol: {
    backgroundColor: '#FEF3C7',
  },
  roleBadgeRef: {
    backgroundColor: '#ECFDF5',
  },
  roleBadgeIdr: {
    backgroundColor: '#FDFBF7',
    borderColor: '#DFD0B8',
    borderWidth: 1,
  },
  roleBadgeText: {
    color: '#0F172A',
    fontSize: 9,
    fontWeight: '800',
  },
  modeText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  dateText: {
    color: '#94A3B8',
    fontSize: 10,
  },
  sessionIdText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  metaItem: {
    color: '#64748B',
    fontSize: 11,
  },
  metaHighlight: {
    color: '#0F172A',
    fontWeight: '700',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderColor: '#047857',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  shareButtonText: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  exportButtonText: {
    color: '#855E15',
    fontSize: 10,
    fontWeight: '800',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#991B1B',
    fontSize: 10,
    fontWeight: '800',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 4,
  },
});
