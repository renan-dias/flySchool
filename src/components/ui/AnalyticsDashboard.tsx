"use client";
/**
 * AnalyticsDashboard — curvas de aprendizagem, matriz individual, correlação homeostase × desempenho,
 * eficácia dos métodos, rotas da última prova e exportação do relatório PDF.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { generateClassReport } from "@/core/ReportGenerator";
import { ARENA, PLATE_RADIUS } from "@/core/SchoolLayout";
import { PLATE_LETTERS } from "@/core/types";
import { getEngine, useSimStore } from "@/store/useSimStore";
import { pct } from "./theme";

type Tab = "curve" | "matrix" | "correlation" | "methods" | "routes";

const AXIS = { stroke: "#64748b", fontSize: 11 };
const GRID = "rgba(148,163,184,0.12)";
const TOOLTIP = { contentStyle: { background: "#0c1322", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "#e2e8f0" } };
const PROFILE_COLOR: Record<string, string> = {
  "Rápida e precisa": "#4ade80",
  "Aprendiz consistente": "#5eead4",
  "Em desenvolvimento": "#fbbf24",
  Impulsiva: "#fb923c",
  Distraída: "#f472b6",
  "Resistente ao condicionamento": "#fb7185",
  "Sem dados": "#64748b",
};

/** Recalcula os dados a cada 1,5 s (as agregações varrem milhares de registros). */
function useSnapshot() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setV((x) => x + 1), 1500);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => {
    const e = getEngine();
    const names = new Map(e.strategies.map((s) => [s.id, s.name]));
    return {
      v,
      day: e.director.day,
      curve: e.analytics.learningCurve(e.director.day, e.students).map((d) => ({
        day: `Dia ${d.day}`,
        examMath: d.examMath,
        examLang: d.examLang,
        classMath: d.classMath,
        classLang: d.classLang,
      })),
      rolling: e.analytics.rollingPresentations(6, 120),
      matrix: e.analytics.studentMatrix(e.students),
      corr: e.analytics.correlation(),
      methods: e.analytics.strategyEfficacy(names),
      exams: e.analytics.exams,
    };
  }, [v]);
}

