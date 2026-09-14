# 🪰 FlySchool: Bio-Neural Classroom Simulator

Laboratório de neuroeducação e vida artificial: alunas e professora são moscas *Drosophila melanogaster*
virtuais governadas por **redes neurais de espículas (LIF)** que aprendem por **STDP modulado por dopamina**
em uma escola 3D (sala de aula, pátio/refeitório, banheiro, descanso e arena de prova).

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Three.js / @react-three/fiber / drei · Recharts · jsPDF · Zustand

## Rodando

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # build de produção (Vercel)
npm run sim:headless # simula 3 dias sem renderização e imprime a curva de aprendizado
```

Deploy na Vercel: importe o repositório — nenhuma configuração extra é necessária (`.npmrc` já define `legacy-peer-deps`).

## Arquitetura

| Módulo | Responsabilidade |
|---|---|
| `src/core/FlyConnectome.ts` | SNN LIF (dt = 5 ms), 96 neurônios, CSR, STDP competitivo + dopamina, STM/LTM, escalonamento sináptico |
| `src/core/FlyAgent.ts` | Sensores → correntes, seleção de ação, acumulador de evidência (MBON → placa), cinemática DNg, homeostase |
| `src/core/SchoolDirector.ts` | Relógio, campainha, cronograma, rotina didática do professor (estímulo, glicose, rajada de ar, estrobo, feromônio) |
| `src/core/ExamSystem.ts` | Provas A–E sem reforço: tempo de decisão, rota, acerto, estado interno |
| `src/core/Analytics.ts` | Curvas, matriz individual, perfis, correlação ponto-bisserial, eficácia por método |
| `src/core/ReportGenerator.ts` | Relatório PDF (gráficos rasterizados em canvas offscreen) |
| `src/core/SimulationEngine.ts` | Orquestração, população, crises, estratégias |
| `src/components/3d/SchoolScene.tsx` | Cenário 3D, lousas e placas com texturas dinâmicas |
| `src/components/3d/FlyAgentView.tsx` | Malha procedural da mosca (marcha em tripé, asas, probóscide) |
| `src/components/ui/BrainGraphModal.tsx` | Grafo force-directed estilo Obsidian, heatmap KC→MBON, raster |
| `src/components/ui/AnalyticsDashboard.tsx` | Dashboard Recharts + botão de relatório |
| `src/components/ui/GodPanel.tsx` | População, crises, métodos de ensino, editor de estratégias, parâmetros da prova |

O motor (`src/core`) não depende de React/Three e roda headless (`scripts/headless.ts`).
No navegador, o engine fica acessível no console como `window.flyschool`.

## Modelo neural (resumo)

```
Lousa ─► 16 colunas visuais ─► 40 Kenyon cells (esparsas, APL) ─► 5 MBONs (placas A–E) ─► decisão
                    ▲ ganho atencional (CX)                ▲ ΔW = η·(PAM − PPL1)·traço(i,j)
Fome/Sede/Fadiga/Bexiga ─► neurônios de ação (WTA) ─► DNg (caminhar, girar, voar, probóscide, permanecer)
```

* **Crédito de escolha:** cópia eferente da placa escolhida + LTD heterossináptica pela média dos MBONs.
* **Memória:** W = W_curto (decai τ = 420 s e consolida τ = 300 s) + W_longo; consolidação extra no sono noturno.
* **Resultado típico** (18 alunas, método apetitivo): prova sobe de ~30–40% no dia 1 para ~55–60% no dia 3–5 (acaso = 20%), com forte variação individual.

### Sobre o FlyWire

O conectoma é **reduzido e construído à mão**, usando classes celulares identificadas no FlyWire/hemibrain
(Kenyon cells, APL, MBONs, PAM, PPL1, PFL3, DNa02, Giant Fiber, Gr5a, Gr28b, Or67d…).
**Não** carrega dados reais do FlyWire (≈139 mil neurônios / dezenas de milhões de sinapses), e os pesos
são parâmetros calibrados, não medidos. Moscas aprendem associações *padrão visual → placa recompensada*;
rótulos como "3 + 1" são interpretação humana.
