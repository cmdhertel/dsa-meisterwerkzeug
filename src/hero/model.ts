// Pure hero model: Heldenschmiede JSON (+ mapping) -> Hero. No obsidian imports.
import { COMBAT_TECHNIQUE_BASE } from "../engine/constants";
import { tryParseDice } from "../engine/dice";
import { ATTR_KEYS, Attributes, AttrKey } from "../engine/types";
import type { Combatant, Weapon } from "../model";
import { TALENT_BY_KEY, talentByKey, talentByName } from "./keys";
import { ArmorEntry, HeroMapping, WeaponEntry, emptyMapping, lookupName } from "./mapping";

export const HERO_SCHEMA = "dsa-heldenschmiede-character";

export interface Pool {
  value: number;
  max: number;
}

export interface HeroSpell {
  key: number;
  label: string;
  resolved: boolean;
  /** Zauberfertigkeitswert */
  value: number;
}

export interface HeroWeaponRef {
  key: number;
  category: "melee" | "ranged";
  label: string;
  resolved: boolean;
  entry: WeaponEntry | null;
}

export interface HeroArmor {
  key: number;
  label: string;
  resolved: boolean;
  rs: number;
  be: number;
}

export interface Hero {
  uid: string;
  name: string;
  callName: string;
  attributes: Attributes;
  lep: Pool;
  asp: Pool;
  schip: Pool;
  ini: number;
  aw: number;
  sk: number;
  zk: number;
  gs: number;
  wundschwelle: number;
  /** talent name -> FW; talents missing from the export are 0 and NOT listed here, use talentValue() */
  talents: Record<string, number>;
  /** charSkills keys outside the known talent list */
  unknownTalents: { key: number; value: number }[];
  /** combat technique name -> value (from charCombatSkills + mapping.kampftechniken); empty = all at base */
  combatTechniques: Record<string, number>;
  spells: HeroSpell[];
  weapons: HeroWeaponRef[];
  armor: HeroArmor[];
  /** filled by HeroRepository */
  notePath?: string;
  dataPath?: string;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
const pool = (v: unknown): Pool => {
  const o = (v ?? {}) as Record<string, unknown>;
  const max = num(o.valueMax, num(o.value));
  return { value: num(o.value, max), max };
};

export interface HeroJson {
  schema?: string;
  character?: Record<string, unknown>;
  [k: string]: unknown;
}

export function validateHeroJson(json: unknown): string | null {
  if (!json || typeof json !== "object") return "Keine JSON-Datei mit Objekt.";
  const j = json as HeroJson;
  if (j.schema !== HERO_SCHEMA) return `Unbekanntes Schema "${String(j.schema)}" (erwartet ${HERO_SCHEMA}).`;
  if (!j.character || typeof j.character !== "object") return "Feld 'character' fehlt.";
  if (typeof j.character.uid !== "string" || !j.character.uid) return "character.uid fehlt.";
  if (typeof j.character.characterName !== "string" || !j.character.characterName) return "character.characterName fehlt.";
  return null;
}

/** Never throws on unknown keys; call validateHeroJson first for structural problems. */
export function parseHero(json: HeroJson, mapping: HeroMapping = emptyMapping()): Hero {
  const c = (json.character ?? {}) as Record<string, unknown>;

  const attributes = {} as Attributes;
  for (const k of ATTR_KEYS) attributes[k] = 0;
  for (const a of arr(c.attributes)) {
    const k = ATTR_KEYS[num(a.key, -1)];
    if (k) attributes[k] = num(a.value, num(a.valueBase));
  }

  const talents: Record<string, number> = {};
  const unknownTalents: Hero["unknownTalents"] = [];
  for (const s of arr(c.charSkills)) {
    const key = num(s.key, -1);
    const t = talentByKey(key);
    const value = num(s.value);
    if (t) talents[t.name] = value;
    else unknownTalents.push({ key, value });
  }

  const combatTechniques: Record<string, number> = {};
  for (const s of arr(c.charCombatSkills)) {
    const { label, resolved } = lookupName(mapping, "kampftechniken", num(s.key, -1));
    if (resolved) combatTechniques[label] = num(s.value, COMBAT_TECHNIQUE_BASE);
  }

  const spells: HeroSpell[] = arr(c.charMysticalSkills).map((s) => {
    const key = num(s.key, -1);
    return { key, value: num(s.value), ...lookupName(mapping, "zauber", key) };
  });

  const weapons: HeroWeaponRef[] = [];
  for (const [list, cat, mcat] of [
    [c.boughtWeaponMeleeList, "melee", "waffenNahkampf"],
    [c.boughtWeaponRangedList, "ranged", "waffenFernkampf"],
  ] as const) {
    for (const w of arr(list)) {
      const key = num(w.key, -1);
      const entry = (mapping[mcat] as Record<string, WeaponEntry | undefined>)[String(key)] ?? null;
      const l = lookupName(mapping, mcat, key);
      weapons.push({ key, category: cat, label: l.label, resolved: l.resolved, entry: l.resolved ? entry : entry && (entry.tp || entry.kampftechnik) ? entry : null });
    }
  }

  const armor: HeroArmor[] = arr(c.boughtArmorList).map((a) => {
    const key = num(a.key, -1);
    const e = (mapping.ruestung as Record<string, ArmorEntry | undefined>)[String(key)];
    return { key, ...lookupName(mapping, "ruestung", key), rs: num(e?.rs), be: num(e?.be) };
  });

  return {
    uid: str(c.uid),
    name: str(c.characterName),
    callName: str(c.callName, str(c.characterName)),
    attributes,
    lep: pool(c.lep),
    asp: pool(c.asp),
    schip: pool(c.schip),
    ini: num(c.ini),
    aw: num(c.aw),
    sk: num(c.sk),
    zk: num(c.zk),
    gs: num(c.gs),
    wundschwelle: num(c.wundschwelle),
    talents,
    unknownTalents,
    combatTechniques,
    spells,
    weapons,
    armor,
  };
}

// ---------------------------------------------------------------- accessors used by the next agents

/** FW of a talent by name (case-insensitive); 0 if the hero has none. Throws nothing on unknown names (returns 0). */
export function talentValue(hero: Hero, name: string): number {
  const t = talentByName(name);
  return t ? hero.talents[t.name] ?? 0 : 0;
}

/** Attribute triple for a talent name, e.g. Sinnesschärfe -> [KL, IN, IN] values; null for unknown talents. */
export function talentAttributes(hero: Hero, name: string): { keys: [AttrKey, AttrKey, AttrKey]; values: [number, number, number] } | null {
  const t = talentByName(name);
  if (!t) return null;
  return { keys: t.attrs, values: t.attrs.map((k) => hero.attributes[k]) as [number, number, number] };
}

/** Leiteigenschaften per combat technique (Kampftechniken.md). */
export const COMBAT_TECHNIQUE_LEIT: Record<string, AttrKey[]> = {
  Armbrüste: ["FF"], Bögen: ["FF"], Dolche: ["GE"], Fechtwaffen: ["GE"], Hiebwaffen: ["KK"], Kettenwaffen: ["KK"],
  Lanzen: ["KK"], Raufen: ["GE", "KK"], Schilde: ["KO"], Schwerter: ["GE", "KK"], Stangenwaffen: ["GE", "KK"],
  Wurfwaffen: ["FF"], Zweihandhiebwaffen: ["KK"], Zweihandschwerter: ["KK"],
};

/** UNCONFIRMED against the vault: +1 TP per point of the Leiteigenschaft above this value (DSA5 core). */
export const LEIT_DAMAGE_THRESHOLD = 14;

export function leitDamageBonus(hero: Hero, technique: string): number {
  const keys = COMBAT_TECHNIQUE_LEIT[technique];
  if (!keys) return 0;
  const v = Math.max(...keys.map((k) => hero.attributes[k]));
  return Math.max(0, v - LEIT_DAMAGE_THRESHOLD);
}

export function combatTechniqueValue(hero: Hero, technique: string): number {
  return hero.combatTechniques[technique] ?? COMBAT_TECHNIQUE_BASE;
}

/** Ausweichen as computed by Heldenschmiede (`aw`). */
export const heroDodge = (hero: Hero): number => hero.aw;

/** Armor value: highest RS among the hero's resolved armor pieces (we cannot know which one is worn); 0 if none. */
export function heroRs(hero: Hero): number {
  return hero.armor.reduce((m, a) => Math.max(m, a.rs), 0);
}

/**
 * Combat values for one weapon entry, from the mapping:
 *   AT (melee) / FK (ranged) = technique value + atMod
 *   PA = ceil(technique value / 2) + paMod
 *   TP = entry.tp + Leiteigenschaft bonus
 * Technique value = hero.combatTechniques[technique] or COMBAT_TECHNIQUE_BASE (6). Returns null AT/PA/TP when the
 * mapping entry is not filled in yet (technique / tp empty).
 */
export function weaponValues(hero: Hero, ref: HeroWeaponRef): Weapon {
  const e = ref.entry;
  const ranged = ref.category === "ranged";
  const technique = e?.kampftechnik?.trim() ?? "";
  const ktw = technique ? combatTechniqueValue(hero, technique) : null;
  const dice = e?.tp ? tryParseDice(e.tp) : null;
  let tp: string | null = null;
  if (dice) {
    const bonus = technique ? leitDamageBonus(hero, technique) : 0;
    const total = dice.bonus + bonus;
    tp = dice.count === 0 ? String(total) : `${dice.count}W${dice.sides}${total > 0 ? "+" + total : total < 0 ? String(total) : ""}`;
  }
  const rw = e?.rw?.trim() ?? "";
  const rm = rw.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  const at = ktw === null ? null : ktw + (e?.atMod ?? 0);
  return {
    name: ref.label,
    kind: ref.category,
    at: ranged ? null : at,
    pa: ranged || ktw === null ? null : Math.ceil(ktw / 2) + (e?.paMod ?? 0),
    fk: ranged ? at : null,
    tp,
    tpNote: "",
    rw,
    rwRanges: rm ? [parseInt(rm[1], 10), parseInt(rm[2], 10), parseInt(rm[3], 10)] : null,
    lz: null,
    raw: "",
    partial: at === null || tp === null,
  };
}

export function heroWeapons(hero: Hero): Weapon[] {
  return hero.weapons.map((w) => weaponValues(hero, w));
}

/** Hero -> static Combatant for the CombatStore. */
/** KO for the Wundschwelle (Trefferzonen); null when the hero has no readable KO. */
export const heroKo = (hero: Hero): number | null => (hero.attributes?.KO > 0 ? hero.attributes.KO : null);

export function heroToCombatant(hero: Hero): Combatant {
  return {
    name: hero.name,
    kind: "hero",
    sourcePath: hero.notePath ?? "",
    lepMax: hero.lep.max,
    iniBase: hero.ini,
    rs: heroRs(hero),
    vw: heroDodge(hero),
    weapons: heroWeapons(hero),
    needsManual: [],
    bodyType: "humanoid",
    size: "mittel",
    ko: heroKo(hero),
  };
}
