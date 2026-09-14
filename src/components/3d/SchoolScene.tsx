"use client";
/**
 * SchoolScene — cenário 3D da escola: sala de aula, arena de prova, pátio/refeitório,
 * banheiro e área de descanso, com lousas, placas de resposta e fontes de alimento interativas.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  ARENA,
  BATHROOM,
  CLASSROOM,
  PATIO,
  PLATE_RADIUS,
  REST,
  SUGAR_SOURCES,
  TABLE_HEIGHT,
  WATER_SOURCES,
  ZONES,
  type Zone,
} from "@/core/SchoolLayout";
import { PLATE_LETTERS } from "@/core/types";
import { getEngine } from "@/store/useSimStore";
import { drawBoard, drawPlate, makeCanvasTexture, makeLabelTexture } from "./textures";

// ────────────────────────── Primitivas ──────────────────────────
function Box({ p, s, color, cast = true, receive = true, opacity }: { p: [number, number, number]; s: [number, number, number]; color: string; cast?: boolean; receive?: boolean; opacity?: number }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow={receive}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} transparent={opacity !== undefined} opacity={opacity ?? 1} roughness={0.85} />
    </mesh>
  );
}

function ZoneFloor({ zone }: { zone: Zone }) {
  const w = zone.maxX - zone.minX;
  const d = zone.maxZ - zone.minZ;
  return (
    <group>
      <mesh position={[(zone.minX + zone.maxX) / 2, 0.02, (zone.minZ + zone.maxZ) / 2]} receiveShadow>
        <boxGeometry args={[w, 0.08, d]} />
        <meshStandardMaterial color={zone.color} roughness={0.95} />
      </mesh>
    </group>
  );
}

/** Paredes: fundo alto (onde fica a lousa), lateral média, frente baixa para a vista isométrica. */
function Walls({ zone, back = 5.8, side = 2.2, front = 0.45, color = "#cbd5e1" }: { zone: Zone; back?: number; side?: number; front?: number; color?: string }) {
  const w = zone.maxX - zone.minX;
  const d = zone.maxZ - zone.minZ;
  const cx = (zone.minX + zone.maxX) / 2;
  const cz = (zone.minZ + zone.maxZ) / 2;
  const t = 0.3;
  return (
    <group>
      <Box p={[cx, back / 2, zone.minZ - t / 2]} s={[w + t * 2, back, t]} color={color} />
      <Box p={[zone.minX - t / 2, side / 2, cz]} s={[t, side, d]} color={color} />
      {/* frente com vão de porta */}
      <Box p={[zone.minX + w * 0.2, front / 2, zone.maxZ + t / 2]} s={[w * 0.4, front, t]} color={color} />
      <Box p={[zone.maxX - w * 0.2, front / 2, zone.maxZ + t / 2]} s={[w * 0.4, front, t]} color={color} />
      <Box p={[zone.maxX + t / 2, front / 2, zone.minZ + d * 0.25]} s={[t, front, d * 0.5]} color={color} />
    </group>
  );
}

