/**
 * Banco de problemas e estratégias pedagógicas pré-configuradas.
 *
 * Nota científica: moscas não fazem aritmética simbólica. O que o circuito aprende é a
 * associação "padrão visual projetado na lousa -> placa de resposta recompensada", do mesmo
 * modo que Drosophila aprende associações cor/odor -> valência nos Mushroom Bodies.
 * Os rótulos humanos ("2 + 3 = ?") servem para o professor/pesquisador.
 */
import type { Problem, TeachingStrategy } from "./types";
import { hashString, RNG } from "./rng";
import { N_VIS } from "./FlyConnectome";

const math = (id: string, a: number, b: number, op: "+" | "-", options: number[], correct: number): Problem => ({
  id,
  subject: "math",
  prompt: `${a} ${op} ${b} = ?`,
  visual: { kind: "dots", a, b, op },
  options: options.map(String) as Problem["options"],
  correct,
});

const lang = (id: string, prompt: string, glyph: string, options: string[], correct: number, hint?: string): Problem => ({
  id,
  subject: "language",
  prompt,
  visual: { kind: "glyph", text: glyph, hint },
  options: options as Problem["options"],
  correct,
});

export const BASE_PROBLEMS: Problem[] = [
  math("m-2+3", 2, 3, "+", [4, 6, 3, 7, 5], 4),
  math("m-3+1", 3, 1, "+", [4, 2, 5, 3, 6], 0),
  math("m-1+1", 1, 1, "+", [3, 2, 1, 4, 5], 1),
  math("m-4-2", 4, 2, "-", [1, 3, 2, 6, 0], 2),
  math("m-2+2", 2, 2, "+", [5, 3, 6, 4, 2], 3),
  lang("l-bola", "Letra inicial do som /bó/?", "BOLA", ["D", "P", "B", "L", "T"], 2, "⚽"),
  lang("l-casa", "Letra inicial do som /ká/?", "CASA", ["C", "S", "K", "Q", "G"], 0, "🏠"),
  lang("l-uva", "Vogal do som /u/?", "UVA", ["A", "E", "I", "O", "U"], 4, "🍇"),
  lang("l-mala", "Letra inicial do som /mã/?", "MALA", ["N", "M", "W", "L", "A"], 1, "🧳"),
  lang("l-sapo", "Sílaba inicial de SAPO?", "SAPO", ["PO", "ZA", "CA", "SA", "SO"], 3, "🐸"),
];

export const PRESET_STRATEGIES: TeachingStrategy[] = [
  {
    id: "math-sugar",
    name: "Matemática · Condicionamento Apetitivo",
    subject: "math",
    description:
      "Padrão de pontos na lousa; o professor deposita glicose na placa da resposta correta. Reforço positivo puro (circuito PAM).",
    problemIds: BASE_PROBLEMS.filter((p) => p.subject === "math").map((p) => p.id),
    reinforcement: "positive",
    sugarReward: true,
    airPuff: false,
    strobeDistracted: false,
    pheromoneTrail: false,
    interTrialInterval: 2,
    responseTolerance: 6.5,
    rewardMagnitude: 1,
  },
  {
    id: "math-scaffold",
    name: "Matemática · Andaime com Feromônio",
    subject: "math",
    description:
      "Trilha de feromônio no chão guia até a placa correta (scaffolding); glicose como recompensa. Acelera as primeiras associações.",
    problemIds: BASE_PROBLEMS.filter((p) => p.subject === "math").map((p) => p.id),
    reinforcement: "positive",
    sugarReward: true,
    airPuff: false,
    strobeDistracted: false,
    pheromoneTrail: true,
    interTrialInterval: 2,
    responseTolerance: 6.5,
    rewardMagnitude: 1,
  },
  {
    id: "lang-symbolic",
    name: "Linguagem · Associação Simbólica",
    subject: "language",
    description:
      "Glifos de letras/palavras na lousa; glicose na zona correta e estroboscópio frio para reengajar moscas distraídas.",
    problemIds: BASE_PROBLEMS.filter((p) => p.subject === "language").map((p) => p.id),
    reinforcement: "positive",
    sugarReward: true,
    airPuff: false,
    strobeDistracted: true,
    pheromoneTrail: false,
    interTrialInterval: 2,
    responseTolerance: 6.5,
    rewardMagnitude: 1,
  },
  {
    id: "lang-mixed",
    name: "Linguagem · Recompensa + Punição Leve",
    subject: "language",
    description:
      "Glicose no acerto (PAM) e rajada de ar no erro (PPL1). Condicionamento bidirecional: potencia o certo e deprime o errado.",
    problemIds: BASE_PROBLEMS.filter((p) => p.subject === "language").map((p) => p.id),
    reinforcement: "mixed",
    sugarReward: true,
    airPuff: true,
    strobeDistracted: false,
    pheromoneTrail: false,
    interTrialInterval: 2,
    responseTolerance: 6.5,
    rewardMagnitude: 1,
  },
  {
    id: "math-aversive",
    name: "Matemática · Somente Aversivo",
    subject: "math",
    description: "Sem glicose. Apenas rajada de ar nas respostas erradas. Útil como grupo de comparação (aprendizagem por evitação).",
    problemIds: BASE_PROBLEMS.filter((p) => p.subject === "math").map((p) => p.id),
    reinforcement: "negative",
    sugarReward: false,
    airPuff: true,
    strobeDistracted: false,
    pheromoneTrail: false,
    interTrialInterval: 2,
    responseTolerance: 6.5,
    rewardMagnitude: 1,
  },
];

/**
 * Código visual do estímulo: 4 de 16 colunas visuais ativas, derivado do padrão da lousa.
 * Padrões diferentes compartilham colunas parcialmente → interferência realista entre memórias.
 */

const codeCache = new Map<string, Uint8Array>();
export function visualCode(problem: Problem): Uint8Array {
  const key = problem.id + "|" + JSON.stringify(problem.visual);
  let c = codeCache.get(key);
  if (c) return c;
  const rng = new RNG(hashString(key));
  c = new Uint8Array(N_VIS);
  let on = 0;
  while (on < 4) {
    const k = rng.int(N_VIS);
    if (!c[k]) {
      c[k] = 1;
      on++;
    }
  }
  codeCache.set(key, c);
  return c;
}
