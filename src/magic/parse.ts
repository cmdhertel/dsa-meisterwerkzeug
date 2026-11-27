// Inline code: `zauber: Ignifaxius +2 @Thorwin` / `liturgie: Blendstrahl -1`
import type { AttrKey } from "../engine/types";
import type { SpellKind } from "./spells";

/** Attributes remembered for a spell without rule note (zauber-eigenschaften.json). */
export interface RememberedSpell {
  probe: [AttrKey, AttrKey, AttrKey];
  kosten?: number | null;
}

/**
 * Content of zauber-eigenschaften.json. Blank text -> empty memory. Anything that is not a JSON object -> null,
 * meaning: the file is broken and must never be overwritten.
 */
export function parseMemoryFile(text: string): Record<string, RememberedSpell> | null {
  if (!text.trim()) return {};
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, RememberedSpell>) : null;
  } catch {
    return null;
  }
}

export interface MagicSpec {
  kind: SpellKind;
  name: string;
  /** positive = easier */
  modifier: number;
  hero: string | null;
}

export const MAGIC_PREFIX = /^\s*(zauber|liturgie)\s*:/i;
export const isMagicCode = (text: string): boolean => MAGIC_PREFIX.test(text);

export function parseMagic(raw: string): { ok: true; spec: MagicSpec } | { ok: false; error: string } {
  const m = /^\s*(zauber|liturgie)\s*:\s*(.*)$/i.exec(raw);
  if (!m) return { ok: false, error: "Kein Zauber-/Liturgiecode." };
  const kind: SpellKind = m[1].toLowerCase() === "zauber" ? "zauber" : "liturgie";
  let rest = m[2].trim();
  let hero: string | null = null;
  const h = /(?:^|\s)@(.+)$/.exec(rest);
  if (h) {
    hero = h[1].trim() || null;
    rest = rest.slice(0, h.index).trim();
  }
  let modifier = 0;
  const mod = /\s*([+\-−–])\s*(\d+)\s*$/.exec(rest);
  if (mod) {
    modifier = (mod[1] === "+" ? 1 : -1) * Number(mod[2]);
    rest = rest.slice(0, mod.index).trim();
  }
  if (!rest) return { ok: false, error: `Kein ${kind === "zauber" ? "Zauber" : "Liturgie"}name angegeben.` };
  return { ok: true, spec: { kind, name: rest, modifier, hero } };
}
