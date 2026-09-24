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
}

export const LiveMap: React.FC<LiveMapProps> = ({
  telemetry,
  routeCoordinates,
  showGhostBaseline = false,
  onToggleGhostBaseline,
  onMapClick,
  customOrigin,
  customDestination,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [is3DMode, setIs3DMode] = useState(false);

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
      },
    });

    webViewRef.current.postMessage(msg);
  }, [routeCoordinates, customOrigin, customDestination]);

  const toggleCameraMode = () => {
    const nextMode = !is3DMode;
    setIs3DMode(nextMode);
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

  // Generate self-contained HTML with Leaflet & OpenStreetMap tiles
  const initialCenter = routeCoordinates[0] || [28.6315, 77.2167];

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #f1f5f9; overflow: hidden; }
    .leaflet-control-attribution, .leaflet-control-zoom { display: none !important; }

    /* Custom Vehicle Marker */
    .car-puck {
      position: relative;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .car-cone {
      position: absolute;
      width: 0;
      height: 0;
      border-left: 9px solid transparent;
      border-right: 9px solid transparent;
      border-bottom: 24px solid #2563eb;
      filter: drop-shadow(0 2px 5px rgba(37,99,235,0.6));
      top: 4px;
      transition: transform 0.1s linear;
    }
    .car-dot {
      width: 12px;
      height: 12px;
      background: #ffffff;
      border: 2px solid #1d4ed8;
      border-radius: 50%;
      z-index: 2;
    }
    .car-radar-pulse {
      position: absolute;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(37, 99, 235, 0.15);
      border: 1px solid rgba(37, 99, 235, 0.4);
      animation: radarPulse 2s infinite ease-out;
    }
    @keyframes radarPulse {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* Last GNSS Pin Marker */
    .last-gnss-marker {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #dc2626;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 8px rgba(220, 38, 38, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      font-family: sans-serif;
    }

    /* Stop Pin */
    .stop-pin {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 3px solid #ffffff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .pin-origin { background: #059669; }
    .pin-dest { background: #2563eb; }

    /* Ghost Car Puck */
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
    var map = L.map('map', {
      center: [${initialCenter[0]}, ${initialCenter[1]}],
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    // Clean, high-contrast OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map);

    var routePolyline = L.polyline([], { color: '#0f172a', weight: 4.5, opacity: 0.75 }).addTo(map);
    var gnssTrail = L.polyline([], { color: '#059669', weight: 4.5, opacity: 0.9 }).addTo(map);
    var idrTrail = L.polyline([], { color: '#2563eb', weight: 4.5, opacity: 0.95 }).addTo(map);
    var ghostTrail = L.polyline([], { color: '#f97316', weight: 3, opacity: 0.85, dashArray: '5, 5' }).addTo(map);

    var carMarker = null;
    var ghostMarker = null;
    var lastGnssMarker = null;
    var originMarker = null;
    var destMarker = null;
    var isFollowing = true;
    var prevBlackout = false;

    // Create custom vehicle HTML marker
    var carIcon = L.divIcon({
      className: 'car-icon-wrap',
      html: '<div class="car-puck"><div class="car-radar-pulse"></div><div id="carCone" class="car-cone"></div><div class="car-dot"></div></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    var ghostIcon = L.divIcon({
      className: 'ghost-icon-wrap',
      html: '<div class="ghost-puck"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    // Map Click Listener
    map.on('click', function(e) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'MAP_CLICK',
          lat: e.latlng.lat,
          lon: e.latlng.lng
        }));
      }
    });

    // Disable auto-follow when user manually drags map
    map.on('dragstart', function() {
      isFollowing = false;
    });

    // Communication receiver
    function handleAppMessage(event) {
      try {
        var msg = JSON.parse(event.data);

        if (msg.type === 'ROUTE_UPDATE') {
          var pts = msg.data.coordinates;
          if (pts && pts.length > 0) {
            routePolyline.setLatLngs(pts);
            if (pts.length > 1) {
              map.fitBounds(routePolyline.getBounds(), { padding: [50, 50] });
            }

            // Origin Pin
            var orig = msg.data.origin || pts[0];
            if (orig) {
              if (originMarker) map.removeLayer(originMarker);
              originMarker = L.marker(orig, {
                icon: L.divIcon({
                  className: 'origin-wrap',
                  html: '<div class="stop-pin pin-origin"></div>',
                  iconSize: [18, 18],
                  iconAnchor: [9, 9]
                })
              }).addTo(map);
            }

            // Destination Pin
            var dest = msg.data.destination || pts[pts.length - 1];
            if (dest) {
              if (destMarker) map.removeLayer(destMarker);
              destMarker = L.marker(dest, {
                icon: L.divIcon({
                  className: 'dest-wrap',
                  html: '<div class="stop-pin pin-dest"></div>',
                  iconSize: [18, 18],
                  iconAnchor: [9, 9]
                })
              }).addTo(map);
            }
          }
        }

        if (msg.type === 'TELEMETRY_UPDATE') {
          var d = msg.data;
          var pos = d.carPos;
          var heading = d.heading;
          var isBlackout = d.isBlackout;

          // 1. Update Car Marker
          if (!carMarker) {
            carMarker = L.marker(pos, { icon: carIcon, zIndexOffset: 1000 }).addTo(map);
          } else {
            carMarker.setLatLng(pos);
          }

          // Rotate heading cone
          var cone = document.getElementById('carCone');
          if (cone) {
            cone.style.transform = 'rotate(' + heading + 'deg)';
          }

          // 2. Trails Management
          if (!isBlackout) {
            gnssTrail.addLatLng(pos);
            idrTrail.addLatLng(pos);

            // Remove last GNSS marker when restored
            if (prevBlackout && lastGnssMarker) {
              map.removeLayer(lastGnssMarker);
              lastGnssMarker = null;
            }
          } else {
            // In Blackout: IDR trail keeps growing, GNSS trail stops!
            idrTrail.addLatLng(pos);

            // Place Last GNSS Freeze Pin at blackout inception
            if (!prevBlackout && !lastGnssMarker) {
              lastGnssMarker = L.marker(pos, {
                icon: L.divIcon({
                  className: 'last-gnss-wrap',
                  html: '<div class="last-gnss-marker">GPS</div>',
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                }),
                zIndexOffset: 900
              }).addTo(map);
            }
          }

          // 3. Ghost Baseline Trail (B1 Raw INS)
          if (d.showGhost && d.b1Pos) {
            ghostTrail.addLatLng(d.b1Pos);
            if (!ghostMarker) {
              ghostMarker = L.marker(d.b1Pos, { icon: ghostIcon, zIndexOffset: 800 }).addTo(map);
            } else {
              ghostMarker.setLatLng(d.b1Pos);
            }
          } else if (ghostMarker) {
            map.removeLayer(ghostMarker);
            ghostMarker = null;
            ghostTrail.setLatLngs([]);
          }

          // 4. Auto-center Camera
          if (isFollowing) {
            map.panTo(pos, { animate: true, duration: 0.1 });
          }

          prevBlackout = isBlackout;
        }

        if (msg.type === 'SET_CAMERA_MODE') {
          var container = document.getElementById('map');
          if (msg.is3D) {
            container.style.transition = 'transform 0.4s ease';
            container.style.transform = 'perspective(650px) rotateX(35deg) scale(1.08)';
            if (carMarker) map.setView(carMarker.getLatLng(), 17, { animate: true });
          } else {
            container.style.transition = 'transform 0.4s ease';
            container.style.transform = 'none';
            if (carMarker) map.setView(carMarker.getLatLng(), 15, { animate: true });
          }
        }

        if (msg.type === 'RECENTER_VEHICLE') {
          isFollowing = true;
          if (carMarker) {
            map.setView(carMarker.getLatLng(), 16, { animate: true });
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

      {/* Floating Map Controls */}
      <View style={styles.mapControls}>
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={centerOnVehicle}
          activeOpacity={0.7}
          accessibilityLabel="Center on Vehicle"
        >
          <IconCrosshair size={18} color={theme.colors.slateDark} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, is3DMode && styles.controlBtnActive]}
          onPress={toggleCameraMode}
          activeOpacity={0.7}
          accessibilityLabel="Toggle 2D / 3D Mode"
        >
          <IconCompass size={18} color={is3DMode ? theme.colors.idrBlue : theme.colors.slateDark} />
        </TouchableOpacity>

        {onToggleGhostBaseline && (
          <TouchableOpacity
            style={[styles.controlBtn, showGhostBaseline && styles.controlBtnGhostActive]}
            onPress={onToggleGhostBaseline}
            activeOpacity={0.7}
            accessibilityLabel="Toggle Raw INS Baseline"
          >
            <IconEye size={18} color={showGhostBaseline ? theme.colors.alertRose : theme.colors.slateDark} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#f1f5f9',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mapControls: {
    position: 'absolute',
    right: 12,
    top: 86,
    gap: 8,
    zIndex: 20,
  },
  controlBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  controlBtnActive: {
    backgroundColor: theme.colors.idrBgSoft,
    borderColor: theme.colors.idrBlue,
  },
  controlBtnGhostActive: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
});
