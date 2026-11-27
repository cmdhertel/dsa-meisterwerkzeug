// User-editable key mapping for everything Heldenschmiede exports as bare numeric keys.

export type MappingCategory =
  | "zauber"
  | "waffenNahkampf"
  | "waffenFernkampf"
  | "ruestung"
  | "kampftechniken"
  | "vorteile"
  | "sonderfertigkeiten"
  | "ausruestung"
  | "sprachen"
  | "schriften";

export const MAPPING_CATEGORIES: MappingCategory[] = [
  "zauber",
  "waffenNahkampf",
  "waffenFernkampf",
  "ruestung",
  "kampftechniken",
  "vorteile",
  "sonderfertigkeiten",
  "ausruestung",
  "sprachen",
  "schriften",
];

/** Display prefix for unresolved keys, e.g. "Zauber #534". */
export const CATEGORY_LABEL: Record<MappingCategory, string> = {
  zauber: "Zauber",
  waffenNahkampf: "Nahkampfwaffe",
  waffenFernkampf: "Fernkampfwaffe",
  ruestung: "Rüstung",
  kampftechniken: "Kampftechnik",
  vorteile: "Vorteil/Nachteil",
  sonderfertigkeiten: "Sonderfertigkeit",
  ausruestung: "Ausrüstung",
  sprachen: "Sprache",
  schriften: "Schrift",
};

export interface NameEntry {
  name: string;
}
export interface WeaponEntry extends NameEntry {
  /** combat technique, e.g. "Dolche" (see Kampftechniken.md) */
  kampftechnik: string;
  /** damage dice, e.g. "1W6+2" */
  tp: string;
  /** modifier on top of the technique value (AT; for ranged weapons: FK) */
  atMod: number;
  paMod: number;
  /** melee reach "kurz|mittel|lang" or ranged "5/10/20" */
  rw: string;
}
export interface ArmorEntry extends NameEntry {
  rs: number;
  be: number;
}

export interface HeroMapping {
  _hinweis: string;
  zauber: Record<string, NameEntry>;
  waffenNahkampf: Record<string, WeaponEntry>;
  waffenFernkampf: Record<string, WeaponEntry>;
  ruestung: Record<string, ArmorEntry>;
  kampftechniken: Record<string, NameEntry>;
  vorteile: Record<string, NameEntry>;
  sonderfertigkeiten: Record<string, NameEntry>;
  ausruestung: Record<string, NameEntry>;
  sprachen: Record<string, NameEntry>;
  schriften: Record<string, NameEntry>;
}

export const MAPPING_HINT =
  "Heldenschmiede exportiert nur numerische Schlüssel. Trage hier bei jedem Eintrag den Namen ein (und bei Waffen Kampftechnik, TP, AT/PA-Modifikatoren, Reichweite). Leere Namen werden als 'Zauber #534' usw. angezeigt. Das Plugin ergänzt neue Schlüssel automatisch als leere Einträge und überschreibt nie deine Eingaben.";

export function emptyMapping(): HeroMapping {
  return {
    _hinweis: MAPPING_HINT,
    zauber: {},
    waffenNahkampf: {},
    waffenFernkampf: {},
    ruestung: {},
    kampftechniken: {},
    vorteile: {},
    sonderfertigkeiten: {},
    ausruestung: {},
    sprachen: {},
    schriften: {},
  };
}

export function emptyWeaponEntry(): WeaponEntry {
  return { name: "", kampftechnik: "", tp: "", atMod: 0, paMod: 0, rw: "" };
}

/**
 * A hand-written entry is either an object or a bare string (the name, e.g. `"534": "Feuerball"`).
 * Strings become a full entry with defaults for the category, so the entry is kept and not replaced by a stub.
 */
function normalizeEntry(cat: MappingCategory, v: unknown): unknown {
  if (typeof v === "string") {
    if (cat === "waffenNahkampf" || cat === "waffenFernkampf") return { ...emptyWeaponEntry(), name: v };
    if (cat === "ruestung") return { name: v, rs: 0, be: 0 };
    return { name: v };
  }
  return v && typeof v === "object" ? v : undefined;
}

/** Parse mapping text. Returns null if it is not valid JSON/object (caller must then NOT overwrite the file). */
export function parseMapping(text: string): HeroMapping | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = emptyMapping();
  const r = raw as Record<string, unknown>;
  if (typeof r._hinweis === "string") out._hinweis = r._hinweis;
  for (const cat of MAPPING_CATEGORIES) {
    const sec = r[cat];
    if (sec && typeof sec === "object" && !Array.isArray(sec)) {
      for (const [k, v] of Object.entries(sec as Record<string, unknown>)) {
        const entry = normalizeEntry(cat, v);
        if (entry) (out[cat] as Record<string, unknown>)[k] = entry;
      }
    }
  }
  return out;
}

export function lookupName(mapping: HeroMapping, cat: MappingCategory, key: number): { label: string; resolved: boolean } {
  const e = (mapping[cat] as Record<string, NameEntry | undefined>)[String(key)];
  const name = typeof e?.name === "string" ? e.name.trim() : "";
  return name ? { label: name, resolved: true } : { label: `${CATEGORY_LABEL[cat]} #${key}`, resolved: false };
}

/** Keys a hero uses per category (from the raw character object). */
export function collectKeys(character: Record<string, unknown>): Record<MappingCategory, number[]> {
  const keysOf = (v: unknown): number[] =>
    Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? (x as { key?: unknown }).key : undefined)).filter((k): k is number => typeof k === "number") : [];
  const scripts = Array.isArray(character.scriptKeys) ? (character.scriptKeys as unknown[]).filter((k): k is number => typeof k === "number") : [];
  return {
    zauber: keysOf(character.charMysticalSkills),
    waffenNahkampf: keysOf(character.boughtWeaponMeleeList),
    waffenFernkampf: keysOf(character.boughtWeaponRangedList),
    ruestung: keysOf(character.boughtArmorList),
    kampftechniken: keysOf(character.charCombatSkills),
    vorteile: keysOf(character.charBoons),
    sonderfertigkeiten: keysOf(character.charAbilities),
    ausruestung: keysOf(character.boughtEquipmentList),
    sprachen: keysOf(character.charLanguages),
    schriften: scripts,
  };
}

/**
 * Add empty stubs for every key that is not in the mapping yet. Never touches existing entries.
 * Returns the new mapping (a copy) and the list of added "category/key" ids.
 */
export function addStubs(mapping: HeroMapping, keys: Record<MappingCategory, number[]>): { mapping: HeroMapping; added: string[] } {
  const next: HeroMapping = JSON.parse(JSON.stringify(mapping));
  const added: string[] = [];
  for (const cat of MAPPING_CATEGORIES) {
    const sec = next[cat] as Record<string, unknown>;
    for (const k of keys[cat]) {
      const id = String(k);
      if (id in sec) continue;
      sec[id] = cat === "waffenNahkampf" || cat === "waffenFernkampf" ? emptyWeaponEntry() : cat === "ruestung" ? { name: "", rs: 0, be: 0 } : { name: "" };
      added.push(`${cat}/${id}`);
    }
    // keep keys numerically sorted for readability
    const sorted = Object.keys(sec).sort((a, b) => Number(a) - Number(b));
    const re: Record<string, unknown> = {};
    for (const k of sorted) re[k] = sec[k];
    (next as unknown as Record<string, unknown>)[cat] = re;
  }
  return { mapping: next, added };
}

export function serializeMapping(m: HeroMapping): string {
  return JSON.stringify(m, null, 2) + "\n";
}
