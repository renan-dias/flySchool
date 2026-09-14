"use client";
import dynamic from "next/dynamic";

/** WebGL + motor SNN só existem no navegador: carregamento sem SSR. */
const FlySchoolApp = dynamic(() => import("./FlySchoolApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-lab-950">
      <div className="text-5xl animate-bounce">🪰</div>
      <p className="font-mono text-sm text-slate-400">Montando conectomas e acendendo a escola…</p>
    </div>
  ),
});

export default function FlySchoolLoader() {
  return <FlySchoolApp />;
}