function ZoneLabel({ zone, y = 6.8 }: { zone: Zone; y?: number }) {
  const tex = useMemo(() => makeLabelTexture(zone.label), [zone.label]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={[(zone.minX + zone.maxX) / 2, y, zone.minZ + 0.5]} scale={[7, 1.75, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// ────────────────────────── Lousa dinâmica ──────────────────────────
function Board({ where }: { where: "classroom" | "arena" }) {
  const cfg = where === "classroom" ? CLASSROOM.board : ARENA.board;
  const { ctx, texture } = useMemo(() => makeCanvasTexture(1024, 440), []);
  const sig = useRef("");
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    const e = getEngine();
    const d = e.director;
    const dark = e.blackoutTimer > 0;
    let key: string;
    let state: Parameters<typeof drawBoard>[1];
    if (where === "classroom") {
      const s = d.currentStrategy;
      const prob = d.phase === "stimulus" ? d.currentProblem : null;
      const progress = d.phase === "stimulus" && s ? Math.min(1, d.phaseTime / s.responseTolerance) : undefined;
      const title = d.period.context === "class" ? d.period.label : d.period.context === "entry" ? "Bom dia, turma! 🪰" : "Sala vazia";
      state = {
        problem: prob,
        title,
        subtitle: d.period.context === "class" && s ? s.name : undefined,
        footer: `Dia ${d.day} · ${d.clock}`,
        dark,
        progress,
      };
      key = `${title}|${prob?.id}|${dark}|${d.clock}|${progress?.toFixed(2)}`;
    } else {
      const x = e.exam;
      const q = x.current;
      const title = x.phase === "off" ? "Sala de Avaliação" : x.phase === "gather" ? "Prova: posicionem-se" : x.phase === "done" ? "Prova encerrada ✔" : `Questão ${x.index + 1}/${x.questions.length}`;
      state = {
        problem: q,
        title,
        subtitle: q ? (q.subject === "math" ? "Matemática" : "Português") + " — permaneça sobre a alternativa" : undefined,
        footer: q ? `${x.remaining.toFixed(0)}s` : `Dia ${d.day}`,
        dark,
        progress: q ? x.phaseTime / x.tolerance : undefined,
      };
      key = `${title}|${q?.id}|${dark}|${state.footer}|${state.progress?.toFixed(2)}`;
    }
    if (key !== sig.current) {
      sig.current = key;
      drawBoard(ctx, state);
      texture.needsUpdate = true;
    }
  });

  return (
    <group position={[cfg.x, cfg.y, cfg.z + 0.2]}>
      <mesh castShadow>
        <planeGeometry args={[cfg.width, cfg.height]} />
        <meshStandardMaterial map={texture} emissive="#ffffff" emissiveMap={texture} emissiveIntensity={0.35} roughness={0.9} />
      </mesh>
      {/* bandeja de giz */}
      <Box p={[0, -cfg.height / 2 - 0.1, 0.15]} s={[cfg.width, 0.12, 0.3]} color="#6b4f2a" />
    </group>
  );
}

// ────────────────────────── Placas A–E ──────────────────────────
function Plate({ where, index }: { where: "classroom" | "arena"; index: number }) {
  const pos = (where === "classroom" ? CLASSROOM.plates : ARENA.plates)[index];
  const { ctx, texture } = useMemo(() => makeCanvasTexture(256, 256), []);
  const sig = useRef("");
  const drop = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(({ clock }) => {
    const e = getEngine();
    const d = e.director;
    let option: string | null = null;
    let hl: "none" | "reward" | "exam" = "none";
    let reward = false;
    if (where === "classroom" && d.currentProblem && (d.phase === "stimulus" || d.phase === "prepare")) {
      option = d.currentProblem.options[index];
      reward = d.rewardPlates.includes(index);
      if (reward) hl = "reward";
    }
    if (where === "arena" && e.exam.current) {
      option = e.exam.current.options[index];
      hl = "exam";
    }
    const key = `${option}|${hl}`;
    if (key !== sig.current) {
      sig.current = key;
      drawPlate(ctx, PLATE_LETTERS[index], option, hl);
      texture.needsUpdate = true;
    }
    if (drop.current) {
      drop.current.visible = reward;
      drop.current.position.y = 0.32 + Math.sin(clock.elapsedTime * 3 + index) * 0.04;
    }
    if (glow.current) glow.current.intensity = reward ? 6 : 0;
  });

  return (
    <group position={[pos.x, 0, pos.z]}>
      <mesh position={[0, 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[PLATE_RADIUS, 40]} />
        <meshStandardMaterial map={texture} roughness={0.6} />
      </mesh>
      <mesh ref={drop} position={[0, 0.32, 0]} visible={false} castShadow>
        <sphereGeometry args={[0.26, 20, 16]} />
        <meshPhysicalMaterial color="#fff7d6" transmission={0.6} roughness={0.05} thickness={0.4} emissive="#fbbf24" emissiveIntensity={0.4} />
      </mesh>
      <pointLight ref={glow} position={[0, 1, 0]} color="#fbbf24" intensity={0} distance={4} />
    </group>
  );
}

/** Trilha de feromônio do professor até a placa correta. */
function PheromoneTrail() {
  const group = useRef<THREE.Group>(null);
  const N = 14;
  useFrame(({ clock }) => {
    const e = getEngine();
    const d = e.director;
    const g = group.current;
    if (!g) return;
    const on = d.period.context === "class" && !!d.currentStrategy?.pheromoneTrail && d.phase === "stimulus" && !!d.currentProblem;
    g.visible = on;
    if (!on) return;
    const target = CLASSROOM.plates[d.currentProblem!.correct];
    const start = { x: CLASSROOM.board.x, z: 3 };
    g.children.forEach((c, i) => {
      const t = i / (N - 1);
      c.position.set(start.x + (target.x - start.x) * t, 0.12, start.z + (target.z - start.z) * t);
      const s = 0.8 + 0.4 * Math.sin(clock.elapsedTime * 4 - i * 0.6);
      c.scale.setScalar(s);
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: N }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.13, 10, 8]} />
          <meshStandardMaterial color="#c084fc" emissive="#a855f7" emissiveIntensity={1.2} transparent opacity={0.85} />
        </mesh>
      ))}
    </group>
  );
}

