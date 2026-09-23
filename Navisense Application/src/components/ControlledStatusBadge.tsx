import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';
import type { ControlledStatus } from '../types/uiState';
import {
  IconRadio,
  IconShieldAlert,
  IconZap,
  IconAlertTriangle,
  IconCheckCircle,
  IconRotateCcw,
} from './Icons';

interface ControlledStatusBadgeProps {
  status: ControlledStatus;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export const ControlledStatusBadge: React.FC<ControlledStatusBadgeProps> = ({
  status,
  size = 'md',
  showIcon = true,
}) => {
  const getStatusConfig = (s: ControlledStatus) => {
    switch (s) {
      case 'GNSS CONNECTED':
        return {
          bgColor: '#ecfdf5',
          textColor: theme.colors.gnssEmerald,
          borderColor: '#a7f3d0',
          dotColor: theme.colors.gnssEmerald,
          icon: <IconRadio size={size === 'sm' ? 10 : 12} color={theme.colors.gnssEmerald} />,
        };
      case 'GNSS DEGRADED':
        return {
          bgColor: '#fffbeb',
          textColor: '#b45309',
          borderColor: '#fde68a',
          dotColor: '#f59e0b',
          icon: <IconAlertTriangle size={size === 'sm' ? 10 : 12} color="#b45309" />,
        };
      case 'GNSS SIGNAL LOST':
        return {
          bgColor: '#fef2f2',
          textColor: theme.colors.alertRose,
          borderColor: '#fecaca',
          dotColor: theme.colors.alertRose,
          icon: <IconShieldAlert size={size === 'sm' ? 10 : 12} color={theme.colors.alertRose} />,
        };
      case 'NIDR ACTIVE':
        return {
          bgColor: theme.colors.idrBgSoft,
          textColor: theme.colors.idrBlue,
          borderColor: '#bfdbfe',
          dotColor: theme.colors.idrBlue,
          icon: <IconZap size={size === 'sm' ? 10 : 12} color={theme.colors.idrBlue} />,
        };
      case 'NIDR DEGRADED':
        return {
          bgColor: '#fff7ed',
          textColor: '#c2410c',
          borderColor: '#fed7aa',
          dotColor: '#ea580c',
          icon: <IconAlertTriangle size={size === 'sm' ? 10 : 12} color="#c2410c" />,
        };
      case 'GNSS REACQUIRED':
      case 'RECONVERGING':
        return {
          bgColor: '#eff6ff',
          textColor: '#2563eb',
          borderColor: '#bfdbfe',
          dotColor: '#3b82f6',
          icon: <IconRotateCcw size={size === 'sm' ? 10 : 12} color="#2563eb" />,
        };
      case 'OFFLINE MODE':
        return {
          bgColor: '#faf5ff',
          textColor: '#7e22ce',
          borderColor: '#e9d5ff',
          dotColor: '#9333ea',
          icon: <IconRadio size={size === 'sm' ? 10 : 12} color="#7e22ce" />,
        };
      case 'ROUTE READY':
        return {
          bgColor: '#f0fdf4',
          textColor: '#15803d',
          borderColor: '#bbf7d0',
          dotColor: '#22c55e',
          icon: <IconCheckCircle size={size === 'sm' ? 10 : 12} color="#15803d" />,
        };
      case 'ROUTE UNAVAILABLE':
      case 'POSITION UNAVAILABLE':
      default:
        return {
          bgColor: '#f8fafc',
          textColor: theme.colors.textMuted,
          borderColor: theme.colors.borderLight,
          dotColor: '#94a3b8',
          icon: <IconAlertTriangle size={size === 'sm' ? 10 : 12} color={theme.colors.textMuted} />,
        };
    }
  };

  const cfg = getStatusConfig(status);

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: cfg.bgColor,
          borderColor: cfg.borderColor,
          paddingVertical: size === 'sm' ? 2 : size === 'lg' ? 6 : 4,
          paddingHorizontal: size === 'sm' ? 6 : size === 'lg' ? 10 : 8,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`System status: ${status}`}
    >
      {showIcon && cfg.icon}
      <View style={[styles.dot, { backgroundColor: cfg.dotColor }]} />
      <Text
        style={[
          styles.label,
          {
            color: cfg.textColor,
            fontSize: size === 'sm' ? 9 : size === 'lg' ? 12 : 10,
          },
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {status}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    gap: 5,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
