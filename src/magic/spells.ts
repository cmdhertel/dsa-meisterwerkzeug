// Pure parser for the spell / liturgy rule notes (20 - Regeln/Zauber, 20 - Regeln/Liturgien). No obsidian imports.
import type { AttrKey } from "../engine/types";
import { ATTR_KEYS } from "../engine/types";

export type SpellKind = "zauber" | "liturgie";
export type Resistance = "SK" | "ZK" | null;

export interface SpellDef {
  name: string;
  kind: SpellKind;
  probe: [AttrKey, AttrKey, AttrKey];
  /** raw cost line, e.g. "4 AsP + 2 AsP je 5 Min" */
  kostenText: string;
  /** first fixed number of the cost line (activation cost); null when not parseable (e.g. "4 / 8 / 16") */
  kostenBasis: number | null;
  /** cost line says "nicht modifizierbar" */
  nichtModifizierbar: boolean;
  zauberdauer: string;
  reichweite: string;
  wirkungsdauer: string;
  wirkung: string;
  zielkategorie: string;
  merkmal: string;
  /** "(mod. SK)" / "(mod. ZK)" in the Probe line */
  modifizierbar: Resistance;
  sourcePath: string;
}

/** lower-case, no diacritics, only letters/digits (same idea as probe/parse normalizeTalentName; kept local) */
export function normalizeSpellName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function parseProbeAttrs(text: string): { attrs: [AttrKey, AttrKey, AttrKey] | null; resistance: Resistance } {
  const m = /^\s*([A-ZÄÖÜ]{2})\s*\/\s*([A-ZÄÖÜ]{2})\s*\/\s*([A-ZÄÖÜ]{2})/.exec(text);
  const resistance: Resistance = /mod\.\s*SK/i.test(text) ? "SK" : /mod\.\s*ZK/i.test(text) ? "ZK" : null;
  if (!m) return { attrs: null, resistance };
  const a = [m[1], m[2], m[3]] as AttrKey[];
  if (!a.every((k) => ATTR_KEYS.includes(k))) return { attrs: null, resistance };
  return { attrs: a as [AttrKey, AttrKey, AttrKey], resistance };
}

/** Basis cost from a cost line. "4 / 8 / 16 AsP" (several tiers) -> null, everything else -> first number. */
export function parseCostBasis(text: string): number | null {
  if (/\d+\s*\/\s*\d+/.test(text)) return null;
  const m = /(\d+)/.exec(text);
  return m ? Number(m[1]) : null;
}

function bullets(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^-\s+\*\*([^*:]+):\*\*\s*(.*)$/.exec(line.trim());
    if (m && !(m[1].trim() in out)) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function wirkungOf(text: string): string {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\*\*Wirkung:\*\*/.test(l.trim()));
  if (i < 0) return "";
  const out = [lines[i].trim().replace(/^\*\*Wirkung:\*\*\s*/, "")];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j].trim();
    if (!l || /^(Regelwiki|#)/.test(l)) break;
    out.push(l);
  }
  return out.join(" ").trim();
}

/** Parse one rule note. Returns null when it is no spell note (no Probe line). */
export function parseSpellNote(text: string, sourcePath: string, fallbackName: string, kindHint?: SpellKind): SpellDef | null {
  const b = bullets(text);
  if (!b["Probe"]) return null;
  const { attrs, resistance } = parseProbeAttrs(b["Probe"]);
  const kostenKey = Object.keys(b).find((k) => /-Kosten$/.test(k));
  const kostenText = kostenKey ? b[kostenKey] : "";
  const kind: SpellKind = kindHint ?? (kostenKey === "KaP-Kosten" || /tags:.*liturgie/i.test(text) ? "liturgie" : "zauber");
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  return {
    name: h1 || fallbackName,
    kind,
    probe: attrs ?? ["MU", "KL", "IN"],
    kostenText,
    kostenBasis: parseCostBasis(kostenText),
    nichtModifizierbar: /nicht modifizierbar/i.test(kostenText),
    zauberdauer: b["Zauberdauer"] ?? b["Liturgiedauer"] ?? "",
    reichweite: b["Reichweite"] ?? "",
    wirkungsdauer: b["Wirkungsdauer"] ?? "",
    wirkung: wirkungOf(text),
    zielkategorie: b["Zielkategorie"] ?? "",
    merkmal: b["Merkmal"] ?? "",
    modifizierbar: resistance,
    sourcePath,
  };
}

/** True when everything a cast needs was found in the note. */
export function isFullySpell(s: SpellDef, rawProbe = true): boolean {
  return rawProbe && s.kostenBasis !== null && !!s.zauberdauer && !!s.wirkung && !!s.wirkungsdauer;
}

export function findSpell(spells: readonly SpellDef[], name: string, kind?: SpellKind): SpellDef | null {
  const n = normalizeSpellName(name);
  if (!n) return null;
  const pool = kind ? spells.filter((s) => s.kind === kind) : spells;
  const exact = pool.find((s) => normalizeSpellName(s.name) === n);
  if (exact) return exact;
  // "Segnungen (Eidsegen)" -> "Segnungen"
  const stripped = normalizeSpellName(name.replace(/\(.*?\)/g, ""));
  if (stripped && stripped !== n) {
    const e2 = pool.find((s) => normalizeSpellName(s.name) === stripped);
    if (e2) return e2;
  }
  if (n.length >= 3) {
    const pre = pool.filter((s) => normalizeSpellName(s.name).startsWith(n));
    if (pre.length === 1) return pre[0];
  }
  return null;
}

/**
 * Replace "QS×n" by the computed number and a lone "QS" followed by a unit by the QS ("QS KR" -> "3 KR").
 * `withHint`: keep the formula in parentheses ("9 Min (QS×3)"). qs <= 0: text unchanged.
 */
export function substituteQs(text: string, qs: number, withHint = true): string {
  if (qs <= 0 || !text) return text;
  let out = text.replace(/QS\s*[×x*]\s*(\d+)/g, (_m, n: string) => (withHint ? `${qs * Number(n)} (QS×${n})` : `${qs * Number(n)}`));
  out = out.replace(/\bQS\b(?=\s*(?:KR|Min|Std|Stunden|Minuten|Kampfrunden|Runden|Tage|Wochen|Schritt|Sek|Sekunden)\b)/g, String(qs));
  return out;
}
