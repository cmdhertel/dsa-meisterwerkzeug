// Trefferzonen (DSA 5 Fokusregel, Kodex des Schwertes S. 227-233, vault note "20 - Regeln/Kampf/Trefferzonen"). Pure.
//
// Local sources (quoted from the Kodex des Schwertes PDF in the vault): the W20 zone tables, the targeted-attack
// modifiers (Kopf -10, Torso -4, Arme -8, Beine -8; halved with Gezielter Angriff/Schuss; -2 less when the target is
// Ueberrascht), Wundschwelle = half KO, wound effects per zone. Everything marked "ASSUMPTION" is NOT in the sources.

import type { Roller } from "./dice";
import { rollDice } from "./dice";

// ---------------------------------------------------------------- types

export type BodyType = "humanoid" | "vierbeiner" | "sechsGliedmassen" | "fangarme" | "amorph";
export type SizeCat = "winzig" | "klein" | "mittel" | "gross" | "riesig";

export type ZoneKey =
  | "kopf" | "torso" | "armL" | "armR" | "beinL" | "beinR"
  | "vorderbeine" | "hinterbeine"
  | "vordereGliedmassen" | "mittlereGliedmassen" | "hintereGliedmassen"
  | "schwanz" | "fangarme" | "koerper";

/** Coarser grouping used for targeting, wound effects and `rs_zonen` frontmatter keys. */
export type ZoneGroup = "kopf" | "torso" | "arme" | "beine" | "gliedmassen" | "schwanz" | "koerper";

export const BODY_TYPES: BodyType[] = ["humanoid", "vierbeiner", "sechsGliedmassen", "fangarme", "amorph"];
export const SIZE_CATS: SizeCat[] = ["winzig", "klein", "mittel", "gross", "riesig"];

export const BODY_TYPE_LABEL: Record<BodyType, string> = {
  humanoid: "Humanoid",
  vierbeiner: "Vierbeiner",
  sechsGliedmassen: "Sechs Gliedmaßen + Schwanz",
  fangarme: "Fangarme",
  amorph: "Ohne Zonen",
};

export const ZONE_LABEL: Record<ZoneKey, string> = {
  kopf: "Kopf",
  torso: "Torso",
  armL: "Linker Arm",
  armR: "Rechter Arm",
  beinL: "Linkes Bein",
  beinR: "Rechtes Bein",
  vorderbeine: "Vordere Beine",
  hinterbeine: "Hintere Beine",
  vordereGliedmassen: "Vordere Gliedmaßen",
  mittlereGliedmassen: "Mittlere Gliedmaßen",
  hintereGliedmassen: "Hintere Gliedmaßen",
  schwanz: "Schwanz",
  fangarme: "Fangarm",
  koerper: "Körper",
};

/** Compact labels for the cockpit badge. */
export const ZONE_SHORT: Record<ZoneKey, string> = {
  kopf: "Kopf",
  torso: "Torso",
  armL: "Arm L",
  armR: "Arm R",
  beinL: "Bein L",
  beinR: "Bein R",
  vorderbeine: "Vorderbeine",
  hinterbeine: "Hinterbeine",
  vordereGliedmassen: "Vorn",
  mittlereGliedmassen: "Mitte",
  hintereGliedmassen: "Hinten",
  schwanz: "Schwanz",
  fangarme: "Fangarm",
  koerper: "Körper",
};

export function zoneGroup(z: ZoneKey): ZoneGroup {
  switch (z) {
    case "kopf": return "kopf";
    case "torso": return "torso";
    case "armL": case "armR": return "arme";
    case "beinL": case "beinR": case "vorderbeine": case "hinterbeine": return "beine";
    case "vordereGliedmassen": case "mittlereGliedmassen": case "hintereGliedmassen": case "fangarme": return "gliedmassen";
    case "schwanz": return "schwanz";
    default: return "koerper";
  }
}

// ---------------------------------------------------------------- zone tables (W20)

interface Band { to: number; zone: ZoneKey | "armen" | "beinen" }

