/**
 * SchoolDirector — relógio escolar, campainha, transição de salas e rotina didática do professor.
 *
 * Escala temporal: 1 minuto escolar = SECONDS_PER_SCHOOL_MINUTE segundos de tempo neural.
 * Um dia letivo (07:30 → 12:45) ≈ 10,5 min de simulação neural em 1x.
 */
import { visualCode } from "./Curriculum";
import { CLASSROOM, PLATE_RADIUS, dist } from "./SchoolLayout";
import type { SimulationEngine } from "./SimulationEngine";
import type { Problem, SchoolContext, Subject, TeachingStrategy, TrialOutcome } from "./types";

export const SECONDS_PER_SCHOOL_MINUTE = 2;

export interface Period {
  id: string;
  label: string;
  start: number; // minutos desde 00:00
  end: number;
  context: SchoolContext;
  subject?: Subject;
  room: "classroom" | "arena" | "patio";
}

const hm = (h: number, m: number) => h * 60 + m;

export const SCHEDULE: Period[] = [
  { id: "entry", label: "Entrada e Acomodação", start: hm(7, 30), end: hm(8, 0), context: "entry", room: "classroom" },
  { id: "math", label: "Aula de Matemática", start: hm(8, 0), end: hm(9, 30), context: "class", subject: "math", room: "classroom" },
  { id: "recess", label: "Recreio / Pátio", start: hm(9, 30), end: hm(10, 0), context: "recess", room: "patio" },
  { id: "language", label: "Aula de Linguagem / Português", start: hm(10, 0), end: hm(11, 30), context: "class", subject: "language", room: "classroom" },
  { id: "exam", label: "Sessão de Avaliação Formal", start: hm(11, 30), end: hm(12, 30), context: "exam", room: "arena" },
  { id: "dismissal", label: "Saída", start: hm(12, 30), end: hm(12, 45), context: "dismissal", room: "patio" },
];
export const DAY_START = SCHEDULE[0].start;
export const DAY_END = SCHEDULE[SCHEDULE.length - 1].end;

export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type TeachPhase = "idle" | "prepare" | "stimulus" | "iti";

export class SchoolDirector {
  day = 1;
  minutes = DAY_START;
  /** Segundos de tempo neural por minuto escolar. */
  secondsPerMinute = SECONDS_PER_SCHOOL_MINUTE;
  periodIndex = 0;

  activeStrategy: Record<Subject, string> = { math: "math-sugar", language: "lang-symbolic" };

  // Estado da aula
  phase: TeachPhase = "idle";
  phaseTime = 0;
  currentProblem: Problem | null = null;
  currentStrategy: TeachingStrategy | null = null;
  trialId = 0;
  presentations = 0;
  rewardPlates: number[] = [];
  private queue: string[] = [];
  private puffed = new Set<string>();
  private strobeClock = 0;
  /** Flash visual do estroboscópio (para renderização). */
  strobeFlash = 0;

  constructor(private engine: SimulationEngine) {}

  get period(): Period {
    return SCHEDULE[this.periodIndex];
  }

  get clock(): string {
    return formatClock(this.minutes);
  }

  get classroomStimulus(): Uint8Array | null {
    return this.phase === "stimulus" && this.currentProblem ? visualCode(this.currentProblem) : null;
  }

  get trialActive(): boolean {
    return this.phase === "stimulus";
  }