function Heat({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-slate-600">—</span>;
  const t = invert ? 1 - value : value;
  const hue = Math.round(t * 140); // vermelho → verde
  return (
    <span className="inline-block min-w-[46px] rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-slate-900" style={{ background: `hsl(${hue} 70% 60%)` }}>
      {pct(value)}
    </span>
  );
}

export default function AnalyticsDashboard() {
  const [tab, setTab] = useState<Tab>("curve");
  const [busy, setBusy] = useState(false);
  const { toggleDashboard, select } = useSimStore();
  const s = useSnapshot();

  const report = async () => {
    setBusy(true);
    try {
      await generateClassReport(getEngine());
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string][] = [
    ["curve", "📈 Curva de Aprendizado"],
    ["matrix", "🧬 Matriz Individual"],
    ["correlation", "🍽️ Fome/Fadiga × Desempenho"],
    ["methods", "🎓 Métodos Pedagógicos"],
    ["routes", "🗺️ Rotas da Prova"],
  ];

  return (
    <section className="glass animate-slide-in pointer-events-auto flex h-[min(58vh,560px)] w-full flex-col rounded-2xl shadow-2xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2.5">
        <h2 className="mr-2 text-sm font-bold text-white">📊 Dashboard Analítico</h2>
        <div className="flex flex-wrap gap-1">
          {tabs.map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${tab === k ? "bg-white/15 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={report} disabled={busy} className="rounded-lg bg-teal-300 px-3 py-1.5 text-xs font-bold text-slate-900 shadow-[0_0_14px_rgba(94,234,212,0.35)] disabled:opacity-50">
            {busy ? "Gerando…" : "📄 Gerar Relatório da Turma"}
          </button>
          <button onClick={() => toggleDashboard(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
        {tab === "curve" && (
          <div className="grid h-full min-h-[380px] grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Acertos por dia letivo" subtitle="Provas formais (sem reforço) e ensaios de aula. Linha tracejada = acaso (20%).">
              <LineChart data={s.curve}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="day" {...AXIS} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => pct(v as number)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="examMath" name="Prova · Matemática" stroke="#60a5fa" strokeWidth={2.5} connectNulls dot />
                <Line type="monotone" dataKey="examLang" name="Prova · Português" stroke="#c084fc" strokeWidth={2.5} connectNulls dot />
                <Line type="monotone" dataKey="classMath" name="Aula · Matemática" stroke="#60a5fa" strokeDasharray="4 3" strokeWidth={1.5} connectNulls dot={false} />
                <Line type="monotone" dataKey="classLang" name="Aula · Português" stroke="#c084fc" strokeDasharray="4 3" strokeWidth={1.5} connectNulls dot={false} />
              </LineChart>
            </ChartCard>
            <ChartCard title="Tempo real · acerto por apresentação na lousa" subtitle="Média móvel de 6 estímulos por matéria; área cinza = omissões (distração).">
              <LineChart data={s.rolling}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="n" {...AXIS} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <Tooltip {...TOOLTIP} labelFormatter={(n) => `Apresentação #${n}`} formatter={(v) => pct(v as number)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Line type="monotone" dataKey="math" name="Matemática" stroke="#60a5fa" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="language" name="Português" stroke="#c084fc" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line type="stepAfter" dataKey="omission" name="Omissões" stroke="#64748b" strokeWidth={1} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartCard>
          </div>
        )}

        {tab === "matrix" && (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
            <div className="overflow-auto rounded-xl bg-white/[0.02]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-lab-900 text-[10px] uppercase tracking-wider text-slate-400">
                  <tr>
                    {["Aluna", "Prova", "Aula", "1º dia", "Último", "t decisão", "Distração", "Resistência", "η×", "Perfil"].map((h) => (
                      <th key={h} className="px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.matrix.map((r) => (
                    <tr key={r.id} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => select(r.id)} title={r.diagnosis}>
                      <td className="px-2 py-1.5">
                        <div className="font-semibold text-slate-100">{r.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">{r.id}</div>
                      </td>
                      <td className="px-2">
                        <Heat value={r.examAcc} />
                      </td>
                      <td className="px-2">
                        <Heat value={r.classAcc} />
                      </td>
                      <td className="px-2">
                        <Heat value={r.firstDayAcc} />
                      </td>
                      <td className="px-2">
                        <Heat value={r.lastDayAcc} />
                      </td>
                      <td className="px-2 font-mono text-slate-300">{r.meanDecisionTime?.toFixed(1) ?? "—"}s</td>
                      <td className="px-2">
                        <Heat value={r.distraction} invert />
                      </td>
                      <td className="px-2">
                        <Heat value={r.resistance} invert />
                      </td>
                      <td className="px-2 font-mono text-slate-400">{r.plasticity.toFixed(2)}</td>
                      <td className="px-2">
                        <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-slate-900" style={{ background: PROFILE_COLOR[r.profile] }}>
                          {r.profile}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ChartCard title="Velocidade × precisão" subtitle="Cada ponto é uma aluna (tamanho = distração). Clique na tabela para abrir o cérebro.">
              <ScatterChart>
                <CartesianGrid stroke={GRID} />
                <XAxis type="number" dataKey="t" name="Tempo de decisão" unit="s" {...AXIS} domain={[0, "auto"]} />
                <YAxis type="number" dataKey="acc" name="Acerto" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <ZAxis type="number" dataKey="z" range={[40, 260]} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Tooltip {...TOOLTIP} formatter={(v, n) => (n === "Acerto" ? pct(v as number) : v)} />
                <Scatter
                  data={s.matrix.filter((r) => r.meanDecisionTime !== null).map((r) => ({ t: +(r.meanDecisionTime ?? 0).toFixed(2), acc: r.examAcc ?? r.classAcc ?? 0, z: r.distraction, name: r.name, profile: r.profile }))}
                >
                  {s.matrix
                    .filter((r) => r.meanDecisionTime !== null)
                    .map((r) => (
                      <Cell key={r.id} fill={PROFILE_COLOR[r.profile]} />
                    ))}
                </Scatter>
              </ScatterChart>
            </ChartCard>
          </div>
        )}

        {tab === "correlation" && (
          <div className="grid h-full min-h-[380px] grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-xl bg-white/[0.03] p-4">
              <h3 className="text-sm font-semibold text-white">Correlação ponto-bisserial</h3>
              <Stat label="Fome × acerto" value={s.corr.rHunger} />
              <Stat label="Fadiga × acerto" value={s.corr.rFatigue} />
              <p className="text-[11px] leading-relaxed text-slate-400">
                n = {s.corr.n} respostas de prova. Fome e fadiga inibem o neurônio de atenção do Complexo Central, reduzindo o ganho das colunas visuais
                sobre as Kenyon cells: menos evidência nos MBONs → decisões mais lentas, omissões e erros. Injete <b>Fome coletiva</b> ou <b>Noite mal dormida</b> antes
                da prova para testar a hipótese.
              </p>
            </div>
            <ChartCard title="Acerto por faixa de fome">
              <BarChart data={s.corr.hungerBins}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="bin" {...AXIS} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => pct(v as number)} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Bar dataKey="acc" name="Acerto" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Acerto por faixa de fadiga">
              <BarChart data={s.corr.fatigueBins}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="bin" {...AXIS} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => pct(v as number)} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Bar dataKey="acc" name="Acerto" fill="#a78bfa" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>
          </div>
        )}

        {tab === "methods" && (
          <div className="grid h-full min-h-[380px] grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <ChartCard title="Eficácia por método pedagógico" subtitle="Acerto nos ensaios de aula vs. acerto nas provas da matéria nos dias em que o método foi usado.">
              <BarChart data={s.methods.map((m) => ({ ...m, short: m.name.split(" · ").pop() }))}>
                <CartesianGrid stroke={GRID} />
                <XAxis dataKey="short" {...AXIS} interval={0} fontSize={10} />
                <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v) => pct(v as number)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0.2} stroke="#94a3b8" strokeDasharray="5 5" />
                <Bar dataKey="classAcc" name="Aula" fill="#5eead4" radius={[6, 6, 0, 0]} />
                <Bar dataKey="examAcc" name="Prova" fill="#fbbf24" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>
            <div className="flex flex-col gap-2 rounded-xl bg-white/[0.03] p-4 text-xs">
              <h3 className="text-sm font-semibold text-white">Protocolo experimental sugerido</h3>
              <ol className="list-decimal space-y-1.5 pl-4 text-slate-300">
                <li>Rode 2–3 dias com o método apetitivo padrão (linha de base).</li>
                <li>Reinicie e troque para “Andaime com Feromônio” ou “Recompensa + Punição”.</li>
                <li>Compare as curvas de prova: a diferença é o efeito do método.</li>
                <li>Crie variantes no editor (tolerância, intervalo, intensidade) e repita.</li>
              </ol>
              <div className="mt-2 space-y-1">
                {s.methods.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1.5">
                    <span className="truncate text-slate-300">{m.name}</span>
                    <span className="font-mono text-slate-400">{m.trials} ensaios</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "routes" && <Routes exams={s.exams} />}
      </div>
    </section>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactElement }) {
  return (
    <div className="flex min-h-[320px] flex-col rounded-xl bg-white/[0.03] p-3">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {subtitle && <p className="mb-2 text-[11px] text-slate-400">{subtitle}</p>}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-black/20 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`font-mono text-2xl font-semibold ${value === null ? "text-slate-500" : value < -0.1 ? "text-rose-300" : value > 0.1 ? "text-emerald-300" : "text-slate-200"}`}>
        r = {value === null ? "—" : value.toFixed(2)}
      </div>
    </div>
  );
}

function Routes({ exams }: { exams: ReturnType<typeof getEngine>["analytics"]["exams"] }) {
  const days = [...new Set(exams.map((r) => r.day))].sort((a, b) => a - b);
  const [day, setDay] = useState<number | null>(null);
  const [q, setQ] = useState<number | "all">("all");
  const d = day ?? days[days.length - 1];
  const recs = exams.filter((r) => r.day === d && (q === "all" || r.questionIndex === q) && r.path.length > 1);
  const questions = [...new Set(exams.filter((r) => r.day === d).map((r) => r.questionIndex))];
  const minX = 2, maxX = 21, minZ = -13.5, maxZ = 6.5;
  const W = 760;
  const H = (W * (maxZ - minZ)) / (maxX - minX);
  const sx = (x: number) => ((x - minX) / (maxX - minX)) * W;
  const sz = (z: number) => ((z - minZ) / (maxZ - minZ)) * H;
  if (!days.length) return <p className="text-sm text-slate-400">Nenhuma prova realizada ainda. A sessão de avaliação começa às 11:30 (use “Pular no cronograma” no God Panel).</p>;
  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="flex flex-col gap-2 text-xs lg:w-56">
        <label className="text-slate-400">Dia da prova</label>
        <select value={d} onChange={(e) => setDay(+e.target.value)} className="rounded-lg border border-white/10 bg-lab-800 px-2 py-1.5 text-white">
          {days.map((x) => (
            <option key={x} value={x}>
              Dia {x}
            </option>
          ))}
        </select>
        <label className="text-slate-400">Questão</label>
        <select value={q} onChange={(e) => setQ(e.target.value === "all" ? "all" : +e.target.value)} className="rounded-lg border border-white/10 bg-lab-800 px-2 py-1.5 text-white">
          <option value="all">Todas</option>
          {questions.map((x) => (
            <option key={x} value={x}>
              Questão {x + 1}
            </option>
          ))}
        </select>
        <div className="mt-2 space-y-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="h-1 w-5 bg-emerald-400" /> acerto
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-5 bg-rose-400" /> erro
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1 w-5 bg-slate-500" /> sem resposta
          </div>
        </div>
        <p className="text-[11px] text-slate-500">{recs.length} trajetórias amostradas a 4 Hz desde o início da questão.</p>
      </div>
      <div className="flex-1 overflow-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[860px] rounded-xl bg-slate-900/60">
          <rect x={sx(ARENA.waiting.minX)} y={sz(ARENA.waiting.minZ)} width={sx(ARENA.waiting.maxX) - sx(ARENA.waiting.minX)} height={sz(ARENA.waiting.maxZ) - sz(ARENA.waiting.minZ)} fill="rgba(96,165,250,0.08)" />
          <rect x={sx(ARENA.board.x - ARENA.board.width / 2)} y={sz(-13.3)} width={sx(ARENA.board.x + ARENA.board.width / 2) - sx(ARENA.board.x - ARENA.board.width / 2)} height={10} fill="#1f4d3a" />
          {ARENA.plates.map((p, i) => (
            <g key={i}>
              <circle cx={sx(p.x)} cy={sz(p.z)} r={(PLATE_RADIUS / (maxX - minX)) * W} fill="rgba(226,232,240,0.1)" stroke="#94a3b8" strokeWidth={2} />
              <text x={sx(p.x)} y={sz(p.z) + 7} textAnchor="middle" fontSize={20} fontWeight={800} fill="#e2e8f0">
                {PLATE_LETTERS[i]}
              </text>
            </g>
          ))}
          {recs.map((r, i) => (
            <polyline
              key={i}
              points={r.path.map((p) => `${sx(p.x)},${sz(p.z)}`).join(" ")}
              fill="none"
              stroke={r.correct ? "#34d399" : r.answer < 0 ? "#64748b" : "#fb7185"}
              strokeOpacity={0.55}
              strokeWidth={1.8}
            >
              <title>{`${r.flyId} · Q${r.questionIndex + 1} · ${r.answer >= 0 ? PLATE_LETTERS[r.answer] : "—"} · ${r.decisionTime.toFixed(1)}s`}</title>
            </polyline>
          ))}
        </svg>
      </div>
    </div>
  );
}