const HUMANOID: Record<"klein" | "mittel" | "gross", Band[]> = {
  klein: [{ to: 6, zone: "kopf" }, { to: 10, zone: "torso" }, { to: 18, zone: "armen" }, { to: 20, zone: "beinen" }],
  mittel: [{ to: 2, zone: "kopf" }, { to: 12, zone: "torso" }, { to: 16, zone: "armen" }, { to: 20, zone: "beinen" }],
  gross: [{ to: 2, zone: "kopf" }, { to: 6, zone: "torso" }, { to: 16, zone: "armen" }, { to: 20, zone: "beinen" }],
};
const QUAD: Record<"klein" | "mittel" | "gross", Band[]> = {
  klein: [{ to: 4, zone: "kopf" }, { to: 12, zone: "torso" }, { to: 16, zone: "vorderbeine" }, { to: 20, zone: "hinterbeine" }],
  mittel: [{ to: 4, zone: "kopf" }, { to: 10, zone: "torso" }, { to: 16, zone: "vorderbeine" }, { to: 20, zone: "hinterbeine" }],
  gross: [{ to: 5, zone: "kopf" }, { to: 11, zone: "torso" }, { to: 16, zone: "vorderbeine" }, { to: 20, zone: "hinterbeine" }],
};
const SIX: Record<"gross" | "riesig", Band[]> = {
  gross: [{ to: 4, zone: "kopf" }, { to: 12, zone: "torso" }, { to: 14, zone: "vordereGliedmassen" }, { to: 16, zone: "mittlereGliedmassen" }, { to: 18, zone: "hintereGliedmassen" }, { to: 20, zone: "schwanz" }],
  riesig: [{ to: 2, zone: "kopf" }, { to: 10, zone: "torso" }, { to: 14, zone: "vordereGliedmassen" }, { to: 16, zone: "mittlereGliedmassen" }, { to: 18, zone: "hintereGliedmassen" }, { to: 20, zone: "schwanz" }],
};
// ASSUMPTION: the book spreads 7-20 evenly over the tentacles (their number is creature specific); we keep one "Fangarm" zone.
const TENTACLES: Band[] = [{ to: 2, zone: "kopf" }, { to: 6, zone: "torso" }, { to: 20, zone: "fangarme" }];
const AMORPH: Band[] = [{ to: 20, zone: "koerper" }];

/** ASSUMPTION: sizes the book has no column for are clamped to the nearest existing column. */
function clampSize(size: SizeCat, allowed: SizeCat[]): SizeCat {
  const order = SIZE_CATS;
  let best = allowed[0];
  let bestDist = Infinity;
  for (const a of allowed) {
    const d = Math.abs(order.indexOf(a) - order.indexOf(size));
    if (d < bestDist) { best = a; bestDist = d; }
  }
  return best;
}

function bandsFor(body: BodyType, size: SizeCat): Band[] {
  switch (body) {
    case "humanoid": return HUMANOID[clampSize(size, ["klein", "mittel", "gross"]) as "klein" | "mittel" | "gross"];
    case "vierbeiner": return QUAD[clampSize(size, ["klein", "mittel", "gross"]) as "klein" | "mittel" | "gross"];
    case "sechsGliedmassen": return SIX[clampSize(size, ["gross", "riesig"]) as "gross" | "riesig"];
    case "fangarme": return TENTACLES;
    default: return AMORPH;
  }
}

/** Zone for a W20 result. Humanoid arms/legs: even = right, odd = left (book). */
export function zoneForRoll(body: BodyType, size: SizeCat, d20: number): ZoneKey {
  const r = Math.min(20, Math.max(1, Math.trunc(d20)));
  const band = bandsFor(body, size).find((b) => r <= b.to) as Band;
  if (band.zone === "armen") return r % 2 === 0 ? "armR" : "armL";
  if (band.zone === "beinen") return r % 2 === 0 ? "beinR" : "beinL";
  return band.zone;
}

/** Table rows for the docs/UI: [range text, zone label]. Humanoid sides are folded ("Arme"). */
export function zoneTable(body: BodyType, size: SizeCat): { range: string; label: string }[] {
  const out: { range: string; label: string }[] = [];
  let from = 1;
  for (const b of bandsFor(body, size)) {
    const label = b.zone === "armen" ? "Arme (gerade rechts, ungerade links)" : b.zone === "beinen" ? "Beine (gerade rechts, ungerade links)" : ZONE_LABEL[b.zone];
    out.push({ range: from === b.to ? `${from}` : `${from}-${b.to}`, label });
    from = b.to + 1;
  }
  return out;
}

