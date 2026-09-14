/**
 * FlyConnectome — motor de Rede Neural de Espículas (SNN) discretizada.
 *
 * Modelo: Leaky Integrate-and-Fire (LIF) com correntes sinápticas exponenciais,
 * integrado por Euler com dt fixo (5 ms). O grafo G = (V, E, W) é um conectoma
 * reduzido inspirado nas classes celulares mapeadas no FlyWire:
 *
 *   Sensoriais ─► Kenyon Cells (Mushroom Body, código esparso + APL) ─► MBONs (placas A–E)
 *        │                                     ▲ plasticidade DA-STDP  │
 *        │                     PAM (recompensa) / PPL1 (aversão) ──────┘
 *   Estados internos (fome, sede, fadiga, bexiga) ─► Neurônios de ação (winner-take-all)
 *   Complexo Central (atenção, navegação L/R)       ─► Descendentes motores DNg
 *
 * Aprendizado (sinapses KC→MBON):
 *   e_ij  ← traço de elegibilidade STDP competitivo (LTP em pós-disparo; LTD em pré-disparo
 *           proporcional à atividade média dos MBONs → crédito só para a escolha dominante)
 *   ΔW_ij = η · (Ativação PAM − Ativação PPL1) · e_ij
 *   W = W_curto (STM, decai e consolida) + W_longo (LTM)
 */
import { RNG } from "./rng";

export type NeuronGroup =
  | "visual"
  | "chemo"
  | "mechano"
  | "state"
  | "context"
  | "cx"
  | "kc"
  | "apl"
  | "mbon"
  | "pam"
  | "ppl1"
  | "action"
  | "motor";

export interface NeuronMeta {
  index: number;
  id: string;
  label: string;
  group: NeuronGroup;
  description: string;
}

export interface EdgeMeta {
  from: number;
  to: number;
  /** Índice CSR (fixa) ou -1 se plástica. */
  csr: number;
  /** Índice na matriz KC×MBON quando plástica, senão -1. */
  plastic: number;
}

// ───────────────────────────── Layout de índices ─────────────────────────────
export const N_VIS = 16;
export const N_KC = 40;
export const N_MBON = 5;

let _i = 0;
const alloc = (n = 1) => {
  const s = _i;
  _i += n;
  return s;
};
export const IDX = {
  VIS: alloc(N_VIS),
  SUGAR: alloc(),
  WATER: alloc(),
  PHERO: alloc(),
  GR28B: alloc(),
  LUM: alloc(),
  AIR: alloc(),
  HUNGER: alloc(),
  THIRST: alloc(),
  FATIGUE: alloc(),
  BLADDER: alloc(),
  CTX_CLASS: alloc(),
  CTX_RECESS: alloc(),
  CTX_EXAM: alloc(),
  CX_ATT: alloc(),
  CX_GOAL: alloc(),
  CX_NAV_L: alloc(),
  CX_NAV_R: alloc(),
  KC: alloc(N_KC),
  APL: alloc(),
  MBON: alloc(N_MBON),
  PAM: alloc(2),
  PPL1: alloc(2),
  ACT: alloc(6), // attend, forage, drink, rest, relief, social
  DN_WALK: alloc(),
  DN_TURN_L: alloc(),
  DN_TURN_R: alloc(),
  DN_FLIGHT: alloc(),
  DN_LAND: alloc(),
  DN_PROBOSCIS: alloc(),
  DN_HOLD: alloc(),
} as const;
export const N_NEURONS = _i;

export const ACTION_NAMES = ["attend", "forage", "drink", "rest", "relief", "social"] as const;

// ───────────────────────────── Constantes biofísicas ─────────────────────────
export const DT = 0.005; // 5 ms
const TAU_SYN = 0.01;
const REFRACTORY_STEPS = 1;
const TAU_TRACE = 0.02; // janela STDP
const TAU_ELIG = 1.4; // traço de elegibilidade (s)
const A_PLUS = 1.0;
const A_MINUS = 1.0;
const ETA = 0.004;
const W_MAX = 1.6;
const W_INIT = 0.34;
const TAU_STM = 420; // decaimento da memória de curto prazo (s)
const TAU_CONSOLIDATION = 300; // transferência STM → LTM (s)

