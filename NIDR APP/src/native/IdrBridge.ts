import { NativeEventEmitter, NativeModules } from 'react-native';
import { EngineType, IdrState, MockScenario, NavigationAnchor, TrajectoryPoint } from '../types';

const { IdrModule } = NativeModules;
const idrEmitter = IdrModule ? new NativeEventEmitter(IdrModule) : null;

export const IdrBridge = {
  setEngineType: async (
    engineType: EngineType = 'MOCK',
    scenario: MockScenario = 'MOCK_40M'
  ): Promise<boolean> => {
    if (!IdrModule) return false;
    return IdrModule.setEngineType(engineType, scenario);
  },

  setAnchor: async (
    anchor: NavigationAnchor,
    engineType: EngineType = 'MOCK'
  ): Promise<boolean> => {
    if (!IdrModule) return false;
    return IdrModule.setAnchor(anchor, engineType);
  },

  triggerBlackout: async (): Promise<boolean> => {
    if (!IdrModule) return false;
    return IdrModule.triggerBlackout();
  },

  endOutage: async (): Promise<boolean> => {
    if (!IdrModule) return false;
    return IdrModule.endOutage();
  },

  restoreGnss: async (): Promise<{
    finalLat: number;
    finalLon: number;
    cumulativeDistanceM: number;
    trajectoryPointCount: number;
    finalUncertaintyM: number;
    blackoutState?: string;
  }> => {
    if (!IdrModule) {
      return {
        finalLat: 0,
        finalLon: 0,
        cumulativeDistanceM: 0,
        trajectoryPointCount: 0,
        finalUncertaintyM: 0,
      };
    }
    return IdrModule.restoreGnss();
  },

  getEstimatedState: async (): Promise<IdrState | null> => {
    if (!IdrModule) return null;
    return IdrModule.getEstimatedState();
  },

  getTrajectory: async (): Promise<TrajectoryPoint[]> => {
    if (!IdrModule) return [];
    return IdrModule.getTrajectory();
  },

  resetTest: async (): Promise<boolean> => {
    if (!IdrModule) return false;
    return IdrModule.resetTest();
  },

  onIdrStateUpdate: (callback: (state: IdrState) => void) => {
    if (!idrEmitter) return { remove: () => {} };
    return idrEmitter.addListener('onIdrStateUpdate', callback);
  },
};
