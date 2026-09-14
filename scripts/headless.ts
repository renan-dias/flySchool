// Teste headless: simula N dias sem renderização e imprime curva de aprendizado.
import { SimulationEngine } from "../src/core/SimulationEngine";
import { IDX } from "../src/core/FlyConnectome";

const days = Number(process.argv[2] ?? 3);
const e = new SimulationEngine(12345, 18);
const t0 = Date.now();
let lastDay = 1;
let ticks = 0;
const modeCount: Record<string, number> = {};
while (e.director.day <= days) {
  e.tick();
  ticks++;
  if (ticks % 250 === 0) {
    for (const f of e.students) modeCount[`${e.director.period.id}:${f.mode}`] = (modeCount[`${e.director.period.id}:${f.mode}`] ?? 0) + 1;
  }
  if (ticks % 1500 === 0 && process.env.VERBOSE) {
    const f = e.students[0];
    const r = f.brain.rate;
    console.log(`D${e.director.day} ${e.director.clock} ${e.director.period.id} phase=${e.director.phase}/${e.exam.phase} f0 mode=${f.mode} room=${f.room} pos=(${f.x.toFixed(1)},${f.z.toFixed(1)}) H=${f.homeo.hunger.toFixed(2)} T=${f.homeo.thirst.toFixed(2)} F=${f.homeo.fatigue.toFixed(2)} B=${f.homeo.bladder.toFixed(2)} att=${r[IDX.CX_ATT].toFixed(0)} kc=${Array.from({length:40},(_, i)=>r[IDX.KC+i]).filter(x=>x>3).length} mbon=${Array.from({length:5},(_, i)=>r[IDX.MBON+i].toFixed(0)).join(',')} pam=${r[IDX.PAM].toFixed(0)} ppl1=${r[IDX.PPL1].toFixed(0)} walk=${r[IDX.DN_WALK].toFixed(0)}`);
  }
  if (e.director.day !== lastDay) {
    const d = e.analytics.days.find((x) => x.day === lastDay)!;
    console.log(`=== Dia ${lastDay}: aula mat ${(d.classMath! * 100).toFixed(0)}% ling ${(d.classLang! * 100).toFixed(0)}% | prova mat ${((d.examMath ?? 0) * 100).toFixed(0)}% ling ${((d.examLang ?? 0) * 100).toFixed(0)}% omissão ${((d.omissionRate ?? 0) * 100).toFixed(0)}%`);
    const pres = e.analytics.presentations.filter((p) => p.day === lastDay);
    console.log("   apresentações:", pres.map((p) => `${p.correct}/${p.incorrect}/${p.omission}`).join(" "));
    lastDay = e.director.day;
  }
}
console.log(modeCount);
console.log(`${ticks} ticks em ${(Date.now() - t0) / 1000}s (${((ticks * 0.02) / ((Date.now() - t0) / 1000)).toFixed(1)}x tempo real)`);
const rows = e.analytics.studentMatrix(e.students);
for (const r of rows) console.log(r.id, r.name.padEnd(12), "prova", ((r.examAcc ?? 0) * 100).toFixed(0).padStart(3), "d1", ((r.firstDayAcc ?? 0) * 100).toFixed(0).padStart(3), "dN", ((r.lastDayAcc ?? 0) * 100).toFixed(0).padStart(3), "t", r.meanDecisionTime?.toFixed(1), "distr", r.distraction.toFixed(2), "plast", r.plasticity.toFixed(2), r.profile);
console.log(e.analytics.correlation());
