import React, { useState, useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { theme } from '../theme';
import { IconCheckCircle, IconAlertTriangle } from './Icons';

export type ButtonInteractionState =
  | 'DEFAULT'
  | 'PRESSED'
  | 'DISABLED'
  | 'LOADING'
  | 'SUCCESS'
  | 'ERROR';

interface RobustButtonProps {
  label: string;
  onPress: () => Promise<void> | void;
  state?: ButtonInteractionState;
  disabled?: boolean;
  disabledReasons?: string[];
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  cooldownMs?: number;
  accessibilityLabel?: string;
}

export const RobustButton: React.FC<RobustButtonProps> = ({
  label,
  onPress,
  state = 'DEFAULT',
  disabled = false,
  disabledReasons = [],
  icon,
  variant = 'primary',
  style,
  textStyle,
  cooldownMs = 80,
  accessibilityLabel,
}) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const lastPressTimeRef = useRef<number>(0);

  const effectiveDisabled = disabled || state === 'DISABLED' || internalLoading || state === 'LOADING';
  const isLoading = state === 'LOADING' || internalLoading;

  const handlePress = async () => {
    if (effectiveDisabled) return;

    const now = Date.now();
    if (now - lastPressTimeRef.current < cooldownMs) {
      return;
    }
    lastPressTimeRef.current = now;

    try {
      const res = onPress();
      if (res instanceof Promise) {
        setInternalLoading(true);
        await res;
      }
    } finally {
      setInternalLoading(false);
    }
  };

  const getBackgroundColor = () => {
    if (effectiveDisabled) return '#e2e8f0';
    if (state === 'SUCCESS') return theme.colors.gnssEmerald;
    if (state === 'ERROR') return theme.colors.alertRose;

    switch (variant) {
      case 'secondary':
        return '#f1f5f9';
      case 'danger':
        return theme.colors.alertRose;
      case 'success':
        return theme.colors.gnssEmerald;
      case 'primary':
      default:
        return theme.colors.idrBlue;
    }
  };

  const getTextColor = () => {
    if (effectiveDisabled) return '#94a3b8';
    if (variant === 'secondary') return theme.colors.textPrimary;
    return '#ffffff';
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: getBackgroundColor() },
          style,
        ]}
        onPress={handlePress}
        disabled={effectiveDisabled}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityState={{ disabled: effectiveDisabled, busy: isLoading }}
      >
        {isLoading ? (
          <View style={styles.contentRow}>
            <ActivityIndicator size="small" color={getTextColor()} />
            <Text style={[styles.text, { color: getTextColor() }, textStyle]}>Processing...</Text>
          </View>
        ) : state === 'SUCCESS' ? (
          <View style={styles.contentRow}>
            <IconCheckCircle size={16} color="#ffffff" />
            <Text style={[styles.text, { color: '#ffffff' }, textStyle]}>{label}</Text>
          </View>
        ) : state === 'ERROR' ? (
          <View style={styles.contentRow}>
            <IconAlertTriangle size={16} color="#ffffff" />
            <Text style={[styles.text, { color: '#ffffff' }, textStyle]}>{label}</Text>
          </View>
        ) : (
          <View style={styles.contentRow}>
            {icon}
            <Text style={[styles.text, { color: getTextColor() }, textStyle]}>{label}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Explicit reasons if disabled */}
      {effectiveDisabled && disabledReasons.length > 0 && (
        <View style={styles.reasonsBox}>
          <Text style={styles.reasonsHeader}>Unavailable:</Text>
          {disabledReasons.map((reason, idx) => (
            <Text key={idx} style={styles.reasonItem}>
              • {reason}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    minHeight: 46,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  reasonsBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 6,
  },
  reasonsHeader: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.colors.alertRose,
    marginBottom: 2,
  },
  reasonItem: {
    fontSize: 10,
    color: '#991b1b',
    lineHeight: 14,
  },
});