/** Zones a user can aim at. */
export function targetableZones(body: BodyType): ZoneKey[] {
  switch (body) {
    case "humanoid": return ["kopf", "torso", "armL", "armR", "beinL", "beinR"];
    case "vierbeiner": return ["kopf", "torso", "vorderbeine", "hinterbeine"];
    case "sechsGliedmassen": return ["kopf", "torso", "vordereGliedmassen", "mittlereGliedmassen", "hintereGliedmassen", "schwanz"];
    case "fangarme": return ["kopf", "torso", "fangarme"];
    default: return [];
  }
}

// ---------------------------------------------------------------- targeted attacks

/** Book: Kopf -10, Torso -4, Arme -8, Beine -8 (humanoid, klein bis gross). */
export const TARGET_MODIFIER: Record<ZoneGroup, number> = {
  kopf: -10,
  torso: -4,
  arme: -8,
  beine: -8,
  // ASSUMPTION: the book gives no values for non-humanoid zones. Limbs and tail use the leg value (-8), a body without
  // zones cannot be targeted (0). Creature-specific weak spots (-2 to -8) are not modelled.
  gliedmassen: -8,
  schwanz: -8,
  koerper: 0,
};

/** Book: Ueberrascht lowers the penalty by 2 in every zone. */
export const SURPRISED_TARGET_BONUS = 2;

export interface TargetOpts {
  /** attacker has Gezielter Angriff / Gezielter Schuss: penalty halved */
  sf?: boolean;
  /** target has the status Ueberrascht: penalty lowered by 2 */
  surprised?: boolean;
}

/**
 * AT/FK modifier for a targeted attack (<= 0). Order from the book: halve first (SF), then +2 (Ueberrascht).
 * ASSUMPTION: halving rounds toward zero (the book values -10/-4/-8 are all even-halvable except -10 -> -5, exact).
 */
export function targetedModifier(zone: ZoneKey, o: TargetOpts = {}): number {
  let v = TARGET_MODIFIER[zoneGroup(zone)];
  if (v === 0) return 0;
  if (o.sf) v = Math.trunc(v / 2);
  if (o.surprised) v += SURPRISED_TARGET_BONUS;
  return Math.min(0, v);
}

// ---------------------------------------------------------------- zone armour

export type ZoneRsMap = Partial<Record<string, number>>;

/**
 * RS to use against a zone: a zone value from `zoneRs` (keys: the exact zone id, else the group "kopf"/"torso"/"arme"/
 * "beine"/"gliedmassen"/"schwanz"/"koerper"), otherwise the general RS.
 */
export function zoneRsFor(zone: ZoneKey, zoneRs: ZoneRsMap | undefined, generalRs: number): { rs: number; source: "zone" | "gesamt" } {
  if (zoneRs) {
    const v = zoneRs[zone] ?? zoneRs[zoneGroup(zone)];
    if (typeof v === "number" && Number.isFinite(v)) return { rs: Math.max(0, v), source: "zone" };
  }
  return { rs: generalRs, source: "gesamt" };
}

// ---------------------------------------------------------------- Wundschwelle and Wundeffekte

/** Book: Wundschwelle = half KO, rounded up (KO 11 -> 6). */
export const woundThreshold = (ko: number): number => Math.max(1, Math.ceil(ko / 2));

export type WoundEffectKind = "betaeubung" | "zusatzSP" | "waffeFallen" | "liegend";

export interface WoundEffect {
  kind: WoundEffectKind;
  /** short German label */
  label: string;
  /** long German description for the tooltip / log */
  text: string;
}

/** Skill used to resist: Kopf/Torso "Handlungsfähigkeit bewahren", Arme/Beine "Störungen ignorieren". */
export type WoundResist = "Handlungsfähigkeit bewahren" | "Störungen ignorieren";

export const WOUND_EXTRA_SP = "1W3+1";

