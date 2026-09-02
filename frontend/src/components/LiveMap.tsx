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
  
  // Polyline layers
  const roadPolylineRef = useRef<L.Polyline | null>(null);
  const gnssTrailRef = useRef<L.Polyline | null>(null);
  const idrTrailRef = useRef<L.Polyline | null>(null);
  const gtTrailRef = useRef<L.Polyline | null>(null);
  
  // Accumulated trail arrays
  const gnssPointsRef = useRef<[number, number][]>([]);
  const idrPointsRef = useRef<[number, number][]>([]);
  const gtPointsRef = useRef<[number, number][]>([]);
  
  // Vehicle Marker
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

    // Dark Map Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    // Initialize Polyline Layers
    roadPolylineRef.current = L.polyline([], {
      color: '#334155',
      weight: 8,
      opacity: 0.6,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    gtTrailRef.current = L.polyline([], {
      color: '#ffffff',
      weight: 2,
      opacity: 0.35,
      dashArray: '4, 8'
    }).addTo(map);

    gnssTrailRef.current = L.polyline([], {
      color: '#00f59b',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round'
    }).addTo(map);

    idrTrailRef.current = L.polyline([], {
      color: '#00d2ff',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round'
    }).addTo(map);

    // Vehicle Marker with Custom SVG Cursor
    const carIcon = L.divIcon({
      className: 'vehicle-marker',
      html: `
        <div id="car-cursor" style="
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: rotate(0deg);
          transition: transform 0.1s linear;
        ">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" fill="#00d2ff" fill-opacity="0.25" />
            <polygon points="16,3 26,27 16,21 6,27" fill="#00d2ff" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />
          </svg>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    vehicleMarkerRef.current = L.marker([initialLat, initialLon], { icon: carIcon }).addTo(map);

    uncertaintyCircleRef.current = L.circle([initialLat, initialLon], {
      radius: 5,
      color: '#00d2ff',
      fillColor: '#00d2ff',
      fillOpacity: 0.15,
      weight: 1.5,
      dashArray: '3, 6'
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle Scenario Switch
  useEffect(() => {
    if (!mapInstanceRef.current || !scenario) return;

    // Reset trails
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
    if (idrPointsRef.current.length > 800) idrPointsRef.current.shift();
    idrTrailRef.current?.setLatLngs(idrPointsRef.current);

    // Append GT points
    gtPointsRef.current.push(gtPt);
    if (gtPointsRef.current.length > 800) gtPointsRef.current.shift();
    gtTrailRef.current?.setLatLngs(gtPointsRef.current);

    // Only append GNSS points when GNSS is available!
    if (gnss_position) {
      const gnssPt: [number, number] = [gnss_position.lat, gnss_position.lon];
      gnssPointsRef.current.push(gnssPt);
      if (gnssPointsRef.current.length > 800) gnssPointsRef.current.shift();
      gnssTrailRef.current?.setLatLngs(gnssPointsRef.current);
    }

    // Update Vehicle Position & Heading
    vehicleMarkerRef.current?.setLatLng(idrPt);
    const cursorElem = document.getElementById('car-cursor');
    if (cursorElem) {
      cursorElem.style.transform = `rotate(${heading_deg}deg)`;
      const svgPoly = cursorElem.querySelector('polygon');
      if (svgPoly) {
        svgPoly.setAttribute('fill', blackout_active ? '#00d2ff' : '#00f59b');
      }
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

    // Pan map smoothly with vehicle
    map.panTo(idrPt, { animate: true, duration: 0.1, easeLinearity: 0.8 });
  }, [telemetry]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
