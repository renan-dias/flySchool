"use client";
/**
 * FullBrainPanel — visualizador do cérebro FlyWire completo de uma mosca:
 * nuvem de 138.639 neurônios nas posições anatômicas reais (point cloud WebGL), acesa pela
 * atividade de espículas do Web Worker, + leituras dos circuitos usados no comportamento.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { FlyAgent } from "@/core/FlyAgent";
import type { FlyWireManifest } from "@/core/fullbrain/FlyWireBrain";
import { PLATE_LETTERS } from "@/core/types";
import { getEngine, useSimStore, useTick } from "@/store/useSimStore";
import { MODE_META, pct } from "./theme";

const SUPER_COLORS: Record<string, string> = {
  unknown: "#475569",
  optic: "#3b82f6",
  central: "#a78bfa",
  sensory: "#34d399",
  visual_projection: "#22d3ee",
  ascending: "#fb923c",
  descending: "#f87171",
  sensory_ascending: "#facc15",
  visual_centrifugal: "#60a5fa",
  motor: "#ef4444",
  endocrine: "#f472b6",
};
const SUPER_LABELS: Record<string, string> = {
  optic: "Lobo óptico",
  central: "Cérebro central",
  sensory: "Sensoriais",
  visual_projection: "Projeção visual",
  ascending: "Ascendentes",
  descending: "Descendentes",
  sensory_ascending: "Sensoriais ascend.",
  visual_centrifugal: "Centrífugos visuais",
  motor: "Motores",
  endocrine: "Endócrinos",
};

interface Atlas {
  manifest: FlyWireManifest & { bounds: Record<"x" | "y" | "z", [number, number]> };
  positions: Float32Array;
  baseColors: Float32Array;
}

let atlasPromise: Promise<Atlas> | null = null;
function loadAtlas(): Promise<Atlas> {
  atlasPromise ??= (async () => {
    const manifest = await (await fetch("/flywire/manifest.json")).json();
    const bin = new DataView(await (await fetch("/flywire/neurons.bin")).arrayBuffer());
    const N: number = manifest.neurons;
    const b = manifest.bounds;
    const span = (k: "x" | "y" | "z") => b[k][1] - b[k][0];
    const maxSpan = Math.max(span("x"), span("y"), span("z"));
    const positions = new Float32Array(N * 3);
    const baseColors = new Float32Array(N * 3);
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const sup = bin.getUint8(i * 7);
      const q = (j: number) => (bin.getInt16(i * 7 + 1 + j * 2, true) / 32767) * 0.5;
      positions[i * 3] = q(0) * (span("x") / maxSpan) * 4;
      positions[i * 3 + 1] = -q(1) * (span("y") / maxSpan) * 4; // FlyWire: y cresce para ventral
      positions[i * 3 + 2] = q(2) * (span("z") / maxSpan) * 4;
      col.set(SUPER_COLORS[manifest.superClasses[sup]] ?? "#475569");
      baseColors.set([col.r, col.g, col.b], i * 3);
    }
    return { manifest, positions, baseColors };
  })();
  return atlasPromise;
}

function BrainCloud({ fly, atlas }: { fly: FlyAgent; atlas: Atlas }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(atlas.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(atlas.baseColors.length), 3));
    return g;
  }, [atlas]);
  const activity = useRef<Uint8Array | null>(null);
  const dirty = useRef(true);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      while (alive) {
        const a = await fly.external?.requestSnapshot();
        if (a) {
          activity.current = a;
          dirty.current = true;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    };
    loop();
    return () => {
      alive = false;
    };
  }, [fly]);

  useFrame(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const c = geom.getAttribute("color") as THREE.BufferAttribute;
    const arr = c.array as Float32Array;
    const base = atlas.baseColors;
    const act = activity.current;
    for (let i = 0; i < arr.length / 3; i++) {
      const a = act ? act[i] / 255 : 0;
      const k = 0.13 + a * 1.6;
      arr[i * 3] = Math.min(1, base[i * 3] * k + a * 0.6);
      arr[i * 3 + 1] = Math.min(1, base[i * 3 + 1] * k + a * 0.6);
      arr[i * 3 + 2] = Math.min(1, base[i * 3 + 2] * k + a * 0.6);
    }
    c.needsUpdate = true;
  });

  return (
    <points geometry={geom}>
      <pointsMaterial size={0.018} vertexColors transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  );
}

function Bar({ label, value, max, color, unit = "Hz" }: { label: string; value: number; max: number; color: string; unit?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-200">
          {value.toFixed(1)} {unit}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${Math.min(1, value / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export default function FullBrainPanel({ fly }: { fly: FlyAgent }) {
  useTick();
  const select = useSimStore((s) => s.select);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  useEffect(() => {
    loadAtlas().then(setAtlas);
  }, []);
  const e = getEngine();
  const ext = fly.external!;
  const r = ext.readout;
  const info = (ext as unknown as { info?: { neurons: number; edges: number; plastic: number } }).info;
  const ex = e.analytics.exams.filter((x) => x.flyId === fly.id);
  const tr = e.analytics.trials.filter((x) => x.flyId === fly.id);
  const examAcc = ex.length ? ex.filter((x) => x.correct).length / ex.length : null;
  const classAcc = tr.length ? tr.filter((x) => x.outcome === "correct").length / tr.length : null;
  const poolMax = Math.max(10, ...(r?.pools ?? [0]));

  return (
    <aside className="glass animate-slide-in pointer-events-auto flex max-h-full w-[470px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl shadow-2xl">
      <div className="flex items-start justify-between border-b border-white/5 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">🧠 {fly.name}</h2>
            <span className="rounded bg-white/5 px-1.5 font-mono text-[10px] text-slate-400">{fly.id}</span>
            <span className="rounded bg-fuchsia-400/20 px-1.5 text-[10px] font-semibold text-fuchsia-200">FlyWire v783</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full px-2 py-0.5 font-semibold text-slate-900" style={{ background: MODE_META[fly.mode].color }}>
              {MODE_META[fly.mode].icon} {MODE_META[fly.mode].label}
            </span>
            <span className="text-slate-400">
              {ext.ready ? `bloco de 20 ms em ${ext.lastComputeMs.toFixed(0)} ms` : `carregando conectoma ${(ext.progress * 100).toFixed(0)}%`}
            </span>
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">
          ✕
        </button>
      </div>

      <div className="scroll-thin flex flex-col gap-3 overflow-y-auto p-3">
        <div className="relative h-[300px] overflow-hidden rounded-xl bg-[#05070d]">
          {atlas && ext.ready ? (
            <Canvas camera={{ position: [0, 0.4, 3.2], fov: 45 }} dpr={[1, 1.5]}>
              <BrainCloud fly={fly} atlas={atlas} />
              <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.6} />
            </Canvas>
          ) : (
            <div className="flex h-full items-center justify-center font-mono text-xs text-slate-500">
              {ext.error ? `erro: ${ext.error}` : `baixando e decodificando 15,1 M sinapses… ${(ext.progress * 100).toFixed(0)}%`}
            </div>
          )}
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-slate-300">
            {info ? `${info.neurons.toLocaleString("pt-BR")} neurônios · ${(info.edges / 1e6).toFixed(1)} M conexões · ${info.plastic.toLocaleString("pt-BR")} KC→MBON plásticas` : "FlyWire v783"}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-slate-400">
            {r ? `${Math.round((r.totalSpikes / r.steps) * 1000).toLocaleString("pt-BR")} spikes/s · KCs ativas ${(r.kcActiveFraction * 100).toFixed(1)}%` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {Object.entries(SUPER_LABELS).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: SUPER_COLORS[k] }} />
              {l}
            </span>
          ))}
        </div>

        {r && (
          <>
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Decisão · 96 MBONs reais em 5 pools</span>
                <span className="font-mono normal-case text-slate-300">{fly.committed >= 0 ? `escolha: ${PLATE_LETTERS[fly.committed]}` : fly.mode === "attend" ? "avaliando…" : "fora da tarefa"}</span>
              </div>
              <div className="flex items-end gap-2">
                {r.pools.map((v, j) => (
                  <div key={j} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-16 w-full items-end overflow-hidden rounded bg-white/5">
                      <div className="w-full rounded" style={{ height: `${(v / poolMax) * 100}%`, background: fly.committed === j ? "#fbbf24" : "#64748b" }} />
                    </div>
                    <span className="text-[11px] font-bold text-slate-300">{PLATE_LETTERS[j]}</span>
                    <span className="font-mono text-[9px] text-slate-500">{v.toFixed(0)}Hz</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white/[0.03] p-3">
              <Bar label="PAM (307 dopaminérgicos)" value={r.rates.pam} max={60} color="#facc15" />
              <Bar label="PPL1 (16 dopaminérgicos)" value={r.rates.ppl1} max={60} color="#fb7185" />
              <Bar label="Kenyon cells (5.177)" value={r.rates.kc} max={20} color="#a78bfa" />
              <Bar label="Receptores de açúcar" value={r.rates.sugar} max={150} color="#34d399" />
              <Bar label="MN9 · probóscide" value={r.rates.mn9} max={60} color="#ef4444" />
              <Bar label="Giant Fiber · fuga" value={r.rates.giant_fiber} max={40} color="#f87171" />
              <Bar label="DNa02 esquerdo" value={r.rates.dna02_left} max={80} color="#22d3ee" />
              <Bar label="DNa02 direito" value={r.rates.dna02_right} max={80} color="#22d3ee" />
              <Bar label="PFL3 (Complexo Central)" value={(r.rates.pfl3_left + r.rates.pfl3_right) / 2} max={80} color="#38bdf8" />
              <Bar label="Fotorreceptores" value={r.rates.photoreceptor} max={20} color="#3b82f6" />
              <Bar label="Plasticidade |ΔW|" value={r.plasticity * 1000} max={50} color="#4ade80" unit="µV/s" />
              <Bar label="Peso KC→MBON médio" value={r.meanPlasticWeight} max={3} color="#fbbf24" unit="mV" />
            </div>
          </>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Acerto em aula", pct(classAcc)],
            ["Acerto em provas", pct(examAcc)],
            ["Atenção", pct(fly.attention())],
            ["Fome", pct(fly.homeo.hunger)],
            ["Fadiga", pct(fly.homeo.fatigue)],
            ["Ensaios", String(tr.length + ex.length)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
              <div className="font-mono text-sm text-white">{v}</div>
              <div className="text-[10px] text-slate-500">{k}</div>
            </div>
          ))}
        </div>

        <p className="text-[10.5px] leading-relaxed text-slate-500">
          LIF de Shiu et al. (Nature 2024) sobre o conectoma FlyWire v783 (Dorkenwald et al. 2024; Schlegel et al. 2024, CC-BY 4.0). Estímulos entram como trens de Poisson
          em neurônios anotados; a lousa chega às Kenyon cells como marcador odorífero (pares de glomérulos), pois fotorreceptores são histaminérgicos (inibitórios) e não
          propagam num LIF puro. Extensões deste simulador: ganho inibitório ×{e.fullBrainParams.inhibitoryGain}, adaptação {e.fullBrainParams.adaptIncrement} mV, APL graduado{" "}
          {e.fullBrainParams.aplGraded} mV e plasticidade KC→MBON. A seleção de programa (atenção/fome/banheiro) é um modelo de utilidade homeostática fora do conectoma.
        </p>
      </div>
    </aside>
  );
}
