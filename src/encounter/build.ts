// Entries -> resolved enemies -> combatants / estimate inputs. Pure (no obsidian imports).
import type { ParseStatus } from "../bestiary/adapter";
import { Roller, defaultRoller, rollDice, tryParseDice } from "../engine/dice";
import type { Combatant, Weapon } from "../model";
import { DEFAULT_FALLBACK, DEFAULT_PARTY, Estimate, FallbackStats, Unit, diceAverage, estimate, manualPartyUnit, unitFromCombatant } from "./estimate";
import type { EncounterEntry, EncounterSpec } from "./parse";
import { splitHelden } from "./parse";
import { valueText } from "../valueText";

// ------------------------------------------------------------------ bestiary catalog

export interface CatalogEntry {
  path: string;
  basename: string;
  /** statblock name */
  name: string;
  combatant: Combatant;
  status: ParseStatus;
  problems: string[];
  /** raw `anzahl` frontmatter ("1W6 oder 2W6") */
  anzahl: string;
  typus: string;
  tags: string[];
  /** `aktionen` if numeric */
  actions: number | null;
}

/** Extra frontmatter fields the builder needs besides the statblock. */
export function creatureMeta(fm: Record<string, unknown> | null | undefined): { anzahl: string; typus: string; tags: string[]; actions: number | null } {
  const f = fm ?? {};
  const tags = Array.isArray(f.tags) ? f.tags.map((t) => String(t)) : typeof f.tags === "string" ? [f.tags] : [];
  const a = typeof f.aktionen === "number" ? f.aktionen : typeof f.aktionen === "string" && /^\s*\d+\s*$/.test(f.aktionen) ? parseInt(f.aktionen, 10) : null;
  return {
    anzahl: valueText(f.anzahl),
    typus: typeof f.typus === "string" ? f.typus : "",
    tags,
    actions: a !== null && a > 0 ? a : null,
  };
}

export type CatalogIndex = Map<string, CatalogEntry>;

export function indexCatalog(list: readonly CatalogEntry[]): CatalogIndex {
  const m: CatalogIndex = new Map();
  for (const c of list) {
    for (const k of [c.basename, c.name]) {
      const key = k.trim().toLowerCase();
      if (key && !m.has(key)) m.set(key, c);
    }
  }
  return m;
}

/** Exact (case-insensitive) match by note name or statblock name. */
export const lookupCreature = (index: CatalogIndex, name: string): CatalogEntry | null => index.get(name.trim().toLowerCase()) ?? null;

// ------------------------------------------------------------------ resolution

export interface ResolvedEntry {
  index: number;
  entry: EncounterEntry;
  catalog: CatalogEntry | null;
  /** true: defined by overrides alone (not in the bestiary or the note has no statblock) */
  adhoc: boolean;
  displayName: string;
  /** effective count for this evaluation */
  count: number;
  /** count came from the expected value of a dice count, not from a roll */
  countIsGuess: boolean;
  /** combatant with all overrides applied; ready for the add-creature flow */
  combatant: Combatant;
  warnings: string[];
  actions: number | null;
}

const newAdhoc = (name: string): Combatant => ({ name, kind: "creature", sourcePath: "", lepMax: null, iniBase: null, rs: null, vw: null, weapons: [], needsManual: [] });

function adhocWeapon(e: EncounterEntry): Weapon | null {
  if (e.at === undefined && e.tp === undefined && e.pa === undefined) return null;
  return {
    name: "Angriff",
    kind: "melee",
    at: e.at ?? null,
    pa: e.pa ?? null,
    fk: null,
    tp: e.tp ?? null,
    tpNote: "",
    rw: "",
    rwRanges: null,
    lz: null,
    raw: "",
    partial: e.at === undefined || e.tp === undefined,
  };
}

/** Roll the dice counts of a spec: index -> rolled number (min 1). */
export function rollCounts(spec: EncounterSpec, roller: Roller = defaultRoller): Record<number, number> {
  const out: Record<number, number> = {};
  spec.entries.forEach((e, i) => {
    if (e.countDice) out[i] = Math.max(1, rollDice(e.countDice, roller).total);
  });
  return out;
}

