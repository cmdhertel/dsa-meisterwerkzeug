// Rough difficulty heuristic for an encounter. Pure. DSA5 has no official encounter rating: this is only a guide.
import { DiceSpec, tryParseDice } from "../engine/dice";
import type { Combatant, Weapon } from "../model";

// ------------------------------------------------------------------ tunables (one place)

/** Used for every missing value; shown to the GM whenever it was applied. */
export interface FallbackStats {
  at: number;
  tp: string;
  pa: number;
  rs: number;
  /** LeP of a creature/hero whose LeP is unknown */
  lep: number;
}
export const DEFAULT_FALLBACK: FallbackStats = { at: 12, tp: "1W6+4", pa: 7, rs: 2, lep: 30 };

/** Party assumed when no heroes are available at all. */
export const DEFAULT_PARTY = { count: 4, lep: 30 };

/** Attack chance is clamped to this range. */
export const HIT_CHANCE_MIN = 0.05;
export const HIT_CHANCE_MAX = 0.95;
/** Each further attack against the same defender in a round is this much harder to defend (DSA5 rule). */
export const DEFENSE_STEP_PENALTY = 3;

/**
 * Thresholds on ratio = (rounds the enemies need to drop the heroes) / (rounds the heroes need to drop the enemies).
 * ratio >= leicht -> "leicht"; >= ausgeglichen -> "ausgeglichen"; >= fordernd -> "fordernd"; >= gefaehrlich -> "gefährlich";
 * below that "tödlich".
 */
export const RATIO_THRESHOLDS = { leicht: 4, ausgeglichen: 2.5, fordernd: 1.5, gefaehrlich: 1 } as const;

export type Rating = "leicht" | "ausgeglichen" | "fordernd" | "gefährlich" | "tödlich" | "unbestimmt";

// ------------------------------------------------------------------ types

/** One kind of fighter on a side (count identical copies). */
export interface Unit {
  name: string;
  count: number;
  lep: number;
  /** attacks per combat round */
  actions: number;
  at: number;
  /** average damage of the best weapon */
  tpAvg: number;
  /** PA or VW, whichever is better */
  defense: number;
  rs: number;
}

export interface SideSummary {
  count: number;
  lep: number;
  /** total attacks per round */
  actionsPerRound: number;
  /** expected damage per round this side deals to the other side */
  damagePerRound: number;
  /** average defense / RS of this side (what the other side runs into) */
  avgDefense: number;
  avgRs: number;
}

export interface Estimate {
  heroes: SideSummary;
  enemies: SideSummary;
  /** rounds the heroes need to bring the enemies to 0 LeP in total (Infinity if they deal no damage) */
  roundsToDropEnemies: number;
  roundsToDropHeroes: number;
  /** roundsToDropHeroes / roundsToDropEnemies; null when neither side deals damage */
  ratio: number | null;
  rating: Rating;
  /** values that were missing and therefore guessed */
  guessed: string[];
}

// ------------------------------------------------------------------ helpers

