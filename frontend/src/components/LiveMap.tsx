import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { TelemetryPacket, ScenarioInfo, AppMode } from '../types';

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
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Camera Mode: 'FOLLOW' | 'FREECAM'
  const [cameraMode, setCameraMode] = useState<'FOLLOW' | 'FREECAM'>('FOLLOW');
  const cameraModeRef = useRef<'FOLLOW' | 'FREECAM'>('FOLLOW');

  // Layer refs
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  const roadCorridorGlowRef = useRef<L.Polyline | null>(null);
  const customPreviewPolylineRef = useRef<L.Polyline | null>(null);

  // Seamless unified trails
  const gnssTrailRef = useRef<L.Polyline | null>(null);
  const idrTrailRef = useRef<L.Polyline | null>(null);
  const idrGlowTrailRef = useRef<L.Polyline | null>(null);

  // Raw INS Ghost Baseline layers
  const ghostMarkerRef = useRef<L.Marker | null>(null);
  const ghostTrailRef = useRef<L.Polyline | null>(null);
  const ghostPointsRef = useRef<[number, number][]>([]);

  // Marker refs for custom 2-point mode
  const originMarkerRef = useRef<L.CircleMarker | null>(null);
  const destinationMarkerRef = useRef<L.CircleMarker | null>(null);

  // Accumulated point history
  const gnssPointsRef = useRef<[number, number][]>([]);
  const idrPointsRef = useRef<[number, number][]>([]);
  const lastGnssPtRef = useRef<[number, number] | null>(null);

  // Vehicle marker & uncertainty circle
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const uncertaintyCircleRef = useRef<L.Circle | null>(null);

  // 60 FPS LERP animation refs
  const animPosRef = useRef<[number, number]>([52.4069, -1.5021]);
  const targetPosRef = useRef<[number, number]>([52.4069, -1.5021]);
  const animHeadingRef = useRef<number>(0);
  const targetHeadingRef = useRef<number>(0);
  const isInitializedRef = useRef<boolean>(false);
  const prevBlackoutStateRef = useRef<boolean>(false);

  // Switch to Freecam automatically when entering custom 2-point mode
  useEffect(() => {
    if (appMode === 'CUSTOM_ROUTE') {
      setCameraMode('FREECAM');
      cameraModeRef.current = 'FREECAM';
    }
  }, [appMode]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = 52.4069;
    const initialLon = -1.5021;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 17,
      zoomControl: false,
      attributionControl: false
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc'
    }).addTo(map);

    // Active Road Corridor Lane Glow (Soft Sky-Blue Guideway)
    roadCorridorGlowRef.current = L.polyline([], {
      color: '#bfdbfe',
      weight: 14,
      opacity: 0.45,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Road Centerline Polyline
    roadPolylineRef.current = L.polyline([], {
      color: '#94a3b8',
      weight: 5,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Custom route dashed preview
    customPreviewPolylineRef.current = L.polyline([], {
      color: '#2563eb',
      weight: 4,
      opacity: 0.75,
      dashArray: '6, 8',
      lineCap: 'round'
    }).addTo(map);

    // GNSS Trail (Clean Emerald Green)
    gnssTrailRef.current = L.polyline([], {
      color: '#059669',
      weight: 5.5,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // IDR Trail Glow (Soft Blue Aura)
    idrGlowTrailRef.current = L.polyline([], {
      color: 'rgba(37, 99, 235, 0.35)',
      weight: 12,
      opacity: 0.4,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // IDR Trail (Electric Commercial Blue)
    idrTrailRef.current = L.polyline([], {
      color: '#2563eb',
      weight: 5.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Raw INS Ghost Divergence Trail
    ghostTrailRef.current = L.polyline([], {
      color: '#dc2626',
      weight: 3,
      opacity: 0.75,
      dashArray: '6, 6',
      lineCap: 'round'
    }).addTo(map);

    // Vehicle Navigation Marker Puck
    const carIcon = L.divIcon({
      className: 'nav-car-marker-container',
      html: `
        <div id="nav-car-puck-wrap" class="nav-car-wrap">
          <div class="nav-car-halo"></div>
          <div class="nav-car-puck">
            <div id="nav-car-arrow" class="nav-car-arrow"></div>
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    vehicleMarkerRef.current = L.marker([initialLat, initialLon], { icon: carIcon }).addTo(map);

    // Raw INS Ghost Marker
    const ghostIcon = L.divIcon({
      className: 'nav-ghost-container',
      html: `
        <div style="width: 20px; height: 20px; border-radius: 50%; background: rgba(220, 38, 38, 0.4); border: 2px dashed #ef4444; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(220, 38, 38, 0.6);">
          <div style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    ghostMarkerRef.current = L.marker([initialLat, initialLon], { icon: ghostIcon, opacity: 0 }).addTo(map);

    uncertaintyCircleRef.current = L.circle([initialLat, initialLon], {
      radius: 4,
      color: '#00f59b',
      fillColor: '#00f59b',
      fillOpacity: 0.1,
      weight: 1.5,
      dashArray: '3, 6'
    }).addTo(map);

    // Click handler for 2-point routing
    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    });

    // Auto-switch to Freecam when user drags or zooms
    map.on('dragstart', () => {
      setCameraMode('FREECAM');
      cameraModeRef.current = 'FREECAM';
    });

    map.on('zoomstart', () => {
      setCameraMode('FREECAM');
      cameraModeRef.current = 'FREECAM';
    });

    mapInstanceRef.current = map;

    // ── 60 FPS Smooth Liquid LERP Animation Loop ─────────────────────────────
    let animFrameId: number;

    const animateLoop = () => {
      const curPos = animPosRef.current;
      const tgtPos = targetPosRef.current;

      const newLat = curPos[0] + (tgtPos[0] - curPos[0]) * 0.22;
      const newLon = curPos[1] + (tgtPos[1] - curPos[1]) * 0.22;
      animPosRef.current = [newLat, newLon];

      let dHead = targetHeadingRef.current - animHeadingRef.current;
      while (dHead > 180) dHead -= 360;
      while (dHead < -180) dHead += 360;
      animHeadingRef.current += dHead * 0.2;

      if (vehicleMarkerRef.current) {
        vehicleMarkerRef.current.setLatLng([newLat, newLon]);
      }

      const arrowElem = document.getElementById('nav-car-arrow');
      if (arrowElem) {
        arrowElem.style.transform = `rotate(${animHeadingRef.current}deg)`;
      }

      // ONLY AUTO-CENTER CAMERA IF IN FOLLOW MODE!
      if (mapInstanceRef.current && cameraModeRef.current === 'FOLLOW') {
        const rad = (animHeadingRef.current * Math.PI) / 180;
        const lookaheadLat = newLat + (20 * Math.cos(rad)) / 111320;
        const lookaheadLon = newLon + (20 * Math.sin(rad)) / (111320 * Math.cos((newLat * Math.PI) / 180));
        mapInstanceRef.current.panTo([lookaheadLat, lookaheadLon], { animate: false });
      }

      animFrameId = requestAnimationFrame(animateLoop);
    };

    animFrameId = requestAnimationFrame(animateLoop);

    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      cancelAnimationFrame(animFrameId);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Custom Origin & Destination Markers (Option 2)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (customOrigin) {
      if (!originMarkerRef.current) {
        originMarkerRef.current = L.circleMarker(customOrigin, {
          radius: 8,
          color: '#059669',
          fillColor: '#10b981',
          fillOpacity: 0.9,
          weight: 3
        }).addTo(map);
      } else {
        originMarkerRef.current.setLatLng(customOrigin);
      }
    } else {
      if (originMarkerRef.current) {
        originMarkerRef.current.remove();
        originMarkerRef.current = null;
      }
    }

    if (customDestination) {
      if (!destinationMarkerRef.current) {
        destinationMarkerRef.current = L.circleMarker(customDestination, {
          radius: 8,
          color: '#b91c1c',
          fillColor: '#ef4444',
          fillOpacity: 0.9,
          weight: 3
        }).addTo(map);
      } else {
        destinationMarkerRef.current.setLatLng(customDestination);
      }
    } else {
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.remove();
        destinationMarkerRef.current = null;
      }
    }

    if (customRoutePath.length > 0) {
      customPreviewPolylineRef.current?.setLatLngs(customRoutePath);
      map.fitBounds(L.latLngBounds(customRoutePath).pad(0.15));
    } else {
      customPreviewPolylineRef.current?.setLatLngs([]);
    }
  }, [customOrigin, customDestination, customRoutePath]);

  // Scenario Switch Reset
  useEffect(() => {
    if (!mapInstanceRef.current || appMode !== 'CANONICAL_DATASET' || !scenario) return;

    gnssPointsRef.current = [];
    idrPointsRef.current = [];
    ghostPointsRef.current = [];
    lastGnssPtRef.current = null;

    gnssTrailRef.current?.setLatLngs([]);
    idrTrailRef.current?.setLatLngs([]);
    idrGlowTrailRef.current?.setLatLngs([]);
    ghostTrailRef.current?.setLatLngs([]);
    ghostMarkerRef.current?.setOpacity(0);

    if (scenario.road_polyline && scenario.road_polyline.length > 0) {
      roadPolylineRef.current?.setLatLngs(scenario.road_polyline);
      roadCorridorGlowRef.current?.setLatLngs(scenario.road_polyline);
      const startPt = scenario.road_polyline[0];
      animPosRef.current = startPt;
      targetPosRef.current = startPt;
      mapInstanceRef.current.setView(startPt, 17, { animate: false });
    }
  }, [scenario?.id, appMode]);

  // Update Target Telemetry on 10 Hz Packets
  useEffect(() => {
    if (!telemetry) return;

    const { idr_position, heading_deg, technical_proof, blackout_active, blackout_elapsed_s } = telemetry;
    const currPt: [number, number] = [idr_position.lat, idr_position.lon];

    // First packet initialization
    if (!isInitializedRef.current) {
      animPosRef.current = currPt;
      targetPosRef.current = currPt;
      animHeadingRef.current = heading_deg;
      targetHeadingRef.current = heading_deg;
      isInitializedRef.current = true;
    } else {
      targetPosRef.current = currPt;
      targetHeadingRef.current = heading_deg;
    }

    // Single-Ribbon Trail Logic
    if (!blackout_active) {
      gnssPointsRef.current.push(currPt);
      lastGnssPtRef.current = currPt;
      if (gnssPointsRef.current.length > 1000) gnssPointsRef.current.shift();
      gnssTrailRef.current?.setLatLngs(gnssPointsRef.current);
      ghostPointsRef.current = [];
      ghostTrailRef.current?.setLatLngs([]);
      ghostMarkerRef.current?.setOpacity(0);
    } else {
      if (!prevBlackoutStateRef.current && lastGnssPtRef.current) {
        idrPointsRef.current = [lastGnssPtRef.current, currPt];
      } else {
        idrPointsRef.current.push(currPt);
      }
      if (idrPointsRef.current.length > 1000) idrPointsRef.current.shift();
      idrTrailRef.current?.setLatLngs(idrPointsRef.current);
      idrGlowTrailRef.current?.setLatLngs(idrPointsRef.current);

      // Raw INS Divergence Ghost Vehicle
      if (showGhostBaseline) {
        const rad = (heading_deg * Math.PI) / 180;
        const t = blackout_elapsed_s;
        const driftM = 0.5 * 0.22 * t * t;
        const ghostLat = currPt[0] + (driftM * Math.cos(rad + Math.PI / 2)) / 111320;
        const ghostLon = currPt[1] + (driftM * Math.sin(rad + Math.PI / 2)) / (111320 * Math.cos((currPt[0] * Math.PI) / 180));
        const ghostPt: [number, number] = [ghostLat, ghostLon];

        ghostMarkerRef.current?.setLatLng(ghostPt);
        ghostMarkerRef.current?.setOpacity(0.85);

        ghostPointsRef.current.push(ghostPt);
        if (ghostPointsRef.current.length > 300) ghostPointsRef.current.shift();
        ghostTrailRef.current?.setLatLngs(ghostPointsRef.current);
      } else {
        ghostMarkerRef.current?.setOpacity(0);
        ghostTrailRef.current?.setLatLngs([]);
      }
    }
    prevBlackoutStateRef.current = blackout_active;

    // Vehicle marker state
    const puckWrap = document.getElementById('nav-car-puck-wrap');
    if (puckWrap) {
      if (blackout_active) {
        puckWrap.classList.add('blackout');
      } else {
        puckWrap.classList.remove('blackout');
      }
    }

    // Uncertainty Circle
    if (uncertaintyCircleRef.current) {
      uncertaintyCircleRef.current.setLatLng(currPt);
      uncertaintyCircleRef.current.setRadius(Math.max(2, technical_proof.uncertainty_m));
      uncertaintyCircleRef.current.setStyle({
        color: blackout_active ? '#00d2ff' : '#00f59b',
        fillColor: blackout_active ? '#00d2ff' : '#00f59b'
      });
    }
  }, [telemetry, showGhostBaseline]);

  // Re-center on vehicle
  const handleFollowCar = () => {
    setCameraMode('FOLLOW');
    cameraModeRef.current = 'FOLLOW';
    if (mapInstanceRef.current && animPosRef.current) {
      mapInstanceRef.current.flyTo(animPosRef.current, 17, { duration: 0.6 });
    }
  };

  const handleToggleCamera = (mode: 'FOLLOW' | 'FREECAM') => {
    setCameraMode(mode);
    cameraModeRef.current = mode;
    if (mode === 'FOLLOW' && mapInstanceRef.current && animPosRef.current) {
      mapInstanceRef.current.flyTo(animPosRef.current, 17, { duration: 0.6 });
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: appMode === 'CUSTOM_ROUTE' ? 'crosshair' : 'default' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Camera Mode Toggle (Top-Right of Map) */}
      <div className="map-camera-controls glass-panel">
        <button
          onClick={() => handleToggleCamera('FOLLOW')}
          className={`btn-cam-mode ${cameraMode === 'FOLLOW' ? 'active-cam' : ''}`}
          title="Keep camera centered and following the vehicle"
        >
          <span className={cameraMode === 'FOLLOW' ? 'cam-dot-live' : 'cam-dot-off'} />
          <span>Follow Car</span>
        </button>
        <button
          onClick={() => handleToggleCamera('FREECAM')}
          className={`btn-cam-mode ${cameraMode === 'FREECAM' ? 'active-cam' : ''}`}
          title="Freely pan, zoom, and inspect any road or junction"
        >
          <span>Freecam</span>
        </button>
      </div>

      {/* Floating Re-center Action Button when in Freecam */}
      {cameraMode === 'FREECAM' && (
        <button
          onClick={handleFollowCar}
          className="btn-recenter-car glass-panel"
          title="Fly back and center camera on vehicle"
        >
          <span className="recenter-target-icon">⌖</span>
          <span>Re-center on Car</span>
        </button>
      )}
    </div>
  );
};
