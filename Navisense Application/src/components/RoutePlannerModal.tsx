import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { theme } from '../theme';
import { PRESET_ROUTES } from '../utils/customRouteSimulator';
import { IconX, IconCheckCircle } from './Icons';

interface RoutePlannerModalProps {
  visible: boolean;
  onClose: () => void;
  selectedPresetId: string;
  onSelectPreset: (presetId: string) => void;
  customOrigin: [number, number] | null;
  customDestination: [number, number] | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClearPoints: () => void;
  statusMsg: string;
}

export const RoutePlannerModal: React.FC<RoutePlannerModalProps> = ({
  visible,
  onClose,
  selectedPresetId,
  onSelectPreset,
  customOrigin,
  customDestination,
  isPlaying,
  onTogglePlay,
  onClearPoints,
  statusMsg,
}) => {
  const activePreset = PRESET_ROUTES.find((p) => p.id === selectedPresetId) || PRESET_ROUTES[0];
  const originCoord = customOrigin || activePreset.origin;
  const destCoord = customDestination || activePreset.destination;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.titleTag}>CORRIDOR & ROUTE PLANNER</Text>
              <Text style={styles.statusNote}>{statusMsg}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <IconX size={18} color={theme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Subway-Stop Origin & Destination Connector */}
          <View style={styles.connectorCard}>
            {/* Origin Stop */}
            <View style={styles.stopRow}>
              <View style={styles.nodeColumn}>
                <View style={[styles.stopDot, { backgroundColor: theme.colors.gnssEmerald }]} />
                <View style={styles.trackLine} />
              </View>
              <View style={styles.stopInfo}>
                <Text style={styles.stopLabel}>POINT A / ORIGIN</Text>
                <View style={styles.coordChip}>
                  <Text style={styles.coordText}>
                    {originCoord[0].toFixed(5)}°, {originCoord[1].toFixed(5)}°
                  </Text>
                </View>
              </View>
            </View>

            {/* Destination Stop */}
            <View style={styles.stopRow}>
              <View style={styles.nodeColumn}>
                <View style={[styles.stopDot, { backgroundColor: theme.colors.idrBlue }]} />
              </View>
              <View style={styles.stopInfo}>
                <Text style={styles.stopLabel}>POINT B / DESTINATION</Text>
                <View style={styles.coordChip}>
                  <Text style={styles.coordText}>
                    {destCoord[0].toFixed(5)}°, {destCoord[1].toFixed(5)}°
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Preset Corridors */}
          <Text style={styles.sectionLabel}>PRESET EVALUATION CORRIDORS</Text>
          <ScrollView style={styles.presetList}>
            {PRESET_ROUTES.map((p) => {
              const isSelected = p.id === selectedPresetId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.presetCard, isSelected && styles.presetCardSelected]}
                  onPress={() => onSelectPreset(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.presetTextGroup}>
                    <Text style={[styles.presetName, isSelected && styles.presetNameSelected]}>
                      {p.name}
                    </Text>
                    <Text style={styles.presetDesc}>
                      {p.city} • {p.distanceKm} km • GNSS Lockdown zone {Math.round(p.lockdown[0] * 100)}%-{Math.round(p.lockdown[1] * 100)}%
                    </Text>
                  </View>
                  {isSelected && (
                    <IconCheckCircle size={18} color={theme.colors.idrBlue} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Actions */}
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                onTogglePlay();
                onClose();
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryBtnText}>
                {isPlaying ? 'PAUSE NAVIGATION' : 'START SIMULATION'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.clearBtn} onPress={onClearPoints}>
              <Text style={styles.clearBtnText}>RESET</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    padding: 18,
    ...theme.shadows.card,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  titleTag: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.idrBlue,
    letterSpacing: 0.8,
  },
  statusNote: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  connectorCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    padding: 12,
    marginBottom: 14,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  nodeColumn: {
    alignItems: 'center',
    width: 20,
    marginRight: 10,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
  },
  trackLine: {
    width: 2,
    height: 28,
    backgroundColor: '#cbd5e1',
    marginVertical: 2,
  },
  stopInfo: {
    flex: 1,
    marginBottom: 6,
  },
  stopLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.textMuted,
    marginBottom: 2,
  },
  coordChip: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    alignSelf: 'flex-start',
  },
  coordText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontMono,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  presetList: {
    maxHeight: 180,
    marginBottom: 14,
  },
  presetCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  presetCardSelected: {
    backgroundColor: theme.colors.idrBgSoft,
    borderColor: theme.colors.idrBorder,
  },
  presetTextGroup: {
    flex: 1,
    marginRight: 8,
  },
  presetName: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  presetNameSelected: {
    color: theme.colors.idrBlue,
  },
  presetDesc: {
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtn: {
    flex: 2,
    backgroundColor: theme.colors.slateDark,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.4,
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
});
