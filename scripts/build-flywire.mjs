/**
 * build-flywire.mjs — converte o conectoma FlyWire v783 (Shiu et al. 2024 + anotações FlyWire)
 * num pacote binário compacto servido pelo app em /public/flywire.
 *
 * Entradas (data/flywire-raw/):
 *   Connectivity_783.parquet   github.com/philshiu/Drosophila_brain_model (MIT)
 *   Completeness_783.csv       idem (ordem dos índices dos neurônios)
 *   neuron_annotations.tsv     github.com/flyconnectome/flywire_annotations (CC-BY 4.0)
 *
 * Saída (public/flywire/):
 *   manifest.json        contagens, grupos funcionais (índices), partes do binário
 *   connectome.partN.bin CSR por neurônio pré-sináptico, alvos em delta-varint e
 *                        contagens sinápticas com sinal (zigzag-varint), partes ≤ 20 MB
 *   neurons.bin          super-classe (uint8) + posição quantizada (int16×3) por neurônio
 *
 * Uso: node scripts/build-flywire.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from "hyparquet";

const RAW = "data/flywire-raw";
const OUT = "public/flywire";
const PART_BYTES = 20 * 1024 * 1024;
const compressors = { BROTLI: (input) => new Uint8Array(zlib.brotliDecompressSync(input)) };

// ───────────── neurônios (ordem do índice do modelo de Shiu et al.) ─────────────
const rootIds = fs.readFileSync(path.join(RAW, "Completeness_783.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(",")[0]);
const N = rootIds.length;
const indexOf = new Map(rootIds.map((id, i) => [id, i]));
console.log(`neurônios: ${N}`);

const annLines = fs.readFileSync(path.join(RAW, "neuron_annotations.tsv"), "utf8").trim().split(/\r?\n/);
const H = annLines[0].split("\t");
const col = (name) => H.indexOf(name);
const C = {
  root: col("root_id"),
  x: col("pos_x"),
  y: col("pos_y"),
  z: col("pos_z"),
  sup: col("super_class"),
  cls: col("cell_class"),
  sub: col("cell_sub_class"),
  type: col("cell_type"),
  side: col("side"),
};
const ann = new Array(N).fill(null);
for (const line of annLines.slice(1)) {
  const f = line.split("\t");
  const i = indexOf.get(f[C.root]);
  if (i === undefined) continue;
  ann[i] = { sup: f[C.sup], cls: f[C.cls], sub: f[C.sub], type: f[C.type], side: f[C.side], x: +f[C.x], y: +f[C.y], z: +f[C.z] };
}
console.log(`anotados: ${ann.filter(Boolean).length}`);

const SUPER = ["unknown", "optic", "central", "sensory", "visual_projection", "ascending", "descending", "sensory_ascending", "visual_centrifugal", "motor", "endocrine"];

// ───────────── grupos funcionais (interface sensório-motora) ─────────────
const MN9 = ["720575940660219265", "720575940645521262"]; // Shiu et al. 2024
// 21 GRNs de açúcar do hemisfério direito usados em Shiu et al. 2024 (example.ipynb)
const SHIU_SUGAR = ["720575940624963786", "720575940630233916", "720575940637568838", "720575940638202345", "720575940617000768", "720575940630797113", "720575940632889389", "720575940621754367", "720575940621502051", "720575940640649691", "720575940639332736", "720575940616885538", "720575940639198653", "720575940620900446", "720575940617937543", "720575940632425919", "720575940633143833", "720575940612670570", "720575940628853239", "720575940629176663", "720575940611875570"];
const sel = (pred) => ann.map((a, i) => (a && pred(a) ? i : -1)).filter((i) => i >= 0);
const byIds = (ids) => ids.map((id) => indexOf.get(id)).filter((i) => i !== undefined);
const typeRe = (re) => (a) => re.test(a.type);

const groups = {
  photoreceptor: sel((a) => a.sup === "sensory" && a.cls === "visual"),
  ocellar: sel((a) => a.cls === "ocellar" || a.sub === "ocellar"),
  sugar: [...new Set([...byIds(SHIU_SUGAR), ...sel((a) => a.sub === "sugar/water")])],
  bitter: sel((a) => a.sub === "bitter"),
  pheromone: sel((a) => a.sub === "pheromone"),
  wind: sel((a) => a.sub === "wind_gravity"),
  heat: sel((a) => a.sub === "heating"),
  orn: sel((a) => a.cls === "olfactory"),
  kc: sel((a) => a.cls === "Kenyon_Cell"),
  apl: sel(typeRe(/^APL/)),
  mbon: sel((a) => a.cls === "MBON"),
  pam: sel(typeRe(/^PAM\d/)),
  ppl1: sel(typeRe(/^PPL1\d/)),
  epg: sel(typeRe(/^EPG$/)),
  pfl3_left: sel((a) => /^PFL3/.test(a.type) && a.side === "left"),
  pfl3_right: sel((a) => /^PFL3/.test(a.type) && a.side === "right"),
  dna02_left: sel((a) => /^DNa0[12]$/.test(a.type) && a.side === "left"),
  dna02_right: sel((a) => /^DNa0[12]$/.test(a.type) && a.side === "right"),
  dn_walk: sel(typeRe(/^(DNp09|DNg100|DNg97|oDN1)$/)),
  giant_fiber: sel(typeRe(/^DNp01$/)),
  mn9: byIds(MN9),
  dh44: sel(typeRe(/^DH44$/)),
  ipc: sel(typeRe(/^IPC$/)),
  itp: sel(typeRe(/^ITP$/)),
  dh31: sel(typeRe(/^DH31$/)),
  dfb: sel(typeRe(/^FB6[A-K]?$|^FB6,FB6J$|^FB7A/)),
};
for (const [k, v] of Object.entries(groups)) console.log(`  ${k.padEnd(14)} ${v.length}`);

// Posições das fotorreceptoras (retinotopia aproximada do olho: y dorsoventral, z anteroposterior)
const prInfo = groups.photoreceptor.map((i) => ({ i, side: ann[i].side, y: ann[i].y, z: ann[i].z }));
function retinotopy(side) {
  const pts = prInfo.filter((p) => p.side === side);
  const ys = pts.map((p) => p.y).sort((a, b) => a - b);
  const zs = pts.map((p) => p.z).sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.floor(t * (arr.length - 1))];
  // região 4×4 por quantis (igual número de fotorreceptoras por região)
  const yq = [0.25, 0.5, 0.75].map((t) => q(ys, t));
  const zq = [0.25, 0.5, 0.75].map((t) => q(zs, t));
  const bin = (v, qs) => qs.filter((b) => v > b).length;
  return pts.map((p) => [p.i, bin(p.y, yq) * 4 + bin(p.z, zq)]);
}
const retina = [...retinotopy("left"), ...retinotopy("right")]; // [índice, região 0..15]

// Odor por glomérulo (ORNs agrupados por tipo)
const ornTypes = {};
for (const i of groups.orn) (ornTypes[ann[i].type] ??= []).push(i);

// ───────────── conectividade ─────────────
const file = await asyncBufferFromFile(path.join(RAW, "Connectivity_783.parquet"));
const meta = await parquetMetadataAsync(file);
const E = Number(meta.num_rows);
console.log(`arestas: ${E}`);
const pre = new Int32Array(E);
const post = new Int32Array(E);
const w = new Int16Array(E);
const CHUNK = 1_000_000;
for (let s = 0; s < E; s += CHUNK) {
  const rows = await parquetReadObjects({
    file,
    columns: ["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"],
    rowStart: s,
    rowEnd: Math.min(E, s + CHUNK),
    compressors,
  });
  rows.forEach((r, k) => {
    pre[s + k] = Number(r.Presynaptic_Index);
    post[s + k] = Number(r.Postsynaptic_Index);
    w[s + k] = Math.max(-32767, Math.min(32767, Number(r["Excitatory x Connectivity"])));
  });
  process.stdout.write(`\r  lido ${Math.min(E, s + CHUNK)}/${E}`);
}
console.log();

// CSR por pré-sináptico, alvos ordenados
const deg = new Int32Array(N + 1);
for (let e = 0; e < E; e++) deg[pre[e] + 1]++;
for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
const fill = deg.slice(0, N);
const tgt = new Int32Array(E);
const wt = new Int16Array(E);
for (let e = 0; e < E; e++) {
  const k = fill[pre[e]]++;
  tgt[k] = post[e];
  wt[k] = w[e];
}
const order = [];
let maxW = 0;
const buf = Buffer.alloc(E * 8 + N * 5);
let p = 0;
const varint = (v) => {
  while (v >= 0x80) {
    buf[p++] = (v & 0x7f) | 0x80;
    v >>>= 7;
  }
  buf[p++] = v;
};
for (let i = 0; i < N; i++) {
  const a = deg[i];
  const b = deg[i + 1];
  order.length = 0;
  for (let k = a; k < b; k++) order.push(k);
  order.sort((x, y) => tgt[x] - tgt[y]);
  varint(b - a);
  let last = 0;
  for (const k of order) {
    varint(tgt[k] - last);
    last = tgt[k];
    const z = wt[k] >= 0 ? wt[k] * 2 : -wt[k] * 2 - 1; // zigzag
    varint(z);
    maxW = Math.max(maxW, Math.abs(wt[k]));
  }
}
const packed = buf.subarray(0, p);
console.log(`binário: ${(p / 1e6).toFixed(1)} MB · |w| máx ${maxW}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const parts = [];
for (let s = 0, n = 0; s < p; s += PART_BYTES, n++) {
  const name = `connectome.part${n}.bin`;
  fs.writeFileSync(path.join(OUT, name), packed.subarray(s, Math.min(p, s + PART_BYTES)));
  parts.push(name);
}

// neurons.bin: superclasse + posição quantizada (para a nuvem de pontos)
const nb = Buffer.alloc(N * 7);
const all = ann.filter(Boolean);
const ext = (k) => all.reduce(([lo, hi], a) => (Number.isFinite(a[k]) ? [Math.min(lo, a[k]), Math.max(hi, a[k])] : [lo, hi]), [Infinity, -Infinity]);
const bounds = { x: ext("x"), y: ext("y"), z: ext("z") };
for (let i = 0; i < N; i++) {
  const a = ann[i];
  nb[i * 7] = Math.max(0, SUPER.indexOf(a?.sup ?? "unknown"));
  ["x", "y", "z"].forEach((k, j) => {
    const v = a && Number.isFinite(a[k]) ? a[k] : (bounds[k][0] + bounds[k][1]) / 2;
    nb.writeInt16LE(Math.round(((v - bounds[k][0]) / (bounds[k][1] - bounds[k][0])) * 65534 - 32767), i * 7 + 1 + j * 2);
  });
}
fs.writeFileSync(path.join(OUT, "neurons.bin"), nb);

const manifest = {
  source: "FlyWire v783 · Dorkenwald et al. 2024; Schlegel et al. 2024 (CC-BY 4.0) · conectividade/sinais de Shiu et al. 2024 (MIT)",
  neurons: N,
  edges: E,
  parts,
  bytes: p,
  superClasses: SUPER,
  groups,
  retina,
  ornTypes,
  bounds,
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest));
console.log(`ok → ${OUT} (${parts.length} partes)`);
