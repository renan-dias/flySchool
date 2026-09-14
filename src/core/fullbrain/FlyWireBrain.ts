/**
 * FlyWireBrain — simulação LIF do cérebro inteiro de Drosophila (FlyWire v783: 138.639 neurônios,
 * 15,1 milhões de conexões com sinal excitatório/inibitório).
 *
 * Modelo e parâmetros idênticos a Shiu et al. (Nature, 2024, "A Drosophila computational brain model
 * reveals sensorimotor processing"):
 *   dv/dt = (v₀ − v + g) / τ_m        v₀ = v_reset = −52 mV, v_th = −45 mV, τ_m = 20 ms
 *   dg/dt = −g / τ_syn                 τ_syn = 5 ms, refratário 2,2 ms, atraso sináptico 1,8 ms
 *   w_ij  = nº de sinapses × sinal(neurotransmissor) × 0,275 mV
 *   entrada sensorial: trens de Poisson com peso 250 × w_syn
 * Discretização: dt = 1 ms (Shiu usa 0,1 ms no Brian2) — atraso e refratário arredondados para 2 passos.
 *
 * Aprendizado (extensão deste simulador): as sinapses reais KC→MBON são plásticas, atualizadas
 * a cada bloco de 20 ms por uma regra de três fatores (versão em taxa do STDP modulado por dopamina):
 *   e_ij ← e_ij·e^(−Δt/τe) + (spikes_KC(i) − s̄_KC(i)) · (r_pool(j) − r̄_pools)   (regra de covariância:
 *          KCs tonicamente ativas para qualquer estímulo não recebem crédito)
 *   ΔW_ij = η · (r_PAM→j − r_PPL1→j) · e_ij         (dopamina específica do compartimento de j)
 */

export const FW = {
  DT: 1, // ms
  V0: -52,
  VTH: -45,
  TAU_M: 20,
  TAU_SYN: 5,
  REFRACTORY: 2,
  DELAY: 2,
  W_SYN: 0.275,
  W_POISSON: 250 * 0.275,
};

export type GroupName =
  | "photoreceptor"
  | "ocellar"
  | "sugar"
  | "bitter"
  | "pheromone"
  | "wind"
  | "heat"
  | "orn"
  | "kc"
  | "apl"
  | "mbon"
  | "pam"
  | "ppl1"
  | "epg"
  | "pfl3_left"
  | "pfl3_right"
  | "dna02_left"
  | "dna02_right"
  | "dn_walk"
  | "giant_fiber"
  | "mn9"
  | "dh44"
  | "ipc"
  | "itp"
  | "dh31"
  | "dfb";

export interface FlyWireManifest {
  source: string;
  neurons: number;
  edges: number;
  parts: string[];
  bytes: number;
  superClasses: string[];
  groups: Record<GroupName, number[]>;
  /** [índice do neurônio, região retinotópica 0..15] */
  retina: [number, number][];
  ornTypes: Record<string, number[]>;
}

export interface FlyWireData {
  manifest: FlyWireManifest;
  N: number;
  offsets: Int32Array;
  targets: Int32Array;
  weights: Int16Array;
  /** KC→MBON retiradas da CSR fixa (pesos plásticos) */
  plasticOffsets: Int32Array; // por posição na lista de KCs
  plasticTargets: Int32Array;
  plasticCounts: Int16Array;
}