// ────────────────────────── Mobiliário ──────────────────────────
function StudentDesk({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z + 1.1]}>
      <Box p={[0, 0.62, 0]} s={[2.6, 0.1, 0.9]} color="#a16207" />
      {[-1.1, 1.1].map((dx) => (
        <Box key={dx} p={[dx, 0.3, 0]} s={[0.1, 0.6, 0.7]} color="#57534e" />
      ))}
    </group>
  );
}

function Table({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, TABLE_HEIGHT - 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.1, 2.2]} />
        <meshStandardMaterial color="#f5f5f4" roughness={0.6} />
      </mesh>
      {[
        [-1.5, -0.9],
        [1.5, -0.9],
        [-1.5, 0.9],
        [1.5, 0.9],
      ].map(([dx, dz]) => (
        <Box key={`${dx}${dz}`} p={[dx, (TABLE_HEIGHT - 0.1) / 2, dz]} s={[0.12, TABLE_HEIGHT - 0.1, 0.12]} color="#78716c" />
      ))}
      <Box p={[0, 0.35, 1.7]} s={[3.2, 0.1, 0.6]} color="#92400e" />
      <Box p={[0, 0.35, -1.7]} s={[3.2, 0.1, 0.6]} color="#92400e" />
    </group>
  );
}

function Drop({ x, z, kind }: { x: number; z: number; kind: "sugar" | "water" }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2 + x) * 0.05);
  });
  return (
    <mesh ref={ref} position={[x, TABLE_HEIGHT + 0.18, z]} castShadow>
      <sphereGeometry args={[0.32, 20, 14]} />
      {kind === "sugar" ? (
        <meshPhysicalMaterial color="#fdf2f8" roughness={0.15} transmission={0.4} thickness={0.5} emissive="#f9a8d4" emissiveIntensity={0.25} />
      ) : (
        <meshPhysicalMaterial color="#7dd3fc" roughness={0.02} transmission={0.85} thickness={0.6} ior={1.33} />
      )}
    </mesh>
  );
}

function Tree({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.3, 2, 8]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
      <mesh position={[0, 2.8, 0]} castShadow>
        <icosahedronGeometry args={[1.5, 0]} />
        <meshStandardMaterial color="#4d7c0f" flatShading />
      </mesh>
    </group>
  );
}

