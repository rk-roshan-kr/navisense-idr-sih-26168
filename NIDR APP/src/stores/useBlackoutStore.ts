import { create } from 'zustand';
import { BlackoutLifecycle, EvaluationMetrics, NavigationAnchor, SessionRole, TrajectoryPoint } from '../types';
import { LocationBridge } from '../native/LocationBridge';
import { IdrBridge } from '../native/IdrBridge';
import { BleBridge } from '../native/BleBridge';
import { calculateEvaluationMetrics } from '../utils/trajectoryMetrics';

interface BlackoutStoreState {
  lifecycle: BlackoutLifecycle;
  testRole: SessionRole;
  anchor: NavigationAnchor | null;
  referenceTrajectory: TrajectoryPoint[];
  idrTrajectory: TrajectoryPoint[];
  metrics: EvaluationMetrics | null;

  setTestRole: (role: SessionRole) => void;
  setLifecycle: (lifecycle: BlackoutLifecycle) => void;
  setAnchor: (anchor: NavigationAnchor | null) => void;
  addReferencePoint: (point: TrajectoryPoint) => void;
  addIdrPoint: (point: TrajectoryPoint) => void;

  startAcquiringLock: (sessionId: string) => Promise<boolean>;
  lockAnchorAndPrepare: () => Promise<boolean>;
  triggerBlackoutCutoff: () => Promise<boolean>;
  restoreGnssAndComplete: () => Promise<void>;
  resetTest: () => void;
  evaluateSessions: (refPoints: TrajectoryPoint[], idrPoints: TrajectoryPoint[]) => void;
}

export const useBlackoutStore = create<BlackoutStoreState>((set, get) => ({
  lifecycle: 'IDLE',
  testRole: 'IDR_TEST_PHONE',
  anchor: null,
  referenceTrajectory: [],
  idrTrajectory: [],
  metrics: null,

  setTestRole: (testRole) => set({ testRole }),
  setLifecycle: (lifecycle) => set({ lifecycle }),
  setAnchor: (anchor) => set({ anchor }),

  addReferencePoint: (point) =>
    set((state) => ({ referenceTrajectory: [...state.referenceTrajectory, point] })),

  addIdrPoint: (point) =>
    set((state) => ({ idrTrajectory: [...state.idrTrajectory, point] })),

  startAcquiringLock: async (sessionId: string) => {
    set({ lifecycle: 'ACQUIRING_LOCK', referenceTrajectory: [], idrTrajectory: [], metrics: null });
    await LocationBridge.startLocationTracking(sessionId);
    return true;
  },

  lockAnchorAndPrepare: async () => {
    const anchor = await LocationBridge.captureAnchor();
    if (!anchor) return false;

    set({ anchor, lifecycle: 'READY_TO_TEST' });
    await IdrBridge.setAnchor(anchor, 'MOCK');
    return true;
  },

  triggerBlackoutCutoff: async () => {
    // 1. Programmatic software cutoff on GNSS
    await LocationBridge.softwareCutoff();

    // 2. Strict BLE disconnect
    await BleBridge.disconnect();

    // 3. Trigger IDR dead-reckoning engine
    await IdrBridge.triggerBlackout();

    set({ lifecycle: 'BLACKOUT_ACTIVE' });
    return true;
  },

  restoreGnssAndComplete: async () => {
    await IdrBridge.restoreGnss();
    const idrPoints = await IdrBridge.getTrajectory();
    await LocationBridge.stopLocationTracking();

    set((state) => {
      const evaluation = calculateEvaluationMetrics(state.referenceTrajectory, idrPoints);
      return {
        lifecycle: 'TEST_COMPLETE',
        idrTrajectory: idrPoints,
        metrics: evaluation,
      };
    });
  },

  resetTest: () =>
    set({
      lifecycle: 'IDLE',
      anchor: null,
      referenceTrajectory: [],
      idrTrajectory: [],
      metrics: null,
    }),

  evaluateSessions: (refPoints: TrajectoryPoint[], idrPoints: TrajectoryPoint[]) => {
    const evaluation = calculateEvaluationMetrics(refPoints, idrPoints);
    set({
      referenceTrajectory: refPoints,
      idrTrajectory: idrPoints,
      metrics: evaluation,
    });
  },
}));
