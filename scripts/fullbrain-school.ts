// Integração ponta a ponta sem navegador: SimulationEngine em modo FlyWire com cérebros em processo.
// uso: npx tsx scripts/fullbrain-school.ts <moscas> <dias>
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, odorGlomeruli, type BrainReadout, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
import type { ExternalBrain, FullBrainInput, FullBrainParams } from "../src/core/fullbrain/types";
import { SimulationEngine } from "../src/core/SimulationEngine";

const FLIES = Number(process.argv[2] ?? 1);
const DAYS = Number(process.argv[3] ?? 1);
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const codes = (JSON.parse(fs.readFileSync("public/flywire/odor-codes.json", "utf8")).codes as { glomeruli: string[] }[]).slice(1).map((c) => c.glomeruli);
const G = manifest.groups;

/** Mesmo mapeamento de entradas do worker, executado de forma síncrona. */
class LocalBrain implements ExternalBrain {
  ready = true;
  busy = false;
  error = null;
  progress = 1;
  readout: BrainReadout | null = null;
  lastComputeMs = 0;
  private b: FlyWireBrain;
  private sig = "";
  constructor(seed: number, params: FullBrainParams) {
    this.b = new FlyWireBrain(data, seed);
    Object.assign(this.b, params);
  }
  request(inp: FullBrainInput, steps: number) {
    const b = this.b;
    b.learning = inp.learning;
    const sig = JSON.stringify(inp);
    if (sig !== this.sig) {
      this.sig = sig;
      b.clearInputs();
      if (inp.retina && inp.retinaHz > 0) {
        const lit = new Set(inp.retina);
        b.setRates(manifest.retina.filter(([, r]) => lit.has(r)).map(([i]) => i), inp.retinaHz);
      }
      if (inp.odorKey !== null && inp.odorHz > 0) for (const t of odorGlomeruli(manifest, inp.odorKey, codes)) b.setRates(manifest.ornTypes[t], inp.odorHz);
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
    const t0 = Date.now();
    this.readout = b.run(steps);
    this.lastComputeMs = Date.now() - t0;
  }
  async requestSnapshot() {
    return null;
  }
  setParams(p: Partial<FullBrainParams>) {
    Object.assign(this.b, p);
  }
  dispose() {}
}

const e = new SimulationEngine(20260914, 18);
e.externalBrainFactory = (seed, params) => new LocalBrain(seed, params);
e.setBrainMode("flywire", FLIES);
// usa o método misto na linguagem para comparação
const t0 = Date.now();
let lastDay = 1;
let lastPeriod = "";
while (e.director.day <= DAYS) {
  e.tick();
  const p = e.director.period.id;
  if (p !== lastPeriod) {
    const f = e.students[0];
    console.log(`D${e.director.day} ${e.director.clock} ${p} · modo ${f.mode} · sala ${f.room} · fome ${f.homeo.hunger.toFixed(2)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    lastPeriod = p;
  }
  if (e.director.day !== lastDay) {
    const d = e.analytics.days.find((x) => x.day === lastDay)!;
    const pres = e.analytics.presentations.filter((x) => x.day === lastDay);
    console.log(`=== Dia ${lastDay}: aula mat ${((d.classMath ?? 0) * 100).toFixed(0)}% ling ${((d.classLang ?? 0) * 100).toFixed(0)}% · prova ${((d.examOverall ?? 0) * 100).toFixed(0)}% · omissão ${((d.omissionRate ?? 0) * 100).toFixed(0)}% · ${pres.length} apresentações`);
    lastDay = e.director.day;
  }
}
console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s de parede para ${e.time.toFixed(0)}s simulados`);
