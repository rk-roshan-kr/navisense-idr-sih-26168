import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreglWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { TelemetryPacket, ScenarioInfo, AppMode } from '../types';

// Configure WebGL self-contained worker for Vite production bundle
maplibregl.setWorkerUrl(maplibreglWorker);

interface LiveMapProps {
  telemetry: TelemetryPacket | null;
  scenario: ScenarioInfo | null;
  appMode: AppMode;
  customOrigin: [number, number] | null;
  customDestination: [number, number] | null;
  customRoutePath: [number, number][];
  onMapClick: (lat: number, lon: number) => void;
  showGhostBaseline?: boolean;
}

export const LiveMap: React.FC<LiveMapProps> = ({
  telemetry,
  scenario,
  appMode,
  customOrigin,
  customDestination,
  customRoutePath,
  onMapClick,
  showGhostBaseline = false
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Camera Mode: 2D Top-Down View by Default (per user instruction: "dont start with 3d view start with 2 always")
  const [is3DMode, setIs3DMode] = useState<boolean>(false);
  const is3DModeRef = useRef<boolean>(false);
  const isFollowingRef = useRef<boolean>(true);

  // Segmented MultiLineString coordinates (Guarantees zero green line across blackout and zero spiderweb jumps!)
  const gnssSegmentsRef = useRef<[number, number][][]>([]);
  const idrSegmentsRef = useRef<[number, number][][]>([]);
  const lastGnssCoordRef = useRef<[number, number] | null>(null);
  const lastIdrCoordRef = useRef<[number, number] | null>(null);

  // DOM Markers for Start (A), Destination (B), Car, and Ghost
  const carMarkerRef = useRef<maplibregl.Marker | null>(null);
  const ghostMarkerRef = useRef<maplibregl.Marker | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);

  // 60 FPS LERP animation state (Centered on ISRO ISTRAC, Bangalore, India)
  const animPosRef = useRef<[number, number]>([77.5186, 13.0334]); // [lon, lat]
  const targetPosRef = useRef<[number, number]>([77.5186, 13.0334]);
  const animHeadingRef = useRef<number>(0);
  const targetHeadingRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const prevBlackoutRef = useRef<boolean>(false);

  // Switch to Freecam automatically when entering custom 2-point mode
  useEffect(() => {
    if (appMode === 'CUSTOM_ROUTE') {
      setIs3DMode(false);
      is3DModeRef.current = false;
      if (mapRef.current) {
        mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      }
    }
  }, [appMode]);

  // Initialize MapLibre GL 3D Vector Map (OpenFreeMap 3D Vector Tiles - 100% Free, Zero Watermarks)
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialLon = 77.5186;
    const initialLat = 13.0334;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/liberty', // 3D Vector Map with building extrusions
      center: [initialLon, initialLat],
      zoom: 15.5,
      pitch: 0, // Starts in 2D Top-Down View by default per user directive
      bearing: 0,
      maxPitch: 85,
      attributionControl: false,
      dragRotate: true,
      touchZoomRotate: true,
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true
    });

    map.on('load', () => {
      // 1. Add 3D Extruded Buildings Layer (Architectural shading in 3D)
      const layers = map.getStyle().layers || [];
      const labelLayer = layers.find((l: any) => l.type === 'symbol' && l.layout && l.layout['text-field']);
      const labelLayerId = labelLayer ? labelLayer.id : undefined;

      if (!map.getLayer('3d-buildings') && map.getSource('openmaptiles')) {
        map.addLayer(
          {
            id: '3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 15.0,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'render_height'],
                0, '#e2e8f0',
                20, '#cbd5e1',
                50, '#94a3b8'
              ],
              'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15.0, 0, 16.0, ['get', 'render_height']],
              'fill-extrusion-base': ['get', 'render_min_height'],
              'fill-extrusion-opacity': 0.8
            }
          },
          labelLayerId
        );
      }

      // 2. GNSS Trail (MultiLineString - Breaks completely during outage, no bridging)
      map.addSource('gnss-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'gnss-trail-line',
        type: 'line',
        source: 'gnss-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0f172a', 'line-width': 2, 'line-opacity': 0.7 }
      });

      // 3. IDR Dead Reckoning Trail (DESIGN.md: Emerald 500, 3px line)
      map.addSource('idr-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'idr-trail-line',
        type: 'line',
        source: 'idr-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#10b981', 'line-width': 3, 'line-opacity': 0.95 }
      });

      // 3. Custom Route Preview Layer (DESIGN.md: Cobalt Blue #1D4ED8, 3px line)
      map.addSource('custom-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'custom-route-line',
        type: 'line',
        source: 'custom-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1d4ed8', 'line-width': 3, 'line-opacity': 0.85 }
      });

      // 5. Raw INS Divergence Ghost Trail (DESIGN.md: Rose #E11D48)
      map.addSource('ghost-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'ghost-trail-line',
        type: 'line',
        source: 'ghost-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e11d48', 'line-width': 2, 'line-dasharray': [3, 3], 'line-opacity': 0.7 }
      });
    });

    // Custom 3D Vehicle Marker Element with Forward Direction Beam
    const carEl = document.createElement('div');
    carEl.className = 'nav-car-wrap';
    carEl.innerHTML = `
      <div class="nav-car-halo"></div>
      <div id="nav-car-puck-wrap" class="nav-car-puck">
        <div id="nav-car-arrow" class="nav-car-arrow"></div>
      </div>
    `;
    carMarkerRef.current = new maplibregl.Marker({ element: carEl })
      .setLngLat([initialLon, initialLat])
      .addTo(map);

    // Raw INS Ghost Marker
    const ghostEl = document.createElement('div');
    ghostEl.style.cssText = 'width: 20px; height: 20px; border-radius: 50%; background: rgba(220, 38, 38, 0.4); border: 2px dashed #ef4444; display: none; align-items: center; justify-content: center;';
    ghostEl.innerHTML = '<div style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></div>';
    ghostMarkerRef.current = new maplibregl.Marker({ element: ghostEl })
      .setLngLat([initialLon, initialLat])
      .addTo(map);

    // Map Events
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      onMapClick(e.lngLat.lat, e.lngLat.lng);
    });

    // Auto-unlock camera follow on user manual drag
    const unlockToFreecam = () => {
      isFollowingRef.current = false;
    };

    map.on('dragstart', unlockToFreecam);
    map.on('touchstart', unlockToFreecam);
    map.on('wheel', unlockToFreecam);

    // Right-Click to Zoom Out (Google Maps Gesture)
    map.on('contextmenu', (e) => {
      e.preventDefault();
      unlockToFreecam();
      map.zoomOut({ duration: 300 });
    });

    mapRef.current = map;

    // ── 60 FPS Smooth WebGL Animation Loop ───────────────────────────────────
    let animId: number;
    const animateLoop = () => {
      const cur = animPosRef.current;
      const tgt = targetPosRef.current;

      const newLon = cur[0] + (tgt[0] - cur[0]) * 0.22;
      const newLat = cur[1] + (tgt[1] - cur[1]) * 0.22;
      animPosRef.current = [newLon, newLat];

      let dHead = targetHeadingRef.current - animHeadingRef.current;
      while (dHead > 180) dHead -= 360;
      while (dHead < -180) dHead += 360;
      animHeadingRef.current += dHead * 0.2;

      // Update vehicle marker on map
      if (carMarkerRef.current) {
        carMarkerRef.current.setLngLat([newLon, newLat]);
      }

      const arrow = document.getElementById('nav-car-arrow');
      if (arrow) {
        // In 3D Cockpit view, camera rotates with vehicle heading, so arrow points straight forward
        arrow.style.transform = is3DModeRef.current ? 'rotate(0deg)' : `rotate(${animHeadingRef.current}deg)`;
      }

      // Camera tracking: In 3D Cockpit mode pitch 68 + bearing; in 2D mode, follow vehicle smoothly with pitch 0
      if (mapRef.current && is3DModeRef.current) {
        mapRef.current.jumpTo({
          center: [newLon, newLat],
          bearing: animHeadingRef.current,
          pitch: 68
        });
      } else if (mapRef.current && !is3DModeRef.current && isFollowingRef.current) {
        mapRef.current.jumpTo({
          center: [newLon, newLat],
          pitch: 0,
          bearing: 0
        });
      }

      animId = requestAnimationFrame(animateLoop);
    };

    animId = requestAnimationFrame(animateLoop);

    return () => {
      cancelAnimationFrame(animId);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Custom Origin & Destination Markers (Option 2)
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (customOrigin) {
      if (!originMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width: 16px; height: 16px; border-radius: 50%; background: #10b981; border: 3px solid #ffffff; box-shadow: 0 0 10px rgba(16, 185, 129, 0.6);';
        originMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([customOrigin[1], customOrigin[0]])
          .addTo(map);
      } else {
        originMarkerRef.current.setLngLat([customOrigin[1], customOrigin[0]]);
      }
    } else {
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
    }

    if (customDestination) {
      if (!destMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width: 16px; height: 16px; border-radius: 50%; background: #ef4444; border: 3px solid #ffffff; box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);';
        destMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([customDestination[1], customDestination[0]])
          .addTo(map);
      } else {
        destMarkerRef.current.setLngLat([customDestination[1], customDestination[0]]);
      }
    } else {
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
    }

    if (customRoutePath.length > 0) {
      const geojson = customRoutePath.map(([lat, lon]) => [lon, lat]);
      const src = map.getSource('custom-route') as maplibregl.GeoJSONSource;
      src?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geojson } });
      const bounds = geojson.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(geojson[0] as [number, number], geojson[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: 80 });
    }
  }, [customOrigin, customDestination, customRoutePath]);

  // Scenario Switch Reset
  useEffect(() => {
    if (!mapRef.current || appMode !== 'CANONICAL_DATASET' || !scenario) return;

    gnssSegmentsRef.current = [];
    idrSegmentsRef.current = [];
    lastGnssCoordRef.current = null;
    lastIdrCoordRef.current = null;

    const gSrc = mapRef.current.getSource('gnss-trail') as maplibregl.GeoJSONSource;
    gSrc?.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } });

    const iSrc = mapRef.current.getSource('idr-trail') as maplibregl.GeoJSONSource;
    iSrc?.setData({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } });

    if (scenario.road_polyline && scenario.road_polyline.length > 0) {
      const startPt = scenario.road_polyline[0];
      animPosRef.current = [startPt[1], startPt[0]];
      targetPosRef.current = [startPt[1], startPt[0]];
      mapRef.current.jumpTo({ center: [startPt[1], startPt[0]], zoom: 17 });
    }
  }, [scenario?.id, appMode]);

  // Update Target Telemetry on 10 Hz Packets
  useEffect(() => {
    if (!telemetry || !mapRef.current) return;

    const { idr_position, heading_deg, blackout_active, blackout_elapsed_s } = telemetry;
    const currCoord: [number, number] = [idr_position.lon, idr_position.lat];

    if (!isInitializedRef.current) {
      animPosRef.current = currCoord;
      targetPosRef.current = currCoord;
      animHeadingRef.current = heading_deg;
      targetHeadingRef.current = heading_deg;
      isInitializedRef.current = true;
    } else {
      targetPosRef.current = currCoord;
      targetHeadingRef.current = heading_deg;
    }

    // Distance metric in meters to detect teleportations, resets, or scenario jumps
    const distM = (c1: [number, number], c2: [number, number]) => {
      const dlat = (c2[1] - c1[1]) * 111320;
      const dlon = (c2[0] - c1[0]) * 111320 * Math.cos((c1[1] * Math.PI) / 180);
      return Math.sqrt(dlat * dlat + dlon * dlon);
    };

    // ── Zero GPS Trail During Blackout & Zero Teleportation Jump Lines ──
    if (!blackout_active) {
      // 1. Normal GNSS Active:
      // If GPS just restored, start a NEW segment at the current recovery point!
      // This guarantees NO GREEN LINE is drawn across the blackout period!
      const isRecovery = prevBlackoutRef.current;
      const isLargeJump = lastGnssCoordRef.current ? distM(lastGnssCoordRef.current, currCoord) > 25.0 : false;

      if (isRecovery || isLargeJump || gnssSegmentsRef.current.length === 0 || gnssSegmentsRef.current[gnssSegmentsRef.current.length - 1].length === 0) {
        gnssSegmentsRef.current.push([currCoord]);
      } else {
        const activeSeg = gnssSegmentsRef.current[gnssSegmentsRef.current.length - 1];
        activeSeg.push(currCoord);
      }
      lastGnssCoordRef.current = currCoord;

      const gSrc = mapRef.current.getSource('gnss-trail') as maplibregl.GeoJSONSource;
      gSrc?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: gnssSegmentsRef.current }
      });
    } else {
      // 2. GNSS Blackout (Dead Reckoning Active):
      // GPS line gets ZERO points added.
      // Electric blue IDR trail records the outage navigation.
      const isBlackoutStart = !prevBlackoutRef.current;
      const isLargeJump = lastIdrCoordRef.current ? distM(lastIdrCoordRef.current, currCoord) > 25.0 : false;

      if (isBlackoutStart || isLargeJump || idrSegmentsRef.current.length === 0 || idrSegmentsRef.current[idrSegmentsRef.current.length - 1].length === 0) {
        const startPt = lastGnssCoordRef.current || currCoord;
        idrSegmentsRef.current.push([startPt, currCoord]);
      } else {
        const activeSeg = idrSegmentsRef.current[idrSegmentsRef.current.length - 1];
        activeSeg.push(currCoord);
      }
      lastIdrCoordRef.current = currCoord;

      const iSrc = mapRef.current.getSource('idr-trail') as maplibregl.GeoJSONSource;
      iSrc?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: idrSegmentsRef.current }
      });

      // Raw INS Ghost Divergence
      if (showGhostBaseline) {
        const rad = (heading_deg * Math.PI) / 180;
        const t = blackout_elapsed_s;
        const driftM = 0.5 * 0.22 * t * t;
        const ghostLat = idr_position.lat + (driftM * Math.cos(rad + Math.PI / 2)) / 111320;
        const ghostLon = idr_position.lon + (driftM * Math.sin(rad + Math.PI / 2)) / (111320 * Math.cos((idr_position.lat * Math.PI) / 180));
        ghostMarkerRef.current?.setLngLat([ghostLon, ghostLat]);
        ghostMarkerRef.current?.getElement().style.setProperty('display', 'flex');
      } else {
        ghostMarkerRef.current?.getElement().style.setProperty('display', 'none');
      }
    }
    prevBlackoutRef.current = blackout_active;

    // Vehicle marker state
    const puck = document.getElementById('nav-car-puck-wrap');
    if (puck) {
      if (blackout_active) puck.classList.add('blackout');
      else puck.classList.remove('blackout');
    }
  }, [telemetry, showGhostBaseline]);

  // Toggle Camera Mode
  const handleToggleMode = (mode3D: boolean) => {
    setIs3DMode(mode3D);
    is3DModeRef.current = mode3D;
    isFollowingRef.current = true;

    if (!mapRef.current) return;
    if (mode3D) {
      mapRef.current.easeTo({
        center: animPosRef.current,
        bearing: animHeadingRef.current,
        pitch: 68,
        zoom: 17.8, // Zoomed in tight to the car for immersive 3D Cockpit driving
        duration: 800
      });
    } else {
      mapRef.current.easeTo({
        center: animPosRef.current,
        pitch: 0,
        bearing: 0,
        zoom: 15.5,
        duration: 600
      });
    }
  };

  const handleRecenter = () => {
    isFollowingRef.current = true;
    if (!mapRef.current) return;
    if (is3DModeRef.current) {
      mapRef.current.easeTo({
        center: animPosRef.current,
        bearing: animHeadingRef.current,
        pitch: 68,
        zoom: 17.8,
        duration: 600
      });
    } else {
      mapRef.current.easeTo({
        center: animPosRef.current,
        pitch: 0,
        bearing: 0,
        zoom: 15.5,
        duration: 600
      });
    }
  };

  const handleZoomIn = () => {
    setIs3DMode(false);
    is3DModeRef.current = false;
    mapRef.current?.zoomIn({ duration: 300 });
  };

  const handleZoomOut = () => {
    setIs3DMode(false);
    is3DModeRef.current = false;
    mapRef.current?.zoomOut({ duration: 300 });
  };

  // Google Maps Keyboard Shortcuts (Space/C: Re-center, +/-: Zoom, F: Freecam)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === 'c' || e.key === 'C' || e.key === ' ') {
        e.preventDefault();
        handleRecenter();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === 'f' || e.key === 'F') {
        handleToggleMode(!is3DModeRef.current);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: appMode === 'CUSTOM_ROUTE' ? 'crosshair' : 'default' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Floating 3D Navigation Camera Controls (Moved to Bottom-Left per user request!) */}
      <div className="map-camera-controls glass-panel">
        <button
          onClick={() => handleToggleMode(true)}
          className={`btn-cam-mode ${is3DMode ? 'active-cam' : ''}`}
          title="Apple Maps 3D Cockpit driving perspective with 3D buildings (Press Space or C)"
        >
          <span className={is3DMode ? 'cam-dot-live' : 'cam-dot-off'} />
          <span>3D Cockpit</span>
        </button>
        <button
          onClick={() => handleToggleMode(false)}
          className={`btn-cam-mode ${!is3DMode ? 'active-cam' : ''}`}
          title="2D Top-down Freecam overview (Press F)"
        >
          <span>2D Freecam</span>
        </button>
      </div>

      {/* Floating Re-center Button when in Freecam */}
      {!is3DMode && (
        <button
          onClick={handleRecenter}
          className="btn-recenter-car glass-panel"
          title="Re-center camera and return to 3D driving view (Press Space or C)"
        >
          <span className="recenter-target-icon">⌖</span>
          <span>Re-center on Vehicle (3D)</span>
        </button>
      )}

      {/* Google Maps Floating Zoom Controls (+ / -) in Bottom-Right */}
      <div className="gmaps-zoom-controls glass-panel">
        <button
          onClick={handleZoomIn}
          className="btn-gmaps-zoom"
          title="Zoom in (+ or double-click)"
        >
          +
        </button>
        <div className="zoom-btn-divider" />
        <button
          onClick={handleZoomOut}
          className="btn-gmaps-zoom"
          title="Zoom out (- or right-click)"
        >
          −
        </button>
      </div>
    </div>
  );
};
