"use client";
import { SCHEDULE, DAY_END, DAY_START, formatClock } from "@/core/SchoolDirector";
import { getEngine, useSimStore, useTick, type Speed } from "@/store/useSimStore";

const PERIOD_COLORS: Record<string, string> = {
  entry: "#64748b",
  math: "#3b82f6",
  recess: "#22c55e",
  language: "#a855f7",
  exam: "#f43f5e",
  dismissal: "#475569",
};

function Btn({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
        active ? "bg-teal-300 text-slate-900 shadow-[0_0_12px_rgba(94,234,212,0.5)]" : "bg-white/5 text-slate-200 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

export default function TopBar() {
  useTick();
  const e = getEngine();
  const d = e.director;
  const { paused, speed, setPaused, setSpeed, reset, toggleDashboard, toggleGod, showDashboard, showGod, toggleHelp } = useSimStore();
  const progress = (d.minutes - DAY_START) / (DAY_END - DAY_START);
  const date = d.simulatedDate().toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });

  let status = d.period.label;
  if (d.period.context === "class") {
    if (d.phase === "stimulus" && d.currentProblem) status = `Lousa: ${d.currentProblem.prompt}`;
    else if (d.phase === "prepare") status = "Professora preparando o estímulo…";
    else status = "Intervalo entre estímulos";
  } else if (d.period.context === "exam") {
    const x = e.exam;
    if (x.phase === "question" && x.current) status = `Questão ${x.index + 1}/${x.questions.length}: ${x.current.prompt} · ${x.remaining.toFixed(0)}s`;
    else if (x.phase === "gather") status = "Alunas se dirigindo à Arena de Avaliação";
    else if (x.phase === "done") status = "Prova encerrada";
  }

  return (
    <header className="glass pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl px-4 py-2.5 shadow-2xl">
      <div className="flex items-center gap-2 pr-2">
        <span className="text-2xl">🪰</span>
        <div className="leading-tight">
          <h1 className="text-sm font-bold tracking-tight text-white">FlySchool</h1>
          <p className="text-[10px] uppercase tracking-widest text-teal-300/80">Bio-Neural Classroom</p>
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-black/30 px-3 py-1.5">
        <div className="text-center leading-none">
          <div className="font-mono text-2xl font-semibold tabular-nums text-white">{d.clock}</div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            Dia {d.day} · {date}
          </div>
        </div>
        <div className="w-56 max-w-[30vw]">
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span className="font-semibold text-slate-200">🔔 {d.period.label}</span>
          </div>
          <div className="relative flex h-2 overflow-hidden rounded-full bg-white/10">
            {SCHEDULE.map((p) => (
              <div
                key={p.id}
                title={`${formatClock(p.start)} ${p.label}`}
                style={{ width: `${((p.end - p.start) / (DAY_END - DAY_START)) * 100}%`, background: PERIOD_COLORS[p.id], opacity: p.id === d.period.id ? 1 : 0.35 }}
              />
            ))}
            <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${progress * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 truncate text-xs text-slate-300">
        <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-teal-300" />
        {status}
      </div>

      <div className="flex items-center gap-1">
        <Btn onClick={() => setPaused(!paused)} active={!paused} title="Play / Pause (Espaço)">
          {paused ? "▶ Play" : "⏸ Pause"}
        </Btn>
        {([1, 2, 5, 10] as Speed[]).map((s) => (
          <Btn key={s} onClick={() => setSpeed(s)} active={speed === s} title={`Velocidade ${s}x`}>
            {s}x
          </Btn>
        ))}
        <Btn
          onClick={() => {
            if (confirm("Reiniciar a simulação? Todo aprendizado e métricas serão perdidos.")) reset();
          }}
          title="Reiniciar"
        >
          ↺
        </Btn>
      </div>

      <div className="flex items-center gap-1">
        <Btn onClick={() => toggleGod()} active={showGod}>
          🧪 God Panel
        </Btn>
        <Btn onClick={() => toggleDashboard()} active={showDashboard}>
          📊 Analytics
        </Btn>
        <Btn onClick={() => toggleHelp()}>?</Btn>
      </div>
    </header>
  );
}
