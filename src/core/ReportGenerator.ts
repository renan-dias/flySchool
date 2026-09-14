/**
 * ReportGenerator — compila o "Relatório Pedagógico da Turma" em PDF (jsPDF).
 * Os gráficos são rasterizados em canvas offscreen (independente do DOM/CSS),
 * o que garante fidelidade de cores e funciona com a UI fechada.
 */
import type { SimulationEngine } from "./SimulationEngine";
import { ARENA, PLATE_RADIUS } from "./SchoolLayout";
import { PLATE_LETTERS } from "./types";

type RGB = [number, number, number];
const NAVY: RGB = [15, 23, 42];
const TEAL: RGB = [13, 148, 136];
const GREY: RGB = [100, 116, 139];

/** Fontes padrão do jsPDF usam WinAnsi: normaliza símbolos fora do Latin-1. */
const san = (s: string) =>
  s.replace(/→/g, "->").replace(/[−–—]/g, "-").replace(/η/g, "eta").replace(/≈/g, "~").replace(/[^ -ÿ\n]/g, "");

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(0)}%`);

function lineChart(series: { name: string; color: string; values: (number | null)[] }[], labels: string[], title: string, w = 1000, h = 420) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const L = 70, R = 30, T = 60, B = 60;
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 24px Helvetica, Arial";
  ctx.fillText(title, L, 34);
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#64748b";
  ctx.font = "16px Helvetica, Arial";
  for (let i = 0; i <= 5; i++) {
    const y = T + ((h - T - B) * i) / 5;
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
    ctx.fillText(`${100 - i * 20}%`, 18, y + 5);
  }
  // linha do acaso
  const chanceY = T + (h - T - B) * 0.8;
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(L, chanceY);
  ctx.lineTo(w - R, chanceY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText("acaso (20%)", w - R - 100, chanceY - 8);
  const n = Math.max(1, labels.length);
  const xAt = (i: number) => (n === 1 ? (L + w - R) / 2 : L + ((w - L - R) * i) / (n - 1));
  labels.forEach((lab, i) => {
    if (n > 14 && i % Math.ceil(n / 14)) return;
    ctx.fillStyle = "#64748b";
    ctx.fillText(lab, xAt(i) - 14, h - B + 28);
  });
  series.forEach((s, si) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    let started = false;
    s.values.forEach((v, i) => {
      if (v === null) return;
      const x = xAt(i);
      const y = T + (h - T - B) * (1 - v);
      if (!started) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      started = true;
    });
    ctx.stroke();
    s.values.forEach((v, i) => {
      if (v === null) return;
      ctx.beginPath();
      ctx.arc(xAt(i), T + (h - T - B) * (1 - v), 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillRect(L + si * 230, h - 22, 18, 10);
    ctx.fillStyle = "#334155";
    ctx.fillText(s.name, L + si * 230 + 26, h - 12);
  });
  return c.toDataURL("image/png");
}

function barChart(bars: { label: string; a: number; b: number }[], title: string, legend: [string, string], w = 1000, h = 420) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  const L = 70, R = 30, T = 60, B = 90;
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 24px Helvetica, Arial";
  ctx.fillText(title, L, 34);
  ctx.font = "16px Helvetica, Arial";
  for (let i = 0; i <= 5; i++) {
    const y = T + ((h - T - B) * i) / 5;
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(w - R, y);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.fillText(`${100 - i * 20}%`, 18, y + 5);
  }
  const gw = (w - L - R) / Math.max(1, bars.length);
  bars.forEach((bar, i) => {
    const x0 = L + i * gw + gw * 0.15;
    const bw = gw * 0.33;
    [bar.a, bar.b].forEach((v, k) => {
      const hh = (h - T - B) * v;
      ctx.fillStyle = k === 0 ? "#0d9488" : "#f59e0b";
      ctx.fillRect(x0 + k * bw, h - B - hh, bw - 4, hh);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(`${(v * 100).toFixed(0)}%`, x0 + k * bw, h - B - hh - 6);
    });
    ctx.fillStyle = "#334155";
    const words = bar.label.split(" · ");
    words.forEach((wd, j) => ctx.fillText(wd.slice(0, 30), x0 - 10, h - B + 24 + j * 20));
  });
  ctx.fillStyle = "#0d9488";
  ctx.fillRect(w - 380, 20, 16, 12);
  ctx.fillStyle = "#f59e0b";
  ctx.fillRect(w - 190, 20, 16, 12);
  ctx.fillStyle = "#334155";
  ctx.fillText(legend[0], w - 358, 31);
  ctx.fillText(legend[1], w - 168, 31);
  return c.toDataURL("image/png");
}

/** Mapa da arena com as rotas de decisão da última prova (verde = acerto, vermelho = erro). */
function routesMap(e: SimulationEngine, w = 1000, h = 620) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  const minX = 2, maxX = 21, minZ = -13.5, maxZ = 6.5;
  const sx = (x: number) => ((x - minX) / (maxX - minX)) * w;
  const sz = (z: number) => ((z - minZ) / (maxZ - minZ)) * h;
  const lastDay = Math.max(0, ...e.analytics.exams.map((r) => r.day));
  const recs = e.analytics.exams.filter((r) => r.day === lastDay && r.path.length > 1);
  ctx.fillStyle = "#1f4d3a";
  ctx.fillRect(sx(ARENA.board.x - ARENA.board.width / 2), sz(-13.2), sx(ARENA.board.x + ARENA.board.width / 2) - sx(ARENA.board.x - ARENA.board.width / 2), 16);
  ARENA.plates.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(sx(p.x), sz(p.z), (PLATE_RADIUS / (maxX - minX)) * w, 0, Math.PI * 2);
    ctx.fillStyle = "#e2e8f0";
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 30px Helvetica, Arial";
    ctx.fillText(PLATE_LETTERS[i], sx(p.x) - 10, sz(p.z) + 10);
  });
  ctx.fillStyle = "rgba(59,130,246,0.08)";
  ctx.fillRect(sx(ARENA.waiting.minX), sz(ARENA.waiting.minZ), sx(ARENA.waiting.maxX) - sx(ARENA.waiting.minX), sz(ARENA.waiting.maxZ) - sz(ARENA.waiting.minZ));
  ctx.lineWidth = 2;
  for (const r of recs) {
    ctx.strokeStyle = r.correct ? "rgba(22,163,74,0.45)" : r.answer < 0 ? "rgba(100,116,139,0.35)" : "rgba(220,38,38,0.4)";
    ctx.beginPath();
    r.path.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sz(p.z)) : ctx.moveTo(sx(p.x), sz(p.z))));
    ctx.stroke();
    const end = r.path[r.path.length - 1];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(sx(end.x), sz(end.z), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 22px Helvetica, Arial";
  ctx.fillText(`Rotas de decisão — prova do dia ${lastDay || "—"} (${recs.length} trajetórias)`, 20, h - 20);
  return c.toDataURL("image/png");
}

export async function generateClassReport(e: SimulationEngine) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 14;
  let y = 0;
  const d = e.director;
  const students = e.students;
  const days = e.analytics.learningCurve(d.day, students);
  const matrix = e.analytics.studentMatrix(students);
  const exams = e.analytics.exams;
  const accOf = (arr: typeof exams) => (arr.length ? arr.filter((r) => r.correct).length / arr.length : null);

  const header = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("FlySchool · Escola Bio-Neural Drosophila", M, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const date = d.simulatedDate().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    doc.text(san(`Relatório Pedagógico da Turma  ·  Dia letivo ${d.day} (${date})  ·  ${d.clock}  ·  ${students.length} alunas + 1 professora`), M, 22);
    doc.setTextColor(...NAVY);
    y = 40;
  };
  const section = (title: string) => {
    if (y > 260) {
      doc.addPage();
      header();
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...TEAL);
    doc.text(san(title), M, y);
    doc.setDrawColor(...TEAL);
    doc.line(M, y + 1.5, W - M, y + 1.5);
    doc.setTextColor(...NAVY);
    y += 8;
  };
  const para = (text: string, size = 9.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(san(text), W - 2 * M);
    if (y + lines.length * 4.4 > 285) {
      doc.addPage();
      header();
    }
    doc.text(lines, M, y);
    y += lines.length * 4.4 + 2;
  };
  const image = (url: string, hmm: number) => {
    if (y + hmm > 285) {
      doc.addPage();
      header();
    }
    doc.addImage(url, "PNG", M, y, W - 2 * M, hmm);
    y += hmm + 4;
  };

  header();

  // 1. Resumo estatístico
  section("1. Resumo estatístico das avaliações");
  const mathAcc = accOf(exams.filter((r) => r.subject === "math"));
  const langAcc = accOf(exams.filter((r) => r.subject === "language"));
  const omission = exams.length ? exams.filter((r) => r.answer < 0).length / exams.length : null;
  const answered = exams.filter((r) => r.answer >= 0);
  const meanDT = answered.length ? answered.reduce((a, r) => a + r.decisionTime, 0) / answered.length : null;
  const kpis: [string, string][] = [
    ["Média de acertos · Matemática", fmt(mathAcc)],
    ["Média de acertos · Português", fmt(langAcc)],
    ["Taxa de omissão (sem resposta)", fmt(omission)],
    ["Tempo médio de decisão", meanDT === null ? "-" : `${meanDT.toFixed(1)} s`],
    ["Questões respondidas (registros)", String(exams.length)],
    ["Ensaios de aula registrados", String(e.analytics.trials.length)],
  ];
  doc.setFontSize(9.5);
  kpis.forEach(([k, v], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * ((W - 2 * M) / 2);
    const yy = y + row * 11;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x, yy - 5, (W - 2 * M) / 2 - 3, 9, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    doc.text(k, x + 3, yy + 1);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(v, x + (W - 2 * M) / 2 - 8, yy + 1, { align: "right" });
  });
  y += 36;
  const table = days.map((dd) => `Dia ${dd.day}: prova Mat ${fmt(dd.examMath)} · Port ${fmt(dd.examLang)} · aula Mat ${fmt(dd.classMath)} · Port ${fmt(dd.classLang)}`);
  para(table.join("\n"), 8.5);

  // 2. Curva de aprendizado
  section("2. Curva de aprendizado coletivo");
  image(
    lineChart(
      [
        { name: "Prova · Matemática", color: "#2563eb", values: days.map((x) => x.examMath) },
        { name: "Prova · Português", color: "#9333ea", values: days.map((x) => x.examLang) },
        { name: "Aula (média)", color: "#0d9488", values: days.map((x) => (x.classMath !== null && x.classLang !== null ? (x.classMath + x.classLang) / 2 : x.classMath ?? x.classLang)) },
      ],
      days.map((x) => `D${x.day}`),
      "Taxa de acertos ao longo dos dias letivos",
    ),
    72,
  );

  // 3. Eficácia do método + rotas
  section("3. Eficácia dos métodos pedagógicos e rotas de decisão neural");
  const names = new Map(e.strategies.map((s) => [s.id, s.name]));
  const eff = e.analytics.strategyEfficacy(names);
  if (eff.length) {
    image(
      barChart(
        eff.map((x) => ({ label: x.name, a: x.classAcc, b: x.examAcc })),
        "Acerto em aula vs. acerto em prova por método",
        ["Acerto em aula", "Acerto em prova"],
      ),
      72,
    );
  } else para("Ainda não há ensaios de aula registrados.");
  const best = [...eff].sort((a, b) => b.examAcc - a.examAcc)[0];
  if (best) para(`Método com maior transferência para a prova: "${best.name}" (${fmt(best.examAcc)} de acerto nas provas dos dias em que foi utilizado, ${best.trials} ensaios).`);
  image(routesMap(e), 108);
  para(
    "Interpretação: cada linha é a trajetória de uma aluna durante uma questão (amostrada a cada 250 ms). Rotas diretas indicam comprometimento precoce da evidência acumulada nos MBONs; rotas sinuosas indicam conflito entre alternativas ou captura por estados homeostáticos.",
    8.5,
  );

  // 4. Correlação homeostase × desempenho
  section("4. Estados internos × desempenho");
  const corr = e.analytics.correlation();
  para(
    `Correlação ponto-bisserial fome × acerto: r = ${corr.rHunger === null ? "—" : corr.rHunger.toFixed(2)}; fadiga × acerto: r = ${corr.rFatigue === null ? "—" : corr.rFatigue.toFixed(2)} (n = ${corr.n}).\n` +
      `Acerto por faixa de fome: ${corr.hungerBins.map((b) => `${b.bin}: ${fmt(b.acc)} (n=${b.n})`).join("; ")}.\n` +
      `Acerto por faixa de fadiga: ${corr.fatigueBins.map((b) => `${b.bin}: ${fmt(b.acc)} (n=${b.n})`).join("; ")}.`,
    8.5,
  );

  // 5. Diagnóstico individual
  doc.addPage();
  header();
  section("5. Diagnóstico comportamental individualizado");
  const cols = [M, M + 26, M + 58, M + 78, M + 98, M + 118, M + 140];
  const headerRow = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setFillColor(...NAVY);
    doc.rect(M, y - 4.5, W - 2 * M, 6.5, "F");
    doc.setTextColor(255, 255, 255);
    ["ID", "Nome", "Prova", "Aula", "t decisão", "Distração", "Perfil"].forEach((h, i) => doc.text(h, cols[i] + 1, y));
    doc.setTextColor(...NAVY);
    y += 6;
  };
  headerRow();
  matrix.forEach((row, idx) => {
    const diag = doc.splitTextToSize(san(row.diagnosis), W - 2 * M - 4);
    const need = 6 + diag.length * 3.6;
    if (y + need > 287) {
      doc.addPage();
      header();
      headerRow();
    }
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y - 4, W - 2 * M, need, "F");
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(row.id, cols[0] + 1, y);
    doc.setFont("helvetica", "normal");
    doc.text(san(row.name), cols[1] + 1, y);
    doc.text(fmt(row.examAcc), cols[2] + 1, y);
    doc.text(fmt(row.classAcc), cols[3] + 1, y);
    doc.text(row.meanDecisionTime === null ? "-" : `${row.meanDecisionTime.toFixed(1)}s`, cols[4] + 1, y);
    doc.text(fmt(row.distraction), cols[5] + 1, y);
    doc.setFont("helvetica", "bold");
    doc.text(row.profile, cols[6] + 1, y);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(diag, M + 2, y + 4);
    doc.setTextColor(...NAVY);
    y += need;
  });

  // Rodapé metodológico
  y += 4;
  section("Nota metodológica");
  para(
    "Cada aluna é governada por um conectoma reduzido (96 neurônios Leaky Integrate-and-Fire, dt = 5 ms) inspirado nas classes celulares do FlyWire: colunas visuais, Kenyon cells com inibição APL, MBONs, dopaminérgicos PAM/PPL1, estados homeostáticos, Complexo Central e descendentes motores. " +
      "A memória reside nas sinapses KC→MBON, atualizadas por STDP modulado por dopamina: ΔW = η·(PAM − PPL1)·traço(i,j), com memória de curto prazo que decai e consolida em longo prazo (inclusive durante o sono noturno). " +
      "As moscas aprendem associações padrão visual → placa recompensada; os rótulos simbólicos (\"3 + 1\") são interpretações humanas.",
    8.5,
  );

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(`FlySchool Bio-Neural Classroom Simulator · página ${i}/${pages}`, W / 2, 292, { align: "center" });
  }
  doc.save(`FlySchool_Relatorio_Dia${d.day}.pdf`);
}
