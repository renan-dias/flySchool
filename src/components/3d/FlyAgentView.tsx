"use client";
/**
 * FlyAgentView — malha procedural de Drosophila melanogaster com animação de
 * marcha em tripé (6 patas), batimento de asas em voo e extensão da probóscide.
 * A pose é lida do motor a cada frame (sem re-render React).
 */
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import type { FlyAgent } from "@/core/FlyAgent";
import { useSimStore } from "@/store/useSimStore";
import { MODE_META } from "@/components/ui/theme";

// Geometrias compartilhadas por todas as moscas
const G = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  leg: new THREE.CylinderGeometry(0.025, 0.018, 1, 5).translate(0, -0.5, 0),
  wing: (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(-0.3, 0.18, -0.95, 0.2, -1.05, 0.02);
    shape.bezierCurveTo(-0.95, -0.12, -0.3, -0.1, 0, 0);
    return new THREE.ShapeGeometry(shape, 8);
  })(),
  ring: new THREE.RingGeometry(0.55, 0.68, 32).rotateX(-Math.PI / 2),
  halo: new THREE.RingGeometry(0.85, 1.0, 40).rotateX(-Math.PI / 2),
  stripe: new THREE.TorusGeometry(1, 0.08, 6, 20),
  proboscis: new THREE.CylinderGeometry(0.035, 0.05, 1, 6).translate(0, -0.5, 0),
  hit: new THREE.SphereGeometry(0.9, 8, 6),
  puff: new THREE.SphereGeometry(1, 16, 10),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
};

const M = {
  eye: new THREE.MeshStandardMaterial({ color: "#b91c1c", roughness: 0.3, metalness: 0.1 }),
  stripe: new THREE.MeshStandardMaterial({ color: "#2b1d12", roughness: 0.8 }),
  leg: new THREE.MeshStandardMaterial({ color: "#3b2a1a", roughness: 0.9 }),
  wing: new THREE.MeshPhysicalMaterial({ color: "#e0f2fe", transparent: true, opacity: 0.45, roughness: 0.1, side: THREE.DoubleSide, iridescence: 0.8, depthWrite: false }),
  hit: new THREE.MeshBasicMaterial({ visible: false }),
  hat: new THREE.MeshStandardMaterial({ color: "#111827" }),
  tassel: new THREE.MeshStandardMaterial({ color: "#facc15" }),
  puff: new THREE.MeshBasicMaterial({ color: "#a5f3fc", transparent: true, opacity: 0.35, depthWrite: false }),
  halo: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9 }),
};

const LEG_SLOTS = [
  { x: 0.28, side: 1, phase: 0 },
  { x: 0.0, side: 1, phase: Math.PI },
  { x: -0.28, side: 1, phase: 0 },
  { x: 0.28, side: -1, phase: Math.PI },
  { x: 0.0, side: -1, phase: 0 },
  { x: -0.28, side: -1, phase: Math.PI },
];

