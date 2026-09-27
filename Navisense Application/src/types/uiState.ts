// Centralized UI State Contracts, Controlled Status Vocabulary, and Invariants

export type ControlledStatus =
  | 'GNSS CONNECTED'
  | 'GNSS DEGRADED'
  | 'GNSS SIGNAL LOST'
  | 'NIDR ACTIVE'
  | 'NIDR DEGRADED'
  | 'GNSS REACQUIRED'
  | 'RECONVERGING'
  | 'OFFLINE MODE'
  | 'ROUTE READY'
  | 'ROUTE UNAVAILABLE'
  | 'POSITION UNAVAILABLE';

export type NavigationUiState =
  | {
      kind: 'idle';
      message: string;
    }
  | {
      kind: 'loading';
      step: string;
      detail: string;
      progress?: number;
    }
  | {
      kind: 'ready';
      corridorName: string;
      distanceMeters: number;
      originName: string;
      destinationName: string;
    }
  | {
      kind: 'empty';
      title: string;
      reason: string;
      actionLabel: string;
    }
  | {
      kind: 'partial';
      hasPosition: boolean;
      hasRoute: boolean;
      message: string;
      actionLabel?: string;
    }
  | {
      kind: 'null_data';
      message: string;
    }
  | {
      kind: 'navigating';
      maneuverPrimary: string;
      maneuverSecondary: string;
      remainingMeters: number;
      etaMinutes: number;
      speedKmh: number;
      headingDeg: number;
      accuracyMeters: number;
      isOnline: boolean;
    }
  | {
      kind: 'nidr';
      maneuverPrimary: string;
      maneuverSecondary: string;
      blackoutElapsedS: number;
      uncertaintyMeters: number;
      speedKmh: number;
      headingDeg: number;
      driftPct: number;
      isSensorDegraded?: boolean;
    }
  | {
      kind: 'recovering';
      progressPct: number;
      maneuverPrimary: string;
      reacquiredAccuracyMeters: number;
    }
  | {
      kind: 'offline';
      corridorName: string;
      cachedTilesCount: number;
      isNidrActive: boolean;
    }
  | {
      kind: 'disabled';
      title: string;
      reasons: string[];
      actionLabel?: string;
    }
  | {
      kind: 'permission_denied';
      permissionType: 'LOCATION' | 'MOTION_SENSORS';
      description: string;
    }
  | {
      kind: 'no_data';
      dataType: 'SAVED_SESSIONS' | 'MAP_TILES';
      message: string;
    }
  | {
      kind: 'long_data';
      corridorName: string;
      instruction: string;
    }
  | {
      kind: 'arrived';
      summary: string;
      totalDistanceMeters: number;
      durationMinutes: number;
    }
  | {
      kind: 'error';
      code: string;
      userMessage: string;
      userDescription: string;
      recoveryActionLabel?: string;
      isRecoverable: boolean;
    };
