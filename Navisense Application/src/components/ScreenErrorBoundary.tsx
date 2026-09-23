import React, { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { IconAlertTriangle, IconRotateCcw } from './Icons';

interface Props {
  children?: ReactNode;
  screenName?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ScreenErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message || 'Component failed to render safely',
    };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn(`[ScreenErrorBoundary] Error caught in ${this.props.screenName || 'Component'}:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <IconAlertTriangle size={24} color={theme.colors.alertRose} />
          </View>
          <Text style={styles.title}>
            {this.props.screenName ? `${this.props.screenName} Paused` : 'View Temporarily Unavailable'}
          </Text>
          <Text style={styles.desc}>
            An isolated render failure occurred in this section. The core navigation and dead reckoning engine continues operating unaffected.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleReset} activeOpacity={0.8}>
            <IconRotateCcw size={14} color="#ffffff" />
            <Text style={styles.retryText}>RELOAD VIEW</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    margin: 8,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fef2f2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  desc: {
    fontSize: 11,
    color: theme.colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.idrBlue,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  retryText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
});