function FlyAgentViewImpl({ fly }: { fly: FlyAgent }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Mesh | null)[]>([]);
  const wingL = useRef<THREE.Group>(null);
  const wingR = useRef<THREE.Group>(null);
  const proboscis = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const puff = useRef<THREE.Mesh>(null);
  const selected = useSimStore((s) => s.selectedFlyId === fly.id);
  const select = useSimStore((s) => s.select);
  useSimStore((s) => (s.selectedFlyId === fly.id ? s.tick : 0)); // atualiza o rótulo da selecionada

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: fly.color, roughness: 0.55 }), [fly.color]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#5eead4", transparent: true, opacity: 0.75, depthWrite: false }), []);
  const teacher = fly.role === "teacher";
  const scale = teacher ? 0.78 : 0.56;

  useFrame(({ clock }) => {
    const r = root.current;
    if (!r) return;
    r.position.set(fly.x, fly.y, fly.z);
    r.rotation.y = -fly.heading;
    const t = clock.elapsedTime;

    // marcha em tripé
    const walking = fly.speed > 0.05 && !fly.flying;
    legs.current.forEach((leg, i) => {
      if (!leg) return;
      const slot = LEG_SLOTS[i];
      const swing = walking ? Math.sin(fly.legPhase + slot.phase) * 0.45 : 0;
      const tuck = fly.flying ? 1.1 : 0;
      leg.rotation.set(slot.side * (0.95 + tuck * 0.5), swing + slot.x * 1.2, 0);
    });

    // asas: dobradas sobre o abdômen ou batendo em voo
    const flap = fly.flying ? Math.sin(fly.wingPhase) * 0.9 : 0;
    const spread = fly.flying ? 1.1 : 0.18;
    if (wingL.current) wingL.current.rotation.set(-0.12 - flap, spread, 0);
    if (wingR.current) wingR.current.rotation.set(0.12 + flap, -spread, 0);

    if (proboscis.current) proboscis.current.scale.set(1, 0.05 + fly.proboscis * 0.4, 1);

    // leve oscilação do corpo ao caminhar
    if (body.current) body.current.position.y = 0.38 + (walking ? Math.abs(Math.sin(fly.legPhase)) * 0.03 : 0) + (fly.flying ? Math.sin(t * 8) * 0.05 : 0);

    if (ring.current) {
      ringMat.color.set(MODE_META[fly.mode].color);
      ring.current.visible = !fly.flying;
      ring.current.rotation.y = fly.heading;
    }
    if (halo.current) {
      halo.current.visible = selected;
      halo.current.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    }
    if (puff.current) {
      const on = fly.airPuffTimer > 0 || fly.strobeTimer > 0;
      puff.current.visible = on;
      if (on) {
        const k = 1 - Math.max(fly.airPuffTimer / 0.7, fly.strobeTimer / 0.5);
        puff.current.scale.setScalar(0.4 + k * 1.4);
        (puff.current.material as THREE.MeshBasicMaterial).color.set(fly.airPuffTimer > 0 ? "#a5f3fc" : "#f0f9ff");
      }
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(selected ? null : fly.id);
  };

  return (
    <group ref={root}>
      <mesh
        geometry={G.hit}
        material={M.hit}
        position={[0, 0.4, 0]}
        onClick={onClick}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      />
      <mesh ref={ring} geometry={G.ring} material={ringMat} position={[0, 0.1, 0]} scale={teacher ? 1.3 : 1} />
      <mesh ref={halo} geometry={G.halo} material={M.halo} position={[0, 0.11, 0]} visible={false} scale={teacher ? 1.3 : 1} />
      <mesh ref={puff} geometry={G.puff} material={M.puff.clone()} position={[0, 0.4, 0]} visible={false} />

      <group ref={body} scale={scale} position={[0, 0.38, 0]}>
        {/* tórax */}
        <mesh geometry={G.sphere} material={bodyMat} scale={[0.42, 0.34, 0.33]} castShadow />
        {/* abdômen listrado */}
        <group position={[-0.62, -0.02, 0]} rotation={[0, 0, 0.08]}>
          <mesh geometry={G.sphere} material={bodyMat} scale={[0.52, 0.32, 0.32]} castShadow />
          {[-0.05, -0.22, -0.38].map((x, i) => (
            <mesh key={i} geometry={G.stripe} material={M.stripe} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.31 - i * 0.05, 0.31 - i * 0.05, 0.5]} />
          ))}
        </group>
        {/* cabeça + olhos compostos vermelhos */}
        <group position={[0.52, 0.06, 0]}>
          <mesh geometry={G.sphere} material={bodyMat} scale={[0.22, 0.22, 0.24]} castShadow />
          <mesh geometry={G.sphere} material={M.eye} position={[0.04, 0.05, 0.16]} scale={[0.14, 0.16, 0.1]} />
          <mesh geometry={G.sphere} material={M.eye} position={[0.04, 0.05, -0.16]} scale={[0.14, 0.16, 0.1]} />
          <mesh geometry={G.leg} material={M.leg} position={[0.16, 0.14, 0.05]} rotation={[0.3, 0, -2.3]} scale={[1, 0.2, 1]} />
          <mesh geometry={G.leg} material={M.leg} position={[0.16, 0.14, -0.05]} rotation={[-0.3, 0, -2.3]} scale={[1, 0.2, 1]} />
          <mesh ref={proboscis} geometry={G.proboscis} material={M.leg} position={[0.1, -0.15, 0]} rotation={[0, 0, 0.35]} />
        </group>
        {/* asas */}
        <group ref={wingL} position={[0.05, 0.3, 0.08]}>
          <mesh geometry={G.wing} material={M.wing} rotation={[Math.PI / 2, 0, 0]} />
        </group>
        <group ref={wingR} position={[0.05, 0.3, -0.08]}>
          <mesh geometry={G.wing} material={M.wing} rotation={[-Math.PI / 2, 0, 0]} />
        </group>
        {/* seis patas */}
        {LEG_SLOTS.map((slot, i) => (
          <mesh
            key={i}
            ref={(m) => {
              legs.current[i] = m;
            }}
            geometry={G.leg}
            material={M.leg}
            position={[slot.x, -0.18, slot.side * 0.14]}
            scale={[1, 0.62, 1]}
          />
        ))}
        {/* capelo da professora */}
        {teacher && (
          <group position={[0.52, 0.34, 0]}>
            <mesh geometry={G.box} material={M.hat} scale={[0.5, 0.05, 0.5]} rotation={[0, Math.PI / 4, 0]} />
            <mesh geometry={G.cyl} material={M.hat} scale={[0.14, 0.14, 0.14]} position={[0, -0.07, 0]} />
            <mesh geometry={G.sphere} material={M.tassel} scale={0.05} position={[0.2, -0.02, 0.2]} />
          </group>
        )}
      </group>

      {(selected || teacher) && (
        <Html position={[0, teacher ? 1.9 : 1.5, 0]} center distanceFactor={undefined} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-lg ${selected ? "bg-teal-300 text-slate-900" : "bg-slate-900/80 text-slate-100"}`}>
            {teacher ? "👩‍🏫 " : `${MODE_META[fly.mode].icon} `}
            {fly.name}
          </div>
        </Html>
      )}
    </group>
  );
}

export default memo(FlyAgentViewImpl);
