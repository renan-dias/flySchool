"use client";
/**
 * BrainGraphModal — visualizador individual do conectoma (estilo Obsidian / point cloud).
 * Grafo force-directed (molas + repulsão + âncoras por classe celular) desenhado em Canvas 2D.
 * Nós brilham conforme a taxa de disparo; arestas acendem quando o neurônio pré-sináptico dispara.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FlyConnectome, IDX, N_KC, N_MBON, N_NEURONS, type NeuronGroup } from "@/core/FlyConnectome";
import type { FlyAgent } from "@/core/FlyAgent";
import { PLATE_LETTERS } from "@/core/types";
import { getEngine, useSimStore, useTick } from "@/store/useSimStore";
import { GROUP_META, MODE_META, pct } from "./theme";

const GROUP_ORDER: NeuronGroup[] = ["visual", "chemo", "mechano", "state", "context", "cx", "action", "motor", "ppl1", "pam", "mbon", "apl", "kc"];

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  r: number;
  group: NeuronGroup;
}

function useGraphLayout(brain: FlyConnectome) {
  return useMemo(() => {
    const anchors = new Map<NeuronGroup, { x: number; y: number }>();
    GROUP_ORDER.forEach((g, i) => {
      const a = (i / GROUP_ORDER.length) * Math.PI * 2 - Math.PI / 2;
      const rad = g === "kc" || g === "apl" ? 0 : 230;
      anchors.set(g, { x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.8 });
    });
    anchors.set("kc", { x: 0, y: 10 });
    anchors.set("apl", { x: 0, y: -60 });
    const degree = new Array(N_NEURONS).fill(0);
    for (const e of brain.edges) {
      degree[e.from]++;
      degree[e.to]++;
    }
    const nodes: Node[] = brain.meta.map((m, i) => {
      const a = anchors.get(m.group)!;
      return {
        x: a.x + (Math.random() - 0.5) * 80,
        y: a.y + (Math.random() - 0.5) * 80,
        vx: 0,
        vy: 0,
        ax: a.x,
        ay: a.y,
        r: m.group === "kc" || m.group === "visual" ? 4 : Math.min(11, 5 + Math.sqrt(degree[i]) * 0.9),
        group: m.group,
      };
    });
    return nodes;
  }, [brain]);
}

function Graph({ fly }: { fly: FlyAgent }) {
  const brain = fly.brain;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodes = useGraphLayout(brain);
  const view = useRef({ x: 0, y: 0, k: 0.62 });
  const drag = useRef<{ node: number; px: number; py: number; pan: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hover;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let alpha = 1;
    const springEdges = brain.edges.filter((e) => e.plastic < 0 && Math.abs(brain.edgeWeight(e)) > 0.25);

    const physics = () => {
      alpha = Math.max(0.04, alpha * 0.995);
      const n = nodes.length;
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random();
            dy = Math.random();
            d2 = 1;
          }
          if (d2 > 90000) continue;
          const f = (900 / d2) * alpha;
          const inv = 1 / Math.sqrt(d2);
          a.vx += dx * inv * f;
          a.vy += dy * inv * f;
          b.vx -= dx * inv * f;
          b.vy -= dy * inv * f;
        }
      }
      for (const e of springEdges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.0022 * alpha;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        if (drag.current && drag.current.node === i) continue;
        a.vx += (a.ax - a.x) * 0.03 * (0.4 + alpha);
        a.vy += (a.ay - a.y) * 0.03 * (0.4 + alpha);
        a.vx *= 0.8;
        a.vy *= 0.8;
        a.x += a.vx;
        a.y += a.vy;
      }
    };
    // pré-assenta o layout para abrir já organizado
    for (let it = 0; it < 260; it++) physics();

    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      physics();

      // ── desenho ──
      const v = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * 0.7);
      bg.addColorStop(0, "#111a2e");
      bg.addColorStop(1, "#070b14");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2 + v.x, H / 2 + v.y);
      ctx.scale(v.k, v.k);

      const step = brain.stepCount;
      const hv = hoverRef.current;
      ctx.lineCap = "round";
      for (const e of brain.edges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        const w = brain.edgeWeight(e);
        const recent = step - brain.lastSpike[e.from] < 8; // disparo nos últimos 40 ms
        const focus = hv !== null && (e.from === hv || e.to === hv);
        let color: string;
        let alphaE: number;
        let width: number;
        if (e.plastic >= 0) {
          alphaE = Math.min(0.9, Math.max(0.02, (w - 0.2) * 0.6));
          color = `rgba(251,191,36,${recent ? Math.min(1, alphaE + 0.35) : alphaE * 0.55})`;
          width = 0.4 + w * 1.4;
        } else if (w < 0) {
          alphaE = recent ? 0.7 : 0.08;
          color = `rgba(251,113,133,${alphaE})`;
          width = 0.6 + Math.min(2, -w);
        } else {
          alphaE = recent ? 0.85 : 0.1;
          color = `rgba(94,234,212,${alphaE})`;
          width = 0.6 + Math.min(2, w * 0.8);
        }
        if (focus) {
          color = e.plastic >= 0 ? "rgba(251,191,36,0.95)" : w < 0 ? "rgba(251,113,133,0.95)" : "rgba(94,234,212,0.95)";
          width += 0.8;
        } else if (hv !== null) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = width / v.k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const meta = brain.meta[i];
        const rate = brain.rate[i];
        const glow = Math.min(1, rate / 60);
        const col = GROUP_META[a.group].color;
        const spikedNow = step - brain.lastSpike[i] < 3;
        ctx.shadowColor = col;
        ctx.shadowBlur = 4 + glow * 22;
        ctx.globalAlpha = 0.35 + glow * 0.65;
        ctx.fillStyle = spikedNow ? "#ffffff" : col;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r * (1 + glow * 0.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        const showLabel = hv === i || ((a.group === "mbon" || a.group === "pam" || a.group === "ppl1" || a.group === "state") && v.k > 0.55) || (a.group !== "kc" && a.group !== "visual" && v.k > 1.15);
        if (showLabel) {
          ctx.font = `${hv === i ? 600 : 500} ${11 / v.k}px Inter, sans-serif`;
          ctx.fillStyle = hv === i ? "#ffffff" : "rgba(203,213,225,0.75)";
          ctx.textAlign = "center";
          ctx.fillText(meta.label, a.x, a.y - a.r - 5 / v.k);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [brain, nodes]);

  // interação: arrastar nó, pan, zoom
  const toWorld = (ev: React.PointerEvent | React.WheelEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const v = view.current;
    return { x: (ev.clientX - rect.left - rect.width / 2 - v.x) / v.k, y: (ev.clientY - rect.top - rect.height / 2 - v.y) / v.k };
  };
  const pick = (p: { x: number; y: number }) => {
    let best = -1;
    let bd = 14 / view.current.k;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < Math.max(bd, n.r + 2)) {
        bd = d;
        best = i;
      }
    });
    return best;
  };

  const meta = hover !== null ? brain.meta[hover] : null;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="h-[340px] w-full cursor-grab rounded-xl active:cursor-grabbing"
        onPointerDown={(ev) => {
          (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
          const p = toWorld(ev);
          const i = pick(p);
          drag.current = { node: i, px: ev.clientX, py: ev.clientY, pan: i < 0 };
        }}
        onPointerMove={(ev) => {
          const p = toWorld(ev);
          const dr = drag.current;
          if (dr) {
            if (dr.pan) {
              view.current.x += ev.clientX - dr.px;
              view.current.y += ev.clientY - dr.py;
              dr.px = ev.clientX;
              dr.py = ev.clientY;
            } else {
              nodes[dr.node].x = p.x;
              nodes[dr.node].y = p.y;
              nodes[dr.node].vx = nodes[dr.node].vy = 0;
            }
          } else {
            const i = pick(p);
            setHover(i >= 0 ? i : null);
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onWheel={(ev) => {
          const v = view.current;
          v.k = Math.min(3, Math.max(0.25, v.k * (ev.deltaY < 0 ? 1.1 : 0.9)));
        }}
      />
      {meta && hover !== null && (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[260px] rounded-lg bg-black/80 px-2.5 py-1.5 text-[11px] shadow-lg">
          <div className="font-semibold" style={{ color: GROUP_META[meta.group].color }}>
            {meta.label} <span className="font-mono text-slate-500">#{meta.id}</span>
          </div>
          <div className="text-slate-300">{meta.description}</div>
          <div className="mt-0.5 font-mono text-slate-400">
            taxa {brain.rate[hover].toFixed(1)} Hz · V {brain.v[hover].toFixed(2)}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 text-[10px] text-slate-500">arraste nós · roda = zoom · arraste fundo = mover</div>
    </div>
  );
}

function Gauge({ label, value, color, text }: { label: string; value: number; color: string; text?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-200">{text ?? pct(value)}</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function WeightHeatmap({ brain }: { brain: FlyConnectome }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useTick();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const cw = c.width / N_KC;
    const ch = c.height / N_MBON;
    for (let i = 0; i < N_KC; i++)
      for (let j = 0; j < N_MBON; j++) {
        const w = brain.wShort[i * N_MBON + j] + brain.wLong[i * N_MBON + j];
        const t = Math.min(1, w / 1.0);
        ctx.fillStyle = `rgb(${Math.round(20 + 231 * t)},${Math.round(25 + 166 * t)},${Math.round(50 - 14 * t)})`;
        ctx.fillRect(i * cw, j * ch, cw - 1, ch - 1);
        const active = brain.rate[IDX.KC + i] > 3;
        if (active && j === 0) {
          ctx.fillStyle = "#5eead4";
          ctx.fillRect(i * cw, 0, cw - 1, 2);
        }
      }
  });
  return (
    <div className="flex gap-1.5">
      <div className="flex flex-col justify-around text-[9px] font-bold text-slate-500">
        {PLATE_LETTERS.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      <canvas ref={ref} width={400} height={75} className="h-[75px] flex-1 rounded" />
    </div>
  );
}

function Raster({ brain }: { brain: FlyConnectome }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext("2d")!;
        const B = FlyConnectome.RASTER_BINS;
        ctx.fillStyle = "#070b14";
        ctx.fillRect(0, 0, c.width, c.height);
        const bw = c.width / B;
        const rh = c.height / N_NEURONS;
        for (let b = 0; b < B; b++) {
          const bin = (brain.rasterHead + 1 + b) % B;
          for (let n = 0; n < N_NEURONS; n++) {
            if (brain.raster[bin * N_NEURONS + n]) {
              ctx.fillStyle = GROUP_META[brain.meta[n].group].color;
              ctx.fillRect(b * bw, n * rh, Math.max(1, bw - 0.5), Math.max(1, rh));
            }
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [brain]);
  return <canvas ref={ref} width={420} height={140} className="h-[140px] w-full rounded" />;
}

export default function BrainGraphModal() {
  useTick();
  const { selectedFlyId, select } = useSimStore();
  const e = getEngine();
  const fly = e.flyById(selectedFlyId);
  if (!fly) return null;
  const b = fly.brain;
  const r = b.rate;
  const pam = 0.5 * (r[IDX.PAM] + r[IDX.PAM + 1]);
  const ppl = 0.5 * (r[IDX.PPL1] + r[IDX.PPL1 + 1]);
  const mb = Array.from({ length: N_MBON }, (_, j) => r[IDX.MBON + j]);
  const mbMax = Math.max(20, ...mb);
  const ex = e.analytics.exams.filter((x) => x.flyId === fly.id);
  const tr = e.analytics.trials.filter((x) => x.flyId === fly.id);
  const examAcc = ex.length ? ex.filter((x) => x.correct).length / ex.length : null;
  const classAcc = tr.length ? tr.filter((x) => x.outcome === "correct").length / tr.length : null;
  const p = fly.personality;

  return (
    <aside className="glass animate-slide-in pointer-events-auto flex max-h-full w-[470px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl shadow-2xl">
      <div className="flex items-start justify-between border-b border-white/5 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">
              {fly.role === "teacher" ? "👩‍🏫" : "🪰"} {fly.name}
            </h2>
            <span className="rounded bg-white/5 px-1.5 font-mono text-[10px] text-slate-400">{fly.id}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full px-2 py-0.5 font-semibold text-slate-900" style={{ background: MODE_META[fly.mode].color }}>
              {MODE_META[fly.mode].icon} {MODE_META[fly.mode].label}
            </span>
            <span className="text-slate-400">
              {fly.flying ? "✈️ em voo" : fly.speed > 0.1 ? "🦵 caminhando" : "parada"} · sala: {fly.room}
            </span>
          </div>
        </div>
        <button onClick={() => select(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">
          ✕
        </button>
      </div>

      <div className="scroll-thin flex flex-col gap-3 overflow-y-auto p-3">
        <Graph key={fly.id} fly={fly} />
        <div className="flex flex-wrap gap-x-2.5 gap-y-1">
          {GROUP_ORDER.map((g) => (
            <span key={g} className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className="h-2 w-2 rounded-full" style={{ background: GROUP_META[g].color }} />
              {GROUP_META[g].label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white/[0.03] p-3">
          <Gauge label="Dopamina PAM (recompensa)" value={pam / 60} color="#facc15" text={`${pam.toFixed(0)} Hz`} />
          <Gauge label="Dopamina PPL1 (aversão)" value={ppl / 60} color="#fb7185" text={`${ppl.toFixed(0)} Hz`} />
          <Gauge label="Fome" value={fly.homeo.hunger} color="#f59e0b" />
          <Gauge label="Sede" value={fly.homeo.thirst} color="#38bdf8" />
          <Gauge label="Fadiga" value={fly.homeo.fatigue} color="#a78bfa" />
          <Gauge label="Vontade de evacuar" value={fly.homeo.bladder} color="#f472b6" />
          <Gauge label="Atenção (CX)" value={fly.attention()} color="#22d3ee" />
          <Gauge label="Taxa de aprendizado |ΔW|/s" value={Math.min(1, b.plasticityRate * 4)} color="#4ade80" text={b.plasticityRate.toFixed(3)} />
        </div>

        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Decisão motora · MBON → placas</span>
            <span className="font-mono normal-case text-slate-300">
              {fly.committed >= 0 ? `escolha: ${PLATE_LETTERS[fly.committed]}` : fly.mode === "attend" ? "sem estímulo / avaliando…" : "fora da tarefa"}
              {fly.committed >= 0 && fly.locked >= 0 ? ` ✔ travada ${fly.lockTime.toFixed(1)}s` : ""}
            </span>
          </div>
          <div className="flex items-end gap-2">
            {mb.map((v, j) => (
              <div key={j} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-16 w-full items-end overflow-hidden rounded bg-white/5">
                  <div
                    className="w-full rounded transition-[height] duration-200"
                    style={{ height: `${(v / mbMax) * 100}%`, background: fly.committed === j ? "#fbbf24" : "#64748b" }}
                  />
                </div>
                <span className="text-[11px] font-bold text-slate-300">{PLATE_LETTERS[j]}</span>
                <span className="font-mono text-[9px] text-slate-500">{v.toFixed(0)}Hz</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sinapses plásticas KC → MBON (memória)</div>
          <WeightHeatmap brain={b} />
          <p className="mt-1 text-[10px] text-slate-500">40 Kenyon cells × 5 MBONs · traço verde = KC ativa agora · amarelo = sinapse potenciada por dopamina</p>
        </div>

        <div className="rounded-xl bg-white/[0.03] p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Raster de espículas (últimos 2,4 s)</div>
          <Raster brain={b} />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Acerto em aula", pct(classAcc)],
            ["Acerto em provas", pct(examAcc)],
            ["Ensaios", String(tr.length + ex.length)],
            ["Plasticidade η×", p.plasticity.toFixed(2)],
            ["Apetite", p.appetite.toFixed(2)],
            ["Curiosidade", p.curiosity.toFixed(2)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
              <div className="font-mono text-sm text-white">{v}</div>
              <div className="text-[10px] text-slate-500">{k}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
