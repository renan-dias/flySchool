// Teste de aprendizagem do cérebro completo FlyWire: 5 marcadores odoríferos → 5 placas (pools de MBON).
// uso: npx tsx scripts/fullbrain-learning.ts <ensaios> <inh> <adapt> <apl> <odorHz> <eta> [positive|mixed]
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, N_POOLS, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
import { PoolDecoder } from "../src/core/fullbrain/PoolDecoder";

const [TRIALS, INH, AD, APL, HZ, ETA] = process.argv.slice(2, 8).map(Number);
const mode = process.argv[8] ?? "positive";
const tag = `inh${INH} ad${AD} apl${APL} ${HZ}Hz η${ETA} ${mode}`;
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const codes: { glomeruli: string[] }[] = JSON.parse(fs.readFileSync("public/flywire/odor-codes.json", "utf8")).codes;
const G = manifest.groups;
const correct = [3, 0, 4, 1, 2];
const b = new FlyWireBrain(data, 5);
Object.assign(b, { inhibitoryGain: INH, adaptIncrement: AD, aplGraded: APL, eta: ETA });
const poolMembers = Array.from({ length: N_POOLS }, (_, p) => G.mbon.filter((m) => b.mbonPool[m] === p));
const dec = new PoolDecoder(7);
const hits: number[] = [];
const t0 = Date.now();
for (let tr = 0; tr < TRIALS; tr++) {
  const prob = tr % 5;
  b.clearInputs();
  for (const g of codes[prob + 1].glomeruli) b.setRates(manifest.ornTypes[g], HZ);
  dec.reset();
  let choice = -1;
  for (let blk = 0; blk < 125; blk++) {
    const r = b.run(20);
    if (choice < 0) {
      choice = dec.accumulate(r.pools, blk * 20);
      if (choice >= 0) {
        b.setRates(poolMembers[choice], 40);
        if (choice === correct[prob]) {
          b.setRates(G.pam, 40);
          b.setRates(G.sugar, 120);
        } else if (mode === "mixed") b.setRates(G.ppl1, 40);
      }
    }
  }
  hits.push(choice === correct[prob] ? 1 : 0);
  b.clearInputs();
  for (let blk = 0; blk < 25; blk++) b.run(20);
  if ((tr + 1) % 10 === 0) {
    const last = hits.slice(-10);
    console.log(`${tag} · ensaios ${tr - 8}-${tr + 1}: ${last.reduce((a, c) => a + c, 0) * 10}% · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
const total = hits.reduce((a, c) => a + c, 0);
console.log(`${tag} · TOTAL primeira metade ${(hits.slice(0, TRIALS / 2).reduce((a, c) => a + c, 0) / (TRIALS / 2) * 100).toFixed(0)}% · segunda metade ${(hits.slice(TRIALS / 2).reduce((a, c) => a + c, 0) / (TRIALS / 2) * 100).toFixed(0)}% (${total}/${TRIALS})`);
