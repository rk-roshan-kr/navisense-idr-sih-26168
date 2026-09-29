import { create } from 'zustand';
import { IdrState, LocationFix, SensorTelemetry } from '../types';

interface TelemetryStoreState {
  sensor: SensorTelemetry | null;
  location: LocationFix | null;
  idrState: IdrState | null;

  setSensorTelemetry: (telemetry: SensorTelemetry) => void;
  setLocationFix: (fix: LocationFix) => void;
  setIdrState: (state: IdrState) => void;
  resetTelemetry: () => void;
}

export const useTelemetryStore = create<TelemetryStoreState>((set) => ({
  sensor: null,
  location: null,
  idrState: null,

  setSensorTelemetry: (sensor) => set({ sensor }),
  setLocationFix: (location) => set({ location }),
  setIdrState: (idrState) => set({ idrState }),
  resetTelemetry: () => set({ sensor: null, location: null, idrState: null }),
}));
