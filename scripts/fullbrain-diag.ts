import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, N_POOLS, odorGlomeruli, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const G = manifest.groups;
// Entrada total recebida pelos MBONs: via KC (plástica) vs outras
const mbonSet = new Set(G.mbon);
let kcIn = 0, otherExc = 0, otherInh = 0;
for (let e = 0; e < data.plasticCounts.length; e++) kcIn += data.plasticCounts[e];
for (let i = 0; i < data.N; i++) for (let k = data.offsets[i]; k < data.offsets[i + 1]; k++) if (mbonSet.has(data.targets[k])) { const w = data.weights[k]; if (w > 0) otherExc += w; else otherInh += w; }
console.log(`sinapses nos MBONs: KC ${kcIn} · outras exc ${otherExc} · inib ${otherInh}`);
const kcPerMbon = G.mbon.map((m) => { let s = 0; for (let e = 0; e < data.plasticTargets.length; e++) if (data.plasticTargets[e] === m) s += data.plasticCounts[e]; return s; });
console.log("sinapses KC por MBON (min/mediana/max):", Math.min(...kcPerMbon), kcPerMbon.sort((a,b)=>a-b)[48], Math.max(...kcPerMbon), "MBONs sem KC:", kcPerMbon.filter((x) => x === 0).length);

function measure(key: number, scale: (b: FlyWireBrain) => void, label: string) {
  const b = new FlyWireBrain(data, 9); b.learning = false; b.inhibitoryGain = 5; b.adaptIncrement = 1; scale(b);
  for (const t of odorGlomeruli(manifest, key)) b.setRates(manifest.ornTypes[t], 30);
  const pools = [0,0,0,0,0]; let kc = 0;
  for (let i = 0; i < 40; i++) { const r = b.run(20); if (i < 5) continue; r.pools.forEach((p, j) => (pools[j] += p / 35)); kc += r.kcActiveFraction / 35; }
  console.log(`${label.padEnd(28)} KC ${(kc*100).toFixed(1)}% pools ${pools.map((p) => p.toFixed(1)).join(", ")}`);
}
for (const key of [11, 22, 33]) measure(key, () => {}, `odor ${key} base`);
const boost = (pool: number, f: number) => (b: FlyWireBrain) => { for (let e = 0; e < b.plasticW.length; e++) if (b.mbonPool[data.plasticTargets[e]] === pool) b.plasticW[e] *= f; };
measure(11, boost(1, 3), "odor 11 KC→pool1 ×3");
measure(11, boost(1, 6), "odor 11 KC→pool1 ×6");
measure(11, boost(4, 0), "odor 11 KC→pool4 ×0");
