/**
 * NaviSense IDR Consumer Navigation Map View
 *
 * 100% Pure React Native vector map renderer.
 * Zero external native library dependencies.
 * Strictly zero emojis.
 */

import React, { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationMode, NavigationRoute, RoutePoint } from '../types/navigation';
import { Crosshair, ZoomIn, ZoomOut } from './Icon';

interface NavigationMapViewProps {
  currentPosition: RoutePoint;
  headingDeg: number;
  route: NavigationRoute | null;
  mode: NavigationMode;
  accuracyM?: number;
  height?: number;
  showControls?: boolean;
}

export const NavigationMapView: React.FC<NavigationMapViewProps> = ({
  currentPosition,
  headingDeg,
  route,
  mode,
  accuracyM = 3.0,
  height,
  showControls = true,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1.2);
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const screenDimensions = Dimensions.get('window');
  const viewWidth = screenDimensions.width - 24;
  const viewHeight = height || Math.round(screenDimensions.height * 0.58);
  const centerX = viewWidth / 2;
  const centerY = viewHeight / 2;

  // Origin reference for projection
  const origin = useMemo(() => {
    if (route && route.origin) {
      return route.origin;
    }
    return currentPosition;
  }, [route, currentPosition]);

  // WGS84 local projection meters per degree
  const { metersPerLat, metersPerLon } = useMemo(() => {
    const latRad = (origin.latitude * Math.PI) / 180.0;
    const mLat = 111132.92;
    const mLon = (Math.PI / 180.0) * 6378137.0 * Math.cos(latRad);
    return { metersPerLat: mLat, metersPerLon: Math.max(mLon, 10000.0) };
  }, [origin.latitude]);

  // Scale: meters to pixels
  const scale = 0.65 * zoomLevel;

  // Convert (lat, lon) -> screen (x, y)
  const toScreen = (lat: number, lon: number): { x: number; y: number } => {
    const dNorth = (lat - currentPosition.latitude) * metersPerLat;
    const dEast = (lon - currentPosition.longitude) * metersPerLon;

    const baseCenterX = autoFollow ? centerX : centerX + panOffset.x;
    const baseCenterY = autoFollow ? centerY : centerY + panOffset.y;

    const x = baseCenterX + dEast * scale;
    const y = baseCenterY - dNorth * scale;
    return { x, y };
  };

  // Build segments for route polyline
  const routeSegments = useMemo(() => {
    if (!route || route.geometry.length < 2) return [];

    const segments: {
      left: number;
      top: number;
      length: number;
      angleDeg: number;
    }[] = [];

    // Stride to keep segment count crisp and performant
    const geom = route.geometry;
    const stride = Math.max(1, Math.floor(geom.length / 40));

    for (let i = 0; i < geom.length - stride; i += stride) {
      const p1 = toScreen(geom[i].latitude, geom[i].longitude);
      const p2 = toScreen(geom[i + stride].latitude, geom[i + stride].longitude);

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 1.0) continue;

      const angleDeg = (Math.atan2(dy, dx) * 180.0) / Math.PI;
      const midX = (p1.x + p2.x) / 2.0;
      const midY = (p1.y + p2.y) / 2.0;

      segments.push({
        left: midX - length / 2.0,
        top: midY - 2.5,
        length,
        angleDeg,
      });
    }

    return segments;
  }, [route, currentPosition, scale, autoFollow, panOffset]);

  // Screen positions
  const userScreenPos = autoFollow
    ? { x: centerX, y: centerY }
    : toScreen(currentPosition.latitude, currentPosition.longitude);

  const destScreenPos = route
    ? toScreen(route.destination.latitude, route.destination.longitude)
    : null;

  const isBlackout = mode === 'NIDR_DEAD_RECKONING';
  const isReconverging = mode === 'RECONVERGING';

  // Navigation mode theme colors
  let statusColor = '#047857'; // Imperial Emerald
  let statusBadgeText = 'GNSS ACTIVE';
  if (isBlackout) {
    statusColor = '#B8860B'; // Imperial Royal Gold
    statusBadgeText = 'NIDR DEAD RECKONING';
  } else if (isReconverging) {
    statusColor = '#991B1B'; // Imperial Burgundy Reconverging
    statusBadgeText = 'RECONVERGING';
  }

  // Uncertainty radius in screen pixels
  const uncertaintyRadius = Math.max(16, Math.min(70, accuracyM * scale));

  return (
    <View style={[styles.container, height ? { height } : { flex: 1 }]}>
      {/* Background Canvas */}
      <View style={StyleSheet.absoluteFillObject}>
        {/* Ambient Grid Lines (Horizontal) */}
        {[-70, -35, 0, 35, 70].map((offset) => (
          <View
            key={`h_grid_${offset}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: centerY + offset * scale,
              height: 1,
              backgroundColor: '#E2E8F0',
              opacity: 0.8,
            }}
          />
        ))}

        {/* Ambient Grid Lines (Vertical) */}
        {[-70, -35, 0, 35, 70].map((offset) => (
          <View
            key={`v_grid_${offset}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: centerX + offset * scale,
              width: 1,
              backgroundColor: '#E2E8F0',
              opacity: 0.8,
            }}
          />
        ))}

        {/* Route Polyline Segments (Imperial Royal Gold) */}
        {routeSegments.map((seg, idx) => (
          <View
            key={`seg_${idx}`}
            style={{
              position: 'absolute',
              left: seg.left,
              top: seg.top,
              width: seg.length,
              height: 5,
              backgroundColor: '#B8860B',
              borderRadius: 2.5,
              transform: [{ rotate: `${seg.angleDeg}deg` }],
              shadowColor: '#855E15',
              shadowOpacity: 0.35,
              shadowRadius: 4,
            }}
          />
        ))}

        {/* Destination Pin Marker */}
        {destScreenPos && (
          <View
            style={{
              position: 'absolute',
              left: destScreenPos.x - 10,
              top: destScreenPos.y - 10,
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: 'rgba(180, 83, 9, 0.15)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: '#B45309',
            }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: '#B45309',
              }}
            />
          </View>
        )}

        {/* Dead-Reckoning Uncertainty Ring (Royal Amber Gold Circle) */}
        {isBlackout && (
          <View
            style={{
              position: 'absolute',
              left: userScreenPos.x - uncertaintyRadius,
              top: userScreenPos.y - uncertaintyRadius,
              width: uncertaintyRadius * 2,
              height: uncertaintyRadius * 2,
              borderRadius: uncertaintyRadius,
              backgroundColor: 'rgba(184, 134, 11, 0.12)',
              borderWidth: 1.5,
              borderColor: '#B8860B',
              borderStyle: 'dashed',
            }}
          />
        )}

        {/* GNSS Accuracy Footprint */}
        {!isBlackout && (
          <View
            style={{
              position: 'absolute',
              left: userScreenPos.x - Math.max(10, accuracyM * scale),
              top: userScreenPos.y - Math.max(10, accuracyM * scale),
              width: Math.max(20, accuracyM * scale * 2),
              height: Math.max(20, accuracyM * scale * 2),
              borderRadius: Math.max(10, accuracyM * scale),
              backgroundColor: 'rgba(4, 120, 87, 0.08)',
              borderWidth: 1,
              borderColor: 'rgba(4, 120, 87, 0.25)',
            }}
          />
        )}

        {/* User Vehicle/Pedestrian Chevron Puck (Rotates with Device Heading) */}
        <View
          style={{
            position: 'absolute',
            left: userScreenPos.x - 16,
            top: userScreenPos.y - 16,
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: '#0F172A',
            borderWidth: 2,
            borderColor: '#B8860B',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ rotate: `${headingDeg}deg` }],
            shadowColor: '#0F172A',
            shadowOpacity: 0.25,
            shadowRadius: 6,
            elevation: 4,
          }}>
          {/* Directional Chevron Pointer in Pure Royal Gold */}
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 6,
              borderRightWidth: 6,
              borderBottomWidth: 12,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: '#D4AF37',
              marginTop: -3,
            }}
          />
          {/* Center Point */}
          <View
            style={{
              width: 3,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: '#FFFFFF',
              marginTop: 1,
            }}
          />
        </View>
      </View>

      {/* Floating Status Badge (Top-Left) */}
      <View style={[styles.statusBadge, { borderColor: statusColor + '44' }]}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusBadgeText}
        </Text>
      </View>

      {/* Offline Route Readiness Indicator (Top-Right) */}
      {route && route.isCachedOffline && (
        <View style={styles.offlineBadge}>
          <Text style={styles.offlineText}>OFFLINE CACHED</Text>
        </View>
      )}

      {/* Accuracy Tag (Bottom-Left) */}
      <View style={styles.accuracyTag}>
        <Text style={styles.accuracyText}>
          Accuracy: +-{accuracyM.toFixed(1)} m
        </Text>
      </View>

      {/* Floating Map Controls (Bottom-Right) */}
      {showControls && (
        <View style={styles.controlsContainer}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => setZoomLevel((z) => Math.min(3.0, z + 0.3))}>
            <ZoomIn size={16} color="#334155" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => setZoomLevel((z) => Math.max(0.6, z - 0.3))}>
            <ZoomOut size={16} color="#334155" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.controlButton, autoFollow && styles.controlButtonActive]}
            onPress={() => {
              setAutoFollow(true);
              setPanOffset({ x: 0, y: 0 });
            }}>
            <Crosshair size={16} color={autoFollow ? '#B8860B' : '#64748B'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  offlineBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#FDFBF7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#DFD0B8',
    zIndex: 10,
    elevation: 1,
  },
  offlineText: {
    color: '#855E15',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  accuracyTag: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  accuracyText: {
    color: '#475569',
    fontSize: 10,
    fontWeight: '700',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    gap: 6,
    zIndex: 10,
  },
  controlButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  controlButtonActive: {
    borderColor: '#B8860B',
    backgroundColor: '#FDFBF7',
  },
});