/** Book table. Zones without an entry (tail, body, tentacles, ...) have no defined effect: the GM decides. */
export function woundEffectFor(zone: ZoneKey): { effect: WoundEffect; resist: WoundResist } | null {
  switch (zoneGroup(zone)) {
    case "kopf":
      return { effect: { kind: "betaeubung", label: "Betäubung I", text: "Eine Stufe Betäubung." }, resist: "Handlungsfähigkeit bewahren" };
    case "torso":
      return { effect: { kind: "zusatzSP", label: `+${WOUND_EXTRA_SP} SP`, text: `Zusätzlich ${WOUND_EXTRA_SP} SP.` }, resist: "Handlungsfähigkeit bewahren" };
    case "arme":
      return {
        effect: { kind: "waffeFallen", label: "Lässt Gehaltenes fallen", text: "Lässt in dieser Hand gehaltene Objekte los (Einhandwaffe/Gegenstand fällt; Zweihandwaffen und Schilde nicht)." },
        resist: "Störungen ignorieren",
      };
    case "beine":
      // ASSUMPTION: front/hind legs of animals count as "Beine" (Liegend).
      return { effect: { kind: "liegend", label: "Liegend", text: "Geht zu Boden und erleidet den Status Liegend." }, resist: "Störungen ignorieren" };
    default:
      return null;
  }
}

export interface WoundResult {
  threshold: number;
  /** SP dealt (after RS) that were compared with the threshold */
  sp: number;
  /** floor(sp / threshold) */
  multiple: number;
  /** penalty of the resist roll (= multiple), shown as "-n" */
  resistPenalty: number;
  effect: WoundEffect;
  resist: WoundResist;
}

/**
 * Wound check for one hit. `sp` = damage after RS (ASSUMPTION: "Schadenspunkte durch eine Verletzung" = SP after RS).
 * Returns null below the threshold, without KO, or for zones without a defined effect.
 */
export function evaluateWound(zone: ZoneKey, sp: number, ko: number | null | undefined): WoundResult | null {
  if (!ko || ko <= 0 || sp <= 0) return null;
  const threshold = woundThreshold(ko);
  if (sp < threshold) return null;
  const e = woundEffectFor(zone);
  if (!e) return null;
  const multiple = Math.floor(sp / threshold);
  return { threshold, sp, multiple, resistPenalty: multiple, effect: e.effect, resist: e.resist };
}

/** Roll the torso wound's extra damage (1W3+1). */
export function rollWoundExtraSP(roller: Roller): { rolls: number[]; total: number } {
  const r = rollDice(WOUND_EXTRA_SP, roller);
  return { rolls: r.rolls, total: r.total };
}

/** Effect to set for one-click apply, or null when the wound has no state-based effect. */
export function woundEffectToApply(w: WoundResult): { kind: "zustand"; key: "betaeubung"; level: number } | { kind: "status"; key: "liegend" } | null {
  if (w.effect.kind === "betaeubung") return { kind: "zustand", key: "betaeubung", level: 1 };
  if (w.effect.kind === "liegend") return { kind: "status", key: "liegend" };
  return null;
}

// ---------------------------------------------------------------- the zone roll for one hit

export interface ZoneHit {
  zone: ZoneKey;
  /** W20 result; null when the attacker aimed at the zone */
  roll: number | null;
  targeted: boolean;
  /** zone fixed by hand (no roll, no penalty) or changed afterwards with reassignZone */
  manual?: boolean;
  /** reassignZone only: the W20 result of the original zone, kept for the log */
  fromRoll?: number | null;
  rs: number;
  rsSource: "zone" | "gesamt";
}

/** Zone context handed to resolveAttack. */
export interface ZoneParams {
  bodyType: BodyType;
  size: SizeCat;
  /** KO of the target (heroes: attribute KO; creatures: `ko` field); wounds are skipped without it */
  ko?: number | null;
  /** zone the attacker aimed at; skips the W20 roll (the AT penalty is applied by the caller, not here) */
  targeted?: ZoneKey | null;
  /** zone fixed by hand (dice rolled at the table / GM decision): skips the W20 roll, NO penalty */
  forced?: ZoneKey | null;
  zoneRs?: ZoneRsMap;
}