const LTM_MIN = 0.02;

/** Traços individuais da mosca (diferenças inter-individuais). */
export interface Personality {
  appetite: number; // multiplicador da taxa de fome
  focus: number; // viés tônico de atenção
  curiosity: number; // exploração / ruído de decisão
  stamina: number; // resistência à fadiga
  sociability: number;
  plasticity: number; // multiplicador de η (aprendizes rápidos vs. resistentes)
}

export class FlyConnectome {
  readonly meta: NeuronMeta[] = [];
  readonly edges: EdgeMeta[] = [];

  // Estado neuronal
  readonly v = new Float32Array(N_NEURONS);
  readonly iSyn = new Float32Array(N_NEURONS);
  readonly iExt = new Float32Array(N_NEURONS);
  readonly bias = new Float32Array(N_NEURONS);
  readonly tau = new Float32Array(N_NEURONS);
  readonly noise = new Float32Array(N_NEURONS);
  readonly tauRate = new Float32Array(N_NEURONS);
  readonly rate = new Float32Array(N_NEURONS); // Hz filtrado
  readonly refractory = new Uint8Array(N_NEURONS);
  readonly spiked = new Uint8Array(N_NEURONS);
  /** Passo do último disparo (para visualização de sinapses "acendendo"). */
  readonly lastSpike = new Float64Array(N_NEURONS).fill(-1e9);

  // Sinapses fixas (CSR)
  private outStart = new Int32Array(N_NEURONS + 1);
  private outTarget!: Int32Array;
  readonly outWeight!: Float32Array;

  // Sinapses plásticas KC→MBON
  readonly wShort = new Float32Array(N_KC * N_MBON);
  readonly wLong = new Float32Array(N_KC * N_MBON);
  readonly elig = new Float32Array(N_KC * N_MBON);
  private kcTrace = new Float32Array(N_KC);
  private mbonTrace = new Float32Array(N_MBON);

  /** Dopamina líquida normalizada (PAM − PPL1). */
  dopamine = 0;
  /** Magnitude média de |ΔW| por segundo (indicador de "taxa de aprendizado"). */
  plasticityRate = 0;
  stepCount = 0;
  personality: Personality;

  /** Raster opcional (liga só para a mosca selecionada). */
  recordRaster = false;
  static readonly RASTER_BINS = 120;
  readonly raster = new Uint8Array(N_NEURONS * FlyConnectome.RASTER_BINS);
  rasterHead = 0;

  private seed: number;
  private noiseState: number;

  constructor(seed: number, personality: Personality) {
    this.seed = seed;
    this.noiseState = (seed * 2654435761) >>> 0 || 1;
    this.personality = personality;
    const rng = new RNG(seed);
    this.buildMeta();
    const fixed = this.buildTopology(rng);
    // Monta CSR
    fixed.sort((a, b) => a[0] - b[0]);
    this.outTarget = new Int32Array(fixed.length);
    (this as { outWeight: Float32Array }).outWeight = new Float32Array(fixed.length);
    let k = 0;
    for (let n = 0; n < N_NEURONS; n++) {
      this.outStart[n] = k;
      while (k < fixed.length && fixed[k][0] === n) {
        this.outTarget[k] = fixed[k][1];
        this.outWeight[k] = fixed[k][2];
        this.edges.push({ from: n, to: fixed[k][1], csr: k, plastic: -1 });
        k++;
      }
    }
    this.outStart[N_NEURONS] = k;
    for (let i = 0; i < N_KC; i++)
      for (let j = 0; j < N_MBON; j++) {
        this.wLong[i * N_MBON + j] = Math.max(LTM_MIN, W_INIT + rng.gauss() * 0.07);
        this.edges.push({ from: IDX.KC + i, to: IDX.MBON + j, csr: -1, plastic: i * N_MBON + j });
      }
  }

