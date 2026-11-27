import type { BodyType, SizeCat, ZoneRsMap } from "./engine/hitzones";
// Shared static combatant model (bestiary creatures and heroes both map to this). No obsidian imports.

export interface Weapon {
  name: string;
  kind: "melee" | "ranged";
  /** melee attack value */
  at: number | null;
  /** melee parry value */
  pa: number | null;
  /** ranged attack value (Fernkampf) */
  fk: number | null;
  /** damage dice, normalized e.g. "1W6+4"; null when the source gives no dice (e.g. "Haltegriff") */
  tp: string | null;
  /** extra text after the dice or the whole non-dice TP text ("(+Gift)", "Haltegriff") */
  tpNote: string;
  /** reach text: melee "kurz|mittel|lang|..." or ranged "5/10/20" */
  rw: string;
  /** ranged: [nah, mittel, weit] in Schritt */
  rwRanges: [number, number, number] | null;
  /** Ladezeit (ranged) */
  lz: number | null;
  /** original source text, for display and debugging */
  raw: string;
  /** true when AT/FK or TP could not be read */
  partial: boolean;
}

export interface Combatant {
  name: string;
  kind: "creature" | "hero";
  /** vault path of the source note */
  sourcePath: string;
  /** null = needs manual input */
  lepMax: number | null;
  /** INI base (the constant part of "13+1W6"); null = needs manual input */
  iniBase: number | null;
  /** Rüstungsschutz, null if the note has none / unreadable */
  rs: number | null;
  /** Verteidigung/Ausweichen */
  vw: number | null;
  weapons: Weapon[];
  /** names of fields the GM must fill in at the table: "lep", "ini" */
  needsManual: string[];
  /** current LeP at combat start (heroes: LeP_aktuell from the note); undefined = full */
  lepCurrent?: number;
  /** Trefferzonen (optional rule): body type, size category, KO (Wundschwelle) and zone armour; undefined = humanoid / mittel / unknown */
  bodyType?: BodyType;
  size?: SizeCat;
  ko?: number | null;
  zoneRs?: ZoneRsMap;
}
