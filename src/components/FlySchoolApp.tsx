"use client";
/**
 * FlySchoolApp — composição da aplicação: cena 3D em tela cheia + painéis flutuantes.
 */
import { useEffect } from "react";
import SchoolCanvas from "./3d/SchoolCanvas";
import AnalyticsDashboard from "./ui/AnalyticsDashboard";
import BrainGraphModal from "./ui/BrainGraphModal";
import EventFeed from "./ui/EventFeed";
import GodPanel from "./ui/GodPanel";
import HelpOverlay from "./ui/HelpOverlay";
import TopBar from "./ui/TopBar";
import { useSimStore } from "@/store/useSimStore";

export default function FlySchoolApp() {
  const { showDashboard, showGod, showHelp, selectedFlyId, bump } = useSimStore();

  // Pulso de UI (~4 Hz) — o motor roda no laço do WebGL, a UI só amostra.
  useEffect(() => {
    const id = setInterval(bump, 250);
    return () => clearInterval(id);
  }, [bump]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const s = useSimStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.setPaused(!s.paused);
      } else if (e.key === "Escape") s.select(null);
      else if (e.key === "g") s.toggleGod();
      else if (e.key === "d") s.toggleDashboard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const brainOpen = !!selectedFlyId;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-lab-950">
      <div className="absolute inset-0">
        <SchoolCanvas />
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3">
        <TopBar />
        <div className="relative flex min-h-0 flex-1 gap-3">
          <div className="flex min-h-0 flex-col justify-between gap-3">
            {showGod ? <GodPanel /> : <div />}
            {!showGod && !showDashboard && <EventFeed />}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-end">{showDashboard && <AnalyticsDashboard />}</div>
          {brainOpen && (
            <div className="flex min-h-0 flex-col">
              <BrainGraphModal />
            </div>
          )}
        </div>
      </div>

      {showHelp && <HelpOverlay />}
    </main>
  );
}