  // ─────────────────────────── Construção do grafo ───────────────────────────
  private buildMeta() {
    const add = (index: number, id: string, label: string, group: NeuronGroup, description: string) =>
      (this.meta[index] = { index, id, label, group, description });
    for (let i = 0; i < N_VIS; i++)
      add(IDX.VIS + i, `VIS${i}`, `Lobula col.${i}`, "visual", "Coluna visual (medula/lóbula) que codifica luminância da lousa");
    add(IDX.SUGAR, "Gr5a", "Gr5a · Açúcar", "chemo", "Receptor gustativo de açúcar (tarso/probóscide)");
    add(IDX.WATER, "ppk28", "ppk28 · Água", "chemo", "Receptor osmótico de água");
    add(IDX.PHERO, "Or67d", "Or67d · Feromônio", "chemo", "Receptor olfativo de feromônio (cVA / trilha)");
    add(IDX.GR28B, "Gr28b", "Gr28b · Térmico", "mechano", "Receptor térmico/estresse nocivo");
    add(IDX.LUM, "R7/R8", "R7/R8 · Estrobo", "visual", "Fotorreceptores sensíveis a flashes estroboscópicos");
    add(IDX.AIR, "JO-CE", "Johnston · Ar", "mechano", "Órgão de Johnston: rajada de ar (mecanossensação)");
    add(IDX.HUNGER, "AgRP-like", "Fome", "state", "Estado interno: fome (sinal de glicose hemolinfática baixa)");
    add(IDX.THIRST, "ISN", "Sede", "state", "Estado interno: sede (neurônios sensores de osmolaridade)");
    add(IDX.FATIGUE, "dFB", "Fadiga", "state", "Estado interno: pressão de sono/fadiga (dFB)");
    add(IDX.BLADDER, "DH44", "Vontade de evacuar", "state", "Estado interno: pressão excretória");
    add(IDX.CTX_CLASS, "CTX-aula", "Contexto: Aula", "context", "Contexto escolar (campainha + sala)");
    add(IDX.CTX_RECESS, "CTX-recreio", "Contexto: Recreio", "context", "Contexto escolar (campainha + pátio)");
    add(IDX.CTX_EXAM, "CTX-prova", "Contexto: Prova", "context", "Contexto escolar (arena de avaliação)");
    add(IDX.CX_ATT, "EPG-att", "CX · Atenção", "cx", "Complexo Central: ganho atencional sobre a lousa");
    add(IDX.CX_GOAL, "FB-goal", "CX · Meta", "cx", "Fan-shaped body: meta comportamental ativa");
    add(IDX.CX_NAV_L, "PFL3-L", "CX · Navegação E", "cx", "PFL3 esquerdo: erro de rumo → virar à esquerda");
    add(IDX.CX_NAV_R, "PFL3-R", "CX · Navegação D", "cx", "PFL3 direito: erro de rumo → virar à direita");
    for (let i = 0; i < N_KC; i++) add(IDX.KC + i, `KC${i}`, `Kenyon ${i}`, "kc", "Célula de Kenyon: código esparso do estímulo");
    add(IDX.APL, "APL", "APL", "apl", "Neurônio GABAérgico APL: inibição global (esparsidade)");
    const L = ["A", "B", "C", "D", "E"];
    for (let i = 0; i < N_MBON; i++)
      add(IDX.MBON + i, `MBON-${L[i]}`, `MBON → Placa ${L[i]}`, "mbon", `Neurônio de saída do MB: tendência de escolher a placa ${L[i]}`);
    add(IDX.PAM, "PAM-γ5", "PAM · Recompensa", "pam", "Dopaminérgico PAM: recompensa/prazer (acerto)");
    add(IDX.PAM + 1, "PAM-β'2", "PAM · Recompensa 2", "pam", "Dopaminérgico PAM: recompensa nutritiva");
    add(IDX.PPL1, "PPL1-γ1", "PPL1 · Aversão", "ppl1", "Dopaminérgico PPL1: punição/frustração (erro)");
    add(IDX.PPL1 + 1, "PPL1-α3", "PPL1 · Aversão 2", "ppl1", "Dopaminérgico PPL1: aversão térmica");
    const acts = ["Atenção à lousa", "Forrageio", "Beber", "Repouso", "Alívio", "Social"];
    ACTION_NAMES.forEach((a, i) => add(IDX.ACT + i, `ACT-${a}`, `Ação · ${acts[i]}`, "action", `Seletor de programa motor: ${acts[i]}`));
    add(IDX.DN_WALK, "DNg-walk", "DNg · Caminhar", "motor", "Descendente motor: velocidade de marcha (x, y)");
    add(IDX.DN_TURN_L, "DNa02-L", "DNa02 · Girar E", "motor", "Descendente motor: giro à esquerda");
    add(IDX.DN_TURN_R, "DNa02-R", "DNa02 · Girar D", "motor", "Descendente motor: giro à direita");
    add(IDX.DN_FLIGHT, "DNp01", "Giant Fiber · Voo", "motor", "Descendente motor: decolagem/voo curto");
    add(IDX.DN_LAND, "DNp-land", "DN · Pousar", "motor", "Descendente motor: extensão de pernas/pouso");
    add(IDX.DN_PROBOSCIS, "DNg12", "DNg12 · Probóscide", "motor", "Descendente motor: extensão da probóscide (alimentação)");
    add(IDX.DN_HOLD, "DNg-hold", "DNg · Permanecer", "motor", "Descendente motor: parar e permanecer sobre a placa");
  }

