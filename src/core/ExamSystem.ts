/**
 * ExamSystem — sessão de avaliação formal na Arena de Prova.
 * Sem intervenção do professor: nenhuma glicose, nenhuma punição. Mede apenas a memória
 * associativa consolidada nos Mushroom Bodies de cada mosca.
 */
import { visualCode } from "./Curriculum";
import { RNG } from "./rng";
import { ARENA } from "./SchoolLayout";
import type { SimulationEngine } from "./SimulationEngine";
import type { ExamRecord, Problem, Vec2 } from "./types";

export type ExamPhase = "off" | "gather" | "question" | "interval" | "done";

export class ExamSystem {
  phase: ExamPhase = "off";
  phaseTime = 0;
  questions: Problem[] = [];
  index = -1;
  day = 0;
  trialId = 100000; // espaço de ids separado dos ensaios de aula
  /** Tempo limite por questão (s). Configurável no GodPanel. */
  tolerance = 15;
  questionCount = 6;
  gatherTime = 8;
  intervalTime = 3;

  constructor(private engine: SimulationEngine) {}

  get current(): Problem | null {
    return this.phase === "question" ? this.questions[this.index] ?? null : null;
  }

  get stimulus(): Uint8Array | null {
    const q = this.current;
    return q ? visualCode(q) : null;
  }

  get active(): boolean {
    return this.phase === "question";
  }

  get remaining(): number {
    return this.phase === "question" ? Math.max(0, this.tolerance - this.phaseTime) : 0;
  }

  /** Monta a prova com questões balanceadas dos conteúdos ensinados. */
  begin(day: number) {
    const e = this.engine;
    this.day = day;
    const rng = new RNG(day * 7919 + 17);
    const taught = (id: string) => e.strategy(id).problemIds.map((p) => e.problem(p));
    const math = rng.shuffle([...taught(e.director.activeStrategy.math)]);
    const lang = rng.shuffle([...taught(e.director.activeStrategy.language)]);
    const qs: Problem[] = [];
    for (let i = 0; qs.length < this.questionCount && (i < math.length || i < lang.length); i++) {
      if (i < math.length) qs.push(math[i]);
      if (qs.length < this.questionCount && i < lang.length) qs.push(lang[i]);
    }
    this.questions = qs;
    this.index = -1;
    this.phase = "gather";
    this.phaseTime = 0;
    e.log("exam", `📝 Prova do dia ${day}: ${qs.length} questões, ${this.tolerance}s por questão.`);
  }

  end() {
    if (this.phase === "question") this.collect();
    this.phase = "off";
  }

  update(dt: number) {
    if (this.phase === "off" || this.phase === "done") return;
    this.phaseTime += dt;
    if (this.phase === "gather" && this.phaseTime >= this.gatherTime) this.nextQuestion();
    else if (this.phase === "question" && this.phaseTime >= this.tolerance) {
      this.collect();
      this.phase = "interval";
      this.phaseTime = 0;
    } else if (this.phase === "interval" && this.phaseTime >= this.intervalTime) this.nextQuestion();
  }

  private nextQuestion() {
    this.index++;
    if (this.index >= this.questions.length) {
      this.phase = "done";
      const recs = this.engine.analytics.exams.filter((r) => r.day === this.day);
      const acc = recs.length ? recs.filter((r) => r.correct).length / recs.length : 0;
      this.engine.log("exam", `✅ Prova encerrada — acerto médio da turma: ${(acc * 100).toFixed(0)}%`);
      return;
    }
    this.phase = "question";
    this.phaseTime = 0;
    this.trialId++;
  }

  /** Registra ID, tempo de decisão, rota e acerto de cada aluno. */
  private collect() {
    const e = this.engine;
    const q = this.questions[this.index];
    if (!q) return;
    for (const f of e.students) {
      const valid = f.trialId === this.trialId;
      const answer = valid ? (f.locked >= 0 ? f.locked : -1) : -1;
      const rec: ExamRecord = {
        day: this.day,
        questionIndex: this.index,
        problemId: q.id,
        subject: q.subject,
        flyId: f.id,
        answer,
        correct: answer === q.correct,
        decisionTime: answer >= 0 ? f.lockTime : this.tolerance,
        path: valid ? f.path.slice(0, 80) : [],
        hunger: f.homeo.hunger,
        fatigue: f.homeo.fatigue,
        thirst: f.homeo.thirst,
      };
      e.analytics.addExam(rec);
    }
  }

  proctorTarget(): Vec2 {
    return ARENA.proctorSpot;
  }

  reset() {
    this.phase = "off";
    this.index = -1;
    this.questions = [];
    this.trialId = 100000;
  }
}
