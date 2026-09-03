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

  // Camera Modes: 3D Cockpit (Apple Maps style) vs 2D Freecam
  const [is3DMode, setIs3DMode] = useState<boolean>(true);
  const is3DModeRef = useRef<boolean>(true);

  // Accumulated Trail Coordinates (GeoJSON format: [lon, lat])
  const gnssCoordsRef = useRef<[number, number][]>([]);
  const idrCoordsRef = useRef<[number, number][]>([]);
  const lastPointRef = useRef<[number, number] | null>(null);

  // Markers
  const carMarkerRef = useRef<maplibregl.Marker | null>(null);
  const ghostMarkerRef = useRef<maplibregl.Marker | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);

  // 60 FPS LERP animation state
  const animPosRef = useRef<[number, number]>([-1.5021, 52.4069]); // [lon, lat]
  const targetPosRef = useRef<[number, number]>([-1.5021, 52.4069]);
  const animHeadingRef = useRef<number>(0);
  const targetHeadingRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const prevBlackoutRef = useRef<boolean>(false);

  // Auto-switch to Freecam when entering custom 2-point mode
  useEffect(() => {
    if (appMode === 'CUSTOM_ROUTE') {
      setIs3DMode(false);
      is3DModeRef.current = false;
      if (mapRef.current) {
        mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      }
    }
  }, [appMode]);

  // Initialize MapLibre GL (100% Free OpenFreeMap 3D Vector Tiles)
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialLon = -1.5021;
    const initialLat = 52.4069;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      // 100% Free OpenFreeMap 3D Vector Tile Style (NO API KEY REQUIRED!)
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [initialLon, initialLat],
      zoom: 17,
      pitch: 60, // 3D Perspective Tilt like Apple Maps
      bearing: 0,
      maxPitch: 85,
      attributionControl: false
    });

    map.on('load', () => {
      // 1. Add 3D Extruded Buildings Layer (Apple Maps 3D City Look!)
      const layers = map.getStyle().layers;
      const labelLayer = layers ? layers.find((l: any) => l.type === 'symbol' && l.layout && l.layout['text-field']) : null;
      const labelLayerId = labelLayer ? labelLayer.id : undefined;

      if (!map.getLayer('3d-buildings') && map.getSource('openmaptiles')) {
        map.addLayer(
          {
            id: '3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
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
                14, 0,
                14.5, ['get', 'render_height']
              ],
              'fill-extrusion-base': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14, 0,
                14.5, ['get', 'render_min_height']
              ],
              'fill-extrusion-opacity': 0.75
            }
          },
          labelLayerId
        );
      }

      // 2. Active Road Corridor Source & Layer
      map.addSource('road-corridor', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'road-corridor-line',
        type: 'line',
        source: 'road-corridor',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#60a5fa', 'line-width': 4, 'line-opacity': 0.6 }
      });

      // 3. GNSS Active Trail (Emerald Green - Never Disappears!)
      map.addSource('gnss-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'gnss-trail-line',
        type: 'line',
        source: 'gnss-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#059669', 'line-width': 5.5, 'line-opacity': 0.95 }
      });

      // 4. IDR Dead Reckoning Trail (Electric Blue Aura & Core)
      map.addSource('idr-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'idr-trail-glow',
        type: 'line',
        source: 'idr-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': 'rgba(37, 99, 235, 0.4)', 'line-width': 12, 'line-opacity': 0.5 }
      });
      map.addLayer({
        id: 'idr-trail-line',
        type: 'line',
        source: 'idr-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 5.5, 'line-opacity': 0.95 }
      });

      // 5. Custom Route Preview Layer
      map.addSource('custom-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'custom-route-line',
        type: 'line',
        source: 'custom-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.8 }
      });

      // 6. Raw INS Divergence Ghost Trail
      map.addSource('ghost-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
      });
      map.addLayer({
        id: 'ghost-trail-line',
        type: 'line',
        source: 'ghost-trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#dc2626', 'line-width': 3, 'line-dasharray': [3, 3], 'line-opacity': 0.75 }
      });

      // Set scenario road corridor if already present
      if (scenario?.road_polyline && scenario.road_polyline.length > 0) {
        const roadGeoJSON = scenario.road_polyline.map(([lat, lon]) => [lon, lat]);
        const src = map.getSource('road-corridor') as maplibregl.GeoJSONSource;
        src?.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: roadGeoJSON }
        });
      }
    });

    // Custom 3D Vehicle Marker Element
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

    map.on('dragstart', () => {
      setIs3DMode(false);
      is3DModeRef.current = false;
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
        // If in 3D driving view, map rotates with heading, so arrow points straight forward
        arrow.style.transform = is3DModeRef.current ? 'rotate(0deg)' : `rotate(${animHeadingRef.current}deg)`;
      }

      // In 3D Cockpit Mode: camera tracks vehicle in 3D perspective ahead
      if (mapRef.current && is3DModeRef.current) {
        mapRef.current.jumpTo({
          center: [newLon, newLat],
          bearing: animHeadingRef.current,
          pitch: 60
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

    gnssCoordsRef.current = [];
    idrCoordsRef.current = [];
    lastPointRef.current = null;

    const gSrc = mapRef.current.getSource('gnss-trail') as maplibregl.GeoJSONSource;
    gSrc?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });

    const iSrc = mapRef.current.getSource('idr-trail') as maplibregl.GeoJSONSource;
    iSrc?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } });

    if (scenario.road_polyline && scenario.road_polyline.length > 0) {
      const roadGeoJSON = scenario.road_polyline.map(([lat, lon]) => [lon, lat]);
      const rSrc = mapRef.current.getSource('road-corridor') as maplibregl.GeoJSONSource;
      rSrc?.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: roadGeoJSON } });

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

    // ── Continuous Trail Updating (Expanded to 10,000 Points - NEVER DISAPPEARS!) ──
    if (!blackout_active) {
      gnssCoordsRef.current.push(currCoord);
      lastPointRef.current = currCoord;
      if (gnssCoordsRef.current.length > 10000) gnssCoordsRef.current.shift();

      const gSrc = mapRef.current.getSource('gnss-trail') as maplibregl.GeoJSONSource;
      gSrc?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: gnssCoordsRef.current }
      });
    } else {
      if (!prevBlackoutRef.current && lastPointRef.current) {
        idrCoordsRef.current = [lastPointRef.current, currCoord];
      } else {
        idrCoordsRef.current.push(currCoord);
      }
      if (idrCoordsRef.current.length > 10000) idrCoordsRef.current.shift();

      const iSrc = mapRef.current.getSource('idr-trail') as maplibregl.GeoJSONSource;
      iSrc?.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: idrCoordsRef.current }
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

    if (!mapRef.current) return;
    if (mode3D) {
      mapRef.current.easeTo({
        center: animPosRef.current,
        bearing: animHeadingRef.current,
        pitch: 60,
        zoom: 17,
        duration: 800
      });
    } else {
      mapRef.current.easeTo({
        pitch: 0,
        bearing: 0,
        duration: 600
      });
    }
  };

  const handleRecenter = () => {
    handleToggleMode(true);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: appMode === 'CUSTOM_ROUTE' ? 'crosshair' : 'default' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Floating 3D Navigation Camera Controls (Top-Right) */}
      <div className="map-camera-controls glass-panel">
        <button
          onClick={() => handleToggleMode(true)}
          className={`btn-cam-mode ${is3DMode ? 'active-cam' : ''}`}
          title="Apple Maps 3D Cockpit driving perspective with 3D buildings"
        >
          <span className={is3DMode ? 'cam-dot-live' : 'cam-dot-off'} />
          <span>🏎️ 3D Cockpit</span>
        </button>
        <button
          onClick={() => handleToggleMode(false)}
          className={`btn-cam-mode ${!is3DMode ? 'active-cam' : ''}`}
          title="2D Top-down Freecam overview to inspect the road network"
        >
          <span>🗺️ 2D Freecam</span>
        </button>
      </div>

      {/* Floating Re-center Button when in Freecam */}
      {!is3DMode && (
        <button
          onClick={handleRecenter}
          className="btn-recenter-car glass-panel"
          title="Re-center camera and return to 3D driving view"
        >
          <span className="recenter-target-icon">⌖</span>
          <span>Re-center on Vehicle (3D)</span>
        </button>
      )}
    </div>
  );
};
