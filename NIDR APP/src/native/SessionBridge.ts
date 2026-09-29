import { NativeModules } from 'react-native';
import { SessionInfo, TrajectoryPoint } from '../types';

const { SessionStorageModule } = NativeModules;

export const SessionBridge = {
  listSessions: async (): Promise<SessionInfo[]> => {
    if (!SessionStorageModule) return [];
    try {
      return await SessionStorageModule.listSessions();
    } catch {
      return [];
    }
  },

  deleteSession: async (sessionId: string): Promise<boolean> => {
    if (!SessionStorageModule) return false;
    return SessionStorageModule.deleteSession(sessionId);
  },

  exportSessionZip: async (sessionId: string): Promise<string> => {
    if (!SessionStorageModule) return '';
    return SessionStorageModule.exportSessionZip(sessionId);
  },

  exportAllSessionsZip: async (): Promise<string> => {
    if (!SessionStorageModule) return '';
    return SessionStorageModule.exportAllSessionsZip();
  },

  shareSessionZip: async (sessionId: string): Promise<string> => {
    if (!SessionStorageModule) return '';
    return SessionStorageModule.shareSessionZip(sessionId);
  },

  shareAllSessionsZip: async (): Promise<string> => {
    if (!SessionStorageModule) return '';
    return SessionStorageModule.shareAllSessionsZip();
  },

  readSessionTrajectories: async (
    sessionId: string
  ): Promise<{ sessionId: string; gnssPoints: TrajectoryPoint[] }> => {
    if (!SessionStorageModule) return { sessionId, gnssPoints: [] };
    return SessionStorageModule.readSessionTrajectories(sessionId);
  },
};