export function diceAverage(d: DiceSpec): number {
  return d.count * (d.sides + 1) / 2 + d.bonus;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function hitChance(at: number): number {
  return clamp(at / 20, HIT_CHANCE_MIN, HIT_CHANCE_MAX);
}

export function rate(ratio: number | null): Rating {
  if (ratio === null || Number.isNaN(ratio)) return "unbestimmt";
  if (ratio >= RATIO_THRESHOLDS.leicht) return "leicht";
  if (ratio >= RATIO_THRESHOLDS.ausgeglichen) return "ausgeglichen";
  if (ratio >= RATIO_THRESHOLDS.fordernd) return "fordernd";
  if (ratio >= RATIO_THRESHOLDS.gefaehrlich) return "gefährlich";
  return "tödlich";
}

// ------------------------------------------------------------------ combatant -> unit

export interface UnitOptions {
  /** overrides c.lepMax */
  lep?: number | null;
  actions?: number | null;
  /** false: skip "Standardwert" notes for RS (a bestiary creature without RS has 0) - default true */
  label?: string;
}

function weaponScore(w: Weapon): { at: number; avg: number; score: number } | null {
  const at = w.kind === "ranged" ? w.fk : w.at;
  const d = tryParseDice(w.tp);
  if (at === null || !d) return null;
  const avg = diceAverage(d);
  return { at, avg, score: hitChance(at) * avg };
}

/** Builds the Unit for `count` copies of a combatant, filling gaps from `fb` and listing them in `guessed`. */
export function unitFromCombatant(c: Combatant, count: number, opts: UnitOptions = {}, fb: FallbackStats = DEFAULT_FALLBACK): { unit: Unit; guessed: string[] } {
  const label = opts.label ?? c.name;
  const guessed: string[] = [];
  const fbAvg = diceAverage(tryParseDice(fb.tp) ?? { count: 1, sides: 6, bonus: 4, text: "1W6+4" });

  // best weapon among those with both AT and TP; otherwise take any partial one and fill the rest
  let at: number | null = null;
  let avg: number | null = null;
  let best = -1;
  for (const w of c.weapons) {
    const s = weaponScore(w);
    if (s && s.score > best) {
      best = s.score;
      at = s.at;
      avg = s.avg;
    }
  }
  if (at === null) {
    const partial = c.weapons[0];
    if (partial) {
      at = partial.kind === "ranged" ? partial.fk : partial.at;
      const d = tryParseDice(partial.tp);
      avg = d ? diceAverage(d) : null;
    }
  }
  if (at === null) {
    at = fb.at;
    guessed.push(`${label}: AT unbekannt, Standardwert ${fb.at}`);
  }
  if (avg === null) {
    avg = fbAvg;
    guessed.push(`${label}: TP unbekannt, Standardwert ${fb.tp}`);
  }

  const defs = [...c.weapons.map((w) => w.pa), c.vw].filter((v): v is number => v !== null && v !== undefined);
  let defense: number;
  if (defs.length) defense = Math.max(...defs);
  else {
    defense = fb.pa;
    guessed.push(`${label}: PA/VW unbekannt, Standardwert ${fb.pa}`);
  }

  let rs: number;
  if (c.rs !== null) rs = c.rs;
  else {
    rs = fb.rs;
    guessed.push(`${label}: RS unbekannt, Standardwert ${fb.rs}`);
  }

  let lep: number;
  const lepIn = opts.lep !== undefined ? opts.lep : c.lepMax;
  if (lepIn !== null && lepIn !== undefined) lep = lepIn;
  else {
    lep = fb.lep;
    guessed.push(`${label}: LeP unbekannt, Standardwert ${fb.lep}`);
  }

  const actions = opts.actions && opts.actions > 0 ? opts.actions : 1;
  return { unit: { name: label, count, lep, actions, at, tpAvg: avg, defense, rs }, guessed };
}

// ------------------------------------------------------------------ the estimate

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function summarize(att: Unit[], def: Unit[]): SideSummary {
  const count = sum(att.map((u) => u.count));
  const actionsPerRound = sum(att.map((u) => u.count * u.actions));
  const lep = sum(att.map((u) => u.count * u.lep));
  const avgDefense = count ? sum(att.map((u) => u.count * u.defense)) / count : 0;
  const avgRs = count ? sum(att.map((u) => u.count * u.rs)) / count : 0;

  // damage this side deals to `def`
  const nDef = sum(def.map((u) => u.count));
  let damagePerRound = 0;
  if (count > 0 && nDef > 0) {
    const defAvgDefense = sum(def.map((u) => u.count * u.defense)) / nDef;
    const defAvgRs = sum(def.map((u) => u.count * u.rs)) / nDef;
    // every defender is attacked m times per round; the k-th defense is DEFENSE_STEP_PENALTY*(k-1) harder,
    // so the penalty averaged over all attacks is STEP*(m-1)/2 (spread evenly over the attackers)
    const m = Math.max(1, actionsPerRound / nDef);
    const penalty = (DEFENSE_STEP_PENALTY * (m - 1)) / 2;
    const defEff = Math.max(0, defAvgDefense - penalty);
    const notDefended = 1 - Math.min(1, defEff / 20);
    for (const u of att) {
      const dmg = Math.max(0, u.tpAvg - defAvgRs);
      damagePerRound += u.count * u.actions * hitChance(u.at) * notDefended * dmg;
    }
  }
  return { count, lep, actionsPerRound, damagePerRound, avgDefense, avgRs };
}

export function estimate(heroes: Unit[], enemies: Unit[], guessed: string[] = []): Estimate {
  const h = summarize(heroes, enemies);
  const e = summarize(enemies, heroes);
  const roundsToDropEnemies = h.damagePerRound > 0 ? e.lep / h.damagePerRound : Infinity;
  const roundsToDropHeroes = e.damagePerRound > 0 ? h.lep / e.damagePerRound : Infinity;
  let ratio: number | null;
  if (h.damagePerRound <= 0 && e.damagePerRound <= 0) ratio = null;
  else if (h.damagePerRound <= 0) ratio = 0;
  else if (e.damagePerRound <= 0) ratio = Infinity;
  else ratio = roundsToDropHeroes / roundsToDropEnemies;
  return { heroes: h, enemies: e, roundsToDropEnemies, roundsToDropHeroes, ratio, rating: rate(ratio), guessed };
}

/** Party without hero data: `count` average heroes built purely from the fallback values. */
export function manualPartyUnit(count: number, lep: number, fb: FallbackStats = DEFAULT_FALLBACK): { unit: Unit; guessed: string[] } {
  const tp = tryParseDice(fb.tp) ?? { count: 1, sides: 6, bonus: 4, text: "1W6+4" };
  return {
    unit: { name: "Helden", count, lep, actions: 1, at: fb.at, tpAvg: diceAverage(tp), defense: fb.pa, rs: fb.rs },
    guessed: [`Helden: keine Heldendaten, Standardwerte AT ${fb.at}, TP ${fb.tp}, PA ${fb.pa}, RS ${fb.rs} (${count} Helden mit je ${lep} LeP)`],
  };
}
