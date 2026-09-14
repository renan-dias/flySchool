/**
 * SimulationEngine — orquestra mundo, agentes, diretor escolar, provas e métricas.
 * Passo fixo de 20 ms (4 subpassos neurais de 5 ms por agente).
 */
import { Analytics } from "./Analytics";
import { BASE_PROBLEMS, PRESET_STRATEGIES } from "./Curriculum";
import { ExamSystem } from "./ExamSystem";
import { FlyAgent, type WorldView } from "./FlyAgent";
import { RNG } from "./rng";
import { CLASSROOM } from "./SchoolLayout";
import { SchoolDirector } from "./SchoolDirector";
import type { CrisisKind, Problem, SimEvent, Subject, TeachingStrategy } from "./types";

export const TICK = 0.02;
export const MAX_POPULATION = 40;

const NICKNAMES = [
  "Rutabaga", "Dunce", "Amnesiac", "Linotte", "Radish", "Latheo", "Volado", "Nalyot", "Orb2", "Fruitless",
  "Cheapdate", "Tipsy", "Timeless", "Period", "Cryptochrome", "Shaker", "Hikaru", "Genki", "Tudor", "Staufen",
  "Pumilio", "Notch", "Wingless", "Hedgehog", "Toll", "Sevenless", "Bride", "Frizzled", "Armadillo", "Dishevelled",
  "Engrailed", "Bicoid", "Nanos", "Oskar", "Vasa", "Piwi", "Aubergine", "Krasavietz", "Doublesex", "Sxl",
];
const COLORS = ["#b45309", "#a16207", "#92400e", "#9a3412", "#854d0e", "#78350f", "#b91c1c", "#a3a3a3"];

export const CRISES: Record<CrisisKind, { label: string; description: string }> = {
  famine: { label: "Fome coletiva", description: "Glicose hemolinfática despenca: fome = 95% em toda a turma." },
  heatwave: { label: "Onda de calor", description: "Ativa Gr28b (60 s): estresse térmico, PPL1 e fadiga." },
  insomnia: { label: "Noite mal dormida", description: "Fadiga = 90%: pressão de sono no dFB." },
  diuretic: { label: "Suco diurético", description: "Bexiga = 90%: fila no banheiro." },
  blackout: { label: "Queda de energia", description: "Lousas apagadas por 30 s." },
  pheromoneStorm: { label: "Tempestade de feromônio", description: "cVA no ar por 30 s: excitação social." },
  sugarRush: { label: "Lanche reforçado", description: "Toda a turma saciada (fome = 0)." },
};

export class SimulationEngine {
  flies: FlyAgent[] = [];
  teacher!: FlyAgent;
  readonly director: SchoolDirector;
  readonly exam: ExamSystem;
  readonly analytics = new Analytics();
  problems = new Map<string, Problem>();
  strategies: TeachingStrategy[] = [];

  time = 0;
  speed = 1;
  paused = false;
  seed: number;

  heatTimer = 0;
  blackoutTimer = 0;
  pheromoneStormTimer = 0;

  events: SimEvent[] = [];
  private eventId = 0;
  private accumulator = 0;
  private nextFlySerial = 1;
  private world: WorldView;

  constructor(seed = 20260914, population = 18) {
    this.seed = seed;
    this.director = new SchoolDirector(this);
    this.exam = new ExamSystem(this);
    for (const p of BASE_PROBLEMS) this.problems.set(p.id, p);
    this.strategies = PRESET_STRATEGIES.map((s) => ({ ...s, problemIds: [...s.problemIds] }));
    this.world = {
      time: 0,
      context: "entry",
      classroomStimulus: null,
      arenaStimulus: null,
      trialActive: false,
      trialRoom: null,
      trialId: -1,
      guidePlate: -1,
      pheromoneTrail: false,
      rewardPlates: [],
      rewardMagnitude: 1,
      heat: 0,
      pheromoneStorm: 0,
      flies: this.flies,
    };
    this.build(population);
  }

  private build(population: number) {
    this.flies.length = 0;
    this.nextFlySerial = 1;
    this.teacher = new FlyAgent({
      id: "PROF-01",
      name: 'Profª "Melanogaster"',
      role: "teacher",
      seed: this.seed + 999,
      seat: CLASSROOM.teacherSpot,
      color: "#374151",
    });
    this.teacher.x = CLASSROOM.teacherSpot.x;
    this.teacher.z = CLASSROOM.teacherSpot.z;
    this.flies.push(this.teacher);
    this.setPopulation(population);
    this.director.reset();
    this.log("info", `🏫 FlySchool iniciada com ${population} alunas e 1 professora.`);
  }

  get students(): FlyAgent[] {
    return this.flies.filter((f) => f.role === "student");
  }

  // ───────────────────────────── Loop ─────────────────────────────
  /** Avança por um intervalo de tempo real (s), respeitando velocidade e pausa. */
  advance(realDt: number) {
    if (this.paused) return;
    this.accumulator += Math.min(realDt, 0.1) * this.speed;
    let guard = 0;
    while (this.accumulator >= TICK && guard++ < 60) {
      this.tick();
      this.accumulator -= TICK;
    }
    if (guard >= 60) this.accumulator = 0; // evita espiral de morte em máquinas lentas
  }

