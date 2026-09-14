/**
 * Analytics — coleta de métricas pedagógicas e estatísticas derivadas.
 */
import type { FlyAgent } from "./FlyAgent";
import type { ExamRecord, Subject, TrialRecord } from "./types";

export interface Presentation {
  n: number;
  day: number;
  clock: string;
  subject: Subject;
  strategyId: string;
  problemId: string;
  correct: number;
  incorrect: number;
  omission: number;
}

export interface DaySummary {
  day: number;
  classMath: number | null;
  classLang: number | null;
  examMath: number | null;
  examLang: number | null;
  examOverall: number | null;
  omissionRate: number | null;
  meanHunger: number;
  meanFatigue: number;
}

export type StudentProfile =
  | "Aprendiz consistente"
  | "Rápida e precisa"
  | "Impulsiva"
  | "Distraída"
  | "Resistente ao condicionamento"
  | "Em desenvolvimento"
  | "Sem dados";

export interface StudentRow {
  id: string;
  name: string;
  examAcc: number | null;
  classAcc: number | null;
  firstDayAcc: number | null;
  lastDayAcc: number | null;
  meanDecisionTime: number | null;
  distraction: number; // 0..1
  omissionRate: number;
  resistance: number; // 0..1 (1 = não aprende)
  plasticity: number;
  appetite: number;
  profile: StudentProfile;
  diagnosis: string;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const accOf = <T extends { correct: boolean }>(a: T[]) => (a.length ? a.filter((r) => r.correct).length / a.length : null);

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export class Analytics {
  trials: TrialRecord[] = [];
  exams: ExamRecord[] = [];
  presentations: Presentation[] = [];
  days: DaySummary[] = [];
  private attention = new Map<string, { class: number; attend: number }>();

  addTrial(r: TrialRecord) {
    this.trials.push(r);
    if (this.trials.length > 60000) this.trials.splice(0, 10000);
  }

  addExam(r: ExamRecord) {
    this.exams.push(r);
    if (this.exams.length > 20000) this.exams.splice(0, 4000);
  }

  addPresentation(p: Presentation) {
    this.presentations.push(p);
    if (this.presentations.length > 5000) this.presentations.splice(0, 1000);
  }

  /** Fecha o resumo do dia e fotografa índices de atenção. */
  closeDay(day: number, students: FlyAgent[]) {
    this.days = this.days.filter((d) => d.day !== day);
    this.days.push(this.summarize(day, students));
    for (const f of students) this.attention.set(f.id, { class: f.classTicks, attend: f.attendTicks });
  }

  summarize(day: number, students: FlyAgent[]): DaySummary {
    const t = this.trials.filter((r) => r.day === day);
    const ex = this.exams.filter((r) => r.day === day);
    const classAcc = (s: Subject) => {
      const a = t.filter((r) => r.subject === s);
      return a.length ? a.filter((r) => r.outcome === "correct").length / a.length : null;
    };
    return {
      day,
      classMath: classAcc("math"),
      classLang: classAcc("language"),
      examMath: accOf(ex.filter((r) => r.subject === "math")),
      examLang: accOf(ex.filter((r) => r.subject === "language")),
      examOverall: accOf(ex),
      omissionRate: ex.length ? ex.filter((r) => r.answer < 0).length / ex.length : null,
      meanHunger: mean(students.map((s) => s.homeo.hunger)) ?? 0,
      meanFatigue: mean(students.map((s) => s.homeo.fatigue)) ?? 0,
    };
  }

  /** Série do dia corrente + dias fechados (para curva em tempo real). */
  learningCurve(currentDay: number, students: FlyAgent[]): DaySummary[] {
    const closed = this.days.filter((d) => d.day !== currentDay);
    return [...closed, this.summarize(currentDay, students)].sort((a, b) => a.day - b.day);
  }

  /** Acurácia por apresentação com média móvel (curva intra-dia). */
  rollingPresentations(window = 8, limit = 160) {
    const recent = this.presentations.slice(-limit);
    const out: { n: number; label: string; math: number | null; language: number | null; raw: number; omission: number }[] = [];
    const hist: Record<Subject, number[]> = { math: [], language: [] };
    for (const p of recent) {
      const total = p.correct + p.incorrect + p.omission;
      const acc = total ? p.correct / total : 0;
      hist[p.subject].push(acc);
      if (hist[p.subject].length > window) hist[p.subject].shift();
      out.push({
        n: p.n,
        label: `D${p.day} ${p.clock}`,
        math: p.subject === "math" ? mean(hist.math) : null,
        language: p.subject === "language" ? mean(hist.language) : null,
        raw: acc,
        omission: total ? p.omission / total : 0,
      });
    }
    return out;
  }

  studentMatrix(students: FlyAgent[]): StudentRow[] {
    const days = [...new Set(this.exams.map((e) => e.day))].sort((a, b) => a - b);
    return students.map((f) => {
      const ex = this.exams.filter((r) => r.flyId === f.id);
      const tr = this.trials.filter((r) => r.flyId === f.id);
      const examAcc = accOf(ex);
      const classAcc = tr.length ? tr.filter((r) => r.outcome === "correct").length / tr.length : null;
      const firstDayAcc = days.length ? accOf(ex.filter((r) => r.day === days[0])) : null;
      const lastDayAcc = days.length ? accOf(ex.filter((r) => r.day === days[days.length - 1])) : null;
      const answered = ex.filter((r) => r.answer >= 0);
      const meanDecisionTime = mean(answered.map((r) => r.decisionTime));
      const omissionRate = ex.length ? ex.filter((r) => r.answer < 0).length / ex.length : tr.length ? tr.filter((r) => r.outcome === "omission").length / tr.length : 0;
      const attention = f.classTicks ? f.attendTicks / f.classTicks : 1;
      const distraction = Math.min(1, 0.6 * (1 - attention) + 0.4 * omissionRate);
      const chance = 0.2;
      const acc = examAcc ?? classAcc;
      const resistance = acc === null ? 0 : Math.max(0, Math.min(1, 1 - (acc - chance) / (1 - chance)));

      let profile: StudentProfile = "Sem dados";
      let diagnosis = "Ainda não participou de ensaios suficientes.";
      const nData = ex.length + tr.length;
      if (nData >= 8 && acc !== null) {
        if (distraction > 0.25) {
          profile = "Distraída";
          diagnosis = `Atenção à lousa em ${(attention * 100).toFixed(0)}% do tempo de aula; estados homeostáticos (fome ${(f.homeo.hunger * 100).toFixed(0)}%) competem com o circuito atencional do Complexo Central.`;
        } else if (acc >= 0.6 && (meanDecisionTime ?? 99) < 3.7) {
          profile = "Rápida e precisa";
          diagnosis = `Associação KC→MBON bem consolidada; decide em ${meanDecisionTime?.toFixed(1)}s com ${(acc * 100).toFixed(0)}% de acerto.`;
        } else if (acc >= 0.5) {
          profile = "Aprendiz consistente";
          diagnosis = `Desempenho acima do acaso (${(acc * 100).toFixed(0)}%). Plasticidade dopaminérgica efetiva.`;
        } else if ((meanDecisionTime ?? 99) < 3.5 && acc < 0.35) {
          profile = "Impulsiva";
          diagnosis = "Compromete-se cedo com uma placa antes de a evidência dos MBONs se diferenciar; alta exploração.";
        } else if (resistance > 0.8 && days.length >= 2) {
          profile = "Resistente ao condicionamento";
          diagnosis = `Acerto próximo do acaso (${(acc * 100).toFixed(0)}%) após ${days.length} dias; baixo ganho sináptico (η × ${f.personality.plasticity.toFixed(2)}).`;
        } else {
          profile = "Em desenvolvimento";
          diagnosis = `Acerto de ${(acc * 100).toFixed(0)}%; memória de curto prazo ainda em consolidação.`;
        }
      }
      return {
        id: f.id,
        name: f.name,
        examAcc,
        classAcc,
        firstDayAcc,
        lastDayAcc,
        meanDecisionTime,
        distraction,
        omissionRate,
        resistance,
        plasticity: f.personality.plasticity,
        appetite: f.personality.appetite,
        profile,
        diagnosis,
      };
    });
  }

  /** Correlação fome/fadiga × acerto nas provas (point-biserial) e acurácia por faixas. */
  correlation() {
    const ex = this.exams;
    const y = ex.map((r) => (r.correct ? 1 : 0));
    const bins = [0, 0.25, 0.5, 0.75, 1.0001];
    const binned = (key: "hunger" | "fatigue") =>
      bins.slice(0, -1).map((lo, i) => {
        const hi = bins[i + 1];
        const sel = ex.filter((r) => r[key] >= lo && r[key] < hi);
        return { bin: `${Math.round(lo * 100)}–${Math.round(Math.min(1, hi) * 100)}%`, acc: accOf(sel), n: sel.length };
      });
    return {
      rHunger: pearson(ex.map((r) => r.hunger), y),
      rFatigue: pearson(ex.map((r) => r.fatigue), y),
      hungerBins: binned("hunger"),
      fatigueBins: binned("fatigue"),
      n: ex.length,
    };
  }

  /** Eficácia por estratégia: acerto em aula e acerto na prova da matéria nos dias em que foi usada. */
  strategyEfficacy(names: Map<string, string>) {
    const ids = [...new Set(this.trials.map((t) => t.strategyId))];
    return ids.map((id) => {
      const tr = this.trials.filter((t) => t.strategyId === id);
      const subject = tr[0]?.subject;
      const days = new Set(tr.map((t) => t.day));
      const ex = this.exams.filter((e) => e.subject === subject && days.has(e.day));
      return {
        id,
        name: names.get(id) ?? id,
        subject,
        classAcc: tr.length ? tr.filter((t) => t.outcome === "correct").length / tr.length : 0,
        examAcc: accOf(ex) ?? 0,
        trials: tr.length,
      };
    });
  }

  reset() {
    this.trials = [];
    this.exams = [];
    this.presentations = [];
    this.days = [];
    this.attention.clear();
  }
}
