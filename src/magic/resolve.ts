// Pure cast resolution: 3W20 against three attributes (engine/talent), then cost rules. No obsidian imports.
import type { Roller } from "../engine/dice";
import { TalentCheckResult, rollTalentCheck } from "../engine/talent";
import type { SpellDef, SpellKind } from "./spells";
import { substituteQs } from "./spells";

/** Cost factors (DSA5; the vault rule notes do not state them, adjust here). */
export const COST_FACTOR_SUCCESS = 1;
/** Failed cast: caster pays half the cost (rounded up), spells and liturgies alike. */
export const COST_FACTOR_FAILURE = 0.5;
/** Critical success: cost is halved (rounded up). */
export const COST_FACTOR_CRITICAL_SUCCESS = 0.5;
/** Patzer: treated like a failure (UNCONFIRMED; Patzer table is up to the GM). */
export const COST_FACTOR_PATZER = 0.5;

export interface CastInput {
  name: string;
  kind: SpellKind;
  attrs: [number, number, number];
  attrLabels?: [string, string, string];
  fw: number;
  /** total modifier on the attributes: positive = easier (same convention as the Probenknopf) */
  modifier: number;
  /** resistance subtracted from the check (SK/ZK of the target); 0 = none */
  resistance?: number;
  resistanceLabel?: "SK" | "ZK" | null;
  /** base cost of the cast (activation cost) */
  costBasis: number | null;
  /** typed by the GM for "Kosten senken" etc. (0.75 = 25% cheaper); default 1 */
  costMultiplier?: number;
  spell?: SpellDef | null;
  statePenalty?: number;
}

export interface CastResult {
  input: CastInput;
  check: TalentCheckResult;
  success: boolean;
  qs: number;
  critical: "success" | "patzer" | null;
  /** cost before success factor (basis x multiplier, rounded up); null if unknown */
  costFull: number | null;
  costFactor: number;
  /** what the caster actually pays */
  costPaid: number | null;
  energy: "AsP" | "KaP";
  wirkung: string;
  wirkungsdauer: string;
  reichweite: string;
  zauberdauer: string;
}

export const energyOf = (kind: SpellKind): "AsP" | "KaP" => (kind === "liturgie" ? "KaP" : "AsP");

export function costFactor(success: boolean, critical: "success" | "patzer" | null): number {
  if (critical === "patzer") return COST_FACTOR_PATZER;
  if (critical === "success") return COST_FACTOR_CRITICAL_SUCCESS;
  return success ? COST_FACTOR_SUCCESS : COST_FACTOR_FAILURE;
}

/** Full cost as the caster has to be able to afford it (before the roll). */
export function fullCost(basis: number | null, multiplier = 1): number | null {
  if (basis === null) return null;
  return Math.max(0, Math.ceil(basis * multiplier - 1e-9));
}

export function resolveCast(input: CastInput, roller?: Roller): CastResult {
  const resistance = Math.max(0, input.resistance ?? 0);
  const modifiers = [] as { label: string; value: number }[];
  if (input.modifier) modifiers.push({ label: "Modifikator", value: input.modifier });
  if (resistance) modifiers.push({ label: input.resistanceLabel ?? "SK/ZK", value: -resistance });
  const check = rollTalentCheck({ attrs: input.attrs, fw: input.fw, modifiers, statePenalty: input.statePenalty ?? 0 }, roller);
  const factor = costFactor(check.success, check.critical);
  const full = fullCost(input.costBasis, input.costMultiplier ?? 1);
  const paid = full === null ? null : Math.ceil(full * factor - 1e-9);
  const s = input.spell;
  const qs = check.qs;
  return {
    input,
    check,
    success: check.success,
    qs,
    critical: check.critical,
    costFull: full,
    costFactor: factor,
    costPaid: paid,
    energy: energyOf(input.kind),
    wirkung: s ? (check.success ? substituteQs(s.wirkung, qs) : s.wirkung) : "",
    wirkungsdauer: s ? (check.success ? substituteQs(s.wirkungsdauer, qs) : s.wirkungsdauer) : "",
    reichweite: s?.reichweite ?? "",
    zauberdauer: s?.zauberdauer ?? "",
  };
}

/** Energy check before casting. */
export function canAfford(available: number | null, cost: number | null): boolean {
  if (available === null || cost === null) return true;
  return available >= cost;
}

/** One-line table log text: "Thorwin wirkt Armatrutz: gelungen, QS 3, 4 AsP" (cost omitted when unknown). */
export function castEventText(caster: string, r: Pick<CastResult, "input" | "success" | "qs" | "critical" | "costPaid" | "energy">): string {
  const outcome = r.critical === "patzer" ? "Patzer" : r.critical === "success" ? `kritischer Erfolg, QS ${r.qs}` : r.success ? `gelungen, QS ${r.qs}` : "misslungen";
  const cost = r.costPaid === null ? "" : `, ${r.costPaid} ${r.energy}`;
  return `${caster} wirkt ${r.input.name}: ${outcome}${cost}`;
}
