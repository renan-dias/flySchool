/**
 * Texturas geradas em Canvas 2D (lousa, placas, rótulos). Evita dependência de fontes remotas
 * no WebGL e permite redesenhar o estímulo instantaneamente quando o professor troca a questão.
 */
import * as THREE from "three";
import type { Problem } from "@/core/types";

export function makeCanvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}

export interface BoardState {
  problem: Problem | null;
  title: string;
  subtitle?: string;
  footer?: string;
  dark?: boolean;
  progress?: number; // 0..1 barra de tempo
}

/** Desenha a lousa (quadro verde) com o estímulo visual. */
export function drawBoard(ctx: CanvasRenderingContext2D, s: BoardState) {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  // moldura
  ctx.fillStyle = "#6b4f2a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = s.dark ? "#0b0f0c" : "#1f4d3a";
  ctx.fillRect(14, 14, W - 28, H - 28);
  if (s.dark) {
    ctx.fillStyle = "#334155";
    ctx.font = "600 34px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("⚡ sem energia", W / 2, H / 2);
    return;
  }
  // textura de giz
  ctx.globalAlpha = 0.06;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(rnd() * W, rnd() * H, rnd() * 60, 1.5);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.fillStyle = "#e2f3ea";
  ctx.font = "600 30px Inter, sans-serif";
  ctx.fillText(s.title, W / 2, 60);
  if (s.subtitle) {
    ctx.font = "400 22px Inter, sans-serif";
    ctx.fillStyle = "#b7d8c6";
    ctx.fillText(s.subtitle, W / 2, 92);
  }

  const p = s.problem;
  if (p) {
    const cy = H / 2 + 20;
    if (p.visual.kind === "dots") {
      const { a, b, op } = p.visual;
      const drawDots = (n: number, cx: number) => {
        const cols = Math.min(3, n);
        const rows = Math.ceil(n / 3);
        for (let i = 0; i < n; i++) {
          const x = cx + ((i % 3) - (cols - 1) / 2) * 46;
          const y = cy + (Math.floor(i / 3) - (rows - 1) / 2) * 46;
          ctx.beginPath();
          ctx.arc(x, y, 17, 0, Math.PI * 2);
          ctx.fillStyle = "#fef08a";
          ctx.fill();
        }
      };
      drawDots(a, W / 2 - 190);
      ctx.fillStyle = "#fff";
      ctx.font = "700 72px Inter, sans-serif";
      ctx.fillText(op, W / 2 - 70, cy + 24);
      drawDots(b, W / 2 + 50);
      ctx.fillText("= ?", W / 2 + 200, cy + 24);
    } else if (p.visual.kind === "glyph") {
      ctx.fillStyle = "#fff";
      ctx.font = "800 110px Inter, sans-serif";
      ctx.fillText(p.visual.text, W / 2 + (p.visual.hint ? 50 : 0), cy + 40);
      if (p.visual.hint) {
        ctx.font = "90px serif";
        ctx.fillText(p.visual.hint, W / 2 - 230, cy + 34);
      }
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = "800 80px Inter, sans-serif";
      ctx.fillText(p.visual.text, W / 2, cy + 28);
    }
    ctx.font = "500 24px Inter, sans-serif";
    ctx.fillStyle = "#cbe7d6";
    ctx.fillText(p.options.map((o, i) => `${"ABCDE"[i]}) ${o}`).join("    "), W / 2, H - 60);
  } else {
    ctx.fillStyle = "#9cc3ad";
    ctx.font = "italic 400 28px Inter, sans-serif";
    ctx.fillText("· · ·", W / 2, H / 2 + 10);
  }
  if (s.footer) {
    ctx.font = "500 20px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#a7f3d0";
    ctx.textAlign = "right";
    ctx.fillText(s.footer, W - 40, H - 26);
    ctx.textAlign = "center";
  }
  if (s.progress !== undefined) {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(40, H - 22, W - 80, 6);
    ctx.fillStyle = s.progress > 0.75 ? "#fb7185" : "#5eead4";
    ctx.fillRect(40, H - 22, (W - 80) * (1 - s.progress), 6);
  }
}

/** Placa de resposta no chão (vista de cima). */
export function drawPlate(ctx: CanvasRenderingContext2D, letter: string, option: string | null, highlight: "none" | "reward" | "exam") {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  const r = W / 2 - 4;
  const grad = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, r);
  if (highlight === "reward") {
    grad.addColorStop(0, "#fef9c3");
    grad.addColorStop(1, "#f59e0b");
  } else if (highlight === "exam") {
    grad.addColorStop(0, "#e0f2fe");
    grad.addColorStop(1, "#38bdf8");
  } else {
    grad.addColorStop(0, "#f8fafc");
    grad.addColorStop(1, "#94a3b8");
  }
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1e293b";
  ctx.stroke();
  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "center";
  ctx.font = `800 ${option ? 92 : 120}px Inter, sans-serif`;
  ctx.fillText(letter, W / 2, H / 2 + (option ? 10 : 42));
  if (option) {
    ctx.font = "700 58px Inter, sans-serif";
    ctx.fillStyle = "#334155";
    ctx.fillText(option, W / 2, H / 2 + 80);
  }
}

export function makeLabelTexture(text: string, opts: { color?: string; bg?: string; font?: string; w?: number; h?: number } = {}) {
  const { canvas, ctx, texture } = makeCanvasTexture(opts.w ?? 512, opts.h ?? 128);
  ctx.fillStyle = opts.bg ?? "rgba(15,23,42,0.78)";
  const W = canvas.width;
  const H = canvas.height;
  const rr = 28;
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, rr);
  ctx.fill();
  ctx.fillStyle = opts.color ?? "#e2e8f0";
  ctx.font = opts.font ?? "700 52px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 2);
  texture.needsUpdate = true;
  return texture;
}
