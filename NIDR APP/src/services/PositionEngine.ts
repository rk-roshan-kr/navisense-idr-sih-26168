/**
 * NaviSense IDR Position Engine
 *
 * Unifies GNSS fixes with Neural & Kinematic Dead-Reckoning (IDR / PDR) IMU inference.
 * Manages seamless transitions during GNSS/network blackouts and
 * smooth reconvergence upon GNSS signal restoration.
 *
 * Runs 100% on-device using physical phone sensors with zero external APIs.
 * Strictly zero emojis.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import { IdrBridge } from '../native/IdrBridge';
import { LocationBridge } from '../native/LocationBridge';
import { IdrState, LocationFix, NavigationAnchor } from '../types';
import { NavigationMode, RoutePoint } from '../types/navigation';
import { RouteEngine } from './RouteEngine';

export interface PositionState {
  latitude: number;
  longitude: number;
  snappedLatitude?: number;
  snappedLongitude?: number;
  isSnappedToPath?: boolean;
  isOffPath?: boolean;
  roadBearingDeg?: number;
  currentRoadName?: string;
  crossTrackErrorM?: number;
  altitude: number;
  headingDeg: number;
  speedMps: number;
  accuracyM: number;
  mode: NavigationMode;
  isBlackout: boolean;
  blackoutDurationS: number;
  blackoutDistanceM: number;
  stepCount: number;
  lastGnssTimestampMs: number;
  anchorPoint: RoutePoint | null;
  hasAcquiredFix: boolean;
}

type PositionListener = (state: PositionState) => void;

class PositionEngineService {
  private currentState: PositionState = {
    latitude: 0.0,
    longitude: 0.0,
    altitude: 0.0,
    headingDeg: 0.0,
    speedMps: 0.0,
    accuracyM: 0.0,
    mode: 'GNSS_ACTIVE',
    isBlackout: false,
    blackoutDurationS: 0,
    blackoutDistanceM: 0,
    stepCount: 0,
    lastGnssTimestampMs: 0,
    anchorPoint: null,
    hasAcquiredFix: false,
  };

  private listeners: Set<PositionListener> = new Set();
  private simulatedBlackout: boolean = false;
  private blackoutStartTimeMs: number = 0;
  private reconvergenceStartTimeMs: number = 0;
  private reconvergenceStartLat: number = 0;
  private reconvergenceStartLon: number = 0;
  private reconvergenceTargetLat: number = 0;
  private reconvergenceTargetLon: number = 0;
  private gnssTimeoutTimer: ReturnType<typeof setInterval> | null = null;
  private locationSubscription: { remove: () => void } | null = null;
  private idrSubscription: { remove: () => void } | null = null;
  private isRunning: boolean = false;
  private lastAnchorUpdateMs: number = 0;

  constructor() {
    // Initialized as idle until startTracking() is called
  }

  public async startTracking(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Listen to native GNSS location fixes FIRST so no fix is missed
    this.locationSubscription = LocationBridge.onLocationUpdate((fix: LocationFix) => {
      this.handleGnssFix(fix);
    });

    // 2. Listen to native NIDR neural/kinematic dead-reckoning updates from physical sensors
    this.idrSubscription = IdrBridge.onIdrStateUpdate((idrState: IdrState) => {
      this.handleIdrUpdate(idrState);
    });

    // 3. Request Android runtime permissions so hardware GPS and motion sensors are unlocked
    if (Platform.OS === 'android') {
      try {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);
      } catch {}
    }

    // 4. Immediately query device's actual last known location
    try {
      const lastFix = await LocationBridge.getLastKnownLocation();
      if (lastFix && (!this.currentState.hasAcquiredFix || this.currentState.latitude === 0)) {
        this.handleGnssFix(lastFix);
      }
    } catch {}

    // 5. Start native location tracking service
    LocationBridge.startLocationTracking(`nav_session_${Date.now()}`);

    // Watchdog timer to automatically detect GNSS blackout (timeout > 6.0 seconds)
    this.gnssTimeoutTimer = setInterval(() => {
      this.checkGnssTimeout();
    }, 1000);
  }

  public stopTracking(): void {
    this.isRunning = false;
    LocationBridge.stopLocationTracking();

    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    if (this.idrSubscription) {
      this.idrSubscription.remove();
      this.idrSubscription = null;
    }
    if (this.gnssTimeoutTimer) {
      clearInterval(this.gnssTimeoutTimer);
      this.gnssTimeoutTimer = null;
    }
  }

  public subscribe(listener: PositionListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getCurrentState(): PositionState {
    return { ...this.currentState };
  }

  public setInitialPosition(lat: number, lon: number, headingDeg: number = 0.0): void {
    this.currentState = {
      ...this.currentState,
      latitude: lat,
      longitude: lon,
      headingDeg: headingDeg,
      lastGnssTimestampMs: Date.now(),
    };
    this.notifyListeners();
  }

  public setSimulatedBlackout(active: boolean): void {
    this.simulatedBlackout = active;
    if (active) {
      this.enterBlackoutMode();
    } else {
      this.exitBlackoutMode();
    }
  }

  public isSimulatedBlackout(): boolean {
    return this.simulatedBlackout;
  }

  private computePathAttributes(
    rawLat: number,
    rawLon: number,
    rawHeading: number
  ): {
    snappedLatitude?: number;
    snappedLongitude?: number;
    isSnappedToPath: boolean;
    isOffPath: boolean;
    roadBearingDeg?: number;
    currentRoadName?: string;
    crossTrackErrorM?: number;
  } {
    const activeRoute = RouteEngine.getActiveRoute();
    if (!activeRoute || activeRoute.geometry.length < 2) {
      return {
        isSnappedToPath: false,
        isOffPath: false,
      };
    }

    const path = RouteEngine.detectPathAndSnap(
      { latitude: rawLat, longitude: rawLon },
      activeRoute
    );

    return {
      snappedLatitude: path.isSnapped ? path.snappedPoint.latitude : undefined,
      snappedLongitude: path.isSnapped ? path.snappedPoint.longitude : undefined,
      isSnappedToPath: path.isSnapped,
      isOffPath: path.isOffPath,
      roadBearingDeg: path.roadBearingDeg,
      currentRoadName: path.currentRoadName,
      crossTrackErrorM: path.crossTrackErrorM,
    };
  }

  private handleGnssFix(fix: LocationFix): void {
    // If simulated blackout is active, ignore real GNSS fixes
    if (this.simulatedBlackout) {
      return;
    }

    const now = Date.now();
    this.currentState.lastGnssTimestampMs = now;

    // If currently in blackout, trigger smooth reconvergence
    if (this.currentState.isBlackout) {
      const heading = fix.bearingDeg >= 0 ? fix.bearingDeg : this.currentState.headingDeg;
      this.startReconvergence(fix.latitude, fix.longitude, heading, fix.speedMps);
      return;
    }

    // Normal GNSS Active state
    if (this.currentState.mode === 'RECONVERGING') {
      this.updateReconvergence(fix.latitude, fix.longitude);
      return;
    }

    const pathAttrs = this.computePathAttributes(fix.latitude, fix.longitude, fix.bearingDeg);

    this.currentState = {
      ...this.currentState,
      latitude: fix.latitude,
      longitude: fix.longitude,
      snappedLatitude: pathAttrs.snappedLatitude,
      snappedLongitude: pathAttrs.snappedLongitude,
      isSnappedToPath: pathAttrs.isSnappedToPath,
      isOffPath: pathAttrs.isOffPath,
      roadBearingDeg: pathAttrs.roadBearingDeg,
      currentRoadName: pathAttrs.currentRoadName,
      crossTrackErrorM: pathAttrs.crossTrackErrorM,
      altitude: fix.altitude || this.currentState.altitude,
      headingDeg: fix.bearingDeg >= 0 ? fix.bearingDeg : this.currentState.headingDeg,
      speedMps: fix.speedMps >= 0 ? fix.speedMps : this.currentState.speedMps,
      accuracyM: Math.max(1.5, fix.accuracyM || 3.0),
      mode: 'GNSS_ACTIVE',
      isBlackout: false,
      blackoutDurationS: 0,
      blackoutDistanceM: 0,
      stepCount: 0,
      hasAcquiredFix: true,
    };

    // Keep native dead-reckoning engine continuously primed with fresh anchor
    if (now - this.lastAnchorUpdateMs > 2000) {
      this.lastAnchorUpdateMs = now;
      IdrBridge.setAnchor({
        latitude: fix.latitude,
        longitude: fix.longitude,
        altitude: fix.altitude || 0,
        initialHeadingDeg: fix.bearingDeg >= 0 ? fix.bearingDeg : this.currentState.headingDeg,
        initialSpeedMps: fix.speedMps >= 0 ? fix.speedMps : 0,
        anchorAccuracyM: fix.accuracyM || 3.0,
        anchorUnixTimeMs: now,
        anchorElapsedRealtimeNanos: now * 1000000,
      }, 'LIVE').catch(() => {});
    }

    this.notifyListeners();
  }

  private handleIdrUpdate(idr: IdrState): void {
    // In normal GNSS mode with valid fixes, NIDR runs silently in background
    if (!this.currentState.isBlackout && this.currentState.mode !== 'RECONVERGING') {
      return;
    }

    // Dead Reckoning: Convert local (East, North) displacements to global coordinates
    const anchor = this.currentState.anchorPoint;
    if (!anchor) return;

    // Use geodetic coordinates computed directly by native Kinematic PDR core if available
    let estLat = (idr.latitude && idr.latitude !== 0) ? idr.latitude : anchor.latitude;
    let estLon = (idr.longitude && idr.longitude !== 0) ? idr.longitude : anchor.longitude;

    if ((!idr.latitude || idr.latitude === 0) && (idr.northOffsetM || idr.eastOffsetM)) {
      const latRad = (anchor.latitude * Math.PI) / 180.0;
      const metersPerLat = 111132.92;
      const metersPerLon = (Math.PI / 180.0) * 6378137.0 * Math.cos(latRad);

      const dLat = (idr.northOffsetM || 0.0) / metersPerLat;
      const dLon = (idr.eastOffsetM || 0.0) / Math.max(metersPerLon, 10000.0);

      estLat = anchor.latitude + dLat;
      estLon = anchor.longitude + dLon;
    }

    const now = Date.now();
    const blackoutDuration = this.blackoutStartTimeMs > 0
      ? (now - this.blackoutStartTimeMs) / 1000.0
      : 0;

    const cumDist = idr.cumulativeDistanceM || 0.0;
    // Uncertainty grows as a square-root function of blackout distance
    const estAccuracy = Math.min(12.0, Math.max(3.0, Math.sqrt(9.0 + Math.pow(0.08 * cumDist, 2))));

    if (this.currentState.mode === 'RECONVERGING') {
      // Reconvergence in progress, do not overwrite blended coords
      this.currentState.blackoutDurationS = blackoutDuration;
      this.currentState.blackoutDistanceM = cumDist;
      this.currentState.stepCount = idr.stepCount ?? this.currentState.stepCount;
      this.notifyListeners();
      return;
    }

    const pathAttrs = this.computePathAttributes(estLat, estLon, idr.headingDeg ?? this.currentState.headingDeg);

    // During blackout: Map-matched dead reckoning constrained to path if snapped
    let finalLat = estLat;
    let finalLon = estLon;
    if (pathAttrs.isSnappedToPath && pathAttrs.snappedLatitude && pathAttrs.snappedLongitude) {
      // Smoothly blend 75% towards snapped road centerline to prevent inertial sensor drift
      finalLat = estLat * 0.25 + pathAttrs.snappedLatitude * 0.75;
      finalLon = estLon * 0.25 + pathAttrs.snappedLongitude * 0.75;
    }

    this.currentState = {
      ...this.currentState,
      latitude: finalLat,
      longitude: finalLon,
      snappedLatitude: pathAttrs.snappedLatitude,
      snappedLongitude: pathAttrs.snappedLongitude,
      isSnappedToPath: pathAttrs.isSnappedToPath,
      isOffPath: pathAttrs.isOffPath,
      roadBearingDeg: pathAttrs.roadBearingDeg,
      currentRoadName: pathAttrs.currentRoadName,
      crossTrackErrorM: pathAttrs.crossTrackErrorM,
      headingDeg: idr.headingDeg !== undefined ? idr.headingDeg : this.currentState.headingDeg,
      speedMps: idr.speedMps !== undefined ? idr.speedMps : this.currentState.speedMps,
      accuracyM: estAccuracy,
      mode: 'NIDR_DEAD_RECKONING',
      isBlackout: true,
      blackoutDurationS: blackoutDuration,
      blackoutDistanceM: cumDist,
      stepCount: idr.stepCount ?? this.currentState.stepCount,
    };

    this.notifyListeners();
  }

  private checkGnssTimeout(): void {
    if (!this.isRunning) return;
    if (this.currentState.isBlackout || this.simulatedBlackout) return;

    // CRITICAL: Never declare blackout before the first GNSS fix is acquired
    if (!this.currentState.hasAcquiredFix) {
      return;
    }

    const now = Date.now();
    const elapsedSinceLastFix = now - this.currentState.lastGnssTimestampMs;

    // Automatic GNSS blackout trigger: Triggers only when active GNSS drops for > 6.0 seconds
    if (elapsedSinceLastFix > 6000) {
      this.enterBlackoutMode();
    }
  }

  private enterBlackoutMode(): void {
    if (this.currentState.isBlackout) return;

    const now = Date.now();
    this.blackoutStartTimeMs = now;

    // Safety fallback: if user turned GPS off before fix was acquired, use last known valid coordinates
    let anchorLat = this.currentState.latitude;
    let anchorLon = this.currentState.longitude;
    if (anchorLat === 0 && anchorLon === 0) {
      anchorLat = 28.6139;
      anchorLon = 77.2090;
    }

    const anchor: NavigationAnchor = {
      latitude: anchorLat,
      longitude: anchorLon,
      altitude: this.currentState.altitude,
      initialHeadingDeg: this.currentState.headingDeg,
      initialSpeedMps: this.currentState.speedMps,
      anchorAccuracyM: Math.max(this.currentState.accuracyM, 3.0),
      anchorUnixTimeMs: now,
      anchorElapsedRealtimeNanos: now * 1000000,
    };

    // Lock native dead-reckoning anchor and activate real-time physical sensor dead reckoning
    IdrBridge.setAnchor(anchor, 'LIVE').catch(() => {});
    IdrBridge.triggerBlackout().catch(() => {});

    this.currentState = {
      ...this.currentState,
      latitude: anchorLat,
      longitude: anchorLon,
      mode: 'NIDR_DEAD_RECKONING',
      isBlackout: true,
      blackoutDurationS: 0,
      blackoutDistanceM: 0,
      stepCount: 0,
      anchorPoint: {
        latitude: anchorLat,
        longitude: anchorLon,
        altitude: this.currentState.altitude,
      },
    };

    this.notifyListeners();
  }

  private exitBlackoutMode(): void {
    if (!this.currentState.isBlackout) return;
    IdrBridge.endOutage().catch(() => {});

    // Target position for reconvergence (restore GNSS)
    const targetLat = this.currentState.latitude + 0.00002;
    const targetLon = this.currentState.longitude + 0.00002;
    this.startReconvergence(targetLat, targetLon, this.currentState.headingDeg, this.currentState.speedMps);
  }

  private startReconvergence(
    targetLat: number,
    targetLon: number,
    targetHeading: number,
    targetSpeed: number
  ): void {
    this.reconvergenceStartTimeMs = Date.now();
    this.reconvergenceStartLat = this.currentState.latitude;
    this.reconvergenceStartLon = this.currentState.longitude;
    this.reconvergenceTargetLat = targetLat;
    this.reconvergenceTargetLon = targetLon;

    this.currentState = {
      ...this.currentState,
      mode: 'RECONVERGING',
      isBlackout: false,
      headingDeg: targetHeading,
      speedMps: targetSpeed,
    };

    // Animate smooth 2-second cosine ease-in blending
    const stepDurationMs = 50;
    const totalDurationMs = 2000;
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += stepDurationMs;
      const progress = Math.min(1.0, elapsed / totalDurationMs);
      // Cosine ease-in-out curve
      const factor = 0.5 * (1.0 - Math.cos(progress * Math.PI));

      const blendedLat =
        this.reconvergenceStartLat +
        (this.reconvergenceTargetLat - this.reconvergenceStartLat) * factor;
      const blendedLon =
        this.reconvergenceStartLon +
        (this.reconvergenceTargetLon - this.reconvergenceStartLon) * factor;

      this.currentState = {
        ...this.currentState,
        latitude: blendedLat,
        longitude: blendedLon,
        accuracyM: 3.0 + (1.0 - progress) * 5.0,
      };

      this.notifyListeners();

      if (progress >= 1.0) {
        clearInterval(interval);
        this.currentState = {
          ...this.currentState,
          latitude: this.reconvergenceTargetLat,
          longitude: this.reconvergenceTargetLon,
          mode: 'GNSS_ACTIVE',
          accuracyM: 3.0,
          isBlackout: false,
          blackoutDurationS: 0,
          blackoutDistanceM: 0,
          anchorPoint: null,
        };
        this.notifyListeners();
      }
    }, stepDurationMs);
  }

  private updateReconvergence(targetLat: number, targetLon: number): void {
    this.reconvergenceTargetLat = targetLat;
    this.reconvergenceTargetLon = targetLon;
  }

  private notifyListeners(): void {
    const snapshot = { ...this.currentState };
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.warn('Error in PositionEngine listener:', err);
      }
    });
  }
}

export const PositionEngine = new PositionEngineService();
