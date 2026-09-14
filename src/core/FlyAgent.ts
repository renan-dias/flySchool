/**
 * FlyAgent — corpo, sensores, homeostase e cinemática de uma mosca.
 * Todo comportamento de alto nível emerge da leitura das taxas de disparo do conectoma:
 *   sensores → correntes externas → SNN → neurônios de ação / DNg → movimento.
 */
import { ACTION_NAMES, DT, FlyConnectome, IDX, N_MBON, N_VIS, type Personality } from "./FlyConnectome";
import { RNG } from "./rng";
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
  clampToZone,
  dist,
  inZone,
  nearest,
} from "./SchoolLayout";
import type { ActionMode, Role, SchoolContext, Vec2 } from "./types";
import { PoolDecoder } from "./fullbrain/PoolDecoder";
import { EMPTY_INPUT, type ExternalBrain, type FullBrainInput } from "./fullbrain/types";

export type RoomId = "classroom" | "arena" | "patio" | "bathroom" | "rest" | "hall";

/** Visão do mundo que o motor entrega a cada agente em cada tick. */
export interface WorldView {
  time: number;
  context: SchoolContext;
  classroomStimulus: Uint8Array | null;
  arenaStimulus: Uint8Array | null;
  /** Chave do marcador odorífero do problema na lousa (usada pelo cérebro FlyWire). */
  classroomOdorKey: number | null;
  arenaOdorKey: number | null;
  trialActive: boolean;
  trialRoom: "classroom" | "arena" | null;
  trialId: number;
  /** Placa correta — usada apenas pela trilha de feromônio (estímulo químico real no chão). */
  guidePlate: number;
  pheromoneTrail: boolean;
  /** Placas da sala com gota de glicose e sua concentração. */
  rewardPlates: number[];
  rewardMagnitude: number;
  heat: number;
  pheromoneStorm: number;
  flies: FlyAgent[];
}

export interface Homeostasis {
  hunger: number;
  thirst: number;
  fatigue: number;
  bladder: number;
}

const ACTION_COUNT = ACTION_NAMES.length;

