"use client";
/**
 * GodPanel — controle de população, injeção de crises, seleção/edição de métodos de ensino
 * e parâmetros da avaliação.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { CRISES, MAX_POPULATION } from "@/core/SimulationEngine";
import { SCHEDULE } from "@/core/SchoolDirector";
import type { BoardVisual, CrisisKind, Problem, Reinforcement, Subject, TeachingStrategy } from "@/core/types";
import { PLATE_LETTERS } from "@/core/types";
import { getEngine, useSimStore, useTick } from "@/store/useSimStore";

const CRISIS_ICON: Record<CrisisKind, string> = {
  famine: "🍽️",
  heatwave: "🔥",
  insomnia: "🥱",
  diuretic: "🧃",
  blackout: "⚡",
  pheromoneStorm: "🌫️",
  sugarRush: "🍰",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export default function GodPanel() {
  useTick();
  const e = getEngine();
  const { toggleGod, setPopulation } = useSimStore();
  const [pop, setPop] = useState(e.students.length);
  const [editor, setEditor] = useState(false);
  const [, force] = useState(0);

  const bySubject = (s: Subject) => e.strategies.filter((x) => x.subject === s);

  return (
    <aside className="glass animate-slide-in pointer-events-auto flex max-h-full w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-white">🧪 God Panel</h2>
          <p className="text-[11px] text-slate-400">Intervenções experimentais</p>
        </div>
        <button onClick={() => toggleGod(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">
          ✕
        </button>
      </div>
      <div className="scroll-thin flex flex-col gap-3 overflow-y-auto p-3">
        <Section title="População">
          <div className="flex items-center gap-3">
            <input type="range" min={1} max={MAX_POPULATION} value={pop} onChange={(ev) => setPop(+ev.target.value)} className="flex-1" />
            <span className="w-8 text-right font-mono text-sm text-white">{pop}</span>
            <button
              onClick={() => setPopulation(pop)}
              disabled={pop === e.students.length}
              className="rounded-lg bg-teal-300 px-2.5 py-1 text-xs font-semibold text-slate-900 disabled:opacity-30"
            >
              Aplicar
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Cada mosca executa um conectoma de 96 neurônios LIF · novas alunas chegam sem memória prévia.
          </p>
        </Section>

        <Section title="Injeção de crises">
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(CRISES) as CrisisKind[]).map((k) => (
              <button
                key={k}
                onClick={() => e.injectCrisis(k)}
                title={CRISES[k].description}
                className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-left text-[11px] text-slate-200 transition hover:bg-rose-500/20"
              >
                <span>{CRISIS_ICON[k]}</span>
                {CRISES[k].label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400">
            {e.heatTimer > 0 && <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-orange-300">🔥 calor {e.heatTimer.toFixed(0)}s</span>}
            {e.blackoutTimer > 0 && <span className="rounded bg-slate-500/20 px-1.5 py-0.5">⚡ blecaute {e.blackoutTimer.toFixed(0)}s</span>}
            {e.pheromoneStormTimer > 0 && <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-300">🌫️ feromônio {e.pheromoneStormTimer.toFixed(0)}s</span>}
          </div>
        </Section>

        <Section title="Métodos de ensino ativos">
          {(["math", "language"] as Subject[]).map((s) => {
            const active = e.strategy(e.director.activeStrategy[s]);
            return (
              <div key={s} className="mb-2.5">
                <label className="text-[11px] text-slate-400">{s === "math" ? "📐 Matemática" : "📖 Linguagem / Português"}</label>
                <select
                  value={e.director.activeStrategy[s]}
                  onChange={(ev) => {
                    e.setActiveStrategy(s, ev.target.value);
                    force((x) => x + 1);
                  }}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-lab-800 px-2 py-1.5 text-xs text-white"
                >
                  {bySubject(s).map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.custom ? "✏️ " : ""}
                      {st.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{active.description}</p>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  {active.sugarReward && <span className="rounded bg-amber-400/15 px-1.5 text-amber-300">glicose</span>}
                  {active.airPuff && <span className="rounded bg-cyan-400/15 px-1.5 text-cyan-300">rajada de ar</span>}
                  {active.strobeDistracted && <span className="rounded bg-sky-400/15 px-1.5 text-sky-300">estrobo</span>}
                  {active.pheromoneTrail && <span className="rounded bg-purple-400/15 px-1.5 text-purple-300">feromônio</span>}
                  <span className="rounded bg-white/5 px-1.5 text-slate-400">
                    ITI {active.interTrialInterval}s · tol {active.responseTolerance}s
                  </span>
                </div>
              </div>
            );
          })}
          <button onClick={() => setEditor(true)} className="w-full rounded-lg border border-dashed border-teal-300/40 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-300/10">
            ＋ Criar método pedagógico customizado
          </button>
        </Section>

        <Section title="Avaliação formal">
          <label className="flex items-center justify-between text-[11px] text-slate-300">
            Tempo limite por questão
            <span className="font-mono">{e.exam.tolerance}s</span>
          </label>
          <input type="range" min={6} max={30} value={e.exam.tolerance} onChange={(ev) => ((e.exam.tolerance = +ev.target.value), force((x) => x + 1))} className="w-full" />
          <label className="mt-1 flex items-center justify-between text-[11px] text-slate-300">
            Nº de questões
            <span className="font-mono">{e.exam.questionCount}</span>
          </label>
          <input type="range" min={2} max={10} value={e.exam.questionCount} onChange={(ev) => ((e.exam.questionCount = +ev.target.value), force((x) => x + 1))} className="w-full" />
          <p className="text-[10.5px] text-slate-500">Mudanças valem para a próxima prova. Sem reforço durante o teste.</p>
        </Section>

        <Section title="Pular no cronograma">
          <div className="grid grid-cols-2 gap-1.5">
            {SCHEDULE.filter((p) => p.id !== "dismissal").map((p) => (
              <button
                key={p.id}
                onClick={() => e.director.jumpTo(p.id)}
                className={`rounded-lg px-2 py-1.5 text-left text-[11px] transition ${e.director.period.id === p.id ? "bg-teal-300/20 text-teal-200" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Section>
      </div>
      {editor && createPortal(<StrategyEditor onClose={() => setEditor(false)} />, document.body)}
    </aside>
  );
}

// ───────────────────────── Editor de estratégias ─────────────────────────
function StrategyEditor({ onClose }: { onClose: () => void }) {
  const e = getEngine();
  const [name, setName] = useState("Meu método");
  const [subject, setSubject] = useState<Subject>("math");
  const [patternKind, setPatternKind] = useState<"dots" | "glyph">("dots");
  const [a, setA] = useState(3);
  const [b, setB] = useState(2);
  const [op, setOp] = useState<"+" | "-">("+");
  const [glyph, setGlyph] = useState("GATO");
  const [prompt, setPrompt] = useState("Letra inicial de GATO?");
  const [options, setOptions] = useState(["5", "4", "6", "1", "7"]);
  const [correct, setCorrect] = useState(0);
  const [reinforcement, setReinforcement] = useState<Reinforcement>("positive");
  const [strobe, setStrobe] = useState(false);
  const [pheromone, setPheromone] = useState(false);
  const [iti, setIti] = useState(2);
  const [tolerance, setTolerance] = useState(6.5);
  const [magnitude, setMagnitude] = useState(1);
  const [includeBank, setIncludeBank] = useState(true);
  const [activate, setActivate] = useState(true);

  const save = () => {
    const id = `custom-${Date.now().toString(36)}`;
    const visual: BoardVisual = patternKind === "dots" ? { kind: "dots", a, b, op } : { kind: "glyph", text: glyph.toUpperCase().slice(0, 6) };
    const problem: Problem = {
      id: `${id}-p`,
      subject,
      prompt: patternKind === "dots" ? `${a} ${op} ${b} = ?` : prompt,
      visual,
      options: options.map((o) => o.slice(0, 4) || "?") as Problem["options"],
      correct,
      custom: true,
    };
    const bank = includeBank ? e.strategies.find((s) => s.subject === subject && !s.custom)?.problemIds ?? [] : [];
    const strategy: TeachingStrategy = {
      id,
      name,
      subject,
      description: `Método customizado: padrão "${problem.prompt}", reforço ${reinforcement === "positive" ? "positivo" : reinforcement === "negative" ? "negativo" : "misto"}${pheromone ? ", trilha de feromônio" : ""}${strobe ? ", estrobo" : ""}.`,
      problemIds: [problem.id, ...bank],
      reinforcement,
      sugarReward: reinforcement !== "negative",
      airPuff: reinforcement !== "positive",
      strobeDistracted: strobe,
      pheromoneTrail: pheromone,
      interTrialInterval: iti,
      responseTolerance: tolerance,
      rewardMagnitude: magnitude,
      custom: true,
    };
    e.addStrategy(strategy, [problem]);
    if (activate) e.setActiveStrategy(subject, id);
    onClose();
  };

  const input = "w-full rounded-lg border border-white/10 bg-lab-800 px-2 py-1.5 text-xs text-white";
  const lbl = "text-[11px] text-slate-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass scroll-thin max-h-[90vh] w-[560px] max-w-full overflow-y-auto rounded-2xl p-5 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">✏️ Editor de Estratégia Pedagógica</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={lbl}>Nome do método</label>
            <input className={input} value={name} onChange={(ev) => setName(ev.target.value)} />
          </div>
          <div>
            <label className={lbl}>Matéria (aula em que será usado)</label>
            <select className={input} value={subject} onChange={(ev) => setSubject(ev.target.value as Subject)}>
              <option value="math">Matemática</option>
              <option value="language">Linguagem / Português</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Padrão na lousa</label>
            <select className={input} value={patternKind} onChange={(ev) => setPatternKind(ev.target.value as "dots" | "glyph")}>
              <option value="dots">Pontos (operação)</option>
              <option value="glyph">Letras / palavra</option>
            </select>
          </div>

          {patternKind === "dots" ? (
            <div className="col-span-2 flex items-end gap-2">
              <div className="flex-1">
                <label className={lbl}>A</label>
                <input type="number" min={0} max={9} className={input} value={a} onChange={(ev) => setA(Math.max(0, Math.min(9, +ev.target.value)))} />
              </div>
              <div className="w-20">
                <label className={lbl}>Op.</label>
                <select className={input} value={op} onChange={(ev) => setOp(ev.target.value as "+" | "-")}>
                  <option>+</option>
                  <option>-</option>
                </select>
              </div>
              <div className="flex-1">
                <label className={lbl}>B</label>
                <input type="number" min={0} max={9} className={input} value={b} onChange={(ev) => setB(Math.max(0, Math.min(9, +ev.target.value)))} />
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className={lbl}>Glifo na lousa</label>
                <input className={input} value={glyph} maxLength={6} onChange={(ev) => setGlyph(ev.target.value)} />
              </div>
              <div>
                <label className={lbl}>Enunciado</label>
                <input className={input} value={prompt} onChange={(ev) => setPrompt(ev.target.value)} />
              </div>
            </>
          )}

          <div className="col-span-2">
            <label className={lbl}>Alternativas nas placas (clique na letra para marcar a correta)</label>
            <div className="mt-1 grid grid-cols-5 gap-1.5">
              {PLATE_LETTERS.map((L, i) => (
                <div key={L} className="flex flex-col gap-1">
                  <button
                    onClick={() => setCorrect(i)}
                    className={`rounded-md py-1 text-xs font-bold ${correct === i ? "bg-amber-400 text-slate-900" : "bg-white/5 text-slate-300"}`}
                  >
                    {L}
                  </button>
                  <input
                    className={`${input} text-center`}
                    value={options[i]}
                    maxLength={4}
                    onChange={(ev) => setOptions((o) => o.map((x, j) => (j === i ? ev.target.value : x)))}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-2">
            <label className={lbl}>Tipo de reforço</label>
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {(
                [
                  ["positive", "➕ Positivo", "glicose no acerto (PAM)"],
                  ["negative", "➖ Negativo", "rajada de ar no erro (PPL1)"],
                  ["mixed", "± Misto", "glicose + rajada de ar"],
                ] as const
              ).map(([k, l, d]) => (
                <button
                  key={k}
                  onClick={() => setReinforcement(k)}
                  className={`rounded-lg p-2 text-left text-xs ${reinforcement === k ? "bg-teal-300/20 ring-1 ring-teal-300" : "bg-white/5"}`}
                >
                  <div className="font-semibold text-white">{l}</div>
                  <div className="text-[10px] text-slate-400">{d}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={pheromone} onChange={(ev) => setPheromone(ev.target.checked)} /> Trilha de feromônio (andaime)
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={strobe} onChange={(ev) => setStrobe(ev.target.checked)} /> Estrobo p/ distraídas
          </label>

          <div>
            <label className={`${lbl} flex justify-between`}>
              Intervalo entre estímulos <span className="font-mono text-slate-300">{iti}s</span>
            </label>
            <input type="range" min={0.5} max={8} step={0.5} value={iti} onChange={(ev) => setIti(+ev.target.value)} className="w-full" />
          </div>
          <div>
            <label className={`${lbl} flex justify-between`}>
              Tolerância de resposta <span className="font-mono text-slate-300">{tolerance}s</span>
            </label>
            <input type="range" min={3} max={15} step={0.5} value={tolerance} onChange={(ev) => setTolerance(+ev.target.value)} className="w-full" />
          </div>
          <div className="col-span-2">
            <label className={`${lbl} flex justify-between`}>
              Intensidade do reforço <span className="font-mono text-slate-300">{magnitude.toFixed(1)}×</span>
            </label>
            <input type="range" min={0.3} max={2} step={0.1} value={magnitude} onChange={(ev) => setMagnitude(+ev.target.value)} className="w-full" />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={includeBank} onChange={(ev) => setIncludeBank(ev.target.checked)} /> Intercalar com o banco de problemas da matéria (mais interferência, mais realista)
          </label>
          <label className="col-span-2 flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={activate} onChange={(ev) => setActivate(ev.target.checked)} /> Ativar imediatamente nesta matéria
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">
            Cancelar
          </button>
          <button onClick={save} className="rounded-lg bg-teal-300 px-4 py-1.5 text-xs font-bold text-slate-900">
            Salvar método
          </button>
        </div>
      </div>
    </div>
  );
}
