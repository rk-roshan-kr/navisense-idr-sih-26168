/**
 * NaviSense IDR Interactive Slippy Tile Map
 *
 * Full-screen real geographic map engine rendering watermark-free OpenStreetMap
 * and Esri Satellite raster tiles via pure React Native.
 *
 * Smooth continuous road-following route polylines, navigation puck,
 * and automatic dead-reckoning trajectory tracking.
 *
 * Strictly zero emojis. Premium Royal Theme.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NavigationMode, NavigationRoute, RoutePoint } from '../types/navigation';
import { Compass, Crosshair, Layers, MapPin, Navigation, ZoomIn, ZoomOut } from './Icon';

export type MapTileStyle = 'streets' | 'satellite' | 'topo';

interface InteractiveTileMapProps {
  currentPosition: RoutePoint;
  headingDeg: number;
  route: NavigationRoute | null;
  mode: NavigationMode;
  accuracyM?: number;
  height?: number;
  width?: number;
  showControls?: boolean;
  speedMps?: number;
  isSnappedToPath?: boolean;
  onSelectMapCoordinate?: (lat: number, lon: number) => void;
}

const TILE_SIZE = 256;

// Web Mercator coordinate transforms
function latLonToWorld(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180.0) / 360.0) * scale;
  const latRad = (lat * Math.PI) / 180.0;
  const y =
    ((1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0) * scale;
  return { x, y };
}

function worldToLatLon(x: number, y: number, zoom: number): { latitude: number; longitude: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const lon = (x / scale) * 360.0 - 180.0;
  const n = Math.PI - (2.0 * Math.PI * y) / scale;
  const latRad = Math.atan(Math.sinh(n));
  const lat = (latRad * 180.0) / Math.PI;
  return { latitude: lat, longitude: lon };
}

interface SlippyTile {
  key: string;
  uri: string;
  fallbackUri?: string;
  left: number;
  top: number;
}

const SlippyTileImage: React.FC<{ tile: SlippyTile }> = React.memo(({ tile }) => {
  const [currentUri, setCurrentUri] = useState<string>(tile.uri);
  const [hasFallback, setHasFallback] = useState<boolean>(false);

  useEffect(() => {
    setCurrentUri(tile.uri);
    setHasFallback(false);
  }, [tile.uri]);

  const handleError = () => {
    if (!hasFallback && tile.fallbackUri && currentUri !== tile.fallbackUri) {
      setHasFallback(true);
      setCurrentUri(tile.fallbackUri);
    }
  };

  return (
    <Image
      source={{
        uri: currentUri,
        headers: {
          'User-Agent': 'NaviSenseIDR/2.0 (Mobile Navigation; Android)',
        },
      }}
      style={[
        styles.tileImage,
        {
          left: tile.left,
          top: tile.top,
        },
      ]}
      fadeDuration={80}
      resizeMode="cover"
      onError={handleError}
    />
  );
});

export const InteractiveTileMap: React.FC<InteractiveTileMapProps> = ({
  currentPosition,
  headingDeg,
  route,
  mode,
  accuracyM = 3.0,
  height,
  width,
  showControls = true,
  speedMps = 0.0,
  isSnappedToPath = false,
  onSelectMapCoordinate,
}) => {
  const screenDimensions = Dimensions.get('window');
  const viewWidth = width || screenDimensions.width;
  const viewHeight = height || screenDimensions.height;

  const [zoomLevel, setZoomLevel] = useState<number>(15.5);
  const [mapStyle, setMapStyle] = useState<MapTileStyle>('streets');
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const isBlackout = mode === 'NIDR_DEAD_RECKONING';

  // Pan gesture tracking
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  panOffsetRef.current = panOffset;

  // Center coordinate determination (guarantees no Null Island 0,0 Atlantic ocean)
  const DEFAULT_FALLBACK_LAT = 28.6139;
  const DEFAULT_FALLBACK_LON = 77.2090;

  const isValidCoordinate = (lat: number, lon: number): boolean =>
    lat !== 0 && lon !== 0 && !isNaN(lat) && !isNaN(lon) && Math.abs(lat) > 0.001;

  const lastValidCenterRef = useRef<{ lat: number; lon: number }>({
    lat: isValidCoordinate(currentPosition.latitude, currentPosition.longitude)
      ? currentPosition.latitude
      : DEFAULT_FALLBACK_LAT,
    lon: isValidCoordinate(currentPosition.latitude, currentPosition.longitude)
      ? currentPosition.longitude
      : DEFAULT_FALLBACK_LON,
  });

  if (isValidCoordinate(currentPosition.latitude, currentPosition.longitude)) {
    lastValidCenterRef.current = {
      lat: currentPosition.latitude,
      lon: currentPosition.longitude,
    };
  }

  const centerLat = isValidCoordinate(currentPosition.latitude, currentPosition.longitude)
    ? currentPosition.latitude
    : (lastValidCenterRef.current.lat !== 0 ? lastValidCenterRef.current.lat : DEFAULT_FALLBACK_LAT);
  const centerLon = isValidCoordinate(currentPosition.latitude, currentPosition.longitude)
    ? currentPosition.longitude
    : (lastValidCenterRef.current.lon !== 0 ? lastValidCenterRef.current.lon : DEFAULT_FALLBACK_LON);

  const integerZoom = Math.max(12, Math.min(18, Math.round(zoomLevel)));
  const centerWorld = useMemo(
    () => latLonToWorld(centerLat, centerLon, integerZoom),
    [centerLat, centerLon, integerZoom]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3;
        },
        onPanResponderGrant: () => {
          panStartRef.current = { ...panOffsetRef.current };
          setAutoFollow(false);
        },
        onPanResponderMove: (_, gestureState) => {
          setPanOffset({
            x: panStartRef.current.x + gestureState.dx,
            y: panStartRef.current.y + gestureState.dy,
          });
        },
        onPanResponderRelease: (_, gestureState) => {
          if (
            Math.abs(gestureState.dx) < 6 &&
            Math.abs(gestureState.dy) < 6 &&
            onSelectMapCoordinate
          ) {
            const effectivePanX = autoFollow ? 0 : panOffsetRef.current.x;
            const effectivePanY = autoFollow ? 0 : panOffsetRef.current.y;
            const clickWorldX = centerWorld.x + (gestureState.x0 - viewWidth / 2) - effectivePanX;
            const clickWorldY = centerWorld.y + (gestureState.y0 - viewHeight / 2) - effectivePanY;
            const coords = worldToLatLon(clickWorldX, clickWorldY, integerZoom);
            onSelectMapCoordinate(coords.latitude, coords.longitude);
          }
        },
      }),
    [centerWorld, integerZoom, viewWidth, viewHeight, autoFollow, onSelectMapCoordinate]
  );

  // Recenter to current user position
  const handleRecenter = useCallback(() => {
    setAutoFollow(true);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoomLevel((z) => Math.min(18.0, z + 0.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((z) => Math.max(12.0, z - 0.5));
  }, []);

  // Toggle map layer
  const handleToggleLayer = useCallback(() => {
    setMapStyle((current) => {
      if (current === 'streets') return 'satellite';
      if (current === 'satellite') return 'topo';
      return 'streets';
    });
  }, []);

  // Projection: convert (lat, lon) -> screen (x, y)
  const toScreen = useCallback(
    (lat: number, lon: number): { x: number; y: number } => {
      const pWorld = latLonToWorld(lat, lon, integerZoom);
      const effectivePanX = autoFollow ? 0 : panOffset.x;
      const effectivePanY = autoFollow ? 0 : panOffset.y;

      const screenX = viewWidth / 2 + (pWorld.x - centerWorld.x) + effectivePanX;
      const screenY = viewHeight / 2 + (pWorld.y - centerWorld.y) + effectivePanY;
      return { x: screenX, y: screenY };
    },
    [integerZoom, autoFollow, panOffset, viewWidth, viewHeight, centerWorld]
  );

  // Compute visible tile grid (100% Watermark-free OpenStreetMap & Esri)
  const visibleTiles = useMemo(() => {
    const effectivePanX = autoFollow ? 0 : panOffset.x;
    const effectivePanY = autoFollow ? 0 : panOffset.y;

    const startX = centerWorld.x - viewWidth / 2 - effectivePanX;
    const endX = centerWorld.x + viewWidth / 2 - effectivePanX;
    const startY = centerWorld.y - viewHeight / 2 - effectivePanY;
    const endY = centerWorld.y + viewHeight / 2 - effectivePanY;

    const minTileX = Math.floor(startX / TILE_SIZE);
    const maxTileX = Math.floor(endX / TILE_SIZE);
    const minTileY = Math.floor(startY / TILE_SIZE);
    const maxTileY = Math.floor(endY / TILE_SIZE);

    const tiles: { key: string; uri: string; left: number; top: number }[] = [];
    const numTilesAtZoom = Math.pow(2, integerZoom);

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      if (ty < 0 || ty >= numTilesAtZoom) continue;
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const wrappedTx = ((tx % numTilesAtZoom) + numTilesAtZoom) % numTilesAtZoom;

        const tileScreenX = tx * TILE_SIZE - startX;
        const tileScreenY = ty * TILE_SIZE - startY;

        let uri = '';
        let fallbackUri: string | undefined = undefined;
        if (mapStyle === 'satellite') {
          // Esri World Imagery (clamped to available zoom levels)
          const satZoom = Math.min(18, integerZoom);
          uri = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${satZoom}/${ty}/${wrappedTx}`;
        } else if (mapStyle === 'topo') {
          // Esri Topo (clamped to available zoom levels)
          const topoZoom = Math.min(17, integerZoom);
          uri = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${topoZoom}/${ty}/${wrappedTx}`;
        } else {
          // OpenStreetMap standard slippy tiles
          const subdomains = ['a', 'b', 'c'];
          const sub = subdomains[Math.abs(wrappedTx + ty) % 3];
          uri = `https://${sub}.tile.openstreetmap.org/${integerZoom}/${wrappedTx}/${ty}.png`;
          // High-speed Akamai fallback to Esri World Street Map (clamped to 17 to prevent missing tiles)
          const esriZoom = Math.min(17, integerZoom);
          fallbackUri = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${esriZoom}/${ty}/${wrappedTx}`;
        }

        tiles.push({
          key: `${integerZoom}_${tx}_${ty}`,
          uri,
          fallbackUri,
          left: tileScreenX,
          top: tileScreenY,
        });
      }
    }
    return tiles;
  }, [centerWorld, viewWidth, viewHeight, autoFollow, panOffset, integerZoom, mapStyle]);

  // Clean, continuous, non-bulky road-following polyline segments
  const routePolyline = useMemo(() => {
    if (!route || route.geometry.length < 2) return { segments: [], joints: [] };

    const segments: {
      left: number;
      top: number;
      length: number;
      angleDeg: number;
    }[] = [];

    const joints: { x: number; y: number }[] = [];

    const geom = route.geometry;
    for (let i = 0; i < geom.length - 1; i++) {
      const p1 = toScreen(geom[i].latitude, geom[i].longitude);
      const p2 = toScreen(geom[i + 1].latitude, geom[i + 1].longitude);

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.4) continue;

      const angleDeg = (Math.atan2(dy, dx) * 180.0) / Math.PI;
      const midX = (p1.x + p2.x) / 2.0;
      const midY = (p1.y + p2.y) / 2.0;

      // Overlap by 0.8px to eliminate gaps between segments
      segments.push({
        left: midX - (len + 0.8) / 2.0,
        top: midY - 2.0,
        length: len + 0.8,
        angleDeg,
      });

      joints.push({ x: p1.x, y: p1.y });
    }

    if (geom.length > 0) {
      const last = toScreen(geom[geom.length - 1].latitude, geom[geom.length - 1].longitude);
      joints.push({ x: last.x, y: last.y });
    }

    return { segments, joints };
  }, [route, toScreen]);

  // Current user screen position
  const userScreenPos = useMemo(
    () => toScreen(currentPosition.latitude, currentPosition.longitude),
    [toScreen, currentPosition]
  );

  // Destination screen position
  const destinationScreenPos = useMemo(() => {
    if (!route || !route.destination) return null;
    return toScreen(route.destination.latitude, route.destination.longitude);
  }, [route, toScreen]);

  // Uncertainty radius in pixels
  const uncertaintyPx = Math.max(16, Math.min(60, accuracyM * 4.0));

  const routeColor = isBlackout ? '#B8860B' : '#047857';

  return (
    <View style={[styles.container, { width: viewWidth, height: viewHeight }]} {...panResponder.panHandlers}>
      {/* Background fallback grid */}
      <View style={styles.fallbackGrid} />

      {/* Slippy Tile Raster Layer (Watermark-Free) */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {visibleTiles.map((tile) => (
          <Image
            key={tile.key}
            source={{
              uri: tile.uri,
              headers: {
                'User-Agent': 'NaviSenseIDR/2.0 (Mobile Navigation; Android)',
              },
            }}
            style={[
              styles.tileImage,
              {
                left: tile.left,
                top: tile.top,
              },
            ]}
            fadeDuration={80}
            resizeMode="cover"
          />
        ))}
      </View>

      {/* Real Road Polyline: Sleek, smooth, continuous line (NOT bulky dots) */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {/* Subtle white casing for contrast over roads and buildings */}
        {routePolyline.segments.map((seg, idx) => (
          <View
            key={`route_casing_${idx}`}
            style={{
              position: 'absolute',
              left: seg.left - 0.5,
              top: seg.top - 1.0,
              width: seg.length + 1.0,
              height: 6.0,
              backgroundColor: '#FFFFFF',
              borderRadius: 3.0,
              transform: [{ rotate: `${seg.angleDeg}deg` }],
              opacity: 0.92,
            }}
          />
        ))}

        {/* Primary sleek continuous road line (stroke = 4px) */}
        {routePolyline.segments.map((seg, idx) => (
          <View
            key={`route_line_${idx}`}
            style={{
              position: 'absolute',
              left: seg.left,
              top: seg.top,
              width: seg.length,
              height: 4.0,
              backgroundColor: routeColor,
              borderRadius: 2.0,
              transform: [{ rotate: `${seg.angleDeg}deg` }],
            }}
          />
        ))}

        {/* Round vertex joints for smooth seamless corners */}
        {routePolyline.joints.map((joint, idx) => (
          <View
            key={`route_joint_${idx}`}
            style={{
              position: 'absolute',
              left: joint.x - 2.0,
              top: joint.y - 2.0,
              width: 4.0,
              height: 4.0,
              borderRadius: 2.0,
              backgroundColor: routeColor,
            }}
          />
        ))}
      </View>

      {/* Destination Pin Marker */}
      {destinationScreenPos && (
        <View
          pointerEvents="none"
          style={[
            styles.destinationPinContainer,
            { left: destinationScreenPos.x - 16, top: destinationScreenPos.y - 32 },
          ]}>
          <View style={styles.destinationPinBubble}>
            <MapPin size={18} color="#FFFFFF" />
          </View>
          <View style={styles.destinationPinArrow} />
        </View>
      )}

      {/* Navigation Puck & Heading Beam */}
      <View
        pointerEvents="none"
        style={[
          styles.userPuckContainer,
          {
            left: userScreenPos.x - 24,
            top: userScreenPos.y - 24,
          },
        ]}>
        {/* Dead-Reckoning Uncertainty Ring */}
        {isBlackout && (
          <View
            style={[
              styles.uncertaintyRing,
              {
                width: uncertaintyPx * 2,
                height: uncertaintyPx * 2,
                borderRadius: uncertaintyPx,
                left: 24 - uncertaintyPx,
                top: 24 - uncertaintyPx,
              },
            ]}
          />
        )}

        {/* Outer Halo */}
        <View
          style={[
            styles.puckHalo,
            { backgroundColor: isBlackout ? 'rgba(184, 134, 11, 0.22)' : 'rgba(4, 120, 87, 0.22)' },
          ]}>
          {/* Inner Puck */}
          <View
            style={[
              styles.puckCore,
              {
                borderColor: isBlackout ? '#B8860B' : '#FFFFFF',
                backgroundColor: isBlackout ? '#0F172A' : '#047857',
              },
            ]}>
            <View
              style={{
                transform: [{ rotate: `${Math.round(headingDeg)}deg` }],
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Navigation size={18} color={isBlackout ? '#D4AF37' : '#FFFFFF'} />
            </View>
          </View>
        </View>
      </View>

      {/* Floating Speedometer & Compass Badge (Top-Left) */}
      <View style={styles.speedometerBadge} pointerEvents="none">
        <View style={styles.speedometerRow}>
          <Compass size={14} color="#B8860B" />
          <Text style={styles.speedometerText}>
            {(speedMps * 3.6).toFixed(0)} km/h
          </Text>
          <Text style={styles.headingBadgeText}>
            {Math.round(headingDeg)}°
          </Text>
        </View>
      </View>

      {/* Floating Map Action Toolbar (Right Edge) */}
      {showControls && (
        <View style={styles.controlsBar}>
          {/* Layer Selector */}
          <TouchableOpacity style={styles.controlButton} onPress={handleToggleLayer}>
            <Layers size={18} color={mapStyle === 'satellite' ? '#B8860B' : '#0F172A'} />
          </TouchableOpacity>

          {/* Recenter / Auto-Follow */}
          <TouchableOpacity
            style={[styles.controlButton, autoFollow && styles.controlButtonActive]}
            onPress={handleRecenter}>
            <Crosshair size={18} color={autoFollow ? '#B8860B' : '#64748B'} />
          </TouchableOpacity>

          {/* Zoom In */}
          <TouchableOpacity style={styles.controlButton} onPress={handleZoomIn}>
            <ZoomIn size={18} color="#0F172A" />
          </TouchableOpacity>

          {/* Zoom Out */}
          <TouchableOpacity style={styles.controlButton} onPress={handleZoomOut}>
            <ZoomOut size={18} color="#0F172A" />
          </TouchableOpacity>
        </View>
      )}

      {/* Dynamic Scale & Attribution Badge (Bottom Left) */}
      <View style={styles.bottomScaleBadge} pointerEvents="none">
        <Text style={styles.scaleText}>
          {mapStyle === 'satellite' ? 'Satellite' : mapStyle === 'topo' ? 'Topography' : 'World Streets'} | z{integerZoom}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
  },
  fallbackGrid: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F8FAFC',
  },
  tileImage: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  userPuckContainer: {
    position: 'absolute',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckHalo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  uncertaintyRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: '#B45309',
    backgroundColor: 'rgba(180, 83, 9, 0.12)',
    borderStyle: 'dashed',
  },
  destinationPinContainer: {
    position: 'absolute',
    width: 32,
    height: 38,
    alignItems: 'center',
  },
  destinationPinBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#991B1B',
    borderColor: '#FFFFFF',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  destinationPinArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 0,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#991B1B',
  },
  speedometerBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderColor: '#DFD0B8',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  speedometerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speedometerText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  headingBadgeText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  controlsBar: {
    position: 'absolute',
    right: 14,
    top: 100,
    gap: 10,
  },
  controlButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderColor: '#DFD0B8',
    borderWidth: 1.2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  controlButtonActive: {
    backgroundColor: '#FDFBF7',
    borderColor: '#B8860B',
    borderWidth: 2,
  },
  bottomScaleBadge: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderColor: '#E2E8F0',
    borderWidth: 0.8,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  scaleText: {
    color: '#64748B',
    fontSize: 9,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
});
