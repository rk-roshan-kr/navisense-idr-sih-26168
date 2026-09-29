import { NativeEventEmitter, NativeModules } from 'react-native';
import { MovementMode, SensorTelemetry, SessionRole } from '../types';

const { SensorModule } = NativeModules;
const sensorEmitter = SensorModule ? new NativeEventEmitter(SensorModule) : null;

export const SensorBridge = {
  startRecording: async (
    sessionId: string,
    movementMode: MovementMode,
    participant: string,
    role: SessionRole
  ): Promise<string> => {
    if (!SensorModule) {
      console.warn('SensorModule native module not available');
      return sessionId;
    }
    return SensorModule.startRecording(sessionId, movementMode, participant, role);
  },

  stopRecording: async (): Promise<{
    sessionId: string;
    sampleCount: number;
    actualRateHz: number;
    folderPath: string;
  }> => {
    if (!SensorModule) {
      return { sessionId: '', sampleCount: 0, actualRateHz: 0, folderPath: '' };
    }
    return SensorModule.stopRecording();
  },

  getLiveStatus: async (): Promise<{
    isRecording: boolean;
    actualRateHz: number;
    sampleCount: number;
    sessionId: string;
  }> => {
    if (!SensorModule) {
      return { isRecording: false, actualRateHz: 0, sampleCount: 0, sessionId: '' };
    }
    return SensorModule.getLiveStatus();
  },

  onTelemetry: (callback: (telemetry: SensorTelemetry) => void) => {
    if (!sensorEmitter) return { remove: () => {} };
    const subscription = sensorEmitter.addListener('onSensorTelemetry', callback);
    return subscription;
  },
};
