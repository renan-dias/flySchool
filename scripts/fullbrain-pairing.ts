// Experimento controlado de plasticidade no cérebro FlyWire completo:
// mede a resposta dos pools de MBON a um odor antes/depois de pareá-lo com dopamina (PAM) + cópia eferente.
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, N_POOLS, odorGlomeruli, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";

const eta = Number(process.argv[2] ?? 0.3);
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const G = manifest.groups;
const b = new FlyWireBrain(data, 5);
b.inhibitoryGain = 5;
b.adaptIncrement = 1;
b.eta = eta;
const pool = (p: number) => G.mbon.filter((m) => b.mbonPool[m] === p);

function probe(key: number, ms = 800) {
  b.learning = false;
  b.clearInputs();
  for (const t of odorGlomeruli(manifest, key)) b.setRates(manifest.ornTypes[t], 30);
  const acc = new Array(N_POOLS).fill(0);
  const n = ms / 20;
  for (let i = 0; i < n; i++) {
    const r = b.run(20);
    if (i >= 5) r.pools.forEach((p, j) => (acc[j] += p / (n - 5)));
  }
  b.clearInputs();
  for (let i = 0; i < 25; i++) b.run(20);
  return acc.map((x) => +x.toFixed(1));
}

function pair(key: number, target: number, valence: "pam" | "ppl1") {
  b.learning = true;
  b.clearInputs();
  for (const t of odorGlomeruli(manifest, key)) b.setRates(manifest.ornTypes[t], 30);
  const diag = { daPos: 0, eligTarget: 0, eligOther: 0, dw: 0 };
  const w0 = Float32Array.from(b.plasticW);
  for (let i = 0; i < 100; i++) {
    if (i === 40) {
      b.setRates(pool(target), 40);
      b.setRates(valence === "pam" ? G.pam : G.ppl1, 40);
    }
    b.run(20);
  }
  let up = 0, down = 0;
  for (let e = 0; e < b.plasticW.length; e++) {
    const dw = b.plasticW[e] - w0[e];
    const p = b.mbonPool[data.plasticTargets[e]];
    if (p === target) up += dw;
    else down += dw;
    const el = b.elig[e];
    if (p === target) diag.eligTarget += el;
    else diag.eligOther += el;
  }
  b.clearInputs();
  for (let i = 0; i < 25; i++) b.run(20);
  return { up: +up.toFixed(2), down: +down.toFixed(2), eligTarget: Math.round(diag.eligTarget), eligOther: Math.round(diag.eligOther) };
}

const A = 101, B = 202;
console.log("antes  A:", probe(A), " B:", probe(B));
for (let k = 0; k < 5; k++) console.log(`pareamento ${k + 1} (A→pool 2, PAM)`, pair(A, 2, "pam"));
console.log("depois A:", probe(A), " B:", probe(B));
