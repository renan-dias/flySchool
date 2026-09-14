/**
 * WorkerBrain — implementação de ExternalBrain para o navegador (um Web Worker por mosca).
 */
import type { BrainReadout } from "./FlyWireBrain";
import type { ExternalBrain, FullBrainInput, FullBrainParams, WorkerIn, WorkerOut } from "./types";

export class WorkerBrain implements ExternalBrain {
  ready = false;
  busy = false;
  error: string | null = null;
  progress = 0;
  readout: BrainReadout | null = null;
  lastComputeMs = 0;
  info: { neurons: number; edges: number; plastic: number } | null = null;
  private worker: Worker;
  private nextId = 1;
  private snapshots = new Map<number, (a: Uint8Array | null) => void>();

  constructor(seed: number, params: FullBrainParams, baseUrl = "/flywire") {
    this.worker = new Worker(new URL("./fullbrain.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      switch (m.type) {
        case "progress":
          this.progress = m.value;
          break;
        case "ready":
          this.ready = true;
          this.info = { neurons: m.neurons, edges: m.edges, plastic: m.plastic };
          break;
        case "result":
          this.readout = m.readout;
          this.lastComputeMs = m.ms;
          this.busy = false;
          break;
        case "snapshot":
          this.snapshots.get(m.id)?.(m.activity);
          this.snapshots.delete(m.id);
          break;
        case "error":
          this.error = m.message;
          this.busy = false;
          break;
      }
    };
    this.worker.onerror = (e) => {
      this.error = e.message || "Erro no worker do cérebro FlyWire";
    };
    this.send({ type: "init", baseUrl, seed, params });
  }

  private send(m: WorkerIn) {
    this.worker.postMessage(m);
  }

  request(input: FullBrainInput, steps: number) {
    if (!this.ready || this.busy) return;
    this.busy = true;
    this.send({ type: "step", id: this.nextId++, steps, input });
  }

  requestSnapshot(): Promise<Uint8Array | null> {
    if (!this.ready) return Promise.resolve(null);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.send({ type: "snapshot", id });
      setTimeout(() => {
        if (this.snapshots.has(id)) {
          this.snapshots.delete(id);
          resolve(null);
        }
      }, 3000);
    });
  }

  setParams(p: Partial<FullBrainParams>) {
    this.send({ type: "params", params: p });
  }

  dispose() {
    this.worker.terminate();
  }
}