/** Decodifica o pacote binário (delta-varint + zigzag) produzido por scripts/build-flywire.mjs. */
export function decodeConnectome(manifest: FlyWireManifest, bytes: Uint8Array): FlyWireData {
  const N = manifest.neurons;
  const isMbon = new Uint8Array(N);
  for (const i of manifest.groups.mbon) isMbon[i] = 1;
  const kcPos = new Int32Array(N).fill(-1);
  manifest.groups.kc.forEach((i, k) => (kcPos[i] = k));

  const offsets = new Int32Array(N + 1);
  const targets = new Int32Array(manifest.edges);
  const weights = new Int16Array(manifest.edges);
  const pTargetsTmp: number[] = [];
  const pCountsTmp: number[] = [];
  const pOffsets = new Int32Array(manifest.groups.kc.length + 1);
  let p = 0;
  let k = 0;
  const read = () => {
    let v = 0;
    let shift = 0;
    let b: number;
    do {
      b = bytes[p++];
      v |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return v >>> 0;
  };
  for (let i = 0; i < N; i++) {
    offsets[i] = k;
    const deg = read();
    let t = 0;
    const kp = kcPos[i];
    if (kp >= 0) pOffsets[kp] = pTargetsTmp.length;
    for (let e = 0; e < deg; e++) {
      t += read();
      const z = read();
      const w = z & 1 ? -((z + 1) >>> 1) : z >>> 1;
      if (kp >= 0 && isMbon[t]) {
        pTargetsTmp.push(t);
        pCountsTmp.push(w);
      } else {
        targets[k] = t;
        weights[k] = w;
        k++;
      }
    }
  }
  offsets[N] = k;
  pOffsets[manifest.groups.kc.length] = pTargetsTmp.length;
  return {
    manifest,
    N,
    offsets,
    targets: targets.subarray(0, k),
    weights: weights.subarray(0, k),
    plasticOffsets: pOffsets,
    plasticTargets: Int32Array.from(pTargetsTmp),
    plasticCounts: Int16Array.from(pCountsTmp),
  };
}

export const N_POOLS = 5;

/**
 * Marcador odorífero: par de glomérulos para uma chave (índice do problema).
 * Com a tabela medida no conectoma (scripts/build-odor-codes.ts) usa pares de baixa sobreposição;
 * sem ela, deriva um par determinístico.
 */
export function odorGlomeruli(manifest: FlyWireManifest, key: number, codes?: string[][]): string[] {
  if (codes?.length) return codes[Math.abs(key | 0) % codes.length];
  const types = Object.keys(manifest.ornTypes)
    .filter((t) => manifest.ornTypes[t].length >= 20)
    .sort();
  const k = Math.abs(key | 0);
  const a = types[(k * 7 + 3) % types.length];
  let bIdx = (k * 13 + 5) % types.length;
  if (types[bIdx] === a) bIdx = (bIdx + 1) % types.length;
  return [a, types[bIdx]];
}

export interface BrainReadout {
  steps: number;
  totalSpikes: number;
  rates: Record<string, number>; // Hz médios por grupo
  pools: number[]; // Hz médio dos MBONs de cada placa
  kcActiveFraction: number;
  plasticity: number; // |ΔW| médio por segundo (mV)
  meanPlasticWeight: number;
  superRates: number[]; // Hz médio por super-classe
}

export class FlyWireBrain {
  readonly d: FlyWireData;
  readonly N: number;
  readonly v: Float32Array;
  readonly g: Float32Array;
  readonly refr: Uint8Array;
  readonly counts: Uint16Array; // spikes no bloco corrente
  /** Atividade recente para a nuvem de pontos (0..255, decai). */
  readonly activity: Uint8Array;
  readonly plasticW: Float32Array;
  readonly elig: Float32Array;
  readonly mbonPool: Int8Array; // pool (placa) de cada neurônio MBON; -1 senão
  readonly superOf: Uint8Array | null;

  // Entradas de Poisson: taxa (Hz) por neurônio de entrada
  private inputRate: Float32Array;
  private inputList: Int32Array = new Int32Array(0);
  private inputDirty = true;

  // Fila de atraso sináptico (anel de DELAY+1 listas)
  private ring: Int32Array[];
  private ringLen: Int32Array;
  private ringHead = 0;

  private rngState: number;
  // Conjunto ativo: só integra neurônios com g ≠ 0, v ≠ v₀ ou em período refratário
  private active: Int32Array;
  private activeLen = 0;
  private inActive: Uint8Array;
  private spikedList: Int32Array;
  private spikedLen = 0;
  /** Ganho das sinapses inibitórias (1 = Shiu et al.). */
  inhibitoryGain = 1;
  /** Adaptação por frequência de disparo: incremento (mV) e constante (ms). 0 = Shiu et al. */
  adaptIncrement = 0;
  adaptTau = 120;
  /**
   * Inibição graduada do APL (mV por spike de KC no passo anterior, aplicada a todas as KCs).
   * O APL real é não-espicante e libera GABA de forma graduada; 0 = somente sinapses espicantes.
   */
  aplGraded = 0;
  private aplDrive = 0;
  readonly adapt: Float32Array;
  stepCount = 0;
  eta = 0.9;
  learning = true;
  private plasticInit: Float32Array;
  private mbonDanPam: number[][]; // por MBON (posição): índices PAM que o inervam
  private mbonDanPpl: number[][];
  private mbonIndexPos: Int32Array;

  constructor(data: FlyWireData, seed = 1, superOf: Uint8Array | null = null) {
    this.d = data;
    const N = (this.N = data.N);
    this.v = new Float32Array(N).fill(FW.V0);
    this.g = new Float32Array(N);
    this.refr = new Uint8Array(N);
    this.counts = new Uint16Array(N);
    this.activity = new Uint8Array(N);
    this.adapt = new Float32Array(N);
    this.inputRate = new Float32Array(N);
    this.superOf = superOf;
    this.ring = Array.from({ length: FW.DELAY + 1 }, () => new Int32Array(N));
    this.ringLen = new Int32Array(FW.DELAY + 1);
    this.rngState = (seed * 2654435761) >>> 0 || 7;
    this.active = new Int32Array(N);
    this.inActive = new Uint8Array(N);
    this.spikedList = new Int32Array(N);

    const nP = data.plasticTargets.length;
    this.plasticW = new Float32Array(nP);
    this.plasticInit = new Float32Array(nP);
    this.elig = new Float32Array(nP);
    for (let e = 0; e < nP; e++) this.plasticW[e] = this.plasticInit[e] = data.plasticCounts[e] * FW.W_SYN;

    // Pools de MBON: tipos celulares distribuídos entre as 5 placas (pares bilaterais juntos)
    this.mbonPool = new Int8Array(N).fill(-1);
    const mbons = data.manifest.groups.mbon;
    mbons.forEach((m, i) => (this.mbonPool[m] = (Math.floor(i / 2) % N_POOLS) as number));
    this.mbonIndexPos = new Int32Array(N).fill(-1);
    mbons.forEach((m, i) => (this.mbonIndexPos[m] = i));

    // Dopamina específica do compartimento: DANs com sinapse direta no MBON
    const pam = new Set(data.manifest.groups.pam);
    const ppl = new Set(data.manifest.groups.ppl1);
    this.mbonDanPam = mbons.map(() => []);
    this.mbonDanPpl = mbons.map(() => []);
    for (const dan of [...pam, ...ppl]) {
      for (let k = data.offsets[dan]; k < data.offsets[dan + 1]; k++) {
        const pos = this.mbonIndexPos[data.targets[k]];
        if (pos >= 0) (pam.has(dan) ? this.mbonDanPam : this.mbonDanPpl)[pos].push(dan);
      }
    }
  }

  private rand(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  /** Define a taxa de Poisson (Hz) de um conjunto de neurônios. */
  setRates(indices: ArrayLike<number>, hz: number) {
    for (let i = 0; i < indices.length; i++) {
      const n = indices[i];
      if (this.inputRate[n] === 0 && hz > 0) this.pendingInputs.push(n);
      this.inputRate[n] = hz;
    }
    this.inputDirty = true;
  }

  clearInputs() {
    for (let i = 0; i < this.inputList.length; i++) this.inputRate[this.inputList[i]] = 0;
    for (const n of this.pendingInputs) this.inputRate[n] = 0;
    this.pendingInputs.length = 0;
    this.inputList = new Int32Array(0);
    this.inputDirty = false;
  }

  private pendingInputs: number[] = [];
  private rebuildInputList() {
    const list = [...this.inputList, ...this.pendingInputs].filter((n) => this.inputRate[n] > 0);
    this.inputList = Int32Array.from(new Set(list));
    this.pendingInputs.length = 0;
    this.inputDirty = false;
  }

  /** Avança `steps` ms e devolve as leituras do bloco. */
  run(steps: number): BrainReadout {
    const { v, g, refr, counts, d, active, inActive } = this;
    if (this.inputDirty) this.rebuildInputList();
    // zera contagens apenas de quem disparou no bloco anterior
    for (let q = 0; q < this.spikedLen; q++) counts[this.spikedList[q]] = 0;
    this.spikedLen = 0;
    const decayG = Math.exp(-FW.DT / FW.TAU_SYN);
    const f = FW.DT / FW.TAU_M;
    const kcPosOf = this.kcPos();
    const W = FW.W_SYN;
    const WI = FW.W_SYN * this.inhibitoryGain;
    const adapt = this.adapt;
    const aInc = this.adaptIncrement;
    const aDecay = Math.exp(-FW.DT / this.adaptTau);
    let total = 0;
    const touch = (i: number) => {
      if (!inActive[i]) {
        inActive[i] = 1;
        active[this.activeLen++] = i;
      }
    };

    for (let s = 0; s < steps; s++) {
      this.stepCount++;
      // 1) entrega dos spikes emitidos há DELAY passos
      const slot = (this.ringHead + 1) % (FW.DELAY + 1);
      const list = this.ring[slot];
      const len = this.ringLen[slot];
      for (let q = 0; q < len; q++) {
        const pre = list[q];
        const end = d.offsets[pre + 1];
        for (let k = d.offsets[pre]; k < end; k++) {
          const t = d.targets[k];
          const wk = d.weights[k];
          g[t] += wk * (wk < 0 ? WI : W);
          if (!inActive[t]) {
            inActive[t] = 1;
            active[this.activeLen++] = t;
          }
        }
        const kp = kcPosOf[pre];
        if (kp >= 0)
          for (let k = d.plasticOffsets[kp]; k < d.plasticOffsets[kp + 1]; k++) {
            const t = d.plasticTargets[k];
            g[t] += this.plasticW[k];
            touch(t);
          }
      }
      this.ringLen[slot] = 0;

      // 1b) feedback graduado do APL sobre todas as KCs
      if (this.aplDrive > 0.01) {
        const kcs = d.manifest.groups.kc;
        const inh = this.aplDrive;
        for (let q = 0; q < kcs.length; q++) {
          const t = kcs[q];
          g[t] -= inh;
          if (!inActive[t]) {
            inActive[t] = 1;
            active[this.activeLen++] = t;
          }
        }
      }

      // 2) entradas de Poisson
      const inp = this.inputList;
      for (let q = 0; q < inp.length; q++) {
        const i = inp[q];
        if (this.rand() < this.inputRate[i] * 0.001 * FW.DT) {
          g[i] += FW.W_POISSON;
          touch(i);
        }
      }

      // 3) integração LIF somente do conjunto ativo
      this.ringHead = (this.ringHead + 1) % (FW.DELAY + 1);
      const out = this.ring[this.ringHead];
      let n = 0;
      let keep = 0;
      for (let q = 0; q < this.activeLen; q++) {
        const i = active[q];
        if (refr[i] > 0) {
          refr[i]--;
          v[i] = FW.V0;
        } else {
          const vi = v[i] + (FW.V0 - v[i] + g[i] - adapt[i]) * f;
          if (vi > FW.VTH) {
            v[i] = FW.V0;
            refr[i] = FW.REFRACTORY;
            adapt[i] += aInc;
            out[n++] = i;
            if (counts[i]++ === 0) this.spikedList[this.spikedLen++] = i;
          } else v[i] = vi;
        }
        const gi = g[i] * decayG;
        g[i] = gi;
        const ai = adapt[i] * aDecay;
        adapt[i] = ai < 0.01 ? 0 : ai;
        if (refr[i] === 0 && ai < 0.01 && gi < 0.01 && gi > -0.01 && v[i] - FW.V0 < 0.01 && v[i] - FW.V0 > -0.01) {
          g[i] = 0;
          v[i] = FW.V0;
          inActive[i] = 0;
        } else active[keep++] = i;
      }
      this.activeLen = keep;
      this.ringLen[this.ringHead] = n;
      if (this.aplGraded > 0) {
        let kcSpikes = 0;
        for (let q = 0; q < n; q++) if (kcPosOf[out[q]] >= 0) kcSpikes++;
        // traço do APL com τ ≈ 5 ms
        this.aplDrive = this.aplDrive * 0.82 + kcSpikes * this.aplGraded;
      }
      total += n;
    }

    const plasticity = this.learning ? this.plasticityUpdate(steps) : 0;
    return this.readout(steps, total, plasticity);
  }

  /** Média de longo prazo dos spikes por bloco de cada KC (τ ≈ 10 s). */
  private kcMean: Float32Array | null = null;
  private _kcPos: Int32Array | null = null;
  private kcPos(): Int32Array {
    if (!this._kcPos) {
      this._kcPos = new Int32Array(this.N).fill(-1);
      this.d.manifest.groups.kc.forEach((i, k) => (this._kcPos![i] = k));
    }
    return this._kcPos;
  }

  private groupRate(idx: number[], steps: number): number {
    if (!idx.length) return 0;
    let c = 0;
    for (const i of idx) c += this.counts[i];
    return (c / idx.length / steps) * 1000;
  }

  private poolRates(steps: number): number[] {
    const sum = new Array(N_POOLS).fill(0);
    const n = new Array(N_POOLS).fill(0);
    for (const m of this.d.manifest.groups.mbon) {
      const p = this.mbonPool[m];
      sum[p] += this.counts[m];
      n[p]++;
    }
    return sum.map((s, p) => (n[p] ? (s / n[p] / steps) * 1000 : 0));
  }

  private plasticityUpdate(steps: number): number {
    const d = this.d;
    const kcs = d.manifest.groups.kc;
    const mbons = d.manifest.groups.mbon;
    const pools = this.poolRates(steps);
    const meanPool = pools.reduce((a, b) => a + b, 0) / N_POOLS;
    const decay = Math.exp(-steps / 1400);
    // dopamina por MBON (Hz PAM − Hz PPL1 dos DANs que o inervam; senão média global)
    const gPam = this.groupRate(d.manifest.groups.pam, steps);
    const gPpl = this.groupRate(d.manifest.groups.ppl1, steps);
    const daByMbon = new Float32Array(this.N);
    mbons.forEach((m, pos) => {
      const pa = this.mbonDanPam[pos];
      const pp = this.mbonDanPpl[pos];
      const rPam = pa.length ? this.groupRate(pa, steps) : gPam;
      const rPpl = pp.length ? this.groupRate(pp, steps) : gPpl;
      daByMbon[m] = (rPam - rPpl) / 40;
    });
    let dwSum = 0;
    const eta = this.eta * 1e-4;
    if (!this.kcMean) this.kcMean = new Float32Array(kcs.length);
    const kcMean = this.kcMean;
    const alphaMean = steps / 10000;
    for (let kp = 0; kp < kcs.length; kp++) {
      const raw = this.counts[kcs[kp]];
      const c = raw - kcMean[kp];
      kcMean[kp] += (raw - kcMean[kp]) * alphaMean;
      for (let k = d.plasticOffsets[kp]; k < d.plasticOffsets[kp + 1]; k++) {
        const m = d.plasticTargets[k];
        let e = this.elig[k] * decay;
        if (c > 0.05 || c < -0.05) e += c * (pools[this.mbonPool[m]] - meanPool);
        this.elig[k] = e;
        const da = daByMbon[m];
        if (da > 0.05 || da < -0.05) {
          const init = this.plasticInit[k];
          const dw = eta * da * e;
          const nw = Math.min(init * 4 + FW.W_SYN * 4, Math.max(0, this.plasticW[k] + dw));
          dwSum += Math.abs(nw - this.plasticW[k]);
          this.plasticW[k] = nw;
        }
      }
    }
    if (dwSum > 0) this.normalizePlastic();
    return (dwSum / Math.max(1, this.plasticW.length)) * (1000 / steps);
  }

  private initSumByMbon: Float32Array | null = null;
  /**
   * Escala sináptica por MBON: a soma dos pesos KC→MBON de cada MBON volta ao valor anatômico
   * original. Potenciar as KCs ativas deprime as demais (depressão heterossináptica), preservando
   * a especificidade do estímulo e impedindo crescimento sem limite.
   */
  private normalizePlastic() {
    const d = this.d;
    const N = this.N;
    if (!this.initSumByMbon) {
      this.initSumByMbon = new Float32Array(N);
      for (let e = 0; e < this.plasticInit.length; e++) this.initSumByMbon[d.plasticTargets[e]] += this.plasticInit[e];
    }
    const sum = new Float32Array(N);
    for (let e = 0; e < this.plasticW.length; e++) sum[d.plasticTargets[e]] += this.plasticW[e];
    for (let e = 0; e < this.plasticW.length; e++) {
      const m = d.plasticTargets[e];
      if (sum[m] > 0) this.plasticW[e] *= this.initSumByMbon[m] / sum[m];
    }
  }

  private readout(steps: number, total: number, plasticity: number): BrainReadout {
    const G = this.d.manifest.groups;
    const rates: Record<string, number> = {};
    for (const k of Object.keys(G) as GroupName[]) rates[k] = this.groupRate(G[k], steps);
    let active = 0;
    for (const i of G.kc) if (this.counts[i]) active++;
    // atividade recente (nuvem de pontos)
    const act = this.activity;
    const superSum = new Float64Array(16);
    const superN = new Float64Array(16);
    for (let i = 0; i < this.N; i++) {
      const c = this.counts[i];
      act[i] = c ? Math.min(255, act[i] * 0.5 + 80 + c * 40) : act[i] * 0.72;
      if (this.superOf) {
        superSum[this.superOf[i]] += c;
        superN[this.superOf[i]]++;
      }
    }
    let mw = 0;
    for (let e = 0; e < this.plasticW.length; e++) mw += this.plasticW[e];
    return {
      steps,
      totalSpikes: total,
      rates,
      pools: this.poolRates(steps),
      kcActiveFraction: active / Math.max(1, G.kc.length),
      plasticity,
      meanPlasticWeight: mw / Math.max(1, this.plasticW.length),
      superRates: Array.from(superSum, (s, i) => (superN[i] ? (s / superN[i] / steps) * 1000 : 0)),
    };
  }

  readoutWeight(): number {
    let mw = 0;
    for (let e = 0; e < this.plasticW.length; e++) mw += this.plasticW[e];
    return mw / Math.max(1, this.plasticW.length);
  }

  /** Consolidação/escala noturna: nada a fazer aqui (pesos já são de longo prazo), limpa elegibilidade. */
  overnight() {
    this.elig.fill(0);
  }
}
