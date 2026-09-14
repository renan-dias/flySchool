// Sobreposição (Jaccard) dos códigos de Kenyon cells para diferentes regimes de balanço E/I.
// uso: npx tsx scripts/fullbrain-overlap.ts
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";

const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const kcs = manifest.groups.kc;
const codes = [
  ["ORN_DC4", "ORN_DL5"],
  ["ORN_VC1", "ORN_VL2a"],
  ["ORN_DM2", "ORN_VM6v"],
  ["ORN_VA2", "ORN_VA6"],
  ["ORN_DL1", "ORN_VA3"],
];

function kcRates(glom: string[], inh: number, ad: number, hz: number, apl = 0): Float32Array {
  const b = new FlyWireBrain(data, 3);
  b.learning = false;
  b.inhibitoryGain = inh;
  b.adaptIncrement = ad;
  b.aplGraded = apl;
  for (const g of glom) b.setRates(manifest.ornTypes[g], hz);
  const tot = new Float32Array(kcs.length);
  for (let i = 0; i < 40; i++) {
    b.run(20);
    if (i >= 5) kcs.forEach((k, j) => (tot[j] += b.counts[k]));
  }
  return tot;
}
const cos = (a: Float32Array, b: Float32Array) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return s / Math.sqrt(na * nb || 1);
};
let spikesTotal = 0;
for (const [inh, ad, hz, apl] of [
  [5, 1, 30, 0],
  [5, 1, 30, 0.02],
  [5, 1, 30, 0.05],
  [5, 1, 30, 0.15],
  [5, 1, 60, 0.05],
  [3, 1, 30, 0.05],
] as const) {
  const t0 = Date.now();
  const r = codes.map((c) => kcRates(c, inh, ad, hz, apl));
  const active = r.map((x) => x.filter((v) => v >= 3).length);
  let sc = 0, n = 0;
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) (sc += cos(r[i], r[j])), n++;
  console.log(`inh${inh} ad${ad} ${hz}Hz apl${apl} · KCs ativas ${active.join("/")} · similaridade cosseno média ${(sc / n).toFixed(2)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
void spikesTotal;
