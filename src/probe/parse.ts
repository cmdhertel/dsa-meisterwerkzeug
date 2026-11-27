// Pure parser for inline probe code: `probe: Sinnesschärfe +2 | QS2: Text | QS3: Text | Erfolg: ... | Misslungen: ...`
import { TALENTS } from "../data/talents.generated";
import type { TalentDef } from "../engine/types";

export interface ProbeOutcome {
  /** 1-6: unlocked at this QS or higher ("Erfolg" = 1) */
  level: number;
  label: string;
  text: string;
}

export interface ProbeSpec {
  talent: TalentDef;
  /** positive = easier, negative = harder */
  modifier: number;
  /** success texts, sorted by level (stable) */
  outcomes: ProbeOutcome[];
  /** texts shown on failure */
  failure: string[];
}

export type ParseResult = { ok: true; spec: ProbeSpec } | { ok: false; error: string; raw: string };

export const PROBE_PREFIX = /^\s*probe\s*:/i;

export function isProbeCode(text: string): boolean {
  return PROBE_PREFIX.test(text);
}

/** lower-case, strip diacritics, "&" = "und", drop everything that is not a letter/digit */
export function normalizeTalentName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "und")
    .replace(/[^a-z0-9]/g, "");
}

export type TalentMatch = { ok: true; talent: TalentDef } | { ok: false; error: string };

/** Exact (normalized) match first, then an unambiguous prefix of at least 3 characters. */
export function findTalent(name: string, talents: readonly TalentDef[] = TALENTS): TalentMatch {
  const n = normalizeTalentName(name);
  if (!n) return { ok: false, error: "Kein Talent angegeben." };
  const exact = talents.find((t) => normalizeTalentName(t.name) === n);
  if (exact) return { ok: true, talent: exact };
  if (n.length >= 3) {
    const pre = talents.filter((t) => normalizeTalentName(t.name).startsWith(n));
    if (pre.length === 1) return { ok: true, talent: pre[0] };
    if (pre.length > 1) return { ok: false, error: `Talent "${name.trim()}" ist nicht eindeutig: ${pre.map((t) => t.name).join(", ")}.` };
  }
  return { ok: false, error: `Unbekanntes Talent "${name.trim()}".` };
}

/** Split on "|" but not inside [[wiki|links]]. */
export function splitSegments(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) {
      depth++;
      cur += "[[";
      i++;
    } else if (s.startsWith("]]", i) && depth > 0) {
      depth--;
      cur += "]]";
      i++;
    } else if (s[i] === "|" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += s[i];
  }
  out.push(cur);
  return out;
}

const MOD_RE = /^(.*?)\s*([+\-−–])\s*(\d+)\s*$/;
const KEY_RE = /^(?:QS\s*([1-6])|(Erfolg)|(Misslungen|Fehlschlag))\s*:\s*([\s\S]*)$/i;

export function parseProbe(raw: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error, raw });
  if (!isProbeCode(raw)) return fail('Probe muss mit "probe:" beginnen.');
  const body = raw.replace(PROBE_PREFIX, "");
  const [head, ...rest] = splitSegments(body);

  let talentName = head.trim();
  let modifier = 0;
  const m = MOD_RE.exec(talentName);
  if (m) {
    talentName = m[1];
    modifier = Number(m[3]) * (m[2] === "+" ? 1 : -1);
  }
  const found = findTalent(talentName);
  if (!found.ok) return fail(found.error);

  const outcomes: ProbeOutcome[] = [];
  const failure: string[] = [];
  for (const seg of rest) {
    const t = seg.trim();
    if (!t) continue;
    const k = KEY_RE.exec(t);
    if (!k) return fail(`Unbekannter Abschnitt "${t.slice(0, 30)}": erwartet QS1 bis QS6, Erfolg oder Misslungen.`);
    const text = k[4].trim();
    if (!text) continue;
    if (k[3]) failure.push(text);
    else if (k[2]) outcomes.push({ level: 1, label: "Erfolg", text });
    else outcomes.push({ level: Number(k[1]), label: `QS${k[1]}`, text });
  }
  outcomes.sort((a, b) => a.level - b.level);
  return { ok: true, spec: { talent: found.talent, modifier, outcomes, failure } };
}

export function formatModifier(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `-${Math.abs(n)}` : "";
}

export interface Unlocked {
  shown: { label: string; text: string }[];
  /** higher QS levels than reached (GM-only preview); empty on failure */
  hidden: { label: string; text: string }[];
}

/** Which outcome texts are unlocked at a result. qs = 0 / success=false -> only the failure texts. */
export function unlockedOutcomes(outcomes: readonly ProbeOutcome[], failure: readonly string[], success: boolean, qs: number): Unlocked {
  if (!success) return { shown: failure.map((text) => ({ label: "Misslungen", text })), hidden: [] };
  const shown = outcomes.filter((o) => o.level <= qs).map(({ label, text }) => ({ label, text }));
  const hidden = outcomes.filter((o) => o.level > qs).map(({ label, text }) => ({ label, text }));
  return { shown, hidden };
}

/**
 * Single-backtick inline code spans of one line: `` `x` `` yes, ``` ``x`` ``` no (double backticks are no inline code).
 * Written without lookbehind (iOS < 16.4 cannot parse it). `from`/`to` are offsets in `line`, `to` exclusive, backticks included.
 */
export function inlineCodeSpans(line: string): { code: string; from: number; to: number }[] {
  const out: { code: string; from: number; to: number }[] = [];
  const re = /(^|[^`])`([^`\n]+)`(?!`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const from = m.index + m[1].length;
    out.push({ code: m[2], from, to: from + m[2].length + 2 });
  }
  return out;
}
