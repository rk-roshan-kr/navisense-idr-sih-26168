import { NativeEventEmitter, NativeModules } from 'react-native';
import { LocationFix, NavigationAnchor } from '../types';

const { LocationModule } = NativeModules;
const locationEmitter = LocationModule ? new NativeEventEmitter(LocationModule) : null;

export const LocationBridge = {
  startLocationTracking: async (sessionId: string): Promise<boolean> => {
    if (!LocationModule) return false;
    return LocationModule.startLocationTracking(sessionId);
  },

  softwareCutoff: async (): Promise<boolean> => {
    if (!LocationModule) return true;
    return LocationModule.softwareCutoff();
  },

  captureAnchor: async (): Promise<NavigationAnchor | null> => {
    if (!LocationModule) return null;
    try {
      return await LocationModule.captureAnchor();
    } catch {
      return null;
    }
  },

  getLastKnownLocation: async (): Promise<LocationFix | null> => {
    if (!LocationModule || !LocationModule.getLastKnownLocation) return null;
    try {
      return await LocationModule.getLastKnownLocation();
    } catch {
      return null;
    }
  },

  stopLocationTracking: async (): Promise<number> => {
    if (!LocationModule) return 0;
    return LocationModule.stopLocationTracking();
  },

  onLocationUpdate: (callback: (fix: LocationFix) => void) => {
    if (!locationEmitter) return { remove: () => {} };
    return locationEmitter.addListener('onLocationUpdate', callback);
  },
};