export function roomOf(p: Vec2): RoomId {
  if (inZone(p, ZONES.classroom)) return "classroom";
  if (inZone(p, ZONES.arena)) return "arena";
  if (inZone(p, ZONES.patio)) return "patio";
  if (inZone(p, ZONES.bathroom)) return "bathroom";
  if (inZone(p, ZONES.rest)) return "rest";
  return "hall";
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class FlyAgent {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly brain: FlyConnectome;
  readonly personality: Personality;
  readonly color: string;

  x = 0;
  z = 0;
  y = 0;
  heading = 0;
  speed = 0;
  flying = false;
  target: Vec2 = { x: 0, z: 0 };
  targetY = 0;
  seat: Vec2;
  waitSpot: Vec2;

  mode: ActionMode = "attend";
  private modeSince = 0;
  homeo: Homeostasis;

  // Decisão
  trialId = -1;
  trialStart = 0;
  readonly evidence = new Float32Array(N_MBON);
  committed = -1;
  onPlate = -1;
  private onPlateSince = 0;
  locked = -1;
  lockTime = -1;
  path: Vec2[] = [];
  private lastPathSample = 0;

  // Efeitos transitórios
  airPuffTimer = 0;
  strobeTimer = 0;
  feeding = false;
  drinking = false;
  proboscis = 0;
  legPhase = 0;
  wingPhase = 0;

  // Estatísticas de atenção em aula
  classTicks = 0;
  attendTicks = 0;

  /**
   * Cérebro FlyWire completo (138.639 neurônios) rodando num Web Worker. Quando presente,
   * percepção, memória (KC→MBON), decisão, direção (PFL3→DNa02), alimentação (MN9) e fuga (Giant Fiber)
   * são lidas dele; o conectoma reduzido deixa de ser integrado para esta mosca.
   */
  external: ExternalBrain | null = null;
  readonly poolDecoder: PoolDecoder;
  private extInput: FullBrainInput = { ...EMPTY_INPUT };
  private trailSmell = 0;

  /** Alvo scriptado (professor). */
  scriptTarget: Vec2 | null = null;

  private wanderTarget: Vec2 | null = null;
  private wanderUntil = 0;
  private rng: RNG;
  private mbonBuf = new Float32Array(N_MBON);

  constructor(opts: { id: string; name: string; role: Role; seed: number; seat: Vec2; color: string }) {
    this.id = opts.id;
    this.name = opts.name;
    this.role = opts.role;
    this.color = opts.color;
    this.rng = new RNG(opts.seed * 7 + 13);
    const r = this.rng;
    const lognorm = (s: number) => Math.exp(r.gauss() * s);
    this.personality =
      opts.role === "teacher"
        ? { appetite: 0.3, focus: 1.4, curiosity: 0.3, stamina: 2, sociability: 1, plasticity: 0.2 }
        : {
            appetite: Math.min(2.2, Math.max(0.5, lognorm(0.4))),
            focus: Math.min(1.5, Math.max(0.55, 1 + r.gauss() * 0.2)),
            curiosity: Math.min(2, Math.max(0.3, lognorm(0.4))),
            stamina: Math.min(1.6, Math.max(0.6, lognorm(0.2))),
            sociability: Math.min(1.6, Math.max(0.5, lognorm(0.3))),
            plasticity: Math.min(1.8, Math.max(0.25, lognorm(0.45))),
          };
    this.brain = new FlyConnectome(opts.seed, this.personality);
    this.poolDecoder = new PoolDecoder(opts.seed, 2.5 * this.personality.curiosity);
    this.seat = opts.seat;
    this.waitSpot = {
      x: r.range(ARENA.waiting.minX, ARENA.waiting.maxX),
      z: r.range(ARENA.waiting.minZ, ARENA.waiting.maxZ),
    };
    this.homeo = {
      hunger: r.range(0.1, 0.3),
      thirst: r.range(0.05, 0.25),
      fatigue: r.range(0.05, 0.2),
      bladder: r.range(0.05, 0.25),
    };
    this.x = opts.seat.x + r.range(-3, 3);
    this.z = 20 + r.range(-3, 3); // chegam pelo pátio
    this.heading = r.range(-Math.PI, Math.PI);
    this.target = { ...opts.seat };
  }

  get pos(): Vec2 {
    return { x: this.x, z: this.z };
  }

  get room(): RoomId {
    return roomOf(this.pos);
  }

  attention(): number {
    if (this.external) {
      // arbitragem homeostática: estados internos reduzem o ganho sensorial da lousa
      const h = this.homeo;
      return Math.max(
        0.15,
        Math.min(
          1,
          0.85 + 0.15 * (this.personality.focus - 1) - 1.3 * Math.max(0, h.hunger - 0.55) - Math.max(0, h.fatigue - 0.6) - 1.2 * Math.max(0, h.bladder - 0.6) - 0.8 * Math.max(0, h.thirst - 0.6),
        ),
      );
    }
    return clamp01(this.brain.rate[IDX.CX_ATT] / 25);
  }

  /** Leitura motora da probóscide — DNg12 (reduzido) ou MN9 (FlyWire completo). */
  private proboscisActive(threshold: number): boolean {
    if (this.external) return (this.external.readout?.rates.mn9 ?? 0) > threshold * 0.4;
    return this.brain.rate[IDX.DN_PROBOSCIS] > threshold;
  }

  // ─────────────────────────────── Tick ───────────────────────────────
  step(dt: number, w: WorldView) {
    const b = this.brain;
    const pos = this.pos;
    const room = roomOf(pos);
    if (this.external && this.role === "student") {
      this.stepExternal(dt, w, room);
      return;
    }
    // 1) Transdução sensorial → correntes externas
    b.clearInputs();
    const att = this.attention();
    const stim = room === "classroom" ? w.classroomStimulus : room === "arena" ? w.arenaStimulus : null;
    if (stim) for (let i = 0; i < N_VIS; i++) if (stim[i]) b.setInput(IDX.VIS + i, 0.8 + 0.9 * att);

    let sugarContact = 0;
    const sugar = nearest(pos, SUGAR_SOURCES);
    if (sugar.d < 1.0) sugarContact = 1;
    if (room === "classroom")
      for (const plate of w.rewardPlates) if (dist(pos, CLASSROOM.plates[plate]) < PLATE_RADIUS + 0.2) sugarContact = w.rewardMagnitude;
    const waterContact = nearest(pos, WATER_SOURCES).d < 1.0 ? 1 : 0;
    b.setInput(IDX.SUGAR, sugarContact * 1.8);
    b.setInput(IDX.WATER, waterContact * 1.8);

    let neighbors = 0;
    for (const f of w.flies) if (f !== this && Math.abs(f.x - this.x) < 2.5 && Math.abs(f.z - this.z) < 2.5) neighbors++;
    const trailSmell = w.pheromoneTrail && w.trialActive && room === "classroom" && w.guidePlate >= 0 ? 1.6 : 0;
    b.setInput(IDX.PHERO, trailSmell + Math.min(1.2, neighbors * 0.25) * 0.6 + w.pheromoneStorm * 1.6);
    b.setInput(IDX.GR28B, w.heat * 1.9);
    b.setInput(IDX.LUM, this.strobeTimer > 0 ? 1.9 : 0);
    b.setInput(IDX.AIR, this.airPuffTimer > 0 ? 2.1 : 0);

    const stateDrive = (lvl: number) => 0.4 + 2.3 * Math.max(0, lvl - 0.42);
    b.setInput(IDX.HUNGER, stateDrive(this.homeo.hunger));
    b.setInput(IDX.THIRST, stateDrive(this.homeo.thirst));
    b.setInput(IDX.FATIGUE, stateDrive(this.homeo.fatigue));
    b.setInput(IDX.BLADDER, stateDrive(this.homeo.bladder));

    const ctx = w.context;
    b.setInput(IDX.CTX_CLASS, ctx === "class" || ctx === "entry" ? 1.8 : 0);
    b.setInput(IDX.CTX_RECESS, ctx === "recess" || ctx === "dismissal" ? 1.8 : 0);
    b.setInput(IDX.CTX_EXAM, ctx === "exam" ? 1.8 : 0);

    // Navegação: erro de rumo até o alvo alimenta PFL3 esquerdo/direito
    const dx = this.target.x - this.x;
    const dz = this.target.z - this.z;
    const d = Math.hypot(dx, dz);
    const desired = Math.atan2(dz, dx);
    const err = wrapAngle(desired - this.heading);
    const arriveR = 0.35;
    b.setInput(IDX.CX_NAV_L, 0.85 + 1.6 * Math.max(0, err));
    b.setInput(IDX.CX_NAV_R, 0.85 + 1.6 * Math.max(0, -err));
    b.setInput(IDX.DN_TURN_L, 0.6);
    b.setInput(IDX.DN_TURN_R, 0.6);
    b.setInput(IDX.DN_WALK, d > arriveR ? 1.25 : 0);
    b.setInput(IDX.DN_HOLD, d <= arriveR ? 1.6 : 0);
    b.setInput(IDX.DN_FLIGHT, d > 9 ? 1.5 : 0);
    b.setInput(IDX.DN_LAND, this.flying && d < 3 ? 1.9 : 0);

    // Cópia eferente da escolha comprometida (credit assignment no MB)
    if (this.committed >= 0)
      for (let j = 0; j < N_MBON; j++) b.addInput(IDX.MBON + j, j === this.committed ? 0.55 : -0.35);

    // 2) Integração da SNN
    b.step(Math.max(1, Math.round(dt / DT)), this.role === "student");

    // 3) Seleção de ação (winner-take-all com histerese)
    if (this.role === "student") this.selectAction(w);
    else this.mode = "attend";

    // 4) Planejamento de alvo + processo de decisão
    if (this.role === "teacher") {
      if (this.scriptTarget) this.target = this.scriptTarget;
    } else this.plan(w, room);

    // 5) Cinemática guiada por DNg
    this.move(dt, w, err, d);

    // 6) Homeostase
    this.updateHomeostasis(dt, sugarContact, waterContact, room);

    // 7) Efeitos
    this.airPuffTimer = Math.max(0, this.airPuffTimer - dt);
    this.strobeTimer = Math.max(0, this.strobeTimer - dt);
    if (ctx === "class" && this.role === "student") {
      this.classTicks++;
      if (this.mode === "attend") this.attendTicks++;
    }
  }

  /** Tick de uma mosca com cérebro FlyWire completo. */
  private stepExternal(dt: number, w: WorldView, room: RoomId) {
    const ext = this.external!;
    const pos = this.pos;
    const att = this.attention();
    const q = (x: number, step = 5) => Math.round(x / step) * step;

    let sugarContact = 0;
    if (nearest(pos, SUGAR_SOURCES).d < 1.0) sugarContact = 1;
    if (room === "classroom")
      for (const plate of w.rewardPlates) if (dist(pos, CLASSROOM.plates[plate]) < PLATE_RADIUS + 0.2) sugarContact = w.rewardMagnitude;
    const waterContact = nearest(pos, WATER_SOURCES).d < 1.0 ? 1 : 0;
    let neighbors = 0;
    for (const f of w.flies) if (f !== this && Math.abs(f.x - this.x) < 2.5 && Math.abs(f.z - this.z) < 2.5) neighbors++;
    this.trailSmell = w.pheromoneTrail && w.trialActive && room === "classroom" && w.guidePlate >= 0 ? 1 : 0;

    const dx = this.target.x - this.x;
    const dz = this.target.z - this.z;
    const d = Math.hypot(dx, dz);
    const err = wrapAngle(Math.atan2(dz, dx) - this.heading);

    // 1) Transdução → taxas de Poisson nos neurônios sensoriais reais
    const stim = room === "classroom" ? w.classroomStimulus : room === "arena" ? w.arenaStimulus : null;
    const key = room === "classroom" ? w.classroomOdorKey : room === "arena" ? w.arenaOdorKey : null;
    const inp = this.extInput;
    inp.odorKey = stim ? key : null;
    inp.odorHz = stim ? q(60 * att) : 0;
    inp.retina = stim ? Array.from(stim).flatMap((bit, i) => (bit ? [i] : [])) : null;
    inp.retinaHz = stim ? q(6 * att, 2) : 0;
    const puff = this.airPuffTimer > 0;
    const strobe = this.strobeTimer > 0;
    inp.sugarHz = sugarContact > 0 ? 120 : 0;
    inp.pamHz = q(40 * sugarContact + 10 * waterContact);
    inp.ppl1Hz = q((puff ? 40 : 0) + (strobe ? 20 : 0) + w.heat * 15);
    inp.windHz = puff ? 40 : 0;
    inp.heatHz = w.heat * 80;
    inp.ocellarHz = strobe ? 60 : 0;
    inp.pheromoneHz = q(Math.min(30, neighbors * 6) + w.pheromoneStorm * 40 + this.trailSmell * 30, 10);
    // Complexo Central: erro de rumo → PFL3 (o lado contralateral ativa DNa02)
    inp.pfl3RightHz = err > 0.05 ? q(Math.min(80, 70 * err), 10) : 0;
    inp.pfl3LeftHz = err < -0.05 ? q(Math.min(80, -70 * err), 10) : 0;
    inp.efferencePool = this.committed;
    const hm = this.homeo;
    inp.dh44Hz = q(40 * hm.hunger);
    inp.ipcHz = q(30 * (1 - hm.hunger));
    inp.itpHz = q(40 * hm.thirst);
    inp.dfbHz = q(40 * hm.fatigue);
    inp.dh31Hz = q(40 * hm.bladder);
    inp.learning = true;
    ext.request(inp, Math.max(1, Math.round(dt * 1000)));

    // 2) Arbitragem homeostática + plano + decisão (lida dos MBONs reais)
    this.arbitrate(w, sugarContact);
    this.plan(w, room);

    // 3) Cinemática e homeostase
    this.move(dt, w, err, d);
    this.updateHomeostasis(dt, sugarContact, waterContact, room);
    this.airPuffTimer = Math.max(0, this.airPuffTimer - dt);
    this.strobeTimer = Math.max(0, this.strobeTimer - dt);
    if (w.context === "class") {
      this.classTicks++;
      if (this.mode === "attend") this.attendTicks++;
    }
  }

  /** Seleção de programa motor para moscas FlyWire (modelo de utilidade homeostática, fora do conectoma). */
  private arbitrate(w: WorldView, sugarContact: number) {
    const h = this.homeo;
    const ctx = w.context;
    const lesson = ctx === "class" || ctx === "entry" || ctx === "exam";
    const recess = ctx === "recess" || ctx === "dismissal";
    const startle = this.airPuffTimer > 0 || this.strobeTimer > 0 ? 0.5 : 0;
    const score: Record<ActionMode, number> = {
      attend:
        (lesson ? 1 : 0.15) +
        0.25 * (this.personality.focus - 1) -
        1.3 * Math.max(0, h.hunger - 0.55) -
        Math.max(0, h.fatigue - 0.6) -
        1.4 * Math.max(0, h.bladder - 0.6) -
        0.8 * Math.max(0, h.thirst - 0.6) +
        startle,
      forage: 1.6 * Math.max(0, h.hunger - 0.45) + (recess ? 0.35 : 0) + sugarContact * 0.2 - startle * 2,
      drink: 1.6 * Math.max(0, h.thirst - 0.45) + (recess ? 0.3 : 0),
      rest: 1.6 * Math.max(0, h.fatigue - 0.5) + w.heat * 0.4 + (recess ? 0.1 : 0),
      relief: 1.9 * Math.max(0, h.bladder - 0.5),
      social: (recess ? 0.55 * this.personality.sociability : 0) - (lesson ? 1 : 0) - startle * 2,
    };
    let best: ActionMode = this.mode;
    for (const m of ACTION_NAMES) if (score[m] > score[best]) best = m;
    if (best !== this.mode && w.time - this.modeSince > 1 && score[best] > score[this.mode] + 0.1) {
      this.mode = best;
      this.modeSince = w.time;
      this.wanderTarget = null;
    }
  }

  private selectAction(w: WorldView) {
    const r = this.brain.rate;
    let best = 0;
    for (let a = 1; a < ACTION_COUNT; a++) if (r[IDX.ACT + a] > r[IDX.ACT + best]) best = a;
    const current = ACTION_NAMES.indexOf(this.mode);
    const rb = r[IDX.ACT + best];
    const rc = r[IDX.ACT + current];
    if (best !== current && w.time - this.modeSince > 1.0 && rb > rc * 1.15 + 2) {
      this.mode = ACTION_NAMES[best];
      this.modeSince = w.time;
      this.wanderTarget = null;
    }
    // Urgências fisiológicas extremas sobrepõem-se (reflexos homeostáticos)
    if (this.homeo.bladder > 0.97 && this.mode !== "relief") {
      this.mode = "relief";
      this.modeSince = w.time;
    }
  }

  private plan(w: WorldView, room: RoomId) {
    const ctx = w.context;
    const h = this.homeo;
    const inLesson = ctx === "class" || ctx === "entry" || ctx === "exam";
    const homeRoom = ctx === "exam" ? ZONES.arena : ZONES.classroom;

    // Novo ensaio → zera acumulador de evidência
    if (w.trialId !== this.trialId) {
      this.trialId = w.trialId;
      this.trialStart = w.time;
      this.evidence.fill(0);
      this.poolDecoder.reset();
      this.committed = -1;
      this.locked = -1;
      this.lockTime = -1;
      this.onPlate = -1;
      this.path = [];
      this.lastPathSample = -1;
    }
    if (!w.trialActive) this.committed = -1;
    const trialHere = w.trialActive && ((w.trialRoom === "classroom" && room === "classroom") || (w.trialRoom === "arena" && room === "arena"));

    switch (this.mode) {
      case "attend": {
        if (w.trialActive && trialHere) {
          this.decide(w);
          const plates = w.trialRoom === "arena" ? ARENA.plates : CLASSROOM.plates;
          if (this.committed >= 0) {
            const pl = plates[this.committed];
            const jitter = (this.id.charCodeAt(this.id.length - 1) % 7) / 7;
            this.target = { x: pl.x + Math.cos(jitter * 6.28) * 0.45, z: pl.z + Math.sin(jitter * 6.28) * 0.45 };
          }
          // posição sobre as placas
          let on = -1;
          for (let k = 0; k < plates.length; k++) if (dist(this.pos, plates[k]) < PLATE_RADIUS + 0.25) on = k;
          if (on !== this.onPlate) {
            this.onPlate = on;
            this.onPlateSince = w.time;
          }
          if (this.locked < 0 && on >= 0 && on === this.committed && w.time - this.onPlateSince >= 1.2) {
            this.locked = on;
            this.lockTime = w.time - this.trialStart;
          }
          if (w.time - this.lastPathSample >= 0.25) {
            this.path.push({ x: +this.x.toFixed(2), z: +this.z.toFixed(2) });
            this.lastPathSample = w.time;
          }
        } else if (w.trialActive && w.trialRoom === "arena") {
          this.target = this.waitSpot; // ainda chegando à arena
        } else if (ctx === "exam") this.target = this.waitSpot;
        else if (ctx === "class" || ctx === "entry") this.target = this.seat;
        else this.target = PATIO.socialCenter;
        this.targetY = 0;
        break;
      }
      case "forage": {
        if (!inLesson || h.hunger > 0.9) {
          this.target = nearest(this.pos, SUGAR_SOURCES).point;
          this.targetY = TABLE_HEIGHT;
        } else if (room === "classroom" && w.rewardPlates.length && nearest(this.pos, w.rewardPlates.map((k) => CLASSROOM.plates[k])).d < 4) {
          this.target = nearest(this.pos, w.rewardPlates.map((k) => CLASSROOM.plates[k])).point;
          this.targetY = 0;
        } else this.wander(w, homeRoom);
        break;
      }
      case "drink": {
        if (!inLesson || h.thirst > 0.9) {
          this.target = nearest(this.pos, WATER_SOURCES).point;
          this.targetY = TABLE_HEIGHT;
        } else this.wander(w, homeRoom);
        break;
      }
      case "rest": {
        if (!inLesson || h.fatigue > 0.85) {
          this.target = REST.beds[this.hashIndex(REST.beds.length)];
        } else if (this.speed < 0.05 && !this.wanderTarget) {
          this.target = this.pos; // cochila onde está
        }
        this.targetY = 0;
        break;
      }
      case "relief": {
        this.target = BATHROOM.stalls[this.hashIndex(BATHROOM.stalls.length)];
        this.targetY = 0;
        break;
      }
      case "social": {
        let best: FlyAgent | null = null;
        let bd = 7;
        for (const f of w.flies) {
          if (f === this || f.role === "teacher") continue;
          const dd = dist(this.pos, f.pos);
          if (dd < bd && dd > 0.8) {
            bd = dd;
            best = f;
          }
        }
        if (inLesson) this.wander(w, homeRoom);
        else if (best && w.time % 6 < 4) this.target = { x: best.x + 0.6, z: best.z };
        else this.wander(w, ZONES.patio);
        this.targetY = 0;
        break;
      }
    }
  }

  /** Acumulador de evidência sobre as taxas MBON (drift-diffusion) → comprometimento com uma placa. */
  private decide(w: WorldView) {
    if (this.committed >= 0) return;
    if (this.external) {
      const r = this.external.readout;
      if (!r) return;
      const guide = w.pheromoneTrail && w.guidePlate >= 0 && this.trailSmell > 0 ? w.guidePlate : -1;
      const choice = this.poolDecoder.accumulate(r.pools, (w.time - this.trialStart) * 1000, (j) => (j === guide ? 0.08 : 0));
      for (let j = 0; j < N_MBON; j++) this.evidence[j] = this.poolDecoder.evidence[j];
      if (choice >= 0) this.committed = choice;
      return;
    }
    const r = this.brain.mbonRates(this.mbonBuf);
    let mean = 0;
    let total = 0;
    for (let j = 0; j < N_MBON; j++) total += r[j];
    mean = total / N_MBON;
    const dt = 0.02;
    for (let j = 0; j < N_MBON; j++) this.evidence[j] += ((r[j] - mean) / 12) * dt + this.rng.gauss() * 0.03 * this.personality.curiosity;
    const phero = this.brain.rate[IDX.PHERO];
    if (w.pheromoneTrail && w.guidePlate >= 0 && phero > 8) this.evidence[w.guidePlate] += (phero / 40) * 0.9 * dt;

    let best = 0;
    for (let j = 1; j < N_MBON; j++) if (this.evidence[j] > this.evidence[best]) best = j;
    const elapsed = w.time - this.trialStart;
    const activeEnough = total > 4;
    if ((this.evidence[best] > 0.45 && activeEnough) || (elapsed > 2.8 && activeEnough)) {
      // Exploração: fração de escolhas aleatórias (curiosidade)
      this.committed = this.rng.next() < 0.05 * this.personality.curiosity ? this.rng.int(N_MBON) : best;
    }
  }

  private wander(w: WorldView, zone: (typeof ZONES)[keyof typeof ZONES]) {
    if (!this.wanderTarget || w.time > this.wanderUntil || dist(this.pos, this.wanderTarget) < 0.5) {
      const base = inZone(this.pos, zone) ? this.pos : { x: (zone.minX + zone.maxX) / 2, z: (zone.minZ + zone.maxZ) / 2 };
      this.wanderTarget = clampToZone({ x: base.x + this.rng.range(-5, 5), z: base.z + this.rng.range(-5, 5) }, zone, 1);
      this.wanderUntil = w.time + this.rng.range(0.8, 2.2);
    }
    this.target = this.wanderTarget;
    this.targetY = 0;
  }

  private hashIndex(n: number): number {
    let h = 0;
    for (let i = 0; i < this.id.length; i++) h = (h * 31 + this.id.charCodeAt(i)) | 0;
    return Math.abs(h) % n;
  }

  private move(dt: number, w: WorldView, err: number, d: number) {
    const r = this.brain.rate;
    const teacher = this.role === "teacher";
    const ext = this.external?.readout ?? null;

    // Giro: PFL3→DNa02 (reduzido: CX_NAV/DN_TURN; FlyWire: DNa02 esquerdo − direito)
    let omega = ext
      ? (ext.rates.dna02_left - ext.rates.dna02_right) * 0.05
      : (r[IDX.CX_NAV_L] - r[IDX.CX_NAV_R]) * 0.07 + (r[IDX.DN_TURN_L] - r[IDX.DN_TURN_R]) * 0.03;
    // Ganho proporcional do erro de rumo cresce com a velocidade (estabilização optomotora em voo)
    omega += err * (ext ? 0.8 + this.speed * 0.9 : 1.5 + this.speed * 0.9);
    if (teacher || d < 1.5) omega = omega * 0.3 + err * 5; // reflexo de alinhamento fino
    omega = Math.max(-10, Math.min(10, omega));
    this.heading = wrapAngle(this.heading + omega * dt);

    // Voo curto
    if (this.external) {
      // voo voluntário para alvos distantes; decolagem de fuga pela Giant Fiber (DNp01)
      if (!this.flying && (d > 9 || (ext?.rates.giant_fiber ?? 0) > 10)) this.flying = true;
      if (this.flying && d < 2.5) this.flying = false;
    } else {
      if (!this.flying && r[IDX.DN_FLIGHT] > 18 && d > 6) this.flying = true;
      if (this.flying && (r[IDX.DN_LAND] > 18 || d < 1.2)) this.flying = false;
    }

    const fatigueSlow = 1 - 0.5 * this.homeo.fatigue;
    let v: number;
    if (teacher) v = d > 0.3 ? Math.min(3.2, d * 2) : 0;
    else if (this.flying) v = 8 * fatigueSlow;
    else if (this.external) v = (d > 0.35 ? 3.4 : 0) * fatigueSlow;
    else v = 3.4 * Math.min(1.2, r[IDX.DN_WALK] / 40) * fatigueSlow;
    if (!teacher && this.proboscisActive(12) && (this.feeding || this.drinking)) v *= 0.1;
    // desacelera quando o alvo está atrás; aproximação final proporcional
    v *= Math.max(0.15, Math.cos(err) * 0.5 + 0.5);
    if (d < 1.2) v = Math.min(v, d * 2.2);
    if (d < 0.08) v = 0;
    this.speed += (v - this.speed) * Math.min(1, dt * 8);

    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    // Separação corporal (evita sobreposição)
    if (!this.flying)
      for (const f of w.flies) {
        if (f === this || f.flying) continue;
        const ox = this.x - f.x;
        const oz = this.z - f.z;
        const dd = ox * ox + oz * oz;
        if (dd < 0.2 && dd > 1e-6) {
          const s = ((0.45 - Math.sqrt(dd)) * 0.5 * dt * 10) / Math.sqrt(dd);
          this.x += ox * s;
          this.z += oz * s;
        }
      }
    this.x = Math.max(-23, Math.min(34, this.x));
    this.z = Math.max(-14, Math.min(26, this.z));

    // Altitude: voo, pouso na mesa do refeitório
    const nearTable = PATIO.tables.some((t) => Math.abs(this.x - t.x) < 1.6 && Math.abs(this.z - t.z) < 1.1);
    const groundY = this.targetY > 0 && nearTable ? TABLE_HEIGHT : 0;
    const desiredY = this.flying ? 2.6 : groundY;
    this.y += (desiredY - this.y) * Math.min(1, dt * 4);

    // Animação
    this.legPhase += this.speed * dt * 9;
    this.wingPhase += dt * (this.flying ? 90 : 0);
    const prob = this.proboscisActive(10) ? 1 : 0;
    this.proboscis += (prob - this.proboscis) * Math.min(1, dt * 6);
  }

  private updateHomeostasis(dt: number, sugarContact: number, waterContact: number, room: RoomId) {
    const h = this.homeo;
    const p = this.personality;
    const activity = 1 + this.speed / 5 + (this.flying ? 1 : 0);
    if (this.role === "teacher") {
      h.hunger = h.thirst = h.bladder = 0.1;
      h.fatigue = 0.15;
      return;
    }
    h.hunger += 0.0015 * p.appetite * activity * dt;
    h.thirst += 0.00032 * activity * dt;
    h.fatigue += ((0.00017 + this.speed * 0.00008 + (this.flying ? 0.0004 : 0)) / p.stamina) * dt;
    h.bladder += 0.00015 * dt;

    // sem leitura ainda (cérebro FlyWire carregando), a extensão da probóscide é reflexa ao contato
    const prob = this.external && !this.external.readout ? true : this.proboscisActive(6);
    this.feeding = sugarContact > 0 && prob && h.hunger > 0.02;
    this.drinking = waterContact > 0 && prob && h.thirst > 0.02;
    if (this.feeding) {
      const eat = (room === "classroom" ? 0.05 : 0.14) * dt;
      h.hunger -= eat;
      h.bladder += eat * 0.08;
    }
    if (this.drinking) {
      h.thirst -= 0.16 * dt;
      h.bladder += 0.015 * dt;
    }
    if (this.mode === "rest" && this.speed < 0.2) h.fatigue -= (room === "rest" ? 0.035 : 0.006) * dt;
    if (this.mode === "relief" && room === "bathroom" && nearest(this.pos, BATHROOM.stalls).d < 1.2) h.bladder -= 0.2 * dt;
    h.hunger = clamp01(h.hunger);
    h.thirst = clamp01(h.thirst);
    h.fatigue = clamp01(h.fatigue);
    h.bladder = clamp01(h.bladder);
  }

  /** Noite: sono consolida memória e restaura fadiga; metabolismo continua. */
  overnight() {
    this.brain.consolidateOvernight();
    const r = this.rng;
    this.homeo.fatigue = r.range(0.02, 0.15);
    this.homeo.hunger = Math.min(0.45, this.homeo.hunger * 0.4 + r.range(0.1, 0.25));
    this.homeo.thirst = r.range(0.05, 0.25);
    this.homeo.bladder = r.range(0.05, 0.25);
    this.x = this.seat.x + r.range(-3, 3);
    this.z = 20 + r.range(-3, 3);
    this.y = 0;
    this.flying = false;
    this.mode = "attend";
  }
}
