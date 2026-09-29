import { NativeEventEmitter, NativeModules } from 'react-native';

const { BleModule } = NativeModules;
const bleEmitter = BleModule ? new NativeEventEmitter(BleModule) : null;

export const BleBridge = {
  startAdvertising: async (sessionId: string): Promise<boolean> => {
    if (!BleModule) return false;
    try {
      return await BleModule.startAdvertising(sessionId);
    } catch {
      return false;
    }
  },

  startScanning: async (): Promise<boolean> => {
    if (!BleModule) return false;
    try {
      return await BleModule.startScanning();
    } catch {
      return false;
    }
  },

  disconnect: async (): Promise<boolean> => {
    if (!BleModule) return true;
    return BleModule.disconnect();
  },

  onPeerDiscovered: (callback: (peer: { address: string; name: string; rssi: number }) => void) => {
    if (!bleEmitter) return { remove: () => {} };
    return bleEmitter.addListener('onBlePeerDiscovered', callback);
  },
};
