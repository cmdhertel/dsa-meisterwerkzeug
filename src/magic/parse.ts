// Inline code: `zauber: Ignifaxius +2 @Thorwin` / `liturgie: Blendstrahl -1`
import type { SpellKind } from "./spells";

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
  const mod = /\s*([+\-−])\s*(\d+)\s*$/.exec(rest);
  if (mod) {
    modifier = (mod[1] === "+" ? 1 : -1) * Number(mod[2]);
    rest = rest.slice(0, mod.index).trim();
  }
  if (!rest) return { ok: false, error: `Kein ${kind === "zauber" ? "Zauber" : "Liturgie"}name angegeben.` };
  return { ok: true, spec: { kind, name: rest, modifier, hero } };
}
