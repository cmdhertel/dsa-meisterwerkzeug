import { Roller, defaultRoller } from "./dice";

export interface InitiativeRoll {
  base: number;
  roll: number; // the 1W6
  total: number;
}

/** INI = INI base + 1W6. */
export function rollInitiative(base: number, roller: Roller = defaultRoller): InitiativeRoll {
  const roll = roller(6);
  return { base, roll, total: base + roll };
}

export interface InitiativeEntry {
  id: string;
  base: number;
  roll: number;
}

/**
 * Descending by total (base + roll); tie -> higher INI base; tie -> higher 1W6 (Modifikatoren.md
 * "Reihenfolge des Handelns"). Still tied: input order (stable). Returns a new array.
 */
export function sortInitiative<T extends InitiativeEntry>(entries: readonly T[]): T[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = a.e.base + a.e.roll;
      const tb = b.e.base + b.e.roll;
      return tb - ta || b.e.base - a.e.base || b.e.roll - a.e.roll || a.i - b.i;
    })
    .map((x) => x.e);
}
