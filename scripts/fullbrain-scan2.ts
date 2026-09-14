import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const G = manifest.groups, orn = manifest.ornTypes;
const types = Object.keys(orn).filter((t) => orn[t].length >= 20).sort();
const code = (k: number) => [types[(k * 7) % types.length], types[(k * 13 + 5) % types.length]];
function run(label: string, inh: number, ad: number, setup: (b: FlyWireBrain) => void, ms = 500) {
  const b = new FlyWireBrain(data, 11); b.learning = false; b.inhibitoryGain = inh; b.adaptIncrement = ad; setup(b);
  let sp = 0, kc = 0; const pools = [0,0,0,0,0]; const acc: Record<string, number> = {}; const n = ms / 20; const t0 = Date.now();
  for (let i = 0; i < n; i++) { const r = b.run(20); if (i < 5) continue; sp += r.totalSpikes; kc += r.kcActiveFraction; r.pools.forEach((p, j) => (pools[j] += p)); for (const k of ["pam","ppl1","mn9","dna02_left","dna02_right"]) acc[k] = (acc[k] ?? 0) + r.rates[k]; }
  const m = n - 5;
  console.log(`inh${inh} ad${ad} ${label.padEnd(12)} ${((Date.now()-t0)/ms).toFixed(2)}s/s spk/s=${Math.round(sp/(m*0.02))} KC=${((kc/m)*100).toFixed(1)}% pools=${pools.map(p=>(p/m).toFixed(1)).join(",")} ` + Object.entries(acc).map(([k,v])=>`${k}=${(v/m).toFixed(1)}`).join(" "));
}
for (const [inh, ad] of [[1, 0], [1, 3], [3, 0], [3, 3], [6, 2], [10, 2]] as const) {
  for (const k of [1, 2]) run(`odor${k} 30Hz`, inh, ad, (b) => { for (const t of code(k)) b.setRates(orn[t], 30); });
  run("sugar21 150", inh, ad, (b) => b.setRates(G.sugar.slice(0, 21), 150));
}