export function resolveEntries(spec: EncounterSpec, index: CatalogIndex, counts?: Record<number, number>): ResolvedEntry[] {
  return spec.entries.map((entry, i) => {
    const cat = lookupCreature(index, entry.creature);
    const adhoc = !cat || cat.status === "nostats";
    const warnings: string[] = [];
    const base: Combatant = cat ? cat.combatant : newAdhoc(entry.creature);
    const c: Combatant = { ...base, weapons: [...base.weapons], needsManual: [...base.needsManual] };
    if (entry.name) c.name = entry.name;
    else if (!cat) c.name = entry.creature;

    if (entry.lep !== undefined) c.lepMax = entry.lep;
    if (entry.ini !== undefined) c.iniBase = entry.ini;
    if (entry.rs !== undefined) c.rs = entry.rs;
    c.needsManual = c.needsManual.filter((f) => !(f === "lep" && entry.lep !== undefined) && !(f === "ini" && entry.ini !== undefined));

    if (adhoc) {
      if (entry.vw !== undefined) c.vw = entry.vw;
      const w = adhocWeapon(entry);
      if (w) c.weapons = [w];
      const miss: string[] = [];
      if (c.lepMax === null) miss.push("LeP");
      if (c.iniBase === null) miss.push("INI");
      if (entry.at === undefined) miss.push("AT");
      if (entry.tp === undefined) miss.push("TP");
      if (c.rs === null) miss.push("RS");
      warnings.push(
        !cat
          ? `${entry.creature}: nicht im Bestiarium, eigener Gegner.` + (miss.length ? ` Es fehlen: ${miss.join(", ")}.` : "")
          : `${entry.creature}: Bestiariumseintrag ohne Wertekasten.` + (miss.length ? ` Es fehlen: ${miss.join(", ")}.` : ""),
      );
    } else {
      const ignored = (["at", "pa", "vw", "tp"] as const).filter((k) => entry[k] !== undefined);
      if (ignored.length) warnings.push(`${entry.creature}: ${ignored.map((k) => k.toUpperCase()).join("/")} wird nur bei eigenen Gegnern übernommen (ignoriert).`);
      if (c.needsManual.includes("lep")) warnings.push(`${entry.creature}: LeP ist „variabel“, bitte LeP angeben (sonst Rückfrage beim Laden).`);
      else if (c.lepMax === null) warnings.push(`${entry.creature}: LeP fehlt im Bestiarium.`);
      if (c.needsManual.includes("ini")) warnings.push(`${entry.creature}: INI ist „variabel“, bitte INI angeben (sonst Rückfrage beim Laden).`);
      else if (c.iniBase === null) warnings.push(`${entry.creature}: INI fehlt im Bestiarium.`);
      if (!c.weapons.length) warnings.push(`${entry.creature}: keine Angriffe im Bestiarium.`);
    }

    let count = entry.count;
    let countIsGuess = false;
    if (entry.countDice) {
      const rolled = counts?.[i];
      if (rolled !== undefined) count = rolled;
      else {
        const d = tryParseDice(entry.countDice);
        count = Math.max(1, Math.round(d ? diceAverage(d) : 1));
        countIsGuess = true;
      }
    }
    return { index: i, entry, catalog: cat, adhoc, displayName: c.name, count, countIsGuess, combatant: c, warnings, actions: cat?.actions ?? null };
  });
}

/** Best attack (AT) of a resolved entry for display, or null. */
export function bestAt(c: Combatant): number | null {
  let best: number | null = null;
  for (const w of c.weapons) {
    const v = w.kind === "ranged" ? w.fk : w.at;
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/** TP text of the weapon with the best AT. */
export function bestTp(c: Combatant): string | null {
  let best: Weapon | null = null;
  for (const w of c.weapons) {
    const v = w.kind === "ranged" ? w.fk : w.at;
    const bv = best ? (best.kind === "ranged" ? best.fk : best.at) : null;
    if (v !== null && (bv === null || v > bv)) best = w;
  }
  return best ? (best.tp ?? (best.tpNote || null)) : null;
}

// ------------------------------------------------------------------ heroes

export interface HeroRef {
  name: string;
  callName?: string;
  campaign: string;
}

/** Resolves `helden:` tokens (campaign names or hero names) to hero names. */
export function resolveHelden(helden: string | undefined, heroes: readonly HeroRef[]): { names: string[]; unresolved: string[] } {
  const names: string[] = [];
  const unresolved: string[] = [];
  const add = (n: string) => names.includes(n) || names.push(n);
  for (const tok of splitHelden(helden)) {
    const t = tok.toLowerCase();
    const byName = heroes.find((h) => h.name.toLowerCase() === t || (h.callName ?? "").toLowerCase() === t);
    if (byName) {
      add(byName.name);
      continue;
    }
    const inCampaign = heroes.filter((h) => h.campaign.toLowerCase() === t);
    if (inCampaign.length) inCampaign.forEach((h) => add(h.name));
    else unresolved.push(tok);
  }
  return { names, unresolved };
}

export type HeroSide = { kind: "heroes"; combatants: Combatant[] } | { kind: "manual"; count: number; lep: number };

export const defaultManualSide = (): HeroSide => ({ kind: "manual", count: DEFAULT_PARTY.count, lep: DEFAULT_PARTY.lep });

// ------------------------------------------------------------------ estimate for a whole encounter

export function estimateEncounter(resolved: readonly ResolvedEntry[], side: HeroSide, fb: FallbackStats = DEFAULT_FALLBACK): Estimate {
  const guessed: string[] = [];
  const enemies: Unit[] = [];
  for (const r of resolved) {
    const { unit, guessed: g } = unitFromCombatant(r.combatant, r.count, { actions: r.actions, label: r.displayName }, fb);
    enemies.push(unit);
    guessed.push(...g);
    if (r.countIsGuess) guessed.push(`${r.displayName}: Anzahl ${r.entry.countDice} nicht gewürfelt, Erwartungswert ${r.count} angenommen`);
  }
  const heroes: Unit[] = [];
  if (side.kind === "heroes" && side.combatants.length) {
    for (const h of side.combatants) {
      const { unit, guessed: g } = unitFromCombatant(h, 1, {}, fb);
      heroes.push(unit);
      guessed.push(...g);
    }
  } else {
    const count = side.kind === "manual" ? side.count : DEFAULT_PARTY.count;
    const lep = side.kind === "manual" ? side.lep : DEFAULT_PARTY.lep;
    const { unit, guessed: g } = manualPartyUnit(count, lep, fb);
    heroes.push(unit);
    guessed.push(...g);
  }
  return estimate(heroes, enemies, guessed);
}
