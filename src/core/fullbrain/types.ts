/**
 * Contratos entre o agente (thread principal) e o cérebro FlyWire completo (Web Worker).
 */
import type { BrainReadout } from "./FlyWireBrain";

export interface FullBrainParams {
  /** Multiplicador das sinapses inibitórias (1 = Shiu et al. 2024). */
  inhibitoryGain: number;
  /** Adaptação por frequência de disparo, mV por spike (0 = Shiu et al. 2024). */
  adaptIncrement: number;
  /** Inibição graduada do APL sobre as Kenyon cells (mV por spike de KC). 0 = Shiu et al. 2024. */
  aplGraded: number;
  /** Taxa de aprendizado das sinapses KC→MBON. */
  eta: number;
}

export const SHIU_PARAMS: FullBrainParams = { inhibitoryGain: 1, adaptIncrement: 0, aplGraded: 0, eta: 0.3 };
export const BALANCED_PARAMS: FullBrainParams = { inhibitoryGain: 5, adaptIncrement: 1, aplGraded: 0.02, eta: 0.3 };

/** Entradas sensoriais e internas de um bloco de simulação (taxas de Poisson em Hz). */
export interface FullBrainInput {
  /** Chave do marcador odorífero da lousa (hash do problema → par de glomérulos ORN). */
  odorKey: number | null;
  odorHz: number;
  /** Regiões retinotópicas (0..15) iluminadas pelo padrão da lousa. */
  retina: number[] | null;
  retinaHz: number;
  sugarHz: number;
  pamHz: number;
  ppl1Hz: number;
  windHz: number;
  heatHz: number;
  ocellarHz: number;
  pheromoneHz: number;
  pfl3LeftHz: number;
  pfl3RightHz: number;
  /** Placa escolhida (cópia eferente para o pool de MBONs) ou −1. */
  efferencePool: number;
  dh44Hz: number;
  ipcHz: number;
  itpHz: number;
  dfbHz: number;
  dh31Hz: number;
  learning: boolean;
}

export const EMPTY_INPUT: FullBrainInput = {
  odorKey: null,
  odorHz: 0,
  retina: null,
  retinaHz: 0,
  sugarHz: 0,
  pamHz: 0,
  ppl1Hz: 0,
  windHz: 0,
  heatHz: 0,
  ocellarHz: 0,
  pheromoneHz: 0,
  pfl3LeftHz: 0,
  pfl3RightHz: 0,
  efferencePool: -1,
  dh44Hz: 0,
  ipcHz: 0,
  itpHz: 0,
  dfbHz: 0,
  dh31Hz: 0,
  learning: true,
};

/** Interface que o FlyAgent usa — implementada no navegador por um Web Worker. */
export interface ExternalBrain {
  readonly ready: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly progress: number; // 0..1 carregamento
  readout: BrainReadout | null;
  /** Wall-clock ms gastos no último bloco. */
  lastComputeMs: number;
  request(input: FullBrainInput, steps: number): void;
  requestSnapshot(): Promise<Uint8Array | null>;
  setParams(p: Partial<FullBrainParams>): void;
  dispose(): void;
}

export type WorkerIn =
  | { type: "init"; baseUrl: string; seed: number; params: FullBrainParams }
  | { type: "step"; id: number; steps: number; input: FullBrainInput }
  | { type: "snapshot"; id: number }
  | { type: "params"; params: Partial<FullBrainParams> };

export type WorkerOut =
  | { type: "progress"; value: number }
  | { type: "ready"; neurons: number; edges: number; plastic: number }
  | { type: "result"; id: number; readout: BrainReadout; ms: number }
  | { type: "snapshot"; id: number; activity: Uint8Array }
  | { type: "error"; message: string };