  /** Retorna [pré, pós, peso] das sinapses fixas e ajusta parâmetros intrínsecos. */
  private buildTopology(rng: RNG): [number, number, number][] {
    const E: [number, number, number][] = [];
    const syn = (a: number, b: number, w: number) => E.push([a, b, w]);
    const p = this.personality;

    // Parâmetros intrínsecos padrão
    for (let n = 0; n < N_NEURONS; n++) {
      this.tau[n] = 0.02;
      this.noise[n] = 0.18;
      this.tauRate[n] = 0.15;
    }
    for (let i = 0; i < N_VIS; i++) this.bias[IDX.VIS + i] = 0.15;
    for (let i = 0; i < N_KC; i++) {
      this.bias[IDX.KC + i] = 0.12;
      this.noise[IDX.KC + i] = 0.12;
    }
    for (let i = 0; i < N_MBON; i++) {
      this.bias[IDX.MBON + i] = 0.3;
      this.noise[IDX.MBON + i] = 0.35 + 0.25 * p.curiosity;
    }
    this.bias[IDX.PAM] = this.bias[IDX.PAM + 1] = 0.7;
    this.bias[IDX.PPL1] = this.bias[IDX.PPL1 + 1] = 0.7;
    this.bias[IDX.CX_ATT] = 0.72 + 0.25 * (p.focus - 1);
    for (let a = 0; a < 6; a++) this.bias[IDX.ACT + a] = 0.6;
    this.bias[IDX.ACT + 5] = 0.55 + 0.15 * (p.sociability - 1);
    for (const m of [IDX.DN_WALK, IDX.DN_TURN_L, IDX.DN_TURN_R, IDX.DN_FLIGHT, IDX.DN_LAND, IDX.DN_HOLD, IDX.DN_PROBOSCIS]) {
      this.tauRate[m] = 0.08;
      this.noise[m] = 0.12;
    }
    this.bias[IDX.DN_PROBOSCIS] = 0.25;

    // Visual → KC (cada KC amostra 3 colunas visuais: expansão combinatória)
    for (let k = 0; k < N_KC; k++) {
      const chosen = new Set<number>();
      while (chosen.size < 3) chosen.add(rng.int(N_VIS));
      for (const c of chosen) syn(IDX.VIS + c, IDX.KC + k, 1.1 + rng.gauss() * 0.06);
      syn(IDX.KC + k, IDX.APL, 0.3);
      syn(IDX.APL, IDX.KC + k, -2.4);
    }
    // Atenção (CX) → colunas visuais (modulação de ganho — representada no grafo)
    for (let i = 0; i < N_VIS; i++) syn(IDX.CX_ATT, IDX.VIS + i, 0.12);

    // Inibição lateral entre MBONs (competição de escolha) e MBON → CX meta
    for (let a = 0; a < N_MBON; a++) {
      for (let b = 0; b < N_MBON; b++) if (a !== b) syn(IDX.MBON + a, IDX.MBON + b, -0.28);
      syn(IDX.MBON + a, IDX.CX_GOAL, 0.35);
      syn(IDX.MBON + a, IDX.PAM + 1, 0.05); // laço recorrente MBON→DAN
    }

    // Sensores → dopaminérgicos
    for (let d = 0; d < 2; d++) {
      syn(IDX.SUGAR, IDX.PAM + d, 2.5);
      syn(IDX.WATER, IDX.PAM + d, 0.4);
      syn(IDX.HUNGER, IDX.PAM + d, 0.35); // fome aumenta a sensibilidade à recompensa
      syn(IDX.AIR, IDX.PPL1 + d, 2.5);
      syn(IDX.GR28B, IDX.PPL1 + d, 1.1);
      syn(IDX.LUM, IDX.PPL1 + d, 0.6);
    }
    syn(IDX.PAM, IDX.PPL1, -0.4);
    syn(IDX.PPL1, IDX.PAM, -0.4);

    // Estados internos / contexto → atenção
    syn(IDX.CTX_CLASS, IDX.CX_ATT, 1.0);
    syn(IDX.CTX_EXAM, IDX.CX_ATT, 1.1);
    syn(IDX.HUNGER, IDX.CX_ATT, -0.9);
    syn(IDX.FATIGUE, IDX.CX_ATT, -0.7);
    syn(IDX.BLADDER, IDX.CX_ATT, -0.7);
    syn(IDX.GR28B, IDX.CX_ATT, -0.8);
    syn(IDX.AIR, IDX.CX_ATT, 1.2);
    syn(IDX.LUM, IDX.CX_ATT, 0.9);

    // Seleção de ação (winner-take-all)
    const [ATT, FOR, DRI, RES, REL, SOC] = [0, 1, 2, 3, 4, 5].map((a) => IDX.ACT + a);
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) if (a !== b) syn(IDX.ACT + a, IDX.ACT + b, -0.6);
    syn(IDX.CTX_CLASS, ATT, 1.4);
    syn(IDX.CTX_EXAM, ATT, 1.6);
    syn(IDX.CX_ATT, ATT, 0.8);
    syn(IDX.HUNGER, ATT, -1.0);
    syn(IDX.FATIGUE, ATT, -0.9);
    syn(IDX.BLADDER, ATT, -1.2);
    syn(IDX.THIRST, ATT, -0.6);
    syn(IDX.HUNGER, FOR, 1.6);
    syn(IDX.SUGAR, FOR, 0.8);
    syn(IDX.CTX_RECESS, FOR, 0.35);
    syn(IDX.THIRST, DRI, 1.6);
    syn(IDX.WATER, DRI, 0.7);
    syn(IDX.CTX_RECESS, DRI, 0.35);
    syn(IDX.FATIGUE, RES, 1.6);
    syn(IDX.GR28B, RES, 0.8);
    syn(IDX.CTX_RECESS, RES, 0.2);
    syn(IDX.BLADDER, REL, 1.9);
    syn(IDX.PHERO, SOC, 0.5);
    syn(IDX.CTX_RECESS, SOC, 1.5);
    syn(IDX.CTX_CLASS, SOC, -1.2);
    syn(IDX.CTX_EXAM, SOC, -1.2);
    for (const inhib of [IDX.AIR, IDX.LUM]) {
      syn(inhib, FOR, -1.5);
      syn(inhib, SOC, -1.5);
    }

