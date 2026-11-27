import { TALENTS } from "../data/talents.generated";
import type { TalentDef } from "../engine/types";

/**
 * Heldenschmiede `charSkills[].key` -> talent. The keys are the standard DSA5 talent list counted from 0 in the order
 * Körper, Gesellschaft, Natur, Wissen, Handwerk (alphabetical within a group) = the order of TALENTS.
 * Confirmed by the user: 35 = Magiekunde, 39 = Sagen & Legenden (asserted in tests).
 */
export const TALENT_BY_KEY: ReadonlyArray<TalentDef> = TALENTS;

export function talentByKey(key: number): TalentDef | null {
  return TALENT_BY_KEY[key] ?? null;
}

const byName = new Map(TALENTS.map((t) => [t.name.toLowerCase(), t]));
export function talentByName(name: string): TalentDef | null {
  return byName.get(name.trim().toLowerCase()) ?? null;
}
