// Pure caster model: heroes (frontmatter + imported spells) and bestiary creatures (zauber:/liturgien: strings).
import type { Attributes, AttrKey } from "../engine/types";
import { ATTR_KEYS } from "../engine/types";
import type { Hero } from "../hero/model";
import type { SpellKind } from "./spells";

export interface KnownSpell {
  name: string;
  kind: SpellKind;
  fw: number;
  /** hero spell whose name is not mapped yet ("Zauber #534") */
  unresolved?: boolean;
}

export interface Caster {
  id: string;
  label: string;
  kind: "hero" | "creature";
  attrs: Partial<Attributes>;
  sk: number;
  zk: number;
  known: KnownSpell[];
  /** current energy, null = unknown / none */
  asp: number | null;
  aspMax: number | null;
  kap: number | null;
  kapMax: number | null;
  notePath?: string;
}

/** Frontmatter keys written by the rest/calendar feature. */
export const KEY_ASP_CURRENT = "AsP_aktuell";
export const KEY_KAP_CURRENT = "KaP_aktuell";

const toNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = /^\s*(-?\d+)/.exec(v);
    if (m) return Number(m[1]);
  }
  return null;
};
export const energyNumber = toNum;

/** Split "Ignifaxius 11, Segnungen (Eidsegen) 12" -> entries; commas inside parentheses are kept. */
export function parseSpellList(value: unknown, kind: SpellKind): KnownSpell[] {
  const items: string[] = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
  const out: KnownSpell[] = [];
  for (const item of items) {
    let depth = 0;
    let cur = "";
    const parts: string[] = [];
    for (const ch of item) {
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if ((ch === "," || ch === ";") && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const m = /^\s*(.+?)\s+(-?\d+)\s*$/.exec(p);
      if (m) out.push({ name: m[1].trim(), kind, fw: Number(m[2]) });
      else if (p.trim() && !/^[–-]$/.test(p.trim())) out.push({ name: p.trim(), kind, fw: 0 });
    }
  }
  return out;
}

export function casterFromHero(hero: Hero, fm: Record<string, unknown> | undefined): Caster {
  const f = fm ?? {};
  const aspMax = toNum(f["AsP"]) ?? (hero.asp.max || null);
  const kapMax = toNum(f["KaP"]);
  const known: KnownSpell[] = hero.spells.map((s) => ({ name: s.label, kind: "zauber", fw: s.value, unresolved: !s.resolved }));
  const hasNote = !!hero.notePath;
  return {
    id: `hero:${hero.uid}`,
    label: hero.callName || hero.name,
    kind: "hero",
    attrs: { ...hero.attributes },
    sk: hero.sk,
    zk: hero.zk,
    known,
    asp: aspMax === null ? null : hasNote ? (toNum(f[KEY_ASP_CURRENT]) ?? aspMax) : aspMax,
    aspMax,
    kap: kapMax === null ? null : (toNum(f[KEY_KAP_CURRENT]) ?? kapMax),
    kapMax,
    notePath: hero.notePath,
  };
}

export function casterFromCreature(fm: Record<string, unknown> | undefined, path: string, fallbackName: string): Caster {
  const f = fm ?? {};
  const attrs: Partial<Attributes> = {};
  for (const k of ATTR_KEYS) {
    const v = toNum(f[k.toLowerCase()]);
    if (v !== null) attrs[k as AttrKey] = v;
  }
  const asp = toNum(f["asp"]);
  const kap = toNum(f["kap"]);
  return {
    id: `creature:${path}`,
    label: typeof f["name"] === "string" && f["name"] ? (f["name"] as string) : fallbackName,
    kind: "creature",
    attrs,
    sk: toNum(f["sk"]) ?? 0,
    zk: toNum(f["zk"]) ?? 0,
    known: [...parseSpellList(f["zauber"], "zauber"), ...parseSpellList(f["liturgien"], "liturgie")],
    asp,
    aspMax: asp,
    kap,
    kapMax: kap,
    notePath: path,
  };
}

export function findKnown(c: Caster, name: string, kind?: SpellKind): KnownSpell | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
  const n = norm(name);
  const base = norm(name.replace(/\(.*?\)/g, ""));
  return c.known.find((k) => (!kind || k.kind === kind) && (norm(k.name) === n || norm(k.name.replace(/\(.*?\)/g, "")) === base)) ?? null;
}
