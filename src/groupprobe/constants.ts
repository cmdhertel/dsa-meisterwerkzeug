// Rule constants for Gruppenprobe / Sammelprobe. Pure, no obsidian imports.

/** Sammelprobe: default target QS (core rule: usually 10). */
export const SAMMEL_DEFAULT_TARGET = 10;
/** Sammelprobe: default number of attempts (UNSURE: core says the GM sets it; 7 is the task default). */
export const SAMMEL_DEFAULT_ATTEMPTS = 7;
/** Sammelprobe: QS of a roll are multiplied by this on a kritischer Erfolg (UNSURE: task spec "doubled"). */
export const SAMMEL_CRIT_MULTIPLIER = 2;
/** Sammelprobe: a Patzer resets the accumulated QS to this value (UNSURE: task spec). */
export const SAMMEL_PATZER_RESET_QS = 0;
/** Sammelprobe: a Patzer also ends the Sammelprobe as gescheitert (it "must restart"). */
export const SAMMEL_PATZER_ENDS = true;
/** Sammelprobe: Teilerfolg when attempts run out with at least this many accumulated QS (UNSURE: task spec). */
export const SAMMEL_TEILERFOLG_MIN_QS = 6;
/** Max number of unfinished Sammelproben remembered in plugin data. */
export const SAVED_SAMMEL_LIMIT = 50;