  tick() {
    const dt = TICK;
    this.time += dt;
    this.director.update(dt);
    this.exam.update(dt);
    this.heatTimer = Math.max(0, this.heatTimer - dt);
    this.blackoutTimer = Math.max(0, this.blackoutTimer - dt);
    this.pheromoneStormTimer = Math.max(0, this.pheromoneStormTimer - dt);

    const w = this.world;
    const d = this.director;
    const s = d.currentStrategy;
    const examOn = d.period.context === "exam";
    w.time = this.time;
    w.context = d.period.context;
    w.classroomStimulus = this.blackoutTimer > 0 ? null : d.classroomStimulus;
    w.arenaStimulus = this.blackoutTimer > 0 ? null : this.exam.stimulus;
    w.trialActive = examOn ? this.exam.active : d.trialActive;
    w.trialRoom = examOn ? "arena" : d.period.context === "class" ? "classroom" : null;
    w.trialId = examOn ? this.exam.trialId : d.trialId;
    w.guidePlate = !examOn && d.trialActive && d.currentProblem ? d.currentProblem.correct : -1;
    w.pheromoneTrail = !examOn && !!s?.pheromoneTrail && d.period.context === "class";
    w.rewardPlates = examOn ? [] : d.rewardPlates;
    w.rewardMagnitude = s?.rewardMagnitude ?? 1;
    w.heat = this.heatTimer > 0 ? 1 : 0;
    w.pheromoneStorm = this.pheromoneStormTimer > 0 ? 1 : 0;

    for (const f of this.flies) f.step(dt, w);
  }

  // ───────────────────────────── Controles ─────────────────────────────
  setPopulation(n: number) {
    n = Math.max(1, Math.min(MAX_POPULATION, Math.round(n)));
    const students = this.students;
    if (students.length > n) {
      const remove = new Set(students.slice(n).map((f) => f.id));
      for (let i = this.flies.length - 1; i >= 0; i--) if (remove.has(this.flies[i].id)) this.flies.splice(i, 1);
    } else {
      const rng = new RNG(this.seed + this.nextFlySerial * 31);
      for (let i = students.length; i < n; i++) {
        const serial = this.nextFlySerial++;
        const seatBase = CLASSROOM.desks[(serial - 1) % CLASSROOM.desks.length];
        const slot = Math.floor((serial - 1) / CLASSROOM.desks.length);
        const seat = { x: seatBase.x + (slot % 2 ? 0.8 : -0.8) * (slot ? 1 : 0.4), z: seatBase.z + (slot > 1 ? 0.7 : 0) };
        this.flies.push(
          new FlyAgent({
            id: `DM-${String(serial).padStart(2, "0")}`,
            name: NICKNAMES[(serial - 1) % NICKNAMES.length],
            role: "student",
            seed: this.seed + serial * 1013,
            seat,
            color: COLORS[rng.int(COLORS.length)],
          }),
        );
      }
    }
  }

  injectCrisis(kind: CrisisKind) {
    const st = this.students;
    switch (kind) {
      case "famine":
        st.forEach((f) => (f.homeo.hunger = 0.95));
        break;
      case "sugarRush":
        st.forEach((f) => (f.homeo.hunger = 0));
        break;
      case "insomnia":
        st.forEach((f) => (f.homeo.fatigue = 0.9));
        break;
      case "diuretic":
        st.forEach((f) => (f.homeo.bladder = 0.9));
        break;
      case "heatwave":
        this.heatTimer = 60;
        break;
      case "blackout":
        this.blackoutTimer = 30;
        break;
      case "pheromoneStorm":
        this.pheromoneStormTimer = 30;
        break;
    }
    this.log("crisis", `⚠️ Crise injetada: ${CRISES[kind].label} — ${CRISES[kind].description}`);
  }

  reset(population = this.students.length || 18) {
    this.time = 0;
    this.accumulator = 0;
    this.heatTimer = this.blackoutTimer = this.pheromoneStormTimer = 0;
    this.analytics.reset();
    this.exam.reset();
    this.events = [];
    this.build(population);
  }

  problem(id: string): Problem {
    const p = this.problems.get(id);
    if (!p) throw new Error(`Problema desconhecido: ${id}`);
    return p;
  }

  strategy(id: string): TeachingStrategy {
    return this.strategies.find((s) => s.id === id) ?? this.strategies[0];
  }

  setActiveStrategy(subject: Subject, id: string) {
    this.director.activeStrategy[subject] = id;
    if (this.director.period.subject === subject) {
      this.director.currentStrategy = this.strategy(id);
      this.log("teach", `Professor troca o método para "${this.strategy(id).name}"`);
    }
  }

  addStrategy(strategy: TeachingStrategy, problems: Problem[] = []) {
    for (const p of problems) this.problems.set(p.id, p);
    this.strategies = this.strategies.filter((s) => s.id !== strategy.id);
    this.strategies.push(strategy);
    this.log("teach", `✏️ Novo método pedagógico criado: "${strategy.name}"`);
  }

  log(kind: SimEvent["kind"], text: string) {
    this.events.push({ id: this.eventId++, day: this.director?.day ?? 1, clock: this.director?.clock ?? "07:30", kind, text });
    if (this.events.length > 200) this.events.splice(0, 50);
  }

  flyById(id: string | null): FlyAgent | undefined {
    return id ? this.flies.find((f) => f.id === id) : undefined;
  }
}
