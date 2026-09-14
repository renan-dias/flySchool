// Validação do cérebro completo FlyWire contra Shiu et al. 2024 + teste de desempenho.
import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";

const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
let t = Date.now();
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
console.log(`decodificado em ${Date.now() - t} ms · fixas ${data.targets.length} · KC→MBON plásticas ${data.plasticTargets.length}`);
const G = manifest.groups;
const SHIU = [ "720575940624963786" ]; void SHIU;

function trial(label: string, setup: (b: FlyWireBrain) => void, ms = 1000, pick = ["mn9", "pam", "ppl1", "kc", "mbon", "giant_fiber", "dna02_left", "dna02_right"]) {
  const b = new FlyWireBrain(data, 3);
  b.learning = false;
  setup(b);
  const t0 = Date.now();
  let spikes = 0;
  const acc: Record<string, number> = {};
  let kcFrac = 0;
  let pools = [0, 0, 0, 0, 0];
  const blocks = ms / 20;
  for (let i = 0; i < blocks; i++) {
    const r = b.run(20);
    spikes += r.totalSpikes;
    for (const k of pick) acc[k] = (acc[k] ?? 0) + r.rates[k] / blocks;
    kcFrac += r.kcActiveFraction / blocks;
    pools = pools.map((p, j) => p + r.pools[j] / blocks);
  }
  const wall = Date.now() - t0;
  console.log(`${label.padEnd(34)} ${(wall / ms).toFixed(2)} s/s-sim · spikes/s ${spikes / (ms / 1000)} · ` + pick.map((k) => `${k}=${acc[k].toFixed(1)}`).join(" ") + ` · KC ativas/bloco ${(kcFrac * 100).toFixed(1)}% · pools ${pools.map((p) => p.toFixed(1)).join(",")}`);
}

trial("repouso (sem entrada)", () => {});
trial("açúcar 200 Hz (129 GRNs)", (b) => b.setRates(G.sugar, 200));
const shiu = G.sugar.slice(0, 21);
trial("açúcar 200 Hz (21 GRNs Shiu)", (b) => b.setRates(shiu, 200));
const regionNeurons = (bits: number[]) => manifest.retina.filter(([, r]) => bits.includes(r)).map(([i]) => i);
trial("visual 4 regiões 60 Hz", (b) => b.setRates(regionNeurons([1, 6, 11, 12]), 60));
trial("visual 4 regiões 20 Hz", (b) => b.setRates(regionNeurons([1, 6, 11, 12]), 20));
trial("ORN DA1+VA1d 80 Hz", (b) => b.setRates([...manifest.ornTypes["ORN_DA1"], ...manifest.ornTypes["ORN_VA1d"]], 80));
trial("vento/JO 150 Hz", (b) => b.setRates(G.wind, 150));
trial("PAM direto 40 Hz", (b) => b.setRates(G.pam, 40));
