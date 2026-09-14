"use client";
import { MODE_META } from "./theme";
import { getEngine, useSimStore, useTick } from "@/store/useSimStore";
import type { ActionMode } from "@/core/types";

const KIND_COLOR = { bell: "text-sky-300", crisis: "text-rose-300", exam: "text-amber-300", teach: "text-teal-300", info: "text-slate-300" };

/** Feed de eventos + censo comportamental da turma em tempo real. */
export default function EventFeed() {
  useTick();
  const select = useSimStore((s) => s.select);
  const e = getEngine();
  const events = e.events.slice(-6).reverse();
  const counts: Record<ActionMode, number> = { attend: 0, forage: 0, drink: 0, rest: 0, relief: 0, social: 0 };
  for (const f of e.students) counts[f.mode]++;
  const n = e.students.length;

  return (
    <div className="pointer-events-auto flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div className="glass rounded-2xl p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span>Censo comportamental</span>
          <span className="font-mono text-slate-300">{n} alunas</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-white/5">
          {(Object.keys(counts) as ActionMode[]).map((m) =>
            counts[m] ? <div key={m} style={{ width: `${(counts[m] / n) * 100}%`, background: MODE_META[m].color }} title={`${MODE_META[m].label}: ${counts[m]}`} /> : null,
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1">
          {(Object.keys(counts) as ActionMode[]).map((m) => (
            <div key={m} className="flex items-center gap-1 text-[11px] text-slate-300">
              <span className="h-2 w-2 rounded-full" style={{ background: MODE_META[m].color }} />
              <span className="truncate">{MODE_META[m].label}</span>
              <span className="ml-auto font-mono text-slate-400">{counts[m]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {e.flies.slice(0, 41).map((f) => (
            <button
              key={f.id}
              onClick={() => select(f.id)}
              title={`${f.name} (${f.id}) — ${MODE_META[f.mode].label}`}
              className="h-4 w-4 rounded-full border border-black/40 text-[8px] leading-none transition hover:scale-125"
              style={{ background: f.role === "teacher" ? "#e2e8f0" : MODE_META[f.mode].color }}
            >
              {f.role === "teacher" ? "T" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="glass rounded-2xl p-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Diário de classe</div>
        <ul className="space-y-1">
          {events.map((ev) => (
            <li key={ev.id} className="flex gap-2 text-[11px] leading-snug">
              <span className="shrink-0 font-mono text-slate-500">
                D{ev.day} {ev.clock}
              </span>
              <span className={KIND_COLOR[ev.kind]}>{ev.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
