// Regenerationsphase: pure roll/cap logic.
import type { Roller } from "../engine/dice";

export type PoolKey = "lep" | "asp" | "kap";
export const POOL_LABEL: Record<PoolKey, string> = { lep: "LeP", asp: "AsP", kap: "KaP" };

export interface RestPoolInput {
  current: number;
  max: number;
}
export interface RestHeroInput {
  id: string;
  name: string;
  lep: RestPoolInput;
  asp: RestPoolInput;
  kap: RestPoolInput;
  /** per-hero modifier, -2..+2 */
  mod: number;
}
export interface RestPoolResult {
  /** false when the hero has no such pool (max <= 0) */
  active: boolean;
  roll: number;
  mod: number;
  gain: number;
  before: number;
  after: number;
  max: number;
}
export interface RestHeroResult {
  id: string;
  name: string;
  lep: RestPoolResult;
  asp: RestPoolResult;
  kap: RestPoolResult;
}

/** 1W6 + mods, never negative, capped at max, never below current. */
export function applyRegen(current: number, max: number, roll: number, mod: number): { gain: number; after: number } {
  if (max <= 0) return { gain: 0, after: current };
  const gain = Math.max(0, roll + mod);
  const after = Math.max(current, Math.min(max, current + gain));
  return { gain: after - current, after };
}

export function rollPool(pool: RestPoolInput, mod: number, roller: Roller): RestPoolResult {
  const active = pool.max > 0;
  const roll = active ? roller(6) : 0;
  const { gain, after } = applyRegen(pool.current, pool.max, roll, active ? mod : 0);
  return { active, roll, mod, gain, before: pool.current, after, max: pool.max };
}

export function rollRest(heroes: RestHeroInput[], globalMod: number, roller: Roller): RestHeroResult[] {
  return heroes.map((h) => {
    const mod = h.mod + globalMod;
    return { id: h.id, name: h.name, lep: rollPool(h.lep, mod, roller), asp: rollPool(h.asp, mod, roller), kap: rollPool(h.kap, mod, roller) };
  });
}

/**
 * Re-rolls one hero only. Every other hero keeps its result, including manual corrections.
 * Returns a new array; the other entries are the same objects.
 */
export function rerollHero(heroes: RestHeroInput[], results: RestHeroResult[], index: number, globalMod: number, roller: Roller): RestHeroResult[] {
  const next = results.slice();
  const hero = heroes[index];
  if (hero) next[index] = rollRest([hero], globalMod, roller)[0];
  return next;
}

/** Re-derive a pool result after the GM typed a new value (clamped 0..max). */
export function withManualValue(r: RestPoolResult, value: number): RestPoolResult {
  const after = Math.max(0, Math.min(r.max, Math.trunc(value)));
  return { ...r, after, gain: after - r.before };
}

/** Table log text for an applied rest: "Rast (Nachtruhe): Thorwin +4 LeP, +5 AsP; Godhard +3 LeP". */
export function restEventText(heroes: readonly RestHeroResult[], days: number): string {
  const label = days > 1 ? `Rast (${days} Tage)` : days === 1 ? "Rast (Nachtruhe)" : "Rast";
  const keys: PoolKey[] = ["lep", "asp", "kap"];
  const parts = heroes.map((h) => {
    const gains = keys.filter((k) => h[k].active).map((k) => `${h[k].after - h[k].before >= 0 ? "+" : "−"}${Math.abs(h[k].after - h[k].before)} ${POOL_LABEL[k]}`);
    return gains.length ? `${h.name} ${gains.join(", ")}` : "";
  });
  return `${label}: ${parts.filter(Boolean).join("; ")}`;
}
