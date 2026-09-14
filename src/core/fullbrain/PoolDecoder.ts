/**
 * PoolDecoder — leitura de decisão a partir dos 5 pools de MBONs reais.
 * Subtrai a linha de base adaptativa de cada pool (diferenças intrínsecas de excitabilidade)
 * e acumula evidência; o comprometimento usa softmax (exploração decrescente com a confiança).
 */
import { N_POOLS } from "./FlyWireBrain";

export class PoolDecoder {
  readonly baseline = new Float32Array(N_POOLS).fill(-1);
  readonly evidence = new Float32Array(N_POOLS);
  private rng: () => number;

  constructor(seed = 1, private temperature = 2.5, private commitAfterMs = 1200) {
    let s = seed * 9301 + 49297;
    this.rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  reset() {
    this.evidence.fill(0);
  }

  /** Integra um bloco; devolve a placa escolhida (≥0) quando compromete, senão −1. */
  accumulate(pools: number[], elapsedMs: number, extraBias?: (j: number) => number): number {
    let total = 0;
    for (let j = 0; j < N_POOLS; j++) {
      const r = pools[j];
      total += r;
      if (this.baseline[j] < 0) this.baseline[j] = r;
      this.baseline[j] += (r - this.baseline[j]) * 0.004; // τ ≈ 5 s de blocos de 20 ms
      this.evidence[j] += (r - this.baseline[j]) * 0.02 + (extraBias ? extraBias(j) : 0);
    }
    if (elapsedMs < this.commitAfterMs) return -1;
    // sem atividade nos MBONs: chuta após 2,5 s (a mosca ainda se move até uma placa)
    if (total < 1 && elapsedMs < 2500) return -1;
    return this.sample();
  }

  sample(): number {
    let max = -Infinity;
    for (const e of this.evidence) max = Math.max(max, e);
    const ws = Array.from(this.evidence, (e) => Math.exp((e - max) / Math.max(0.05, this.temperature * 0.1)));
    const sum = ws.reduce((a, b) => a + b, 0);
    let u = this.rng() * sum;
    for (let j = 0; j < N_POOLS; j++) if ((u -= ws[j]) <= 0) return j;
    return N_POOLS - 1;
  }
}
