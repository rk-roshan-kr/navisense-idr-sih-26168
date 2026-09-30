import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from '../theme';
import type { TelemetryPacket, ScenarioInfo } from '../types';
import { IconCrosshair, IconCompass, IconEye, IconNavigation } from './Icons';

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
  isAudioMuted?: boolean;
  onToggleAudioMuted?: () => void;
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
  isAudioMuted = false,
  onToggleAudioMuted,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [internal3D, setInternal3D] = useState(is3DMode);
  const [isTracking, setIsTracking] = useState(true);

  // Keep latest props in refs so MAP_READY handler always has current state
  const routeCoordinatesRef = useRef(routeCoordinates);
  routeCoordinatesRef.current = routeCoordinates;
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const customOriginRef = useRef(customOrigin);
  customOriginRef.current = customOrigin;
  const customDestinationRef = useRef(customDestination);
  customDestinationRef.current = customDestination;
  const fitBoundsRef = useRef(fitBounds);
  fitBoundsRef.current = fitBounds;

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

  // Sync audio mute state to WebView
  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SET_AUDIO_MUTED',
          muted: isAudioMuted,
        })
      );
    }
  }, [isAudioMuted]);

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
    setIsTracking(true);
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'RECENTER_VEHICLE',
        })
      );
    }
  };

  const trackIn3D = () => {
    setInternal3D(true);
    setIsTracking(true);
    if (onToggle3DMode && !internal3D) {
      onToggle3DMode();
    }
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SET_CAMERA_MODE',
          is3D: true,
        })
      );
    }
  };

  const trackIn2D = () => {
    setInternal3D(false);
    setIsTracking(true);
    if (onToggle3DMode && internal3D) {
      onToggle3DMode();
    }
    if (webViewRef.current) {
      webViewRef.current.postMessage(
        JSON.stringify({
          type: 'SET_CAMERA_MODE',
          is3D: false,
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
      if (data.type === 'TRACKING_STATE') {
        setIsTracking(data.isTracking);
      }
      if (data.type === 'MAP_READY') {
        if (routeCoordinatesRef.current.length > 0 && webViewRef.current) {
          webViewRef.current.postMessage(
            JSON.stringify({
              type: 'ROUTE_UPDATE',
              data: {
                coordinates: routeCoordinatesRef.current,
                origin: customOriginRef.current,
                destination: customDestinationRef.current,
                fitBounds: fitBoundsRef.current,
              },
            })
          );
        }
        if (telemetryRef.current && webViewRef.current) {
          webViewRef.current.postMessage(
            JSON.stringify({
              type: 'TELEMETRY_UPDATE',
              data: {
                carPos: [telemetryRef.current.idr_position.lat, telemetryRef.current.idr_position.lon],
                gnssPos: telemetryRef.current.gnss_position ? [telemetryRef.current.gnss_position.lat, telemetryRef.current.gnss_position.lon] : null,
                b1Pos: telemetryRef.current.b1_position ? [telemetryRef.current.b1_position.lat, telemetryRef.current.b1_position.lon] : null,
                heading: telemetryRef.current.heading_deg,
                speedKmh: telemetryRef.current.speed_kmh,
                isBlackout: telemetryRef.current.blackout_active,
                showGhost: showGhostBaseline,
              },
            })
          );
        }
      }
    } catch (e) {
      console.warn('Map message parse error:', e);
    }
  };

  // Generate self-contained HTML template ONCE so Android WebView NEVER reloads on 10 Hz telemetry updates!
  const htmlContent = useMemo(() => {
    const initCoords = routeCoordinates.length > 0 ? routeCoordinates : [[28.6315, 77.2167], [28.6325, 77.2164]];
    const initialCenter = initCoords[0];
    const initialHeading = telemetry?.heading_deg ?? 344;
    const initialRouteGeoJSON = JSON.stringify(
      initCoords.map((p) => [p[1], p[0]])
    );
    const initialOriginJSON = JSON.stringify(
      customOrigin
        ? [customOrigin[1], customOrigin[0]]
        : [initialCenter[1], initialCenter[0]]
    );
    const initialDestJSON = JSON.stringify(
      customDestination
        ? [customDestination[1], customDestination[0]]
        : [initCoords[initCoords.length - 1][1], initCoords[initCoords.length - 1][0]]
    );

    return `
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
      width: 48px;
      height: 48px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .nav-car-arrow {
      width: 32px;
      height: 32px;
      filter: drop-shadow(0 4px 8px rgba(2, 132, 199, 0.7));
      transform-origin: center center;
    }
    .nav-car-halo {
      position: absolute;
      width: 48px;
      height: 48px;
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
    var initialRouteCoords = ${initialRouteGeoJSON};
    var initialOrigin = ${initialOriginJSON};
    var initialDest = ${initialDestJSON};
    var is3D = ${is3DMode ? 'true' : 'false'};
    var isFollowing = true;
    var currentHeading = ${initialHeading};
    var prevBlackout = false;
    var mapIsLoaded = false;
    var pendingRoute = null;
    var audioCtx = null;
    var voiceMuted = ${isAudioMuted ? 'true' : 'false'};

    function initAudio() {
      if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
    }

    function playChime(type) {
      try {
        if (voiceMuted) return;
        initAudio();
        if (!audioCtx) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();

        var now = audioCtx.currentTime;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'outage') {
          // Warning sweep (Dual Tone Frequency Drop: 640Hz -> 380Hz)
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(640, now);
          osc.frequency.exponentialRampToValueAtTime(380, now + 0.3);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          osc.start(now);
          osc.stop(now + 0.3);
        } else if (type === 'restored') {
          // Positive Reconnection Chord (520Hz -> 820Hz)
          osc.type = 'sine';
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(820, now + 0.25);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
          osc.start(now);
          osc.stop(now + 0.25);
        } else if (type === 'tap') {
          // Subtle feedback click
          osc.type = 'sine';
          osc.frequency.setValueAtTime(750, now);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
          osc.start(now);
          osc.stop(now + 0.08);
        }
      } catch (e) {}
    }

    function speakVoice(text) {
      try {
        if (voiceMuted || !window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.pitch = 1.0;
        u.volume = 0.95;
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }

    // Initialize Real MapLibre GL 3D Vector Map with All Native Gestures (Apple/Google Maps)
    var map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty', // Real 3D Vector Map with building extrusions
      center: [initialLon, initialLat],
      zoom: 16.5,
      pitch: is3D ? 60 : 0, // Real 3D Perspective Pitch
      bearing: is3D ? currentHeading : 0,
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
    carEl.innerHTML = '<div class="nav-car-halo"></div><svg id="carNavArrow" class="nav-car-arrow" viewBox="0 0 32 32"><path d="M16 2 L28 27 L16 21 L4 27 Z" fill="#0284c7" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round" /></svg>';

    var ghostEl = document.createElement('div');
    ghostEl.className = 'ghost-puck';

    // MapLibre Marker with MAP rotation & pitch alignment for authentic road-aligned tracking
    carMarker = new maplibregl.Marker({
      element: carEl,
      anchor: 'center',
      rotationAlignment: 'map',
      pitchAlignment: 'map'
    })
      .setLngLat([initialLon, initialLat])
      .setRotation(currentHeading)
      .addTo(map);

    ghostMarker = new maplibregl.Marker({ element: ghostEl, anchor: 'center' });

    function notifyTracking(state) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'TRACKING_STATE',
          isTracking: state
        }));
      }
    }

    // Differentiate Pan (detach from vehicle) vs Zoom (adjust scale without detaching):
    // 1. Drag/Pan: User explicitly drags the map away from vehicle -> Detach tracking into Freecam mode
    map.on('dragstart', function(e) {
      if (e && e.originalEvent) {
        isFollowing = false;
        notifyTracking(false);
      }
    });
    map.on('rotatestart', function(e) {
      if (e && e.originalEvent) {
        isFollowing = false;
        notifyTracking(false);
      }
    });
    map.on('pitchstart', function(e) {
      if (e && e.originalEvent) {
        isFollowing = false;
        notifyTracking(false);
      }
    });

    // 2. Zooming (pinch, double-tap, scroll wheel): User changes magnification -> Maintain tracking without snapping back
    map.on('zoom', function() {
      // Zoom changes naturally without forcing center or breaking tracking state
    });

    // Tap on map
    map.on('click', function(e) {
      playChime('tap');
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'MAP_CLICK',
          lat: e.lngLat.lat,
          lon: e.lngLat.lng
        }));
      }
    });

    function applyRoute(data) {
      var rawPts = data.coordinates;
      if (!rawPts || rawPts.length === 0) return;
      var geoPts = rawPts.map(function(p) { return [p[1], p[0]]; });

      if (map.getSource('route-casing')) {
        map.getSource('route-casing').setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: geoPts }
        });
      } else {
        map.addSource('route-casing', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geoPts } }
        });
        map.addLayer({
          id: 'route-casing-line',
          type: 'line',
          source: 'route-casing',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#0284c7', 'line-width': 12, 'line-opacity': 0.38 }
        });
      }

      if (map.getSource('route-polyline')) {
        map.getSource('route-polyline').setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: geoPts }
        });
      } else {
        map.addSource('route-polyline', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geoPts } }
        });
        map.addLayer({
          id: 'route-polyline-line',
          type: 'line',
          source: 'route-polyline',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#1a73e8', 'line-width': 7, 'line-opacity': 1.0 }
        });
      }

      if (map.getSource('route-inner')) {
        map.getSource('route-inner').setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: geoPts }
        });
      } else {
        map.addSource('route-inner', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geoPts } }
        });
        map.addLayer({
          id: 'route-inner-line',
          type: 'line',
          source: 'route-inner',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#93c5fd', 'line-width': 2.5, 'line-opacity': 0.95 }
        });
      }

      // Origin Marker
      var orig = data.origin || rawPts[0];
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
      var dest = data.destination || rawPts[rawPts.length - 1];
      if (dest) {
        if (destMarker) destMarker.remove();
        var destEl = document.createElement('div');
        destEl.className = 'stop-pin pin-dest';
        destEl.innerText = 'FINISH';
        destMarker = new maplibregl.Marker({ element: destEl, anchor: 'center' })
          .setLngLat([dest[1], dest[0]])
          .addTo(map);
      }

      if (geoPts.length > 1 && data.fitBounds !== false) {
        var bounds = geoPts.reduce(function(b, coord) {
          return b.extend(coord);
        }, new maplibregl.LngLatBounds(geoPts[0], geoPts[0]));
        map.fitBounds(bounds, { padding: 60, duration: 600, maxZoom: 17 });
      }
    }

    map.on('load', function() {
      mapIsLoaded = true;

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

      // 2. Navigation Route Casing Glow (Cyan / Navy Blue outer glow)
      if (!map.getSource('route-casing')) {
        map.addSource('route-casing', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: initialRouteCoords }
          }
        });
        map.addLayer({
          id: 'route-casing-line',
          type: 'line',
          source: 'route-casing',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#0284c7',
            'line-width': 12,
            'line-opacity': 0.38
          }
        });
      }

      // 3. Navigation Route Polyline (Bold Google Maps Royal Blue #1a73e8)
      if (!map.getSource('route-polyline')) {
        map.addSource('route-polyline', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: initialRouteCoords }
          }
        });
        map.addLayer({
          id: 'route-polyline-line',
          type: 'line',
          source: 'route-polyline',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#1a73e8',
            'line-width': 7,
            'line-opacity': 1.0
          }
        });
      }

      // 4. Navigation Route Inner Accent (Bright Core Line #93c5fd)
      if (!map.getSource('route-inner')) {
        map.addSource('route-inner', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: initialRouteCoords }
          }
        });
        map.addLayer({
          id: 'route-inner-line',
          type: 'line',
          source: 'route-inner',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#93c5fd',
            'line-width': 2.5,
            'line-opacity': 0.95
          }
        });
      }

      // 5. Ghost B1 Trail
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

      // Render initial START & FINISH pins
      if (initialOrigin) {
        var origEl = document.createElement('div');
        origEl.className = 'stop-pin pin-origin';
        origEl.innerText = 'START';
        originMarker = new maplibregl.Marker({ element: origEl, anchor: 'center' })
          .setLngLat(initialOrigin)
          .addTo(map);
      }
      if (initialDest) {
        var destEl = document.createElement('div');
        destEl.className = 'stop-pin pin-dest';
        destEl.innerText = 'FINISH';
        destMarker = new maplibregl.Marker({ element: destEl, anchor: 'center' })
          .setLngLat(initialDest)
          .addTo(map);
      }

      // If a route was received before load, apply it now
      if (pendingRoute) {
        applyRoute(pendingRoute);
        pendingRoute = null;
      }

      // Notify React Native that Map is ready
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
      }
    });

    // Communication receiver
    function handleAppMessage(event) {
      try {
        var msg = JSON.parse(event.data);

        if (msg.type === 'ROUTE_UPDATE') {
          if (!mapIsLoaded) {
            pendingRoute = msg.data;
          } else {
            applyRoute(msg.data);
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
            carMarker.setRotation(heading);
          }

          var arrow = document.getElementById('carNavArrow');
          var puck = document.getElementById('carPuckWrap');
          if (arrow) {
            var p = arrow.querySelector('path');
            if (p) {
              p.setAttribute('fill', isBlackout ? '#ef4444' : '#0284c7');
            }
          }
          if (puck) {
            if (isBlackout) puck.classList.add('car-outage');
            else puck.classList.remove('car-outage');
          }

          // Outage Drop Pin & Audio Feedback
          if (isBlackout && !prevBlackout) {
            playChime('outage');
            speakVoice("GNSS signal lost. Navisense IDR active.");
            if (!lastGnssMarker) {
              var gnssEl = document.createElement('div');
              gnssEl.className = 'last-gnss-marker';
              gnssEl.innerText = 'GPS';
              lastGnssMarker = new maplibregl.Marker({ element: gnssEl, anchor: 'center' })
                .setLngLat([lon, lat])
                .addTo(map);
            }
          } else if (!isBlackout && prevBlackout) {
            playChime('restored');
            speakVoice("GNSS signal restored. Reconverging position.");
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

          // Camera Follow with Real 3D Perspective (Preserves User-Selected Zoom!)
          if (isFollowing) {
            if (is3D) {
              map.easeTo({
                center: [lon, lat],
                bearing: heading,
                pitch: 60,
                duration: 90,
                easing: function(t) { return t; }
              });
            } else {
              map.easeTo({
                center: [lon, lat],
                pitch: 0,
                duration: 90,
                easing: function(t) { return t; }
              });
            }
          }

          prevBlackout = isBlackout;
        }

        if (msg.type === 'SET_CAMERA_MODE') {
          is3D = msg.is3D;
          isFollowing = true;
          notifyTracking(true);
          var curTarget = carMarker ? carMarker.getLngLat() : map.getCenter();
          if (is3D) {
            map.easeTo({
              center: curTarget,
              pitch: 60,
              bearing: currentHeading || 0,
              duration: 700
            });
          } else {
            map.easeTo({
              center: curTarget,
              pitch: 0,
              bearing: 0,
              duration: 700
            });
          }
        }

        if (msg.type === 'RECENTER_VEHICLE') {
          isFollowing = true;
          notifyTracking(true);
          if (carMarker) {
            var curLngLat = carMarker.getLngLat();
            if (is3D) {
              map.flyTo({
                center: curLngLat,
                pitch: 60,
                bearing: currentHeading || 0,
                zoom: Math.max(map.getZoom(), 16.5),
                duration: 650
              });
            } else {
              map.flyTo({
                center: curLngLat,
                pitch: 0,
                bearing: 0,
                zoom: Math.max(map.getZoom(), 15.5),
                duration: 650
              });
            }
          }
        }

        if (msg.type === 'SPEAK') {
          speakVoice(msg.text);
        }
        if (msg.type === 'PLAY_CHIME') {
          playChime(msg.chimeType);
        }
        if (msg.type === 'SET_AUDIO_MUTED') {
          voiceMuted = !!msg.muted;
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
  }, []);

  const htmlSource = useMemo(() => ({ html: htmlContent }), [htmlContent]);

  const RNWebView = WebView as any;

  return (
    <View style={styles.container}>
      <RNWebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={htmlSource}
        onMessage={handleMessage}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scalesPageToFit={true}
        scrollEnabled={false}
      />

      {/* Floating Active Tracking Controls (Recenter Button + 3D/2D Tracking Toggle) */}
      <View style={styles.trackingFloatingWrap} pointerEvents="box-none">
        {/* 1. Dedicated Recenter Button (Appears separately above toggle when panned away) */}
        {!isTracking && (
          <TouchableOpacity
            style={styles.recenterFloatBtn}
            onPress={centerOnVehicle}
            activeOpacity={0.8}
          >
            <IconCrosshair size={14} color="#1a73e8" />
            <Text style={styles.recenterFloatBtnText}>RECENTER CAR</Text>
          </TouchableOpacity>
        )}

        {/* 2. Persistent 3D / 2D Tracking Mode Selector */}
        <View style={styles.trackingSegment}>
          <TouchableOpacity
            style={[
              styles.trackingSegmentBtn,
              internal3D && isTracking && styles.trackingSegmentBtnActive,
            ]}
            onPress={trackIn3D}
            activeOpacity={0.8}
          >
            <IconNavigation size={13} color={internal3D && isTracking ? '#ffffff' : '#64748b'} />
            <Text
              style={[
                styles.trackingSegmentText,
                internal3D && isTracking && styles.trackingSegmentTextActive,
              ]}
            >
              3D TRACK
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.trackingSegmentBtn,
              !internal3D && isTracking && styles.trackingSegmentBtnActive,
            ]}
            onPress={trackIn2D}
            activeOpacity={0.8}
          >
            <IconCompass size={13} color={!internal3D && isTracking ? '#ffffff' : '#64748b'} />
            <Text
              style={[
                styles.trackingSegmentText,
                !internal3D && isTracking && styles.trackingSegmentTextActive,
              ]}
            >
              2D TRACK
            </Text>
          </TouchableOpacity>
        </View>
      </View>

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
  trackingFloatingWrap: {
    position: 'absolute',
    right: 14,
    bottom: 82,
    zIndex: 60,
    alignItems: 'flex-end',
  },
  recenterFloatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7.5,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 5,
  },
  recenterFloatBtnText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#1a73e8',
    letterSpacing: 0.4,
  },
  trackingSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 22,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 2,
  },
  trackingSegmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
  },
  trackingSegmentBtnActive: {
    backgroundColor: '#1a73e8',
    shadowColor: '#1a73e8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  trackingSegmentText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.4,
  },
  trackingSegmentTextActive: {
    color: '#ffffff',
  },
  floatingControls: {
    position: 'absolute',
    right: 14,
    bottom: 135,
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
