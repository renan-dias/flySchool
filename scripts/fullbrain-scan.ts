import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const G = manifest.groups;
const orn = manifest.ornTypes;
const types = Object.keys(orn).filter((t) => orn[t].length >= 20).sort();
console.log("glomérulos com ≥20 ORNs:", types.length);

function run(label: string, setup: (b: FlyWireBrain) => void, ms = 600) {
  const b = new FlyWireBrain(data, 11);
  b.learning = false;
  setup(b);
  let sp = 0, kc = 0; const pools = [0, 0, 0, 0, 0]; const acc: Record<string, number> = {};
  const t0 = Date.now();
  const n = ms / 20;
  for (let i = 0; i < n; i++) {
    const r = b.run(20);
    if (i < 5) continue; // descarta transiente
    sp += r.totalSpikes; kc += r.kcActiveFraction;
    r.pools.forEach((p, j) => (pools[j] += p));
    for (const k of ["pam", "ppl1", "mbon", "dna02_left", "dna02_right", "mn9", "apl"]) acc[k] = (acc[k] ?? 0) + r.rates[k];
  }
  const m = n - 5;
  console.log(`${label.padEnd(30)} ${((Date.now() - t0) / ms).toFixed(2)}s/s spk/s=${Math.round(sp / (m * 0.02))} KC=${((kc / m) * 100).toFixed(1)}% pools=${pools.map((p) => (p / m).toFixed(1)).join(",")} ` + Object.entries(acc).map(([k, v]) => `${k}=${(v / m).toFixed(1)}`).join(" "));
}
const code = (k: number) => [types[(k * 7) % types.length], types[(k * 13 + 5) % types.length]];
for (const hz of [10, 20, 40]) for (const frac of [0.3, 1]) {
  run(`odor2 ${hz}Hz frac${frac}`, (b) => { for (const t of code(1)) b.setRates(orn[t].slice(0, Math.ceil(orn[t].length * frac)), hz); });
}
run("odor A 20Hz", (b) => { for (const t of code(2)) b.setRates(orn[t], 20); });
run("odor B 20Hz", (b) => { for (const t of code(3)) b.setRates(orn[t], 20); });
run("PFL3 L 60Hz", (b) => b.setRates(G.pfl3_left, 60));
run("PFL3 R 60Hz", (b) => b.setRates(G.pfl3_right, 60));
run("sugar21 80Hz", (b) => b.setRates(G.sugar.slice(0, 21), 80));
run("sugar21 80Hz + PAM 25Hz", (b) => { b.setRates(G.sugar.slice(0, 21), 80); b.setRates(G.pam, 25); });
run("wind 40Hz + PPL1 25Hz", (b) => { b.setRates(G.wind.slice(0, 60), 40); b.setRates(G.ppl1, 25); });
