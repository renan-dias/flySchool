"use client";
import { useSimStore } from "@/store/useSimStore";

export default function HelpOverlay() {
  const toggleHelp = useSimStore((s) => s.toggleHelp);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4" onClick={() => toggleHelp(false)}>
      <div className="glass max-w-2xl rounded-2xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="text-4xl">🪰</span>
          <div>
            <h2 className="text-xl font-bold text-white">FlySchool: Bio-Neural Classroom Simulator</h2>
            <p className="text-sm text-teal-300">Laboratório de neuroeducação com Drosophila virtuais</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
          <p>
            <b className="text-white">Cérebros reais em miniatura.</b> Cada aluna roda uma rede de espículas LIF (96 neurônios): visão → Kenyon cells → MBONs,
            dopamina PAM/PPL1, fome, sede, fadiga e neurônios motores DNg. Nada é roteirizado: a escolha da placa sai das taxas de disparo.
          </p>
          <p>
            <b className="text-white">Aprendizado dopaminérgico.</b> Quando uma aluna pousa na placa com glicose, PAM dispara e as sinapses KC→MBON ativas são
            potenciadas: <span className="font-mono text-amber-300">ΔW = η·(PAM − PPL1)·traço</span>. A memória decai, consolida e é testada na prova das 11:30.
          </p>
          <p>
            <b className="text-white">Rotina escolar.</b> Entrada 07:30 · Matemática 08:00 · Recreio 09:30 · Português 10:00 · Prova 11:30. Um dia ≈ 10 min em 1x
            — use 5x/10x para acumular dias.
          </p>
          <p>
            <b className="text-white">Explore.</b> Clique numa mosca para ver o grafo neural ao vivo. Abra o <b>God Panel</b> (G) para crises e métodos de ensino, e o{" "}
            <b>Analytics</b> (D) para curvas e o relatório em PDF. <span className="font-mono">Espaço</span> pausa.
          </p>
        </div>
        <button onClick={() => toggleHelp(false)} className="mt-5 w-full rounded-xl bg-teal-300 py-2 text-sm font-bold text-slate-900">
          Tocar a campainha 🔔
        </button>
      </div>
    </div>
  );
}
