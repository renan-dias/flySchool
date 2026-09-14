/**
 * Tipos compartilhados entre o motor de simulação (core) e a camada visual (UI/3D).
 * O core é 100% independente de React/Three para poder rodar headless (testes/benchmarks).
 */

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };

export type Subject = "math" | "language";
export type Role = "student" | "teacher";

/** Contexto escolar percebido pela mosca (via campainha / sinais ambientais). */
export type SchoolContext = "entry" | "class" | "recess" | "exam" | "dismissal";

/** Programas motores de alto nível selecionados pelos neurônios de ação (winner-take-all). */
export type ActionMode = "attend" | "forage" | "drink" | "rest" | "relief" | "social";

export const PLATE_LETTERS = ["A", "B", "C", "D", "E"] as const;

/** Problema didático: um estímulo visual projetado na lousa e 5 alternativas (placas no chão). */
export interface Problem {
  id: string;
  subject: Subject;
  /** Texto curto exibido na lousa (ex.: "2 + 3 = ?"). */
  prompt: string;
  /** Representação visual (pontos para matemática, glifos para linguagem). */
  visual: BoardVisual;
  options: [string, string, string, string, string];
  correct: number; // 0..4
  custom?: boolean;
}

export type BoardVisual =
  | { kind: "dots"; a: number; b: number; op: "+" | "-" }
  | { kind: "glyph"; text: string; hint?: string }
  | { kind: "text"; text: string };

export type Reinforcement = "positive" | "negative" | "mixed";

/** Estratégia pedagógica que o professor executa durante uma aula. */
export interface TeachingStrategy {
  id: string;
  name: string;
  subject: Subject;
  description: string;
  problemIds: string[];
  reinforcement: Reinforcement;
  /** Gota de glicose na placa correta (reforço positivo). */
  sugarReward: boolean;
  /** Rajada de ar em quem pousa na placa errada (reforço negativo leve). */
  airPuff: boolean;
  /** Luz estroboscópica fria para dispersar distrações (moscas fora de atenção). */
  strobeDistracted: boolean;
  /** Trilha de feromônio guiando até a placa correta (andaime / scaffolding). */
  pheromoneTrail: boolean;
  /** Intervalo entre estímulos (s de tempo neural). */
  interTrialInterval: number;
  /** Tempo de tolerância para resposta (s). */
  responseTolerance: number;
  /** Multiplicador da quantidade de glicose/intensidade do reforço. */
  rewardMagnitude: number;
  custom?: boolean;
}

export type TrialOutcome = "correct" | "incorrect" | "omission";

export interface TrialRecord {
  day: number;
  subject: Subject;
  strategyId: string;
  problemId: string;
  flyId: string;
  outcome: TrialOutcome;
  decisionTime: number;
  hunger: number;
  fatigue: number;
}

export interface ExamRecord {
  day: number;
  questionIndex: number;
  problemId: string;
  subject: Subject;
  flyId: string;
  answer: number; // -1 = sem resposta
  correct: boolean;
  decisionTime: number; // s (limite = tolerância)
  path: Vec2[];
  hunger: number;
  fatigue: number;
  thirst: number;
}

export interface SimEvent {
  id: number;
  day: number;
  clock: string;
  kind: "bell" | "crisis" | "exam" | "teach" | "info";
  text: string;
}

export type CrisisKind =
  | "famine"
  | "heatwave"
  | "insomnia"
  | "diuretic"
  | "blackout"
  | "pheromoneStorm"
  | "sugarRush";
