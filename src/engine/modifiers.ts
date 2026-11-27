// Situational combat modifier data (Modifikatoren.md, Fernkampf.md, Nahkampf.md). Convenience for UIs.
import type { Modifier } from "./types";

export type RangeBand = "nah" | "mittel" | "weit";
export const RANGE_MODS: Record<RangeBand, { fk: number; tp: number }> = {
  nah: { fk: 2, tp: 1 },
  mittel: { fk: 0, tp: 0 },
  weit: { fk: -2, tp: -1 },
};

export type SizeCategory = "winzig" | "klein" | "mittel" | "gross" | "riesig";
export const SIZE_FK_MODS: Record<SizeCategory, number> = { winzig: -8, klein: -4, mittel: 0, gross: 4, riesig: 8 };

export const MOVEMENT_FK_MODS = {
  zielSteht: 2,
  zielLeicht: 0,
  zielSchnell: -2,
  zielHakenZusaetzlich: -4,
  schuetzeGeht: -2,
  schuetzeRennt: -4,
} as const;

export const MOUNTED_FK_MODS = { steht: 0, schritt: -4, galopp: -8 } as const; // Trab: nur Glückstreffer (1)
export const SICHT_FK_MODS = [0, -2, -4, -6] as const; // Stufe 0-3; Stufe 4 = nur Glückstreffer
export const AIM_BONUS_PER_ACTION = 2;
export const AIM_BONUS_MAX = 4;
export const SHOOT_INTO_MELEE_MOD = -2;

export type MeleeReach = "kurz" | "mittel" | "lang";
/** AT penalty for the `attacker` reach against the `defender` reach (Nahkampf.md table). Value <= 0. */
export function reachAtMod(attacker: MeleeReach, defender: MeleeReach): number {
  const t: Record<MeleeReach, Record<MeleeReach, number>> = {
    kurz: { kurz: 0, mittel: -2, lang: -4 },
    mittel: { kurz: 0, mittel: 0, lang: -2 },
    lang: { kurz: 0, mittel: 0, lang: 0 },
  };
  return t[attacker][defender];
}

/** Eingeengt (Modifikatoren.md): [AT, PA] by weapon reach. */
export const CRAMPED_MODS: Record<MeleeReach, [number, number]> = { kurz: [0, 0], mittel: [-4, -4], lang: [-8, -8] };

export function rangeModifiers(band: RangeBand): { fk: Modifier; tp: Modifier } {
  return { fk: { label: `Reichweite ${band}`, value: RANGE_MODS[band].fk }, tp: { label: `Reichweite ${band}`, value: RANGE_MODS[band].tp } };
}
