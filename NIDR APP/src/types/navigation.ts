/**
 * NaviSense IDR Consumer Navigation Types
 * Strictly zero emojis.
 */

export type TravelMode = 'Walk' | 'Run' | 'Cycle' | 'Drive';

export type ManeuverType =
  | 'depart'
  | 'straight'
  | 'turn-slight-left'
  | 'turn-left'
  | 'turn-sharp-left'
  | 'turn-slight-right'
  | 'turn-right'
  | 'turn-sharp-right'
  | 'u-turn'
  | 'arrive';

export type NavigationMode =
  | 'GNSS_ACTIVE'
  | 'NIDR_DEAD_RECKONING'
  | 'RECONVERGING';

export interface RoutePoint {
  latitude: number;
  longitude: number;
  altitude?: number;
}

export interface RouteManeuver {
  id: string;
  instruction: string;
  roadName: string;
  maneuver: ManeuverType;
  distanceM: number;
  pointIndex: number;
  durationS: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface NavigationRoute {
  id: string;
  title: string;
  origin: RoutePoint;
  originName: string;
  destination: RoutePoint;
  destinationName: string;
  travelMode: TravelMode;
  distanceM: number;
  durationS: number;
  geometry: RoutePoint[];
  maneuvers: RouteManeuver[];
  boundingBox: BoundingBox;
  isCachedOffline: boolean;
  cachedAtTimestampMs?: number;
}

export interface PathDetectionResult {
  isSnapped: boolean;
  snappedPoint: RoutePoint;
  closestSegmentIndex: number;
  roadBearingDeg: number;
  crossTrackErrorM: number;
  currentRoadName: string;
  nextManeuver: RouteManeuver | null;
  distanceToNextManeuverM: number;
  remainingDistanceM: number;
  remainingDurationS: number;
  progressFraction: number;
  isOffPath: boolean;
  hasArrived: boolean;
}

export interface NavigationProgress {
  currentPosition: RoutePoint;
  snappedPosition?: RoutePoint;
  currentHeadingDeg: number;
  currentSpeedMps: number;
  distanceRemainingM: number;
  timeRemainingS: number;
  progressFraction: number;
  currentManeuverIndex: number;
  currentManeuver: RouteManeuver | null;
  distanceToNextManeuverM: number;
  mode: NavigationMode;
  estimatedAccuracyM: number;
  isOffRoute: boolean;
  isSnappedToRoad?: boolean;
  crossTrackErrorM?: number;
  currentRoadName?: string;
  hasArrived?: boolean;
  pathDetection?: PathDetectionResult;
  blackoutDurationS: number;
  blackoutDistanceM: number;
}

export interface PreflightChecklist {
  startingLocationAcquired: boolean;
  initialHeadingAcquired: boolean;
  routeCalculated: boolean;
  requiredMapAreaCached: boolean;
  routeGeometryCached: boolean;
  nidrModelReady: boolean;
  sensorsReady: boolean;
  isReadyToNavigate: boolean;
}

export interface PresetDestination {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  category: string;
}
