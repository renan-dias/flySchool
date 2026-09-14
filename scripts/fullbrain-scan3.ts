import fs from "node:fs";
import { decodeConnectome, FlyWireBrain, type FlyWireManifest } from "../src/core/fullbrain/FlyWireBrain";
const manifest: FlyWireManifest = JSON.parse(fs.readFileSync("public/flywire/manifest.json", "utf8"));
const bytes = Buffer.concat(manifest.parts.map((p) => fs.readFileSync(`public/flywire/${p}`)));
const data = decodeConnectome(manifest, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
const G = manifest.groups, orn = manifest.ornTypes;
const types = Object.keys(orn).filter((t) => orn[t].length >= 20).sort();
const code = (k: number) => [types[(k * 7) % types.length], types[(k * 13 + 5) % types.length]];
function run(inh: number, ad: number, setup: (b: FlyWireBrain) => void, ms = 400) {
  const b = new FlyWireBrain(data, 11); b.learning = false; b.inhibitoryGain = inh; b.adaptIncrement = ad; setup(b);
  let kc = 0, sp = 0; const pools = [0,0,0,0,0]; const acc: Record<string, number> = {}; const n = ms / 20;
  for (let i = 0; i < n; i++) { const r = b.run(20); if (i < 5) continue; sp += r.totalSpikes; kc += r.kcActiveFraction; r.pools.forEach((p, j) => (pools[j] += p)); for (const k of Object.keys(r.rates)) acc[k] = (acc[k] ?? 0) + r.rates[k]; }
  const m = n - 5; for (const k in acc) acc[k] /= m;
  return { kc: kc / m, pools: pools.map((p) => p / m), r: acc, sp: sp / (m * 0.02) };
}
const corr = (a: number[], b: number[]) => { const ma = a.reduce((x,y)=>x+y)/a.length, mb = b.reduce((x,y)=>x+y)/b.length; let s=0,sa=0,sb=0; a.forEach((x,i)=>{s+=(x-ma)*(b[i]-mb);sa+=(x-ma)**2;sb+=(b[i]-mb)**2}); return s/Math.sqrt(sa*sb||1); };
for (const inh of [3, 4, 5]) for (const ad of [1, 2]) for (const hz of [30, 50]) {
  const o = [1, 2, 3].map((k) => run(inh, ad, (b) => { for (const t of code(k)) b.setRates(orn[t], hz); }));
  const sugar = run(inh, ad, (b) => b.setRates(G.sugar, 120));
  const steer = run(inh, ad, (b) => b.setRates(G.pfl3_left, 60));
  const pam = run(inh, ad, (b) => b.setRates(G.pam, 30));
  console.log(`inh${inh} ad${ad} odor${hz}Hz KC=${o.map(x=>(x.kc*100).toFixed(1)).join("/")}% poolsMean=${o.map(x=>(x.pools.reduce((a,b)=>a+b)/5).toFixed(1)).join("/")} corr12=${corr(o[0].pools,o[1].pools).toFixed(2)} corr13=${corr(o[0].pools,o[2].pools).toFixed(2)} spk=${Math.round(o[0].sp)} | sugar MN9=${sugar.r.mn9.toFixed(0)} PAM=${sugar.r.pam.toFixed(0)} | PFL3L→DNa02R=${steer.r.dna02_right.toFixed(0)} L=${steer.r.dna02_left.toFixed(0)} | PAM30→pam=${pam.r.pam.toFixed(0)}`);
}
