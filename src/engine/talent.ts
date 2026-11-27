import { QS_THRESHOLDS, TALENT_CRIT_COUNT } from "./constants";
import { Roller, defaultRoller } from "./dice";
import type { Modifier } from "./types";

export function qsFromPoints(points: number): number {
  for (const [min, qs] of QS_THRESHOLDS) if (points >= min) return qs;
  return 1;
}

export interface TalentCheckInput {
  /** the three attribute values (already the hero's current values) */
  attrs: [number, number, number];
  /** Fertigkeitswert (FW), >= 0 */
  fw: number;
  /** Signed modifier applied to each attribute value: positive = easier, negative = harder. */
  modifiers?: Modifier[];
  /** Positive number = total state penalty (see totalStatePenalty); subtracted like a harder roll. */
  statePenalty?: number;
}

export interface TalentCheckResult {
  dice: [number, number, number];
  attrBase: [number, number, number];
  /** sum of modifiers - statePenalty, applied to each attribute */
  modifierTotal: number;
  modifiers: Modifier[];
  statePenalty: number;
  /** attribute values after modifiers */
  attrEffective: [number, number, number];
  fw: number;
  /** points needed per die (die - attrEffective, if > 0) */
  needed: [number, number, number];
  fwUsed: number;
  /** FW left after compensating (>= 0 on success, <0 means it was missing) */
  remaining: number;
  success: boolean;
  /** 0 on failure, else 1-6 */
  qs: number;
  critical: "success" | "patzer" | null;
  ones: number;
  twenties: number;
}

/** 3W20 against three attributes; FW compensates overshoot; leftover points -> QS. */
export function rollTalentCheck(input: TalentCheckInput, roller: Roller = defaultRoller): TalentCheckResult {
  const modifiers = input.modifiers ?? [];
  const statePenalty = input.statePenalty ?? 0;
  const modifierTotal = modifiers.reduce((s, m) => s + m.value, 0) - statePenalty;
  const dice: [number, number, number] = [roller(20), roller(20), roller(20)];
  const attrEffective = input.attrs.map((a) => a + modifierTotal) as [number, number, number];
  const needed = dice.map((d, i) => Math.max(0, d - attrEffective[i])) as [number, number, number];
  const fwUsed = needed.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, input.fw) - fwUsed;
  const ones = dice.filter((d) => d === 1).length;
  const twenties = dice.filter((d) => d === 20).length;
  const critical = ones >= TALENT_CRIT_COUNT ? "success" : twenties >= TALENT_CRIT_COUNT ? "patzer" : null;
  let success = remaining >= 0;
  if (critical === "success") success = true;
  if (critical === "patzer") success = false;
  const qs = success ? qsFromPoints(Math.max(0, remaining)) : 0;
  return {
    dice,
    attrBase: [...input.attrs] as [number, number, number],
    modifierTotal,
    modifiers,
    statePenalty,
    attrEffective,
    fw: input.fw,
    needed,
    fwUsed,
    remaining,
    success,
    qs,
    critical,
    ones,
    twenties,
  };
}
