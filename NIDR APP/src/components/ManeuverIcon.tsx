/**
 * NaviSense IDR Maneuver & Navigation Vector Icons
 *
 * 100% Pure React Native View components.
 * Zero external native library dependencies.
 * Strictly zero emojis.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ManeuverType, TravelMode } from '../types/navigation';

interface ManeuverIconProps {
  maneuver: ManeuverType | 'check' | 'satellite' | 'compass' | 'pulse';
  size?: number;
  color?: string;
}

export const ManeuverIcon: React.FC<ManeuverIconProps> = ({
  maneuver,
  size = 28,
  color = '#FFFFFF',
}) => {
  const containerStyle = { width: size, height: size, alignItems: 'center' as const, justifyContent: 'center' as const };

  switch (maneuver) {
    case 'straight':
    case 'depart':
      return (
        <View style={containerStyle}>
          {/* Arrow Head */}
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.28,
              borderRightWidth: size * 0.28,
              borderBottomWidth: size * 0.35,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          {/* Arrow Stem */}
          <View
            style={{
              width: Math.max(3, size * 0.16),
              height: size * 0.45,
              backgroundColor: color,
              borderRadius: 2,
              marginTop: -2,
            }}
          />
        </View>
      );

    case 'turn-left':
      return (
        <View style={containerStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Left arrow head */}
            <View
              style={{
                width: 0,
                height: 0,
                borderTopWidth: size * 0.25,
                borderBottomWidth: size * 0.25,
                borderRightWidth: size * 0.32,
                borderTopColor: 'transparent',
                borderBottomColor: 'transparent',
                borderRightColor: color,
              }}
            />
            {/* Horizontal bar */}
            <View
              style={{
                width: size * 0.3,
                height: Math.max(3, size * 0.16),
                backgroundColor: color,
                borderRadius: 2,
                marginLeft: -2,
              }}
            />
            {/* Vertical stem down */}
            <View
              style={{
                width: Math.max(3, size * 0.16),
                height: size * 0.45,
                backgroundColor: color,
                borderRadius: 2,
                marginLeft: -Math.max(3, size * 0.16),
                marginTop: size * 0.35,
              }}
            />
          </View>
        </View>
      );

    case 'turn-right':
      return (
        <View style={containerStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* Vertical stem down */}
            <View
              style={{
                width: Math.max(3, size * 0.16),
                height: size * 0.45,
                backgroundColor: color,
                borderRadius: 2,
                marginTop: size * 0.35,
              }}
            />
            {/* Horizontal bar */}
            <View
              style={{
                width: size * 0.3,
                height: Math.max(3, size * 0.16),
                backgroundColor: color,
                borderRadius: 2,
                marginLeft: -Math.max(3, size * 0.16),
              }}
            />
            {/* Right arrow head */}
            <View
              style={{
                width: 0,
                height: 0,
                borderTopWidth: size * 0.25,
                borderBottomWidth: size * 0.25,
                borderLeftWidth: size * 0.32,
                borderTopColor: 'transparent',
                borderBottomColor: 'transparent',
                borderLeftColor: color,
                marginLeft: -2,
              }}
            />
          </View>
        </View>
      );

    case 'turn-slight-left':
      return (
        <View style={[containerStyle, { transform: [{ rotate: '-35deg' }] }]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.24,
              borderRightWidth: size * 0.24,
              borderBottomWidth: size * 0.32,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: Math.max(3, size * 0.15),
              height: size * 0.42,
              backgroundColor: color,
              borderRadius: 2,
              marginTop: -2,
            }}
          />
        </View>
      );

    case 'turn-slight-right':
      return (
        <View style={[containerStyle, { transform: [{ rotate: '35deg' }] }]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.24,
              borderRightWidth: size * 0.24,
              borderBottomWidth: size * 0.32,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: Math.max(3, size * 0.15),
              height: size * 0.42,
              backgroundColor: color,
              borderRadius: 2,
              marginTop: -2,
            }}
          />
        </View>
      );

    case 'turn-sharp-left':
      return (
        <View style={[containerStyle, { transform: [{ rotate: '-70deg' }] }]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.24,
              borderRightWidth: size * 0.24,
              borderBottomWidth: size * 0.32,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: Math.max(3, size * 0.15),
              height: size * 0.4,
              backgroundColor: color,
              borderRadius: 2,
              marginTop: -2,
            }}
          />
        </View>
      );

    case 'turn-sharp-right':
      return (
        <View style={[containerStyle, { transform: [{ rotate: '70deg' }] }]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.24,
              borderRightWidth: size * 0.24,
              borderBottomWidth: size * 0.32,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: Math.max(3, size * 0.15),
              height: size * 0.4,
              backgroundColor: color,
              borderRadius: 2,
              marginTop: -2,
            }}
          />
        </View>
      );

    case 'u-turn':
      return (
        <View style={containerStyle}>
          <View
            style={{
              width: size * 0.6,
              height: size * 0.6,
              borderTopWidth: Math.max(3, size * 0.15),
              borderLeftWidth: Math.max(3, size * 0.15),
              borderRightWidth: Math.max(3, size * 0.15),
              borderTopLeftRadius: size * 0.3,
              borderTopRightRadius: size * 0.3,
              borderColor: color,
            }}
          />
          {/* Arrow pointing down on right side */}
          <View
            style={{
              position: 'absolute',
              right: size * 0.1,
              bottom: size * 0.15,
              width: 0,
              height: 0,
              borderLeftWidth: size * 0.18,
              borderRightWidth: size * 0.18,
              borderTopWidth: size * 0.25,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: color,
            }}
          />
        </View>
      );

    case 'arrive':
      return (
        <View style={containerStyle}>
          <View
            style={{
              width: size * 0.75,
              height: size * 0.75,
              borderRadius: size * 0.375,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: size * 0.35,
                height: size * 0.35,
                borderRadius: size * 0.175,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );

    case 'check':
      return (
        <View style={containerStyle}>
          <View
            style={{
              width: size * 0.6,
              height: size * 0.32,
              borderLeftWidth: Math.max(2, size * 0.14),
              borderBottomWidth: Math.max(2, size * 0.14),
              borderColor: color,
              transform: [{ rotate: '-45deg' }],
              marginTop: -size * 0.1,
            }}
          />
        </View>
      );

    default:
      return (
        <View style={containerStyle}>
          <View
            style={{
              width: size * 0.7,
              height: size * 0.7,
              borderRadius: size * 0.35,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: size * 0.25,
                height: size * 0.25,
                backgroundColor: color,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </View>
        </View>
      );
  }
};

interface ModeIconProps {
  mode: TravelMode;
  size?: number;
  color?: string;
}

export const ModeIcon: React.FC<ModeIconProps> = ({ mode, size = 16, color = '#FFFFFF' }) => {
  // Clean typography badge tag for travel mode with strictly zero emojis
  return (
    <View
      style={{
        paddingHorizontal: 4,
        paddingVertical: 1,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: color,
      }}>
      <Text
        style={{
          color: color,
          fontSize: Math.max(9, Math.round(size * 0.6)),
          fontWeight: '900',
          letterSpacing: 0.5,
        }}>
        {mode.toUpperCase()}
      </Text>
    </View>
  );
};