function Stall({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <Box p={[-1.2, 1.1, 0.4]} s={[0.08, 2.2, 2.6]} color="#94a3b8" />
      <Box p={[1.2, 1.1, 0.4]} s={[0.08, 2.2, 2.6]} color="#94a3b8" />
      <mesh position={[0, 0.3, -0.6]} castShadow>
        <cylinderGeometry args={[0.45, 0.35, 0.6, 16]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <Box p={[0, 0.9, -1]} s={[0.9, 0.9, 0.3]} color="#f1f5f9" />
    </group>
  );
}

function LeafBed({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.12, 0]} scale={[1.8, 0.2, 1.1]} receiveShadow castShadow>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#65a30d" roughness={1} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0.4]}>
        <circleGeometry args={[0.9, 5]} />
        <meshStandardMaterial color="#a3e635" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ────────────────────────── Efeitos ambientais ──────────────────────────
function EnvironmentFX() {
  const strobe = useRef<THREE.PointLight>(null);
  const heat = useRef<THREE.HemisphereLight>(null);
  useFrame(({ clock }) => {
    const e = getEngine();
    if (strobe.current) strobe.current.intensity = e.director.strobeFlash > 0 && Math.sin(clock.elapsedTime * 60) > 0 ? 120 : 0;
    if (heat.current) heat.current.intensity = e.heatTimer > 0 ? 0.9 + Math.sin(clock.elapsedTime * 2) * 0.2 : 0;
  });
  return (
    <>
      <pointLight ref={strobe} position={[CLASSROOM.board.x, 6, -3]} color="#e0f2fe" intensity={0} distance={30} />
      <hemisphereLight ref={heat} args={["#fb923c", "#7c2d12", 0]} />
    </>
  );
}

// ────────────────────────── Cena completa ──────────────────────────
export default function SchoolScene() {
  return (
    <group>
      {/* terreno */}
      <mesh position={[5, -0.05, 6]} receiveShadow>
        <boxGeometry args={[70, 0.1, 52]} />
        <meshStandardMaterial color="#3f4a3c" roughness={1} />
      </mesh>
      {/* corredores */}
      <Box p={[-1, 0.01, 8.5]} s={[44, 0.04, 3]} color="#a8a29e" cast={false} />
      <Box p={[21.5, 0.01, 6]} s={[3, 0.04, 40]} color="#a8a29e" cast={false} />

      {Object.values(ZONES).map((z) => (
        <ZoneFloor key={z.id} zone={z} />
      ))}
      <Walls zone={ZONES.classroom} color="#e7e5e4" />
      <Walls zone={ZONES.arena} color="#dbeafe" />
      <Walls zone={ZONES.bathroom} back={3.2} color="#e0f2fe" />
      <Walls zone={ZONES.rest} back={2} side={1} color="#ede9fe" />
      {Object.values(ZONES).map((z) => (
        <ZoneLabel key={z.id} zone={z} y={z.id === "classroom" || z.id === "arena" ? 7.4 : 4.4} />
      ))}

      {/* SALA DE AULA */}
      <Board where="classroom" />
      {PLATE_LETTERS.map((_, i) => (
        <Plate key={`c${i}`} where="classroom" index={i} />
      ))}
      {/* área de resposta demarcada */}
      <mesh position={[CLASSROOM.plates[2].x, 0.07, CLASSROOM.plates[2].z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[15.5, 3.2]} />
        <meshStandardMaterial color="#fde68a" transparent opacity={0.35} />
      </mesh>
      <PheromoneTrail />
      <group position={[CLASSROOM.teacherDesk.x, 0, CLASSROOM.teacherDesk.z]}>
        <Box p={[0, 0.9, 0]} s={[3.6, 0.14, 1.6]} color="#7c2d12" />
        <Box p={[-1.6, 0.45, 0]} s={[0.2, 0.9, 1.4]} color="#431407" />
        <Box p={[1.6, 0.45, 0]} s={[0.2, 0.9, 1.4]} color="#431407" />
        <mesh position={[0.8, 1.2, 0]} castShadow>
          <sphereGeometry args={[0.28, 16, 12]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        <Box p={[-0.6, 1.05, 0.1]} s={[1, 0.16, 0.7]} color="#1d4ed8" />
      </group>
      {CLASSROOM.desks.map((d, i) => (
        <StudentDesk key={i} x={d.x} z={d.z} />
      ))}

      {/* ARENA DE PROVA */}
      <Board where="arena" />
      {PLATE_LETTERS.map((_, i) => (
        <Plate key={`a${i}`} where="arena" index={i} />
      ))}
      <mesh position={[(ARENA.waiting.minX + ARENA.waiting.maxX) / 2, 0.07, (ARENA.waiting.minZ + ARENA.waiting.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ARENA.waiting.maxX - ARENA.waiting.minX, ARENA.waiting.maxZ - ARENA.waiting.minZ]} />
        <meshStandardMaterial color="#bfdbfe" transparent opacity={0.45} />
      </mesh>
      <group position={[ARENA.proctorSpot.x + 0.5, 0, ARENA.proctorSpot.z - 2]}>
        <Box p={[0, 0.8, 0]} s={[2.4, 0.12, 1.2]} color="#334155" />
        <Box p={[0, 0.4, 0]} s={[2.2, 0.8, 0.1]} color="#1e293b" />
      </group>

      {/* PÁTIO / REFEITÓRIO */}
      {PATIO.tables.map((t, i) => (
        <Table key={i} x={t.x} z={t.z} />
      ))}
      {SUGAR_SOURCES.map((s, i) => (
        <Drop key={`s${i}`} x={s.x} z={s.z} kind="sugar" />
      ))}
      {WATER_SOURCES.map((s, i) => (
        <Drop key={`w${i}`} x={s.x} z={s.z} kind="water" />
      ))}
      <Tree x={-19} z={22} />
      <Tree x={17} z={12} s={0.8} />
      <Tree x={2} z={23.5} s={0.9} />

      {/* BANHEIRO */}
      {BATHROOM.stalls.map((s, i) => (
        <Stall key={i} x={s.x} z={s.z} />
      ))}
      {/* DESCANSO */}
      {REST.beds.map((b, i) => (
        <LeafBed key={i} x={b.x} z={b.z} />
      ))}
      <Tree x={32} z={24} s={0.7} />

      <EnvironmentFX />
    </group>
  );
}
