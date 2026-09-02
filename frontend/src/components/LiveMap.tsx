import React, { useEffect, useRef } from 'react';
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
}

export const LiveMap: React.FC<LiveMapProps> = ({
  telemetry,
  scenario,
  appMode,
  customOrigin,
  customDestination,
  customRoutePath,
  onMapClick
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layer refs
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  const roadCorridorGlowRef = useRef<L.Polyline | null>(null);
  const customPreviewPolylineRef = useRef<L.Polyline | null>(null);

  // Seamless unified trails:
  // GNSS trail: emerald green, records up to the blackout point
  const gnssTrailRef = useRef<L.Polyline | null>(null);
  // IDR trail: electric cyan, seamlessly starts from the exact blackout point and carries forward
  const idrTrailRef = useRef<L.Polyline | null>(null);
  const idrGlowTrailRef = useRef<L.Polyline | null>(null);

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

    // Standard OpenStreetMap tiles with dark cockpit styling
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc'
    }).addTo(map);

    // Active Road Corridor Lane Glow (Holding the car visually on the road)
    roadCorridorGlowRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 14,
      opacity: 0.15,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Road Centerline Polyline
    roadPolylineRef.current = L.polyline([], {
      color: '#334155',
      weight: 6,
      opacity: 0.6,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Custom route dashed preview
    customPreviewPolylineRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 4,
      opacity: 0.75,
      dashArray: '6, 8',
      lineCap: 'round'
    }).addTo(map);

    // GNSS Trail (Solid Emerald Green, stops at blackout)
    gnssTrailRef.current = L.polyline([], {
      color: '#00f59b',
      weight: 5.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // IDR Trail Glow (Soft Neon Aura)
    idrGlowTrailRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 12,
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // IDR Trail (Electric Cyan, seamless continuation)
    idrTrailRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 5.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
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

    uncertaintyCircleRef.current = L.circle([initialLat, initialLon], {
      radius: 4,
      color: '#00f59b',
      fillColor: '#00f59b',
      fillOpacity: 0.1,
      weight: 1.5,
      dashArray: '3, 6'
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    });

    mapInstanceRef.current = map;

    // ── 60 FPS Smooth Liquid LERP Animation Loop ─────────────────────────────
    let animFrameId: number;

    const animateLoop = () => {
      const curPos = animPosRef.current;
      const tgtPos = targetPosRef.current;

      // Smooth position interpolation (alpha = 0.22)
      const newLat = curPos[0] + (tgtPos[0] - curPos[0]) * 0.22;
      const newLon = curPos[1] + (tgtPos[1] - curPos[1]) * 0.22;
      animPosRef.current = [newLat, newLon];

      // Smooth heading angle interpolation
      let dHead = targetHeadingRef.current - animHeadingRef.current;
      while (dHead > 180) dHead -= 360;
      while (dHead < -180) dHead += 360;
      animHeadingRef.current += dHead * 0.2;

      // Update vehicle marker on map
      if (vehicleMarkerRef.current) {
        vehicleMarkerRef.current.setLatLng([newLat, newLon]);
      }

      // Rotate directional arrow smoothly
      const arrowElem = document.getElementById('nav-car-arrow');
      if (arrowElem) {
        arrowElem.style.transform = `rotate(${animHeadingRef.current}deg)`;
      }

      // Smooth lookahead camera pan (anticipatory navigation view)
      if (mapInstanceRef.current) {
        const rad = (animHeadingRef.current * Math.PI) / 180;
        // 20m lookahead in driving direction
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
          color: '#00f59b',
          fillColor: '#00f59b',
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
          color: '#ef4444',
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
    lastGnssPtRef.current = null;

    gnssTrailRef.current?.setLatLngs([]);
    idrTrailRef.current?.setLatLngs([]);
    idrGlowTrailRef.current?.setLatLngs([]);

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

    const { idr_position, heading_deg, technical_proof, blackout_active } = telemetry;
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

    // ── Seamless Single-Ribbon Trail Logic ────────────────────────────────────
    // Before blackout: GNSS is active. Add to single emerald green trail.
    // When blackout hits: Emerald trail stops. Electric cyan trail starts from the exact transition point!
    if (!blackout_active) {
      if (prevBlackoutStateRef.current) {
        // Reconvergence: connect last IDR point back to GNSS seamlessly
        gnssPointsRef.current.push(currPt);
      } else {
        gnssPointsRef.current.push(currPt);
      }
      lastGnssPtRef.current = currPt;
      if (gnssPointsRef.current.length > 1000) gnssPointsRef.current.shift();
      gnssTrailRef.current?.setLatLngs(gnssPointsRef.current);
    } else {
      // Outage active: start IDR trail from last known GNSS point if just begun
      if (!prevBlackoutStateRef.current && lastGnssPtRef.current) {
        idrPointsRef.current = [lastGnssPtRef.current, currPt];
      } else {
        idrPointsRef.current.push(currPt);
      }
      if (idrPointsRef.current.length > 1000) idrPointsRef.current.shift();
      idrTrailRef.current?.setLatLngs(idrPointsRef.current);
      idrGlowTrailRef.current?.setLatLngs(idrPointsRef.current);
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
  }, [telemetry]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: appMode === 'CUSTOM_ROUTE' ? 'crosshair' : 'default' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
