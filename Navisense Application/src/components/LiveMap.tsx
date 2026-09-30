import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import type { TelemetryPacket, ScenarioInfo } from '../types';
import { IconCrosshair, IconCompass, IconEye } from './Icons';

interface LiveMapProps {
  telemetry: TelemetryPacket | null;
  routeCoordinates: [number, number][];
  showGhostBaseline?: boolean;
  onToggleGhostBaseline?: () => void;
  onMapClick?: (lat: number, lon: number) => void;
  customOrigin?: [number, number] | null;
  customDestination?: [number, number] | null;
  fitBounds?: boolean;
  is3DMode?: boolean;
  onToggle3DMode?: () => void;
  showFloatingControls?: boolean;
}

export const LiveMap: React.FC<LiveMapProps> = ({
  telemetry,
  routeCoordinates,
  showGhostBaseline = false,
  onToggleGhostBaseline,
  onMapClick,
  customOrigin,
  customDestination,
  fitBounds = true,
  is3DMode = true,
  onToggle3DMode,
  showFloatingControls = false,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [internal3D, setInternal3D] = useState(is3DMode);

  // Sync external 3D mode changes
  useEffect(() => {
    setInternal3D(is3DMode);
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SET_CAMERA_MODE',
          is3D: is3DMode,
        })
      );
    }
  }, [is3DMode]);

  // Send telemetry updates to WebView map
  useEffect(() => {
    if (!telemetry || !webViewRef.current) return;

    const msg = JSON.stringify({
      type: 'TELEMETRY_UPDATE',
      data: {
        carPos: [telemetry.idr_position.lat, telemetry.idr_position.lon],
        gnssPos: telemetry.gnss_position ? [telemetry.gnss_position.lat, telemetry.gnss_position.lon] : null,
        b1Pos: telemetry.b1_position ? [telemetry.b1_position.lat, telemetry.b1_position.lon] : null,
        heading: telemetry.heading_deg,
        speedKmh: telemetry.speed_kmh,
        isBlackout: telemetry.blackout_active,
        showGhost: showGhostBaseline,
      },
    });

    webViewRef.current.postMessage(msg);
  }, [telemetry, showGhostBaseline]);

  // Send route updates
  useEffect(() => {
    if (!webViewRef.current || routeCoordinates.length === 0) return;

    const msg = JSON.stringify({
      type: 'ROUTE_UPDATE',
      data: {
        coordinates: routeCoordinates,
        origin: customOrigin,
        destination: customDestination,
        fitBounds: fitBounds,
      },
    });

    webViewRef.current.postMessage(msg);
  }, [routeCoordinates, customOrigin, customDestination, fitBounds]);

  const toggleCameraMode = () => {
    const nextMode = !internal3D;
    setInternal3D(nextMode);
    if (onToggle3DMode) {
      onToggle3DMode();
    }
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SET_CAMERA_MODE',
          is3D: nextMode,
        })
      );
    }
  };

  const centerOnVehicle = () => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'RECENTER_VEHICLE',
        })
      );
    }
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK' && onMapClick) {
        onMapClick(data.lat, data.lon);
      }
    } catch (e) {
      console.warn('Map message parse error:', e);
    }
  };

  // Generate self-contained HTML with MapLibre GL 3D Vector Map & Extruded Buildings
  const initialCenter = routeCoordinates[0] || [28.6315, 77.2167];

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #0f172a; overflow: hidden; }
    #map { width: 100%; height: 100%; }
    .maplibregl-ctrl-attrib, .maplibregl-ctrl-logo { display: none !important; }

    /* Custom 3D Vehicle Marker Element with Forward Direction Beam */
    .nav-car-wrap {
      width: 44px;
      height: 44px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nav-car-arrow {
      width: 28px;
      height: 28px;
      transition: transform 0.1s linear;
      filter: drop-shadow(0 4px 10px rgba(2, 132, 199, 0.7));
    }
    .nav-car-halo {
      position: absolute;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(2, 132, 199, 0.2);
      border: 1.5px solid rgba(56, 189, 248, 0.5);
      animation: radarPulse 2s infinite ease-out;
    }
    @keyframes radarPulse {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(1.7); opacity: 0; }
    }
    .car-outage .nav-car-arrow {
      filter: drop-shadow(0 4px 10px rgba(239, 68, 68, 0.8));
    }
    .car-outage .nav-car-halo {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(248, 113, 113, 0.65);
    }

    /* Outage GPS Freeze Marker */
    .last-gnss-marker {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #dc2626;
      border: 2px solid #ffffff;
      box-shadow: 0 3px 10px rgba(220, 38, 38, 0.65);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.5px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Stop Pins matching Native Navigation Pins */
    .stop-pin {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 800;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
      border: 2px solid #ffffff;
      white-space: nowrap;
    }
    .pin-origin { background: #059669; }
    .pin-dest { background: #1d4ed8; }

    /* B1 Ghost Puck */
    .ghost-puck {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(249, 115, 22, 0.85);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px rgba(249, 115, 22, 0.7);
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    var initialLon = ${initialCenter[1]};
    var initialLat = ${initialCenter[0]};
    var is3D = ${is3DMode ? 'true' : 'false'};
    var isFollowing = true;
    var currentHeading = 0;
    var prevBlackout = false;

    // Initialize Real MapLibre GL 3D Vector Map with All Native Gestures (Apple/Google Maps)
    var map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty', // Real 3D Vector Map with building extrusions
      center: [initialLon, initialLat],
      zoom: 16.5,
      pitch: is3D ? 60 : 0, // Real 3D Perspective Pitch
      bearing: 0,
      maxPitch: 85,
      attributionControl: false,
      dragPan: true,
      dragRotate: true,
      touchZoomRotate: true,
      touchPitch: true, // Two-finger vertical drag tilts camera in 3D (Google/Apple Maps gesture)
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true,
      scrollZoom: true
    });

    var carMarker = null;
    var ghostMarker = null;
    var lastGnssMarker = null;
    var originMarker = null;
    var destMarker = null;
    var ghostCoordinates = [];

    // SVG Vehicle Chevron
    var carEl = document.createElement('div');
    carEl.id = 'carPuckWrap';
    carEl.className = 'nav-car-wrap';
    carEl.innerHTML = '<div class="nav-car-halo"></div><svg id="carNavArrow" class="nav-car-arrow" viewBox="0 0 32 32"><path d="M16 3 L28 27 L16 21 L4 27 Z" fill="#0284c7" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" /></svg>';

    var ghostEl = document.createElement('div');
    ghostEl.className = 'ghost-puck';

    // Disable auto-follow when user manually manipulates map
    map.on('dragstart', function() { isFollowing = false; });
    map.on('rotatestart', function() { isFollowing = false; });
    map.on('pitchstart', function() { isFollowing = false; });
    map.on('zoomstart', function(e) {
      if (e.originalEvent) isFollowing = false;
    });

    // Tap on map
    map.on('click', function(e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'MAP_CLICK',
          lat: e.lngLat.lat,
          lon: e.lngLat.lng
        }));
      }
    });

    map.on('load', function() {
      // 1. Add 3D Extruded Buildings Layer (Architectural shading in 3D WebGL)
      var layers = map.getStyle().layers || [];
      var labelLayer = layers.find(function(l) {
        return l.type === 'symbol' && l.layout && l.layout['text-field'];
      });
      var labelLayerId = labelLayer ? labelLayer.id : undefined;

      if (!map.getLayer('3d-buildings') && map.getSource('openmaptiles')) {
        map.addLayer({
          id: '3d-buildings',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14.5,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'render_height'],
              0, '#e2e8f0',
              20, '#cbd5e1',
              50, '#94a3b8'
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              14.5, 0,
              15.5, ['get', 'render_height']
            ],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.85
          }
        }, labelLayerId);
      }

      // 2. Route Casing Glow Layer
      map.addSource('route-casing', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'route-casing-line',
        type: 'line',
        source: 'route-casing',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0369a1', 'line-width': 9, 'line-opacity': 0.28 }
      });

      // 3. Navigation Route Polyline
      map.addSource('route-polyline', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'route-polyline-line',
        type: 'line',
        source: 'route-polyline',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0284c7', 'line-width': 5, 'line-opacity': 0.95 }
      });

      // 4. Ghost B1 Trail
      map.addSource('ghost-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'ghost-trail-line',
        type: 'line',
        source: 'ghost-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 3, 'line-dasharray': [4, 3], 'line-opacity': 0.85 }
      });

      // Add Car Marker
      carMarker = new maplibregl.Marker({ element: carEl, anchor: 'center' })
        .setLngLat([initialLon, initialLat])
        .addTo(map);

      ghostMarker = new maplibregl.Marker({ element: ghostEl, anchor: 'center' });
    });

    // Communication receiver
    function handleAppMessage(event) {
      try {
        var msg = JSON.parse(event.data);

        if (msg.type === 'ROUTE_UPDATE') {
          var rawPts = msg.data.coordinates;
          if (rawPts && rawPts.length > 0) {
            // Convert [lat, lon] to GeoJSON [lon, lat]
            var geoPts = rawPts.map(function(p) { return [p[1], p[0]]; });

            if (map.getSource('route-casing')) {
              map.getSource('route-casing').setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: geoPts }
              });
            }
            if (map.getSource('route-polyline')) {
              map.getSource('route-polyline').setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: geoPts }
              });
            }

            if (geoPts.length > 1 && msg.data.fitBounds !== false) {
              var bounds = geoPts.reduce(function(b, coord) {
                return b.extend(coord);
              }, new maplibregl.LngLatBounds(geoPts[0], geoPts[0]));
              map.fitBounds(bounds, { padding: 50, duration: 600, maxZoom: 17 });
            }

            // Origin Marker
            var orig = msg.data.origin || rawPts[0];
            if (orig) {
              if (originMarker) originMarker.remove();
              var origEl = document.createElement('div');
              origEl.className = 'stop-pin pin-origin';
              origEl.innerText = 'START';
              originMarker = new maplibregl.Marker({ element: origEl, anchor: 'center' })
                .setLngLat([orig[1], orig[0]])
                .addTo(map);
            }

            // Destination Marker
            var dest = msg.data.destination || rawPts[rawPts.length - 1];
            if (dest) {
              if (destMarker) destMarker.remove();
              var destEl = document.createElement('div');
              destEl.className = 'stop-pin pin-dest';
              destEl.innerText = 'FINISH';
              destMarker = new maplibregl.Marker({ element: destEl, anchor: 'center' })
                .setLngLat([dest[1], dest[0]])
                .addTo(map);
            }
          }
        }

        if (msg.type === 'TELEMETRY_UPDATE') {
          var d = msg.data;
          var lat = d.carPos[0];
          var lon = d.carPos[1];
          var heading = d.heading;
          var isBlackout = d.isBlackout;
          currentHeading = heading;

          if (carMarker) {
            carMarker.setLngLat([lon, lat]);
          }

          var arrow = document.getElementById('carNavArrow');
          var puck = document.getElementById('carPuckWrap');
          if (arrow) {
            arrow.style.transform = 'rotate(' + heading + 'deg)';
            var p = arrow.querySelector('path');
            if (p) {
              p.setAttribute('fill', isBlackout ? '#ef4444' : '#0284c7');
            }
          }
          if (puck) {
            if (isBlackout) puck.classList.add('car-outage');
            else puck.classList.remove('car-outage');
          }

          // Outage Drop Pin
          if (isBlackout && !prevBlackout) {
            if (!lastGnssMarker) {
              var gnssEl = document.createElement('div');
              gnssEl.className = 'last-gnss-marker';
              gnssEl.innerText = 'GPS';
              lastGnssMarker = new maplibregl.Marker({ element: gnssEl, anchor: 'center' })
                .setLngLat([lon, lat])
                .addTo(map);
            }
          } else if (!isBlackout && prevBlackout) {
            if (lastGnssMarker) {
              lastGnssMarker.remove();
              lastGnssMarker = null;
            }
          }

          // Ghost Baseline
          if (d.showGhost && d.b1Pos) {
            ghostCoordinates.push([d.b1Pos[1], d.b1Pos[0]]);
            if (map.getSource('ghost-trail')) {
              map.getSource('ghost-trail').setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: ghostCoordinates }
              });
            }
            if (ghostMarker) {
              ghostMarker.setLngLat([d.b1Pos[1], d.b1Pos[0]]).addTo(map);
            }
          } else if (ghostMarker) {
            ghostMarker.remove();
            ghostCoordinates = [];
            if (map.getSource('ghost-trail')) {
              map.getSource('ghost-trail').setData({
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: [] }
              });
            }
          }

          // Camera Follow with Real 3D Perspective
          if (isFollowing) {
            if (is3D) {
              map.easeTo({
                center: [lon, lat],
                bearing: heading,
                pitch: 60,
                zoom: 16.8,
                duration: 120,
                easing: function(t) { return t; }
              });
            } else {
              map.easeTo({
                center: [lon, lat],
                duration: 120,
                easing: function(t) { return t; }
              });
            }
          }

          prevBlackout = isBlackout;
        }

        if (msg.type === 'SET_CAMERA_MODE') {
          is3D = msg.is3D;
          isFollowing = true;
          if (is3D) {
            map.easeTo({
              pitch: 60,
              bearing: currentHeading || 0,
              zoom: 16.8,
              duration: 800
            });
          } else {
            map.easeTo({
              pitch: 0,
              bearing: 0,
              zoom: 15.5,
              duration: 800
            });
          }
        }

        if (msg.type === 'RECENTER_VEHICLE') {
          isFollowing = true;
          if (carMarker) {
            var curLngLat = carMarker.getLngLat();
            if (is3D) {
              map.flyTo({
                center: curLngLat,
                pitch: 60,
                bearing: currentHeading || 0,
                zoom: 16.8,
                duration: 800
              });
            } else {
              map.flyTo({
                center: curLngLat,
                pitch: 0,
                zoom: 15.5,
                duration: 800
              });
            }
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    window.addEventListener('message', handleAppMessage);
    document.addEventListener('message', handleAppMessage);
  </script>
</body>
</html>
  `;

  const RNWebView = WebView as any;

  return (
    <View style={styles.container}>
      <RNWebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        onMessage={handleMessage}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scalesPageToFit={true}
        scrollEnabled={false}
      />

      {/* Floating Map Controls (Optional) */}
      {showFloatingControls && (
        <View style={styles.floatingControls}>
          <TouchableOpacity
            style={styles.controlBtn}
            onPress={toggleCameraMode}
            activeOpacity={0.8}
          >
            <IconCompass size={18} color="#0f172a" />
            <Text style={styles.controlText}>{internal3D ? '3D' : '2D'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlBtn}
            onPress={centerOnVehicle}
            activeOpacity={0.8}
          >
            <IconCrosshair size={18} color="#0f172a" />
          </TouchableOpacity>

          {onToggleGhostBaseline && (
            <TouchableOpacity
              style={[styles.controlBtn, showGhostBaseline && styles.controlBtnActive]}
              onPress={onToggleGhostBaseline}
              activeOpacity={0.8}
            >
              <IconEye size={18} color={showGhostBaseline ? '#ffffff' : '#0f172a'} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  floatingControls: {
    position: 'absolute',
    right: 14,
    bottom: 90,
    gap: 8,
    zIndex: 50,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  controlBtnActive: {
    backgroundColor: '#09131f',
  },
  controlText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: -2,
  },
});