    // Navegação (Complexo Central) → descendentes motores
    syn(IDX.CX_NAV_L, IDX.CX_NAV_R, -0.8);
    syn(IDX.CX_NAV_R, IDX.CX_NAV_L, -0.8);
    syn(IDX.CX_NAV_L, IDX.DN_TURN_L, 2.2);
    syn(IDX.CX_NAV_R, IDX.DN_TURN_R, 2.2);
    syn(IDX.CX_GOAL, IDX.DN_HOLD, 0.4);
    for (let a = 0; a < 6; a++) syn(IDX.ACT + a, IDX.DN_WALK, 0.45);
    syn(IDX.DN_HOLD, IDX.DN_WALK, -1.6);
    syn(IDX.DN_PROBOSCIS, IDX.DN_WALK, -1.6);
    syn(IDX.DN_LAND, IDX.DN_FLIGHT, -2.0);
    syn(IDX.SUGAR, IDX.DN_PROBOSCIS, 1.7);
    syn(IDX.WATER, IDX.DN_PROBOSCIS, 1.7);
    syn(IDX.HUNGER, IDX.DN_PROBOSCIS, 0.5);
    syn(IDX.THIRST, IDX.DN_PROBOSCIS, 0.5);
    syn(IDX.AIR, IDX.DN_FLIGHT, 0.9); // reflexo de fuga
    return E;
  }

  // ─────────────────────────── Integração temporal ───────────────────────────
  private rand(): number {
    // xorshift32 — rápido para ruído de membrana
    let x = this.noiseState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.noiseState = x >>> 0;
    return this.noiseState / 4294967296;
  }

  /** Avança a rede `steps` passos de DT. `learning` desliga plasticidade (ex.: professor). */
  step(steps: number, learning = true) {
    const decaySyn = Math.exp(-DT / TAU_SYN);
    const decayTrace = Math.exp(-DT / TAU_TRACE);
    const decayElig = Math.exp(-DT / TAU_ELIG);
    const decaySTM = Math.exp(-DT / TAU_STM);
    const consol = DT / TAU_CONSOLIDATION;
    const eta = ETA * this.personality.plasticity;
    const invDT = 1 / DT;

    for (let s = 0; s < steps; s++) {
      this.stepCount++;
      const { v, iSyn, iExt, bias, tau, noise, rate, refractory, spiked, tauRate } = this;

      // 1) Membrana LIF
      for (let n = 0; n < N_NEURONS; n++) {
        spiked[n] = 0;
        if (refractory[n] > 0) {
          refractory[n]--;
          v[n] = 0;
        } else {
          const I = iExt[n] + bias[n] + iSyn[n] + (this.rand() - 0.5) * 3.46 * noise[n];
          v[n] += (DT / tau[n]) * (I - v[n]);
          if (v[n] < -1) v[n] = -1;
          if (v[n] >= 1) {
            v[n] = 0;
            spiked[n] = 1;
            refractory[n] = REFRACTORY_STEPS;
            this.lastSpike[n] = this.stepCount;
          }
        }
        iSyn[n] *= decaySyn;
        rate[n] += (spiked[n] * invDT - rate[n]) * (DT / tauRate[n]);
      }

      // 2) Propagação sináptica (fixas)
      for (let n = 0; n < N_NEURONS; n++) {
        if (!spiked[n]) continue;
        for (let k = this.outStart[n]; k < this.outStart[n + 1]; k++) iSyn[this.outTarget[k]] += this.outWeight[k];
      }

      // 3) Sinapses plásticas KC→MBON + STDP
      const kcT = this.kcTrace;
      const mbT = this.mbonTrace;
      for (let i = 0; i < N_KC; i++) kcT[i] *= decayTrace;
      for (let j = 0; j < N_MBON; j++) mbT[j] *= decayTrace;
      let mbMean = 0;
      for (let j = 0; j < N_MBON; j++) mbMean += mbT[j];
      mbMean /= N_MBON;
      for (let i = 0; i < N_KC; i++) {
        if (!spiked[IDX.KC + i]) continue;
        const base = i * N_MBON;
        for (let j = 0; j < N_MBON; j++) {
          iSyn[IDX.MBON + j] += this.wShort[base + j] + this.wLong[base + j];
          this.elig[base + j] -= A_MINUS * mbMean; // pré após pós (média do grupo MBON) → LTD heterossináptica
        }
        kcT[i] += 1;
      }
      for (let j = 0; j < N_MBON; j++) {
        if (!spiked[IDX.MBON + j]) continue;
        for (let i = 0; i < N_KC; i++) this.elig[i * N_MBON + j] += A_PLUS * kcT[i]; // pré antes de pós → LTP
        mbT[j] += 1;
      }

      // 4) Neuromodulação dopaminérgica
      const pam = 0.5 * (rate[IDX.PAM] + rate[IDX.PAM + 1]);
      const ppl = 0.5 * (rate[IDX.PPL1] + rate[IDX.PPL1 + 1]);
      let da = (pam - ppl) / 40;
      this.dopamine = da;
      if (Math.abs(da) < 0.06) da = 0; // zona morta: flutuações basais não escrevem memória

      let dwSum = 0;
      const nSyn = N_KC * N_MBON;
      for (let k = 0; k < nSyn; k++) {
        this.elig[k] *= decayElig;
        if (learning && da !== 0) {
          const dw = eta * da * this.elig[k] * DT;
          this.wShort[k] += dw;
          dwSum += Math.abs(dw);
        }
        // STM decai e parte consolida em LTM
        const ws = this.wShort[k];
        if (ws !== 0) {
          this.wLong[k] += ws * consol;
          this.wShort[k] = ws * decaySTM - ws * consol;
        }
        const total = this.wShort[k] + this.wLong[k];
        if (total > W_MAX) this.wShort[k] -= total - W_MAX;
        else if (total < 0) this.wShort[k] -= total;
        if (this.wLong[k] < LTM_MIN) this.wLong[k] = LTM_MIN;
      }
      this.plasticityRate += (dwSum * invDT - this.plasticityRate) * 0.002;

      // 5) Escalonamento sináptico homeostático (a cada 1 s)
      if (this.stepCount % 200 === 0) this.synapticScaling();

      // 6) Raster
      if (this.recordRaster) {
        const base = this.rasterHead * N_NEURONS;
        for (let n = 0; n < N_NEURONS; n++) if (spiked[n]) this.raster[base + n] = 1;
        if (this.stepCount % 4 === 0) {
          this.rasterHead = (this.rasterHead + 1) % FlyConnectome.RASTER_BINS;
          this.raster.fill(0, this.rasterHead * N_NEURONS, this.rasterHead * N_NEURONS + N_NEURONS);
        }
      }
    }
  }

  /** Mantém a soma de pesos de entrada de cada MBON próxima do alvo (preserva o padrão relativo). */
  private synapticScaling() {
    const target = N_KC * W_INIT;
    for (let j = 0; j < N_MBON; j++) {
      let sum = 0;
      for (let i = 0; i < N_KC; i++) sum += this.wShort[i * N_MBON + j] + this.wLong[i * N_MBON + j];
      if (sum <= 0) continue;
      const f = 1 + (target / sum - 1) * 0.03;
      for (let i = 0; i < N_KC; i++) {
        this.wShort[i * N_MBON + j] *= f;
        this.wLong[i * N_MBON + j] = Math.max(LTM_MIN, this.wLong[i * N_MBON + j] * f);
      }
    }
  }

  /** Consolidação noturna (sono): grande parte da STM migra para LTM. */
  consolidateOvernight() {
    for (let k = 0; k < N_KC * N_MBON; k++) {
      this.wLong[k] = Math.min(W_MAX, Math.max(LTM_MIN, this.wLong[k] + this.wShort[k] * 0.65));
      this.wShort[k] = 0;
      this.elig[k] = 0;
    }
  }

  // ─────────────────────────── Interface de E/S ──────────────────────────────
  clearInputs() {
    this.iExt.fill(0);
  }

  setInput(index: number, current: number) {
    this.iExt[index] = current;
  }

  addInput(index: number, current: number) {
    this.iExt[index] += current;
  }

  /** Peso efetivo de uma aresta para visualização. */
  edgeWeight(e: EdgeMeta): number {
    if (e.plastic >= 0) return this.wShort[e.plastic] + this.wLong[e.plastic];
    return this.outWeight[e.csr];
  }

  mbonRates(out: Float32Array = new Float32Array(N_MBON)): Float32Array {
    for (let j = 0; j < N_MBON; j++) out[j] = this.rate[IDX.MBON + j];
    return out;
  }

  /** Força média das sinapses KC→MBON por placa (para o heatmap). */
  weightMatrix(): number[][] {
    const m: number[][] = [];
    for (let i = 0; i < N_KC; i++) {
      const row: number[] = [];
      for (let j = 0; j < N_MBON; j++) row.push(this.wShort[i * N_MBON + j] + this.wLong[i * N_MBON + j]);
      m.push(row);
    }
    return m;
  }

  get seedValue() {
    return this.seed;
  }
}
