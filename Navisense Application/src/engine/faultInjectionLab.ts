// Developer Failure Lab & Fault Injection Engine

export type GnssFault = 'NONE' | 'BLACKOUT' | 'JUMP_20M' | 'BAD_ACCURACY' | 'JITTER';
export type NetworkFault = 'ONLINE' | 'OFFLINE';
export type SensorFault = 'NONE' | 'DROP_GYRO' | 'TIMESTAMP_GAP' | 'RATE_REDUCTION';
export type ModelFault = 'NONE' | 'NAN_OUTPUT' | 'HIGH_UNCERTAINTY';
export type MapFault = 'NONE' | 'NO_CANDIDATES' | 'BRANCH_AMBIGUITY';

export interface ActiveFaultConfiguration {
  gnssFault: GnssFault;
  networkFault: NetworkFault;
  sensorFault: SensorFault;
  modelFault: ModelFault;
  mapFault: MapFault;
}

export interface AutomatedScenario {
  id: string;
  name: string;
  description: string;
  durationSeconds: number;
}

export const AUTOMATED_SCENARIOS: AutomatedScenario[] = [
  {
    id: 'scenario_a',
    name: 'Scenario A: Tunnel Outage & Smooth Recovery',
    description: 'Normal GNSS for 5s ➔ 60s Tunnel Outage (NIDR Active) ➔ GNSS Restored (3.5s smooth reconvergence)',
    durationSeconds: 70,
  },
  {
    id: 'scenario_b',
    name: 'Scenario B: Hard Braking ➔ ZUPT Stop ➔ Outage',
    description: 'Highway cruise ➔ Rapid brake ➔ Stationary zero-velocity lock ➔ Outage handoff',
    durationSeconds: 40,
  },
  {
    id: 'scenario_c',
    name: 'Scenario C: Cellular Loss (Offline Route Cache)',
    description: 'Cellular network disconnected ➔ GNSS + offline cached vector map continue seamlessly',
    durationSeconds: 30,
  },
  {
    id: 'scenario_d',
    name: 'Scenario D: Airplane Mode (Dual Blackout)',
    description: 'Simultaneous loss of GNSS and Cellular ➔ Pure NIDR + offline road geometry',
    durationSeconds: 45,
  },
  {
    id: 'scenario_e',
    name: 'Scenario E: Y-Junction / Flyover Ambiguity',
    description: 'Parallel elevated flyover & surface road ➔ Topology & NHC trajectory resolution',
    durationSeconds: 35,
  },
  {
    id: 'scenario_f',
    name: 'Scenario F: Phone Mount Slip & Dynamic Recalibration',
    description: 'Sudden mount shift ➔ Online SO(3) tilt realigns without stopping navigation',
    durationSeconds: 40,
  },
];

export class FaultInjectionLab {
  private config: ActiveFaultConfiguration = {
    gnssFault: 'NONE',
    networkFault: 'ONLINE',
    sensorFault: 'NONE',
    modelFault: 'NONE',
    mapFault: 'NONE',
  };

  setGnssFault(f: GnssFault) {
    this.config.gnssFault = f;
  }

  setNetworkFault(f: NetworkFault) {
    this.config.networkFault = f;
  }

  setSensorFault(f: SensorFault) {
    this.config.sensorFault = f;
  }

  setModelFault(f: ModelFault) {
    this.config.modelFault = f;
  }

  setMapFault(f: MapFault) {
    this.config.mapFault = f;
  }

  getConfig(): ActiveFaultConfiguration {
    return { ...this.config };
  }

  resetAllFaults() {
    this.config = {
      gnssFault: 'NONE',
      networkFault: 'ONLINE',
      sensorFault: 'NONE',
      modelFault: 'NONE',
      mapFault: 'NONE',
    };
  }
}
