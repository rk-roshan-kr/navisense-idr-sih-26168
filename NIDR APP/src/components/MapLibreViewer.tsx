/**
 * NaviSense IDR Research & Diagnostics Trajectory Viewer
 *
 * 100% Pure React Native Vector Renderer.
 * Zero external native library dependencies (Zero react-native-svg crashes).
 * Strictly zero emojis. Premium Royal Theme: Pristine White & Imperial Gold.
 */

import React, { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TrajectoryPoint } from '../types';
import { Crosshair, Navigation, ZoomIn, ZoomOut } from './Icon';

interface MapLibreViewerProps {
  currentLat: number;
  currentLon: number;
  headingDeg: number;
  referenceTrajectory: TrajectoryPoint[];
  idrTrajectory: TrajectoryPoint[];
  anchorLat?: number;
  anchorLon?: number;
  isBlackout: boolean;
  uncertaintyM?: number;
}

interface SegmentView {
  left: number;
  top: number;
  length: number;
  angleDeg: number;
}

const VIEW_HEIGHT = 260;
const M_PER_DEG_LAT = 111132.92;

export const MapLibreViewer: React.FC<MapLibreViewerProps> = ({
  currentLat,
  currentLon,
  headingDeg,
  referenceTrajectory,
  idrTrajectory,
  anchorLat,
  anchorLon,
  isBlackout,
  uncertaintyM = 1.0,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  const screenDimensions = Dimensions.get('window');
  const viewWidth = screenDimensions.width - 24;
  const centerX = viewWidth / 2;
  const centerY = VIEW_HEIGHT / 2;

  // Projection center
  const centerLat = autoFollow ? currentLat : (anchorLat || currentLat);
  const centerLon = autoFollow ? currentLon : (anchorLon || currentLon);

  const latRad = (centerLat * Math.PI) / 180.0;
  const metersPerLon = Math.max((Math.PI / 180.0) * 6378137.0 * Math.cos(latRad), 10000.0);
  const scale = 2.8 * zoomLevel;

  const toScreen = (lat: number, lon: number): { x: number; y: number } => {
    const dEast = (lon - centerLon) * metersPerLon;
    const dNorth = (lat - centerLat) * M_PER_DEG_LAT;
    return {
      x: centerX + dEast * scale + (autoFollow ? 0 : panOffset.x),
      y: centerY - dNorth * scale + (autoFollow ? 0 : panOffset.y),
    };
  };

  const anchorPos = useMemo(() => {
    if (!anchorLat || !anchorLon) return null;
    return toScreen(anchorLat, anchorLon);
  }, [anchorLat, anchorLon, centerLat, centerLon, scale, autoFollow, panOffset]);

  const currentPos = useMemo(() => {
    return toScreen(currentLat, currentLon);
  }, [currentLat, currentLon, centerLat, centerLon, scale, autoFollow, panOffset]);

  // Generate Reference GNSS segments
  const refSegments = useMemo<SegmentView[]>(() => {
    if (referenceTrajectory.length < 2) return [];
    const segs: SegmentView[] = [];
    const stride = Math.max(1, Math.floor(referenceTrajectory.length / 50));
    for (let i = 0; i < referenceTrajectory.length - stride; i += stride) {
      const p1 = toScreen(referenceTrajectory[i].latitude, referenceTrajectory[i].longitude);
      const p2 = toScreen(referenceTrajectory[i + stride].latitude, referenceTrajectory[i + stride].longitude);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.5) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      segs.push({
        left: (p1.x + p2.x) / 2 - len / 2,
        top: (p1.y + p2.y) / 2 - 1.5,
        length: len,
        angleDeg: angle,
      });
    }
    return segs;
  }, [referenceTrajectory, centerLat, centerLon, scale, autoFollow, panOffset]);

  // Generate IDR Estimated segments
  const idrSegments = useMemo<SegmentView[]>(() => {
    if (idrTrajectory.length < 2) return [];
    const segs: SegmentView[] = [];
    const stride = Math.max(1, Math.floor(idrTrajectory.length / 50));
    for (let i = 0; i < idrTrajectory.length - stride; i += stride) {
      const p1 = toScreen(idrTrajectory[i].latitude, idrTrajectory[i].longitude);
      const p2 = toScreen(idrTrajectory[i + stride].latitude, idrTrajectory[i + stride].longitude);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.5) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      segs.push({
        left: (p1.x + p2.x) / 2 - len / 2,
        top: (p1.y + p2.y) / 2 - 2,
        length: len,
        angleDeg: angle,
      });
    }
    return segs;
  }, [idrTrajectory, centerLat, centerLon, scale, autoFollow, panOffset]);

  const uncertaintyPx = Math.max(14, Math.min(60, uncertaintyM * scale));

  return (
    <View style={[styles.mapContainer, isBlackout && styles.mapContainerBlackout]}>
      {/* Grid Canvas Background */}
      <View style={StyleSheet.absoluteFillObject}>
        {/* Horizontal grid lines */}
        {[-80, -40, 0, 40, 80].map((offset) => (
          <View
            key={`h_${offset}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: centerY + offset * zoomLevel,
              height: 1,
              backgroundColor: '#E2E8F0',
              opacity: 0.7,
            }}
          />
        ))}

        {/* Vertical grid lines */}
        {[-80, -40, 0, 40, 80].map((offset) => (
          <View
            key={`v_${offset}`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: centerX + offset * zoomLevel,
              width: 1,
              backgroundColor: '#E2E8F0',
              opacity: 0.7,
            }}
          />
        ))}

        {/* Anchor Range Rings (10m, 20m, 30m, 40m) */}
        {anchorPos &&
          [10, 20, 30, 40].map((distM) => {
            const r = distM * scale;
            return (
              <View
                key={`ring_${distM}`}
                style={{
                  position: 'absolute',
                  left: anchorPos.x - r,
                  top: anchorPos.y - r,
                  width: r * 2,
                  height: r * 2,
                  borderRadius: r,
                  borderWidth: distM === 40 ? 1.5 : 0.8,
                  borderColor: distM === 40 ? '#B8860B' : '#DFD0B8',
                  borderStyle: distM === 40 ? 'dashed' : 'solid',
                  opacity: 0.6,
                }}
              />
            );
          })}

        {/* Reference GNSS Polyline Segments (Emerald) */}
        {refSegments.map((seg, idx) => (
          <View
            key={`ref_${idx}`}
            style={{
              position: 'absolute',
              left: seg.left,
              top: seg.top,
              width: seg.length,
              height: 3.5,
              backgroundColor: '#047857',
              borderRadius: 1.5,
              transform: [{ rotate: `${seg.angleDeg}deg` }],
            }}
          />
        ))}

        {/* IDR Estimated Polyline Segments (Imperial Gold) */}
        {idrSegments.map((seg, idx) => (
          <View
            key={`idr_${idx}`}
            style={{
              position: 'absolute',
              left: seg.left,
              top: seg.top,
              width: seg.length,
              height: 4,
              backgroundColor: '#B8860B',
              borderRadius: 2,
              transform: [{ rotate: `${seg.angleDeg}deg` }],
            }}
          />
        ))}

        {/* Anchor P0 Pin Marker */}
        {anchorPos && (
          <View
            style={{
              position: 'absolute',
              left: anchorPos.x - 7,
              top: anchorPos.y - 7,
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: '#B45309',
              borderWidth: 2,
              borderColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
          </View>
        )}

        {/* Live Blackout Uncertainty Ellipse */}
        {isBlackout && uncertaintyM > 0 && (
          <View
            style={{
              position: 'absolute',
              left: currentPos.x - uncertaintyPx,
              top: currentPos.y - uncertaintyPx,
              width: uncertaintyPx * 2,
              height: uncertaintyPx * 2,
              borderRadius: uncertaintyPx,
              backgroundColor: 'rgba(180, 83, 9, 0.12)',
              borderWidth: 1.5,
              borderColor: '#B45309',
              borderStyle: 'dashed',
            }}
          />
        )}

        {/* Navigation Puck Center */}
        <View
          style={{
            position: 'absolute',
            left: currentPos.x - 14,
            top: currentPos.y - 14,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: isBlackout ? 'rgba(184, 134, 11, 0.20)' : 'rgba(4, 120, 87, 0.20)',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: isBlackout ? '#0F172A' : '#047857',
              borderWidth: 2.5,
              borderColor: '#B8860B',
            }}
          />
        </View>

        {/* Direction Pointer Arrow */}
        <View
          pointerEvents="none"
          style={[
            styles.headingOverlay,
            {
              left: currentPos.x - 14,
              top: currentPos.y - 14,
              transform: [{ rotate: `${Math.round(headingDeg)}deg` }],
            },
          ]}>
          <Navigation size={28} color={isBlackout ? '#D4AF37' : '#047857'} />
        </View>
      </View>

      {/* Trajectory Legend Card */}
      <View style={styles.legendContainer}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#047857' }]} />
          <Text style={styles.legendText}>REF GNSS ({referenceTrajectory.length} pts)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#B8860B' }]} />
          <Text style={styles.legendText}>IDR ESTIMATE ({idrTrajectory.length} pts)</Text>
        </View>
        {isBlackout && (
          <View style={styles.legendItem}>
            <View style={[styles.legendColor, { backgroundColor: '#B45309' }]} />
            <Text style={[styles.legendText, { color: '#B45309' }]}>
              UNCERTAINTY: +-{uncertaintyM.toFixed(1)}m
            </Text>
          </View>
        )}
      </View>

      {/* Map Control Buttons */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setZoomLevel((z) => Math.min(z * 1.3, 4.0))}>
          <ZoomIn size={16} color="#855E15" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setZoomLevel((z) => Math.max(z / 1.3, 0.4))}>
          <ZoomOut size={16} color="#855E15" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, autoFollow && styles.controlBtnActive]}
          onPress={() => {
            setAutoFollow((af) => !af);
            setPanOffset({ x: 0, y: 0 });
          }}>
          <Crosshair size={16} color={autoFollow ? '#B8860B' : '#64748B'} />
        </TouchableOpacity>
      </View>

      {/* 40m Gate Ring Badge */}
      <View style={styles.scaleBadge}>
        <Text style={styles.scaleText}>40m GATE RING: GOLD DASH</Text>
      </View>

      {/* Bottom Coordinates Status Bar */}
      <View style={styles.coordsBar}>
        <Text style={styles.coordsText}>
          LAT: {currentLat.toFixed(6)} | LON: {currentLon.toFixed(6)} | ZOOM: {zoomLevel.toFixed(1)}x
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    height: VIEW_HEIGHT,
    backgroundColor: '#F8FAFC',
    borderColor: '#DFD0B8',
    borderWidth: 1.5,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 8,
  },
  mapContainerBlackout: {
    borderColor: '#B8860B',
    borderWidth: 2,
  },
  headingOverlay: {
    position: 'absolute',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 10,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    color: '#0F172A',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  controlsContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    gap: 6,
  },
  controlBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  controlBtnActive: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 1.5,
  },
  scaleBadge: {
    position: 'absolute',
    bottom: 30,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  scaleText: {
    color: '#855E15',
    fontSize: 8,
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  coordsBar: {
    position: 'absolute',
    bottom: 6,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    borderColor: '#E2E8F0',
    borderWidth: 0.8,
  },
  coordsText: {
    color: '#64748B',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
});
