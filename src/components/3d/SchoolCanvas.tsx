"use client";
/**
 * SchoolCanvas — Canvas WebGL isométrico (câmera ortográfica + OrbitControls),
 * laço de simulação acoplado ao frame e câmera que segue a mosca selecionada.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getEngine, useSimStore } from "@/store/useSimStore";
import FlyAgentView from "./FlyAgentView";
import SchoolScene from "./SchoolScene";

function SimulationLoop() {
  useFrame((_, delta) => getEngine().advance(delta));
  return null;
}

function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const selectedId = useSimStore((s) => s.selectedFlyId);
  const { camera } = useThree();
  const focusUntil = useRef(0);
  const last = useRef(new THREE.Vector3());

  useEffect(() => {
    focusUntil.current = performance.now() + 1400;
    const f = getEngine().flyById(selectedId);
    if (f) last.current.set(f.x, f.y, f.z);
  }, [selectedId]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const f = getEngine().flyById(selectedId);
    if (!f) return;
    const target = new THREE.Vector3(f.x, f.y + 0.4, f.z);
    const focusing = performance.now() < focusUntil.current;
    // desloca câmera junto com o alvo (segue a mosca mantendo o ângulo do usuário)
    const prev = c.target.clone();
    c.target.lerp(target, focusing ? 0.12 : 0.25);
    camera.position.add(c.target.clone().sub(prev));
    if (focusing && camera instanceof THREE.OrthographicCamera) {
      camera.zoom += (46 - camera.zoom) * 0.08;
      camera.updateProjectionMatrix();
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[3, 0, 4]}
      maxPolarAngle={Math.PI / 2.25}
      minZoom={6}
      maxZoom={120}
      enableDamping
      dampingFactor={0.12}
    />
  );
}

function Flies() {
  useSimStore((s) => s.populationVersion);
  const flies = getEngine().flies;
  return (
    <>
      {flies.map((f) => (
        <FlyAgentView key={f.id} fly={f} />
      ))}
    </>
  );
}

export default function SchoolCanvas() {
  const select = useSimStore((s) => s.select);
  return (
    <Canvas
      shadows="percentage"
      orthographic
      dpr={[1, 2]}
      camera={{ position: [48, 46, 58], zoom: 15, near: -200, far: 400 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={(e) => e.button === 0 && select(null)}
    >
      <color attach="background" args={["#0b1220"]} />
      <fog attach="fog" args={["#0b1220", 140, 260]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#dbeafe", "#1f2937", 0.55]} />
      <directionalLight
        position={[30, 50, 25]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0005}
      />
      <SimulationLoop />
      <SchoolScene />
      <Flies />
      <CameraRig />
    </Canvas>
  );
}
