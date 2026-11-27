// Every rule value that is NOT confirmed (or is contradicted) by the vault's rule notes lives here,
// so it can be changed in one place. See the plugin report for the list of uncertainties.

/** Max level of any single state (Zustände.md: Stufe I-IV). */
export const MAX_STATE_LEVEL = 4;

/** Schmerz from LeP: fractions of max LeP (Nahkampf.md "Geringe Lebensenergie"). */
export const SCHMERZ_FRACTIONS = { I: 3 / 4, II: 1 / 2, III: 1 / 4 } as const;
/** Schmerz IV at this many LeP or fewer (Nahkampf.md). */
export const SCHMERZ_IV_LEP = 5;

/**
 * UNCONFIRMED: Zustände.md has no rule for a cap on the SUM of state levels.
 * null = no cap on the total, only each state is capped at MAX_STATE_LEVEL.
 */
export const MAX_TOTAL_STATE_PENALTY: number | null = null;

/** Cumulative penalty per further defense in the same combat round (Nahkampf.md: 0, 3, 6, 9 ...). */
export const DEFENSE_STEP = 3;

/**
 * CONFLICT: Nahkampf.md says only heroes (and NPCs with Schicksalspunkte) may defend more than once per round,
 * other beings exactly once, and non-humanoid creatures defend at full value without penalty.
 * The task spec says: every combatant pays the cumulative -3. Default follows the spec; per-combatant override
 * via `DefenseMode`.
 */
export type DefenseMode = "cumulative" | "single" | "unlimited";
export const DEFAULT_DEFENSE_MODE: DefenseMode = "cumulative";

/**
 * CONFLICT: Nahkampf.md / Fernkampf.md say the defense value is halved on ANY rolled 1 (confirmed or not),
 * damage doubled only when confirmed. Task spec: both effects only when confirmed.
 * true = follow the vault rule notes: any rolled 1 halves the defense, doubling stays tied to the confirmation.
 */
export const UNCONFIRMED_CRIT_HALVES_DEFENSE = true;

/** UNCONFIRMED: rounding when a defense value is halved by a critical hit (vault says only "halbiert"). */
export const HALVE_ROUNDING: "ceil" | "floor" = "ceil";

/** Ranged defense modifiers (Modifikatoren.md / Fernkampf.md). */
export const RANGED_DEFENSE_MOD = { schuss: -4, wurf: -2 } as const;

/** Fallback damage when the optional Patzer table is not used (Nahkampf.md: "Der Held erleidet 1W6+2 SP"). */
export const PATZER_FALLBACK_SP = "1W6+2";

/** Talent check: QS thresholds on the remaining skill points (task spec; not in the vault notes). */
export const QS_THRESHOLDS: ReadonlyArray<[minPoints: number, qs: number]> = [
  [16, 6],
  [13, 5],
  [10, 4],
  [7, 3],
  [4, 2],
  [0, 1],
];

/** Talent check: number of 1s (resp. 20s) that make a critical success (resp. Patzer). Task spec. */
export const TALENT_CRIT_COUNT = 2;

/** UNCONFIRMED: Combat technique base value when `charCombatSkills` has no entry (DSA5 core: 6). */
export const COMBAT_TECHNIQUE_BASE = 6;
