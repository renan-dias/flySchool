import type { ActionMode } from "@/core/types";
import type { NeuronGroup } from "@/core/FlyConnectome";

export const MODE_META: Record<ActionMode, { label: string; color: string; icon: string }> = {
  attend: { label: "Atenção à lousa", color: "#5eead4", icon: "📘" },
  forage: { label: "Forrageio", color: "#f59e0b", icon: "🍬" },
  drink: { label: "Beber água", color: "#38bdf8", icon: "💧" },
  rest: { label: "Repouso", color: "#a78bfa", icon: "💤" },
  relief: { label: "Banheiro", color: "#f472b6", icon: "🚽" },
  social: { label: "Social", color: "#4ade80", icon: "💬" },
};

export const GROUP_META: Record<NeuronGroup, { label: string; color: string }> = {
  visual: { label: "Visual (lóbula)", color: "#60a5fa" },
  chemo: { label: "Quimiossensorial", color: "#34d399" },
  mechano: { label: "Mecano/Térmico", color: "#f97316" },
  state: { label: "Estados internos", color: "#f472b6" },
  context: { label: "Contexto escolar", color: "#94a3b8" },
  cx: { label: "Complexo Central", color: "#22d3ee" },
  kc: { label: "Kenyon Cells (MB)", color: "#a78bfa" },
  apl: { label: "APL (inibição)", color: "#e879f9" },
  mbon: { label: "MBON (saída MB)", color: "#fbbf24" },
  pam: { label: "PAM (recompensa)", color: "#facc15" },
  ppl1: { label: "PPL1 (aversão)", color: "#fb7185" },
  action: { label: "Seleção de ação", color: "#4ade80" },
  motor: { label: "Motores DNg", color: "#f87171" },
};

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`);
