// Shared plain types for the pure rules engine. No obsidian imports here.

export type AttrKey = "MU" | "KL" | "IN" | "CH" | "FF" | "GE" | "KO" | "KK";
export const ATTR_KEYS: AttrKey[] = ["MU", "KL", "IN", "CH", "FF", "GE", "KO", "KK"];
export type Attributes = Record<AttrKey, number>;

export type TalentGroup = "Körper" | "Gesellschaft" | "Natur" | "Wissen" | "Handwerk";

export interface TalentDef {
  name: string;
  group: TalentGroup;
  attrs: [AttrKey, AttrKey, AttrKey];
  /** "ja" | "nein" | "eventuell" | "" (unknown, supplement entries) */
  belastung: string;
  /** "vault" = from Talentfertigkeiten.md, "dsa5-core" = supplemented, not in the vault */
  source: "vault" | "dsa5-core";
}

/** A signed modifier with a label so a UI can show where a number came from. Positive = easier / bonus. */
export interface Modifier {
  label: string;
  value: number;
}
