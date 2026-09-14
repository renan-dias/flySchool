/**
 * Geometria do mundo escolar (unidades arbitrárias; y = altura).
 * Compartilhada entre o motor de simulação e o renderizador 3D para garantir
 * que o que a mosca "sente" é exatamente o que o usuário vê.
 */
import type { Vec2 } from "./types";

export interface Zone {
  id: string;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: string;
}

export const ZONES = {
  classroom: { id: "classroom", label: "Sala de Aula", minX: -22, maxX: -1, minZ: -13, maxZ: 7, color: "#e9dcc3" },
  arena: { id: "arena", label: "Sala de Avaliação", minX: 3, maxX: 20, minZ: -13, maxZ: 7, color: "#d9e2ec" },
  patio: { id: "patio", label: "Pátio / Refeitório", minX: -22, maxX: 20, minZ: 10, maxZ: 25, color: "#cfe3c1" },
  bathroom: { id: "bathroom", label: "Banheiro", minX: 23, maxX: 33, minZ: -13, maxZ: 4, color: "#cde7ee" },
  rest: { id: "rest", label: "Área de Descanso", minX: 23, maxX: 33, minZ: 7, maxZ: 25, color: "#e6d8ee" },
} satisfies Record<string, Zone>;

export type ZoneId = keyof typeof ZONES;

export const PLATE_RADIUS = 1.15;

/** Lousa e placas de resposta da sala de aula. */
export const CLASSROOM = {
  board: { x: -11.5, z: -12.6, width: 11, height: 4.6, y: 3.2 },
  teacherSpot: { x: -11.5, z: -10.6 },
  teacherDesk: { x: -18, z: -10.2 },
  plates: [-17.5, -14.5, -11.5, -8.5, -5.5].map((x) => ({ x, z: -7.2 })) as Vec2[],
  desks: (() => {
    const d: Vec2[] = [];
    for (const z of [-2.5, 0.8, 4.1]) for (const x of [-18, -14, -9, -5]) d.push({ x, z });
    return d;
  })(),
};

/** Arena de prova (5 placas A–E). */
export const ARENA = {
  board: { x: 11.5, z: -12.6, width: 11, height: 4.6, y: 3.2 },
  proctorSpot: { x: 18, z: -9.5 },
  plates: [5.5, 8.5, 11.5, 14.5, 17.5].map((x) => ({ x, z: -6.6 })) as Vec2[],
  waiting: { minX: 5, maxX: 18, minZ: -1.5, maxZ: 5 },
};

export const TABLE_HEIGHT = 1.05;

export const PATIO = {
  tables: [
    { x: -15, z: 15 },
    { x: -5, z: 15 },
    { x: 5, z: 15 },
    { x: 14, z: 19.5 },
  ] as Vec2[],
  socialCenter: { x: -3, z: 21 },
};

export const SUGAR_SOURCES: Vec2[] = PATIO.tables.map((t) => ({ x: t.x - 0.9, z: t.z }));
export const WATER_SOURCES: Vec2[] = PATIO.tables.map((t) => ({ x: t.x + 0.9, z: t.z }));

export const BATHROOM = {
  stalls: [
    { x: 25.5, z: -9 },
    { x: 28, z: -9 },
    { x: 30.5, z: -9 },
  ] as Vec2[],
};

export const REST = {
  beds: [
    { x: 25.5, z: 11 },
    { x: 30.5, z: 11 },
    { x: 25.5, z: 17 },
    { x: 30.5, z: 17 },
    { x: 28, z: 22 },
  ] as Vec2[],
};

export function inZone(p: Vec2, zone: Zone, margin = 0): boolean {
  return p.x >= zone.minX - margin && p.x <= zone.maxX + margin && p.z >= zone.minZ - margin && p.z <= zone.maxZ + margin;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function nearest(p: Vec2, list: Vec2[]): { point: Vec2; index: number; d: number } {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = dist(p, list[i]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return { point: list[best], index: best, d: bd };
}

export function clampToZone(p: Vec2, zone: Zone, margin = 0.6): Vec2 {
  return {
    x: Math.min(zone.maxX - margin, Math.max(zone.minX + margin, p.x)),
    z: Math.min(zone.maxZ - margin, Math.max(zone.minZ + margin, p.z)),
  };
}
