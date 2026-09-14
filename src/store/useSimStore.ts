/**
 * Estado de UI (zustand). O motor de simulação vive fora do React (singleton) e é
 * lido diretamente pelos componentes; o store só dispara re-renderizações periódicas.
 */
import { create } from "zustand";
import { SimulationEngine } from "@/core/SimulationEngine";

let engine: SimulationEngine | null = null;
export function getEngine(): SimulationEngine {
  if (!engine) engine = new SimulationEngine(20260914, 18);
  return engine;
}

export type Speed = 1 | 2 | 5 | 10;

interface SimState {
  tick: number;
  paused: boolean;
  speed: Speed;
  selectedFlyId: string | null;
  showDashboard: boolean;
  showGod: boolean;
  showHelp: boolean;
  populationVersion: number;
  bump: () => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: Speed) => void;
  select: (id: string | null) => void;
  toggleDashboard: (v?: boolean) => void;
  toggleGod: (v?: boolean) => void;
  toggleHelp: (v?: boolean) => void;
  setPopulation: (n: number) => void;
  reset: () => void;
}

export const useSimStore = create<SimState>((set, get) => ({
  tick: 0,
  paused: false,
  speed: 1,
  selectedFlyId: null,
  showDashboard: false,
  showGod: false,
  showHelp: true,
  populationVersion: 0,
  bump: () => set((s) => ({ tick: s.tick + 1 })),
  setPaused: (paused) => {
    getEngine().paused = paused;
    set({ paused });
  },
  setSpeed: (speed) => {
    getEngine().speed = speed;
    set({ speed });
  },
  select: (selectedFlyId) => {
    const e = getEngine();
    for (const f of e.flies) f.brain.recordRaster = f.id === selectedFlyId;
    set({ selectedFlyId });
  },
  toggleDashboard: (v) => set((s) => ({ showDashboard: v ?? !s.showDashboard })),
  toggleGod: (v) => set((s) => ({ showGod: v ?? !s.showGod })),
  toggleHelp: (v) => set((s) => ({ showHelp: v ?? !s.showHelp })),
  setPopulation: (n) => {
    const e = getEngine();
    e.setPopulation(n);
    const sel = get().selectedFlyId;
    set((s) => ({ populationVersion: s.populationVersion + 1, selectedFlyId: sel && e.flyById(sel) ? sel : null }));
  },
  reset: () => {
    getEngine().reset();
    set((s) => ({ populationVersion: s.populationVersion + 1, selectedFlyId: null }));
  },
}));

/** Assina re-renderizações periódicas (≈4 Hz). */
export function useTick() {
  return useSimStore((s) => s.tick);
}
