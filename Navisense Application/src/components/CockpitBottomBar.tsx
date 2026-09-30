import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { IconPlay, IconPause, IconRotateCcw, IconSatelliteOff, IconSettings } from './Icons';

interface CockpitBottomBarProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  isBlackout: boolean;
  onToggleBlackout: () => void;
  is3DMode?: boolean;
  onToggle3DMode?: () => void;
  onOpenDiagnostics: () => void;
  isLiveCarMode?: boolean;
  isLandscape?: boolean;
}

export const CockpitBottomBar: React.FC<CockpitBottomBarProps> = ({
  isPlaying,
  onTogglePlay,
  isBlackout,
  onToggleBlackout,
  onOpenDiagnostics,
  isLiveCarMode = false,
  isLandscape = false,
}) => {
  return (
    <View
      style={[styles.container, isLandscape && styles.landscapeContainer]}
      pointerEvents="box-none"
    >
      <View style={styles.actionButtonGroup}>
        {/* 1. Play / Pause Action Button */}
        <TouchableOpacity
          style={[styles.actionBtn, !isPlaying && styles.actionBtnResume]}
          onPress={onTogglePlay}
          activeOpacity={0.8}
        >
          {isPlaying ? (
            <IconPause size={14} color="#ffffff" />
          ) : (
            <IconPlay size={14} color="#ffffff" />
          )}
          <Text style={styles.actionBtnText}>
            {isPlaying ? 'PAUSE' : 'START'}
          </Text>
        </TouchableOpacity>

        {/* 2. Sleek Redesigned GNSS Outage / Blackout Simulator Button */}
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
              <IconRotateCcw size={14} color="#ffffff" />
            ) : (
              <IconSatelliteOff size={14} color="#fbbf24" />
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
      </View>

      {/* 3. Diagnostics & Failure Lab Gear Button */}
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
  actionButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    backgroundColor: '#09131f',
    borderRadius: 24,
    height: 40,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4,
  },
  actionBtnResume: {
    backgroundColor: '#1a73e8',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  outageBtn: {
    borderRadius: 24,
    height: 40,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  outageBtnNormal: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  outageBtnActive: {
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  outageBtnText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  outageBtnTextNormal: {
    color: '#f8fafc',
  },
  outageBtnTextActive: {
    color: '#ffffff',
  },

  settingsBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: 40,
    height: 40,
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
