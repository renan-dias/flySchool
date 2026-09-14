// Seleciona marcadores odoríferos (pares de glomérulos) que evocam códigos de Kenyon cells
// robustos e pouco sobrepostos, medidos no próprio conectoma FlyWire. Gera public/flywire/odor-codes.json.
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
import { BALANCED_PARAMS } from "../src/core/fullbrain/types";

const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const kcs = manifest.groups.kc;
const HZ = 30;

function kcSet(glomeruli: string[]): Set<number> {
  const b = new FlyWireBrain(data, 3);
  b.learning = false;
  b.inhibitoryGain = BALANCED_PARAMS.inhibitoryGain;
  b.adaptIncrement = BALANCED_PARAMS.adaptIncrement;
  for (const g of glomeruli) b.setRates(manifest.ornTypes[g], HZ);
  const tot = new Uint16Array(kcs.length);
  for (let i = 0; i < 40; i++) {
    b.run(20);
    if (i >= 5) kcs.forEach((k, j) => (tot[j] += b.counts[k]));
  }
  return new Set(kcs.filter((_, j) => tot[j] >= 3));
}
const jaccard = (a: Set<number>, b: Set<number>) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
};

const types = Object.keys(manifest.ornTypes).filter((t) => manifest.ornTypes[t].length >= 20).sort();
const single = new Map<string, Set<number>>();
for (const t of types) {
  single.set(t, kcSet([t]));
  process.stdout.write(`\r${t.padEnd(12)} ${single.get(t)!.size} KCs   `);
}
console.log();
// glomérulos úteis: ativam KCs sem levar à atividade global
const useful = types.filter((t) => {
  const n = single.get(t)!.size;
  return n >= 60 && n <= kcs.length * 0.3;
});
console.log(`glomérulos úteis: ${useful.length}/${types.length}`);

// seleção gulosa de pares sem glomérulos repetidos, minimizando a sobreposição com os já escolhidos
const codes: { glomeruli: string[]; kcs: number; maxJaccard: number }[] = [];
const chosenSets: Set<number>[] = [];
const used = new Set<string>();
while (codes.length < 16) {
  let best: { pair: string[]; set: Set<number>; score: number } | null = null;
  const avail = useful.filter((t) => !used.has(t));
  if (avail.length < 2) break;
  for (let i = 0; i < avail.length; i++)
    for (let j = i + 1; j < avail.length; j++) {
      const union = new Set([...single.get(avail[i])!, ...single.get(avail[j])!]);
      const maxJ = chosenSets.length ? Math.max(...chosenSets.map((c) => jaccard(c, union))) : 0;
      const score = maxJ - Math.min(0.2, union.size / 5000);
      if (!best || score < best.score) best = { pair: [avail[i], avail[j]], set: union, score };
    }
  if (!best) break;
  // confirma com os dois glomérulos juntos (interação não linear)
  const real = kcSet(best.pair);
  const maxJ = chosenSets.length ? Math.max(...chosenSets.map((c) => jaccard(c, real))) : 0;
  best.pair.forEach((t) => used.add(t));
  if (real.size < 60) continue;
  chosenSets.push(real);
  codes.push({ glomeruli: best.pair, kcs: real.size, maxJaccard: +maxJ.toFixed(2) });
  console.log(`código ${codes.length}: ${best.pair.join(" + ")} · ${real.size} KCs · Jaccard máx ${maxJ.toFixed(2)}`);
}
fs.writeFileSync("public/flywire/odor-codes.json", JSON.stringify({ hz: HZ, params: BALANCED_PARAMS, codes }));
console.log("ok → public/flywire/odor-codes.json");
