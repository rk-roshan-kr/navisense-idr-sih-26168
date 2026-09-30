import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { IconPlay, IconPause, IconRefresh, IconZap, IconSettings } from './Icons';

interface CockpitBottomBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  isBlackout: boolean;
  onToggleBlackout: () => void;
  is3DMode: boolean;
  onToggle3DMode: () => void;
  onOpenDiagnostics: () => void;
  isLiveCarMode?: boolean;
  isLandscape?: boolean;
}

export const CockpitBottomBar: React.FC<CockpitBottomBarProps> = ({
  isPlaying,
  onTogglePlay,
  isBlackout,
  onToggleBlackout,
  is3DMode,
  onToggle3DMode,
  onOpenDiagnostics,
  isLiveCarMode = false,
  isLandscape = false,
}) => {
  return (
    <View
      style={[styles.container, isLandscape && styles.landscapeContainer]}
      pointerEvents="box-none"
    >
      {/* 1. Left Segmented Camera Toggle: 3D Cockpit vs 2D Freecam */}
      <View style={styles.segmentedToggle}>
        <TouchableOpacity
          style={[styles.segmentBtn, is3DMode && styles.segmentBtnActive]}
          onPress={() => {
            if (!is3DMode) onToggle3DMode();
          }}
          activeOpacity={0.8}
        >
          {is3DMode && <View style={styles.greenDot} />}
          <Text style={[styles.segmentText, is3DMode && styles.segmentTextActive]}>
            3D Cockpit
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, !is3DMode && styles.segmentBtnActive]}
          onPress={() => {
            if (is3DMode) onToggle3DMode();
          }}
          activeOpacity={0.8}
        >
          {!is3DMode && <View style={styles.greenDot} />}
          <Text style={[styles.segmentText, !is3DMode && styles.segmentTextActive]}>
            2D Freecam
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2. Middle Play / Pause Action Button */}
      <TouchableOpacity
        style={[styles.actionBtn, !isPlaying && styles.actionBtnResume]}
        onPress={onTogglePlay}
        activeOpacity={0.8}
      >
        {isPlaying ? (
          <IconPause size={13} color="#ffffff" />
        ) : (
          <IconPlay size={13} color="#ffffff" />
        )}
        <Text style={styles.actionBtnText}>
          {isPlaying ? 'PAUSE' : 'START'}
        </Text>
      </TouchableOpacity>

      {/* 3. GNSS Outage Simulator / Restore Button — ONLY shown in Benchmark Simulator mode! */}
      {!isLiveCarMode && (
        <TouchableOpacity
          style={[
            styles.outageBtn,
            isBlackout ? styles.outageBtnActive : styles.outageBtnNormal,
          ]}
          onPress={onToggleBlackout}
          activeOpacity={0.8}
        >
          {isBlackout ? (
            <IconRefresh size={13} color="#dc2626" />
          ) : (
            <IconZap size={13} color="#b45309" />
          )}
          <Text
            style={[
              styles.outageBtnText,
              isBlackout ? styles.outageBtnTextActive : styles.outageBtnTextNormal,
            ]}
          >
            {isBlackout ? 'RESTORE GNSS FIX' : 'SIMULATE BLACKOUT'}
          </Text>
        </TouchableOpacity>
      )}

      {/* 4. Diagnostics & Failure Lab Gear Button */}
      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={onOpenDiagnostics}
        activeOpacity={0.8}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel="Open Technical Architecture & Diagnostics"
      >
        <IconSettings size={18} color="#1e293b" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 16,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 100,
    gap: 6,
  },
  landscapeContainer: {
    left: 400,
    right: 16,
    bottom: 12,
    justifyContent: 'flex-end',
    gap: 10,
  },
  segmentedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 3,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentBtn: {
    paddingVertical: 5.5,
    paddingHorizontal: 9,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  segmentBtnActive: {
    backgroundColor: '#09131f',
  },
  greenDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10b981',
  },
  segmentText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#ffffff',
  },

  actionBtn: {
    backgroundColor: '#09131f',
    borderRadius: 22,
    paddingVertical: 7,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  actionBtnResume: {
    backgroundColor: '#2563eb',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  outageBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingVertical: 6.5,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  outageBtnActive: {
    borderColor: '#fca5a5',
  },
  outageBtnNormal: {
    borderColor: '#fde047',
  },
  outageBtnText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  outageBtnTextActive: {
    color: '#dc2626',
  },
  outageBtnTextNormal: {
    color: '#b45309',
  },

  settingsBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
