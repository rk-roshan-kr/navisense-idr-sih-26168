import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { TelemetryPacket, ScenarioInfo } from '../types';

interface LiveMapProps {
  telemetry: TelemetryPacket | null;
  scenario: ScenarioInfo | null;
}

export const LiveMap: React.FC<LiveMapProps> = ({ telemetry, scenario }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layer refs
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  const gnssTrailRef = useRef<L.Polyline | null>(null);
  const idrTrailRef = useRef<L.Polyline | null>(null);
  const gtTrailRef = useRef<L.Polyline | null>(null);

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
      zoomControl: true,
      attributionControl: false
    });

    // Standard OpenStreetMap tiles (Clean, reliable, ZERO API KEY / ZERO WATERMARK)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      subdomains: 'abc'
    }).addTo(map);

    // Reposition zoom control to bottom right
    map.zoomControl.setPosition('bottomright');

    // Polylines
    roadPolylineRef.current = L.polyline([], {
      color: '#94a3b8',
      weight: 8,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    gtTrailRef.current = L.polyline([], {
      color: '#475569',
      weight: 2,
      opacity: 0.4,
      dashArray: '4, 6'
    }).addTo(map);

    gnssTrailRef.current = L.polyline([], {
      color: '#16a34a', // Emerald green GNSS
      weight: 5,
      opacity: 0.9,
      lineCap: 'round'
    }).addTo(map);

    idrTrailRef.current = L.polyline([], {
      color: '#2563eb', // Electric blue IDR
      weight: 5,
      opacity: 0.95,
      lineCap: 'round'
    }).addTo(map);

    // Vehicle marker matching legacy nav-car-puck design
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
      color: '#2563eb',
      fillColor: '#2563eb',
      fillOpacity: 0.12,
      weight: 1.5,
      dashArray: '3, 6'
    }).addTo(map);

    mapInstanceRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle Scenario Switch
  useEffect(() => {
    if (!mapInstanceRef.current || !scenario) return;

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
  }, [scenario?.id]);

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
        color: blackout_active ? '#2563eb' : '#16a34a',
        fillColor: blackout_active ? '#2563eb' : '#16a34a'
      });
    }

    // Follow vehicle dynamically at street-level zoom (Zoom 17)
    map.panTo(idrPt, { animate: true, duration: 0.1, easeLinearity: 0.8 });
  }, [telemetry]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};
