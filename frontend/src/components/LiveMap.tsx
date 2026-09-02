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
  const customPreviewPolylineRef = useRef<L.Polyline | null>(null);
  const gnssTrailRef = useRef<L.Polyline | null>(null);
  const idrTrailRef = useRef<L.Polyline | null>(null);
  const gtTrailRef = useRef<L.Polyline | null>(null);

  // Marker refs for custom 2-point mode
  const originMarkerRef = useRef<L.CircleMarker | null>(null);
  const destinationMarkerRef = useRef<L.CircleMarker | null>(null);

  // Accumulated point history
  const gnssPointsRef = useRef<[number, number][]>([]);
  const idrPointsRef = useRef<[number, number][]>([]);
  const gtPointsRef = useRef<[number, number][]>([]);

  // Vehicle marker & uncertainty circle
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const uncertaintyCircleRef = useRef<L.Circle | null>(null);

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

    // Standard OpenStreetMap tiles (Clean, reliable, ZERO API KEY / ZERO WATERMARK)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc'
    }).addTo(map);

    // Polylines
    roadPolylineRef.current = L.polyline([], {
      color: '#334155',
      weight: 8,
      opacity: 0.6,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    customPreviewPolylineRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 4,
      opacity: 0.75,
      dashArray: '6, 8',
      lineCap: 'round'
    }).addTo(map);

    gtTrailRef.current = L.polyline([], {
      color: '#475569',
      weight: 2,
      opacity: 0.4,
      dashArray: '4, 6'
    }).addTo(map);

    gnssTrailRef.current = L.polyline([], {
      color: '#00f59b', // Emerald green GNSS
      weight: 5,
      opacity: 0.9,
      lineCap: 'round'
    }).addTo(map);

    idrTrailRef.current = L.polyline([], {
      color: '#00d2ff', // Electric blue IDR
      weight: 5,
      opacity: 0.95,
      lineCap: 'round'
    }).addTo(map);

    // Vehicle marker matching nav-car-puck design
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
      color: '#00d2ff',
      fillColor: '#00d2ff',
      fillOpacity: 0.12,
      weight: 1.5,
      dashArray: '3, 6'
    }).addTo(map);

    // Click handler for Option 2: Choose 2 points
    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    });

    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Custom Origin & Destination Markers
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

  // Handle Scenario Switch in Dataset mode
  useEffect(() => {
    if (!mapInstanceRef.current || appMode !== 'CANONICAL_DATASET' || !scenario) return;

    gnssPointsRef.current = [];
    idrPointsRef.current = [];
    gtPointsRef.current = [];

    gnssTrailRef.current?.setLatLngs([]);
    idrTrailRef.current?.setLatLngs([]);
    gtTrailRef.current?.setLatLngs([]);

    if (scenario.road_polyline && scenario.road_polyline.length > 0) {
      roadPolylineRef.current?.setLatLngs(scenario.road_polyline);
      const startPt = scenario.road_polyline[0];
      mapInstanceRef.current.setView(startPt, 17, { animate: false });
    }
  }, [scenario?.id, appMode]);

  // Update Telemetry on Every 10 Hz Packet
  useEffect(() => {
    if (!mapInstanceRef.current || !telemetry) return;

    const map = mapInstanceRef.current;
    const { idr_position, gnss_position, ground_truth, heading_deg, technical_proof, blackout_active } = telemetry;

    const idrPt: [number, number] = [idr_position.lat, idr_position.lon];
    const gtPt: [number, number] = [ground_truth.lat, ground_truth.lon];

    // Append IDR points continuously
    idrPointsRef.current.push(idrPt);
    if (idrPointsRef.current.length > 1000) idrPointsRef.current.shift();
    idrTrailRef.current?.setLatLngs(idrPointsRef.current);

    // Append GT points
    gtPointsRef.current.push(gtPt);
    if (gtPointsRef.current.length > 1000) gtPointsRef.current.shift();
    gtTrailRef.current?.setLatLngs(gtPointsRef.current);

    // Only append GNSS points when GNSS is available!
    if (gnss_position) {
      const gnssPt: [number, number] = [gnss_position.lat, gnss_position.lon];
      gnssPointsRef.current.push(gnssPt);
      if (gnssPointsRef.current.length > 1000) gnssPointsRef.current.shift();
      gnssTrailRef.current?.setLatLngs(gnssPointsRef.current);
    }

    // Update Vehicle Position & Heading
    vehicleMarkerRef.current?.setLatLng(idrPt);

    const puckWrap = document.getElementById('nav-car-puck-wrap');
    if (puckWrap) {
      if (blackout_active) {
        puckWrap.classList.add('blackout');
      } else {
        puckWrap.classList.remove('blackout');
      }
    }

    const arrowElem = document.getElementById('nav-car-arrow');
    if (arrowElem) {
      arrowElem.style.transform = `rotate(${heading_deg}deg)`;
    }

    // Update Uncertainty Radius
    if (uncertaintyCircleRef.current) {
      uncertaintyCircleRef.current.setLatLng(idrPt);
      uncertaintyCircleRef.current.setRadius(Math.max(2, technical_proof.uncertainty_m));
      uncertaintyCircleRef.current.setStyle({
        color: blackout_active ? '#00d2ff' : '#00f59b',
        fillColor: blackout_active ? '#00d2ff' : '#00f59b'
      });
    }

    // Follow vehicle dynamically at street-level zoom (Zoom 17)
    map.panTo(idrPt, { animate: true, duration: 0.1, easeLinearity: 0.8 });
  }, [telemetry]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', cursor: appMode === 'CUSTOM_ROUTE' ? 'crosshair' : 'default' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
