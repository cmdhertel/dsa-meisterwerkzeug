// Tunable rule values for Zustände / Status / timed effects. Everything the vault does not state (or that is
// recalled from the DSA5 core rules without a source in the vault) is marked UNSURE: adjust here.
// Sign convention for modifiers: negative = harder (like the vault's "AT –4"), positive = easier.

/** Total roll penalty from all Zustände is capped at this value (DSA5: "höchstens –5"). Positive number. UNSURE: not in the vault notes. */
export const MAX_TOTAL_STATE_PENALTY_CAP: number | null = 5;

/** Paralyse: share of GS that remains per level 0..4 (vault Zustände.md: 75 / 50 / 25 %, IV = bewegungsunfähig). */
export const PARALYSE_GS_FACTOR = [1, 0.75, 0.5, 0.25, 0] as const;
/** Schmerz: GS reduced by the level (vault Zustände.md). */
export const SCHMERZ_GS_PER_LEVEL = 1;
/** Verwirrung from this level on: no complex actions (Zaubern, Liturgien, Wissenstalente). */
export const VERWIRRUNG_NO_COMPLEX_LEVEL = 3;

/** A combatant that is "handlungsunfähig" cannot defend (UNSURE: DSA5 core says no actions; set true to let them parry anyway). */
export const INCAPACITATED_CAN_DEFEND = false;

export type StatusId =
  | "liegend"
  | "bewusstlos"
  | "blind"
  | "brennend"
  | "fixiert"
  | "eingeengt"
  | "ueberrascht"
  | "unsichtbar"
  | "vergiftet"
  | "krank"
  | "blutend"
  | "stumm"
  | "taub"
  | "handlungsunfaehig";

export type Reach = "kurz" | "mittel" | "lang";

export interface StatusDef {
  id: StatusId;
  label: string;
  /** modifier on the status holder's own AT (melee and ranged) */
  at: number;
  /** modifier on the holder's parry */
  pa: number;
  /** modifier on the holder's dodge (Ausweichen / VW) */
  vw: number;
  /** cannot parry / dodge at all */
  noParry?: boolean;
  noDodge?: boolean;
  /** handlungsunfähig */
  incapacitated?: boolean;
  /** suggested per-round tick for the preset */
  tick?: { dice: string; mode: "damage" | "heal" };
  /** one-line rule note shown in the cockpit (GM only) */
  note: string;
}

/**
 * Status values. Liegend/Eingeengt/Überrascht partly from the vault (Modifikatoren.md, Nahkampf.md), the rest DSA5 core
 * from memory. UNSURE entries: Blind, Überrascht, Fixiert, Unsichtbar, tick presets (Brennend, Vergiftet, Blutend).
 */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  liegend: { id: "liegend", label: "Liegend", at: -4, pa: -2, vw: -2, note: "AT −4, PA/VW −2; Aufstehen kostet eine Aktion (freie Aktion nur „sich zu Boden werfen“)." },
  bewusstlos: { id: "bewusstlos", label: "Bewusstlos", at: 0, pa: 0, vw: 0, noParry: true, noDodge: true, incapacitated: true, note: "Wehrlos, handlungsunfähig, kann nicht verteidigen." },
  blind: { id: "blind", label: "Blind", at: -4, pa: -4, vw: -4, note: "Alle Sicht-Proben misslingen; Kampf −4 (UNSURE); Angriffe auf Blinde nicht erleichtert." },
  brennend: { id: "brennend", label: "Brennend", at: 0, pa: 0, vw: 0, tick: { dice: "1W6", mode: "damage" }, note: "Erleidet jede KR Feuerschaden, bis gelöscht." },
  fixiert: { id: "fixiert", label: "Fixiert", at: 0, pa: 0, vw: 0, noDodge: true, note: "Kann sich nicht bewegen, daher kein Ausweichen (UNSURE)." },
  eingeengt: { id: "eingeengt", label: "Eingeengt", at: 0, pa: 0, vw: 0, note: "AT/PA je nach Waffenlänge (Modifikatoren.md): kurz ±0, mittel −4, lang −8." },
  ueberrascht: { id: "ueberrascht", label: "Überrascht", at: 0, pa: -4, vw: -4, note: "Nur in der ersten KR; Verteidigung erschwert (UNSURE: −4); gezielte Angriffe um 2 erleichtert." },
  unsichtbar: { id: "unsichtbar", label: "Unsichtbar", at: 0, pa: 0, vw: 0, note: "Angreifer gegen Unsichtbare: Sichtstufe 4, Treffer nur als Glückstreffer bei einer 1." },
  vergiftet: { id: "vergiftet", label: "Vergiftet", at: 0, pa: 0, vw: 0, tick: { dice: "1W3", mode: "damage" }, note: "Wirkung je nach Gift; Schaden pro KR optional." },
  krank: { id: "krank", label: "Krank", at: 0, pa: 0, vw: 0, note: "Wirkung je nach Krankheit (Stufen/Zustände separat eintragen)." },
  blutend: { id: "blutend", label: "Blutend", at: 0, pa: 0, vw: 0, tick: { dice: "1", mode: "damage" }, note: "Blutet; verliert Lebensenergie, bis die Wunde versorgt ist." },
  stumm: { id: "stumm", label: "Stumm", at: 0, pa: 0, vw: 0, note: "Kann nicht sprechen: keine Zauber/Liturgien mit Sprache." },
  taub: { id: "taub", label: "Taub", at: 0, pa: 0, vw: 0, note: "Hörproben misslingen; Zurufe/Zauber mit Sprache unwirksam." },
  handlungsunfaehig: { id: "handlungsunfaehig", label: "Handlungsunfähig", at: 0, pa: 0, vw: 0, noParry: true, noDodge: true, incapacitated: true, note: "Kann keine Aktionen ausführen und sich nicht verteidigen." },
};
export const STATUS_IDS = Object.keys(STATUS_DEFS) as StatusId[];

/** Eingeengt: modifiers by weapon reach (Modifikatoren.md "Eingeengt"; AT and PA). Default reach if unknown: mittel. */
export const EINGEENGT_BY_REACH: Record<Reach, { at: number; pa: number }> = {
  kurz: { at: 0, pa: 0 },
  mittel: { at: -4, pa: -4 },
  lang: { at: -8, pa: -8 },
};
export const EINGEENGT_DEFAULT_REACH: Reach = "mittel";

/** Preset ticks for Zustand-independent free effects offered in the UI. */
export const EFFECT_PRESETS_FREE: { name: string; tick: { dice: string; mode: "damage" | "heal" } }[] = [
  { name: "Gift", tick: { dice: "1W3", mode: "damage" } },
  { name: "Regeneration", tick: { dice: "1", mode: "heal" } },
  { name: "Säure", tick: { dice: "1W6", mode: "damage" } },
];

/** Roman level text. */
export const ROMAN_LEVEL = ["", "I", "II", "III", "IV"];