export function rollZone(p: ZoneParams, generalRs: number, roller: Roller): ZoneHit {
  let zone: ZoneKey;
  let roll: number | null = null;
  const valid = targetableZones(p.bodyType);
  let manual = false;
  if (p.forced && valid.includes(p.forced)) (zone = p.forced), (manual = true);
  else if (p.targeted && valid.includes(p.targeted)) zone = p.targeted;
  else {
    roll = roller(20);
    zone = zoneForRoll(p.bodyType, p.size, roll);
  }
  const { rs, source } = zoneRsFor(zone, p.zoneRs, generalRs);
  return { zone, roll, targeted: roll === null && !manual, ...(manual ? { manual: true } : {}), rs, rsSource: source };
}

/** Last hit remembered per combatant (cockpit badge). */
export interface LastHit {
  zone: ZoneKey;
  sp: number;
  wound: boolean;
}

// ---------------------------------------------------------------- damage taken per zone (tracking)

/**
 * DSA 5 has no LeP per zone. "LeP of a zone" is therefore tracked as the damage a zone has taken in this fight:
 * SP (after RS), number of hits, number of hits that reached the Wundschwelle.
 */
export interface ZoneTally {
  sp: number;
  hits: number;
  wounds: number;
}
export type ZoneDamage = Partial<Record<ZoneKey, ZoneTally>>;

/** Sum of two zone-damage maps/deltas without clamping (used for patch deltas). */
export function mergeZoneDamage(a: ZoneDamage | undefined, b: ZoneDamage | undefined): ZoneDamage {
  const out: ZoneDamage = {};
  for (const src of [a, b]) {
    if (!src) continue;
    for (const k of Object.keys(src) as ZoneKey[]) {
      const t = src[k];
      if (!t) continue;
      const c = out[k] ?? { sp: 0, hits: 0, wounds: 0 };
      out[k] = { sp: c.sp + t.sp, hits: c.hits + t.hits, wounds: c.wounds + t.wounds };
    }
  }
  return out;
}

/** Apply a delta to the stored tracking: values never drop below 0, all-zero zones are dropped. Pure. */
export function applyZoneDamage(base: ZoneDamage | undefined, delta: ZoneDamage): ZoneDamage {
  const sum = mergeZoneDamage(base, delta);
  const out: ZoneDamage = {};
  for (const k of Object.keys(sum) as ZoneKey[]) {
    const t = sum[k] as ZoneTally;
    const v = { sp: Math.max(0, t.sp), hits: Math.max(0, t.hits), wounds: Math.max(0, t.wounds) };
    if (v.sp || v.hits || v.wounds) out[k] = v;
  }
  return out;
}

export const negateZoneDamage = (d: ZoneDamage): ZoneDamage => {
  const out: ZoneDamage = {};
  for (const k of Object.keys(d) as ZoneKey[]) {
    const t = d[k];
    if (t) out[k] = { sp: -t.sp, hits: -t.hits, wounds: -t.wounds };
  }
  return out;
};

/** The tally delta of one hit. */
export const hitTally = (zone: ZoneKey, sp: number, wound: boolean): ZoneDamage => ({ [zone]: { sp, hits: 1, wounds: wound ? 1 : 0 } });

/**
 * W20 ranges per zone for the overview, in targeting order. Humanoid arms/legs share a band: odd = left, even = right.
 * Empty for bodies without zones.
 */
export function zoneRollRanges(body: BodyType, size: SizeCat): { zone: ZoneKey; range: string }[] {
  if (body === "amorph") return [];
  const out: { zone: ZoneKey; range: string }[] = [];
  let from = 1;
  for (const b of bandsFor(body, size)) {
    const r = from === b.to ? `${from}` : `${from}-${b.to}`;
    if (b.zone === "armen") out.push({ zone: "armL", range: `${r} ungerade` }, { zone: "armR", range: `${r} gerade` });
    else if (b.zone === "beinen") out.push({ zone: "beinL", range: `${r} ungerade` }, { zone: "beinR", range: `${r} gerade` });
    else out.push({ zone: b.zone, range: r });
    from = b.to + 1;
  }
  return out;
}