  /** Data simulada (dia letivo N a partir de uma segunda-feira de referência, pulando fins de semana). */
  simulatedDate(): Date {
    const d = new Date(2026, 2, 2); // 02/03/2026 (segunda) — início do ano letivo
    let added = 0;
    while (added < this.day - 1) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) added++;
    }
    return d;
  }

  update(dt: number) {
    const e = this.engine;
    this.minutes += dt / this.secondsPerMinute;
    this.strobeFlash = Math.max(0, this.strobeFlash - dt);

    // Transição de período → campainha
    const period = this.period;
    if (this.minutes >= period.end) {
      this.endPeriod(period);
      if (this.periodIndex === SCHEDULE.length - 1) {
        this.endDay();
        return;
      }
      this.periodIndex++;
      this.startPeriod(this.period);
    }

    if (this.period.context === "class" && this.period.subject) this.updateTeaching(dt, this.period.subject);
    this.updateTeacherIdle();
  }

  private startPeriod(p: Period) {
    this.engine.log("bell", `🔔 Campainha — ${p.label} (${formatClock(p.start)})`);
    if (p.context === "class" && p.subject) {
      const s = this.engine.strategy(this.activeStrategy[p.subject]);
      this.currentStrategy = s;
      this.queue = [];
      this.phase = "iti";
      this.phaseTime = 0;
      this.engine.log("teach", `Professor inicia "${s.name}"`);
    }
    if (p.context === "exam") this.engine.exam.begin(this.day);
  }

  private endPeriod(p: Period) {
    if (p.context === "class") {
      // ensaio interrompido pela campainha só conta se teve tempo razoável de resposta
      if (this.phase === "stimulus" && this.currentStrategy && this.phaseTime > this.currentStrategy.responseTolerance * 0.6) this.finishTrial();
      this.phase = "idle";
      this.currentProblem = null;
      this.rewardPlates = [];
    }
    if (p.context === "exam") this.engine.exam.end();
  }

  private endDay() {
    const e = this.engine;
    e.analytics.closeDay(this.day, e.students);
    e.log("info", `🌙 Fim do dia letivo ${this.day}. Sono noturno: consolidação STM → LTM.`);
    for (const f of e.flies) f.overnight();
    this.day++;
    this.minutes = DAY_START;
    this.periodIndex = 0;
    this.startPeriod(this.period);
  }

  // ────────────────────────── Rotina de ensino ──────────────────────────
  private updateTeaching(dt: number, subject: Subject) {
    const e = this.engine;
    const s = this.currentStrategy ?? e.strategy(this.activeStrategy[subject]);
    this.currentStrategy = s;
    this.phaseTime += dt;

    switch (this.phase) {
      case "idle":
      case "iti":
        if (this.phaseTime >= s.interTrialInterval) {
          this.phase = "prepare";
          this.phaseTime = 0;
          this.currentProblem = this.nextProblem(s);
        }
        break;
      case "prepare":
        if (this.phaseTime >= 1.2) {
          this.phase = "stimulus";
          this.phaseTime = 0;
          this.trialId++;
          this.presentations++;
          this.puffed.clear();
          this.rewardPlates = s.sugarReward && this.currentProblem ? [this.currentProblem.correct] : [];
        }
        break;
      case "stimulus": {
        const correct = this.currentProblem!.correct;
        // Reforço negativo: rajada de ar em quem permanece na placa errada
        if (s.airPuff)
          for (const f of e.students) {
            if (this.puffed.has(f.id) || f.room !== "classroom") continue;
            if (f.onPlate >= 0 && f.onPlate !== correct && f.committed === f.onPlate && dist(f.pos, CLASSROOM.plates[f.onPlate]) < PLATE_RADIUS) {
              f.airPuffTimer = 0.7 * s.rewardMagnitude;
              this.puffed.add(f.id);
            }
          }
        // Estroboscópio frio para moscas distraídas
        if (s.strobeDistracted) {
          this.strobeClock += dt;
          if (this.strobeClock > 2) {
            this.strobeClock = 0;
            let any = false;
            for (const f of e.students)
              if (f.room === "classroom" && (f.mode === "forage" || f.mode === "social")) {
                f.strobeTimer = 0.5;
                any = true;
              }
            if (any) this.strobeFlash = 0.5;
          }
        }
        if (this.phaseTime >= s.responseTolerance) {
          this.finishTrial();
          this.phase = "iti";
          this.phaseTime = 0;
        }
        break;
      }
    }
  }

  private nextProblem(s: TeachingStrategy): Problem {
    if (!this.queue.length) {
      this.queue = [...s.problemIds];
      // embaralha a ordem de apresentação
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
    }
    return this.engine.problem(this.queue.shift()!);
  }

  private finishTrial() {
    const e = this.engine;
    const prob = this.currentProblem;
    const s = this.currentStrategy;
    if (!prob || !s) return;
    const counts = { correct: 0, incorrect: 0, omission: 0 };
    for (const f of e.students) {
      let outcome: TrialOutcome = "omission";
      let decisionTime = s.responseTolerance;
      if (f.trialId === this.trialId) {
        const answer = f.locked >= 0 ? f.locked : f.onPlate >= 0 && f.onPlate === f.committed ? f.onPlate : -1;
        if (answer >= 0) {
          outcome = answer === prob.correct ? "correct" : "incorrect";
          decisionTime = f.lockTime >= 0 ? f.lockTime : s.responseTolerance;
        }
      }
      counts[outcome]++;
      e.analytics.addTrial({
        day: this.day,
        subject: prob.subject,
        strategyId: s.id,
        problemId: prob.id,
        flyId: f.id,
        outcome,
        decisionTime,
        hunger: f.homeo.hunger,
        fatigue: f.homeo.fatigue,
      });
    }
    e.analytics.addPresentation({
      n: this.presentations,
      day: this.day,
      clock: this.clock,
      subject: prob.subject,
      strategyId: s.id,
      problemId: prob.id,
      ...counts,
    });
    this.rewardPlates = [];
  }

  /** Posiciona o professor conforme a fase didática. */
  private updateTeacherIdle() {
    const t = this.engine.teacher;
    if (!t) return;
    const ctx = this.period.context;
    if (ctx === "exam") {
      t.scriptTarget = this.engine.exam.proctorTarget();
      return;
    }
    if (ctx === "recess" || ctx === "dismissal") {
      t.scriptTarget = { x: -6, z: 12 };
      return;
    }
    if (this.phase === "prepare" && this.currentProblem) {
      const pl = CLASSROOM.plates[this.currentProblem.correct];
      t.scriptTarget = { x: pl.x, z: pl.z - 1.2 }; // deposita a glicose/trilha
    } else if (this.phase === "stimulus") {
      t.scriptTarget = { x: CLASSROOM.board.x + 5.2, z: CLASSROOM.teacherSpot.z };
    } else t.scriptTarget = CLASSROOM.teacherSpot;
  }

  reset() {
    this.day = 1;
    this.minutes = DAY_START;
    this.periodIndex = 0;
    this.phase = "idle";
    this.phaseTime = 0;
    this.currentProblem = null;
    this.trialId = 0;
    this.presentations = 0;
    this.rewardPlates = [];
    this.queue = [];
    this.startPeriod(this.period);
  }

  /** Pula para um período (útil para demonstração). */
  jumpTo(periodId: string) {
    const idx = SCHEDULE.findIndex((p) => p.id === periodId);
    if (idx < 0) return;
    this.endPeriod(this.period);
    this.periodIndex = idx;
    this.minutes = SCHEDULE[idx].start;
    this.startPeriod(this.period);
  }
}
