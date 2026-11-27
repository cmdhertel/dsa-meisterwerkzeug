import { MAX_STATE_LEVEL, SCHMERZ_FRACTIONS, SCHMERZ_IV_LEP } from "./constants";
import { MAX_TOTAL_STATE_PENALTY_CAP, PARALYSE_GS_FACTOR, SCHMERZ_GS_PER_LEVEL } from "./effectConstants";

export type StateId = "belastung" | "betaeubung" | "entrueckung" | "furcht" | "paralyse" | "schmerz" | "verwirrung";
export const STATE_IDS: StateId[] = ["belastung", "betaeubung", "entrueckung", "furcht", "paralyse", "schmerz", "verwirrung"];
export const STATE_LABELS: Record<StateId, string> = {
  belastung: "Belastung",
  betaeubung: "Betäubung",
  entrueckung: "Entrückung",
  furcht: "Furcht",
  paralyse: "Paralyse",
  schmerz: "Schmerz",
  verwirrung: "Verwirrung",
};

/** Stored levels per state (0-4). Schmerz stored here is the NON-LeP part (e.g. from a Patzer); LeP pain is derived. */
export type StateLevels = Partial<Record<StateId, number>>;

export function clampLevel(n: number): number {
  return Math.max(0, Math.min(MAX_STATE_LEVEL, Math.trunc(n)));
}

/** Schmerz level derived from current LeP (never stored). Nahkampf.md "Geringe Lebensenergie". */
export function schmerzFromLep(lep: number, lepMax: number): number {
  if (lepMax <= 0) return 0;
  if (lep <= SCHMERZ_IV_LEP) return 4;
  if (lep <= lepMax * SCHMERZ_FRACTIONS.III) return 3;
  if (lep <= lepMax * SCHMERZ_FRACTIONS.II) return 2;
  if (lep <= lepMax * SCHMERZ_FRACTIONS.I) return 1;
  return 0;
}

/**
 * Effective levels = stored levels, with Schmerz = min(4, stored Schmerz + LeP-derived Schmerz).
 * (Summing is an assumption: the vault only says "eine Stufe", see report.)
 */
export function effectiveLevels(stored: StateLevels, lep: number, lepMax: number, timed: StateLevels = {}): Record<StateId, number> {
  const out = {} as Record<StateId, number>;
  // stored (manual) levels and levels of timed effects add up per state, each state capped at IV
  for (const id of STATE_IDS) out[id] = clampLevel((stored[id] ?? 0) + (timed[id] ?? 0));
  out.schmerz = clampLevel(out.schmerz + schmerzFromLep(lep, lepMax));
  return out;
}

export interface PenaltyContext {
  /** roll requires movement or speech (Paralyse applies). Combat rolls: true (default). */
  movement?: boolean;
  /** roll is pleasing to the Geweihte's god (Entrückung gives a bonus instead). Default false. */
  godPleasing?: boolean;
}

/** Per-state penalty breakdown for a roll. Positive = harder. Entrückung can be negative (bonus). */
export function statePenaltyBreakdown(levels: Record<StateId, number>, ctx: PenaltyContext = {}): Partial<Record<StateId, number>> {
  const movement = ctx.movement ?? true;
  const pleasing = ctx.godPleasing ?? false;
  const out: Partial<Record<StateId, number>> = {};
  for (const id of ["belastung", "betaeubung", "furcht", "schmerz", "verwirrung"] as const) if (levels[id] > 0) out[id] = levels[id];
  if (movement && levels.paralyse > 0) out.paralyse = levels.paralyse;
  const e = levels.entrueckung;
  if (e > 0) {
    // Zustände.md: I: -1 unless pleasing; II: pleasing +1, others -2; III: +2 / -3; IV: +3 / -4
    out.entrueckung = pleasing ? (e === 1 ? 0 : -(e - 1)) : e === 1 ? 1 : e;
  }
  return out;
}

/** Total roll penalty (positive = harder), the sum of the levels of all states that affect the roll. */
export function totalStatePenalty(levels: Record<StateId, number>, ctx: PenaltyContext = {}): number {
  const parts = statePenaltyBreakdown(levels, ctx);
  let sum = 0;
  for (const v of Object.values(parts)) sum += v ?? 0;
  if (MAX_TOTAL_STATE_PENALTY_CAP !== null) sum = Math.min(sum, MAX_TOTAL_STATE_PENALTY_CAP);
  return sum;
}

/**
 * Incapacitated (handlungsunfähig): Betäubung/Furcht/Schmerz/Verwirrung IV; Paralyse IV = bewegungsunfähig.
 * Entrückung IV is NOT incapacitating (Zustände.md).
 */
export function incapacitatedBy(levels: Record<StateId, number>): StateId[] {
  return (["belastung", "betaeubung", "furcht", "paralyse", "schmerz", "verwirrung"] as const).filter((id) => levels[id] >= MAX_STATE_LEVEL);
}
export const isIncapacitated = (levels: Record<StateId, number>): boolean => incapacitatedBy(levels).length > 0;

/** At 0 LeP or below a hero "liegt im Sterben" (Nahkampf.md). */
export const isDying = (lep: number): boolean => lep <= 0;

/** Remaining share of the base GS (0..1) after Paralyse (percent) and Schmerz (flat reduction applied by gsWith). */
export const paralyseGsFactor = (level: number): number => PARALYSE_GS_FACTOR[clampLevel(level)];
/** GS after Paralyse and Schmerz (vault Zustände.md); never below 0. Rounded down. */
export function gsWith(baseGs: number, levels: Record<StateId, number>): number {
  return Math.max(0, Math.floor(baseGs * paralyseGsFactor(levels.paralyse)) - levels.schmerz * SCHMERZ_GS_PER_LEVEL);
}

/** Effect text per level (vault Zustände.md; Belastung analogous). Index = level. */
export const STATE_LEVEL_TEXT: Record<StateId, string[]> = {
  belastung: ["", "alle Proben −1", "alle Proben −2", "alle Proben −3", "handlungsunfähig"],
  betaeubung: ["", "leicht angeschlagen, alle Proben −1", "angeschlagen, alle Proben −2", "schwer angeschlagen, alle Proben −3", "bewusstlos/handlungsunfähig"],
  entrueckung: ["", "alle Proben −1 (außer gottgefälligen)", "gottgefällig +1, sonst −2", "gottgefällig +2, sonst −3", "gottgefällig +3, sonst −4"],
  furcht: ["", "beunruhigt, alle Proben −1", "verängstigt, alle Proben −2", "in Panik, alle Proben −3", "katatonisch, handlungsunfähig (flieht/erstarrt)"],
  paralyse: ["", "Bewegungs-/Sprachproben −1, GS 75 %", "Bewegungs-/Sprachproben −2, GS 50 %", "Bewegungs-/Sprachproben −3, GS 25 %", "bewegungsunfähig"],
  schmerz: ["", "alle Proben −1, GS −1", "alle Proben −2, GS −2", "alle Proben −3, GS −3", "handlungsunfähig, sonst alle Proben −4"],
  verwirrung: ["", "alle Proben −1", "alle Proben −2", "alle Proben −3, keine komplexen Aktivitäten (Zaubern, Wissenstalente)", "handlungsunfähig"],
};
