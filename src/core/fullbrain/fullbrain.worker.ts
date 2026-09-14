/// <reference lib="webworker" />
/**
 * Web Worker: hospeda um cérebro FlyWire completo (138.639 neurônios) fora da thread de renderização.
 */
import { decodeConnectome, FlyWireBrain, odorGlomeruli, type FlyWireManifest } from "./FlyWireBrain";
import type { FullBrainInput, WorkerIn, WorkerOut } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let brain: FlyWireBrain | null = null;
let manifest: FlyWireManifest | null = null;
let lastSignature = "";
let odorCodes: string[][] = [];

const post = (m: WorkerOut, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

async function init(baseUrl: string, seed: number, params: { inhibitoryGain: number; adaptIncrement: number; eta: number }) {
  const man: FlyWireManifest = await (await fetch(`${baseUrl}/manifest.json`)).json();
  manifest = man;
  const total = man.bytes;
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const part of man.parts) {
    const res = await fetch(`${baseUrl}/${part}`);
    if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${part} (${res.status})`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes.set(value, off);
      off += value.length;
      post({ type: "progress", value: (off / total) * 0.9 });
    }
  }
  const neuronsBin = new Uint8Array(await (await fetch(`${baseUrl}/neurons.bin`)).arrayBuffer());
  try {
    const oc = await (await fetch(`${baseUrl}/odor-codes.json`)).json();
    // o primeiro código ativa KCs em excesso (ver build-odor-codes); usa os seguintes
    odorCodes = (oc.codes as { glomeruli: string[] }[]).slice(1).map((c) => c.glomeruli);
  } catch {
    odorCodes = [];
  }
  const superOf = new Uint8Array(man.neurons);
  for (let i = 0; i < man.neurons; i++) superOf[i] = neuronsBin[i * 7];
  const data = decodeConnectome(man, bytes);
  brain = new FlyWireBrain(data, seed, superOf);
  Object.assign(brain, params);
  post({ type: "progress", value: 1 });
  post({ type: "ready", neurons: data.N, edges: man.edges, plastic: data.plasticTargets.length });
}

function applyInput(inp: FullBrainInput) {
  const b = brain!;
  const G = manifest!.groups;
  b.learning = inp.learning;
  // só reconstrói a lista de entradas se algo mudou (taxas quantizadas)
  const sig = JSON.stringify(inp);
  if (sig === lastSignature) return;
  lastSignature = sig;
  b.clearInputs();
  if (inp.retina && inp.retinaHz > 0) {
    const lit = new Set(inp.retina);
    b.setRates(
      manifest!.retina.filter(([, r]) => lit.has(r)).map(([i]) => i),
      inp.retinaHz,
    );
  }
  if (inp.odorKey !== null && inp.odorHz > 0) for (const t of odorGlomeruli(manifest!, inp.odorKey, odorCodes)) b.setRates(manifest!.ornTypes[t], inp.odorHz);
  const set = (idx: number[], hz: number) => hz > 0 && b.setRates(idx, hz);
  set(G.sugar, inp.sugarHz);
  set(G.pam, inp.pamHz);
  set(G.ppl1, inp.ppl1Hz);
  set(G.wind.slice(0, 80), inp.windHz);
  set(G.heat, inp.heatHz);
  set(G.ocellar, inp.ocellarHz);
  set(G.pheromone.slice(0, 60), inp.pheromoneHz);
  set(G.pfl3_left, inp.pfl3LeftHz);
  set(G.pfl3_right, inp.pfl3RightHz);
  set(G.dh44, inp.dh44Hz);
  set(G.ipc, inp.ipcHz);
  set(G.itp, inp.itpHz);
  set(G.dfb, inp.dfbHz);
  set(G.dh31, inp.dh31Hz);
  if (inp.efferencePool >= 0) set(G.mbon.filter((m) => b.mbonPool[m] === inp.efferencePool), 40);
}

ctx.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  try {
    if (m.type === "init") await init(m.baseUrl, m.seed, m.params);
    else if (m.type === "params" && brain) Object.assign(brain, m.params);
    else if (m.type === "step" && brain) {
      const t0 = performance.now();
      applyInput(m.input);
      const readout = brain.run(m.steps);
      post({ type: "result", id: m.id, readout, ms: performance.now() - t0 });
    } else if (m.type === "snapshot" && brain) {
      const activity = brain.activity.slice();
      post({ type: "snapshot", id: m.id, activity }, [activity.buffer]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
