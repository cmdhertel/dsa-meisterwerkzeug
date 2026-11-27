import { tryParseDice } from "../engine/dice";
import type { Combatant, Weapon } from "../model";
import { deriveBody } from "./body";

export type ParseStatus = "ok" | "partial" | "manual" | "nostats";

export interface BestiaryParseResult {
  status: ParseStatus;
  combatant: Combatant;
  /** human-readable reasons for partial/manual/nostats */
  problems: string[];
}

/** Leading integer of a value such as 40, "40", "50*", "5 (im Limbus 17)". Returns null if none. */
export function leadingInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^[-–]?\d+/);
  return m ? parseInt(m[0].replace("–", "-"), 10) : null;
}

const isVariabel = (v: unknown) => typeof v === "string" && /^variabel/i.test(v.trim());

/** "13+1W6" / "1W6+13" / "17+1w6" / 13 -> 13 (the constant part). */
export function parseIniBase(v: unknown): number | null {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v !== "string") return null;
  const d = tryParseDice(v);
  if (d) return d.bonus;
  return leadingInt(v);
}

const DICE_HEAD = /^\s*(\d*[WwDd]\d+(?:\s*[+\-–−]\s*\d+)?)/;

function parseTp(text: string): { tp: string | null; note: string } {
  const m = text.match(DICE_HEAD);
  if (!m) return { tp: null, note: text.trim() };
  const d = tryParseDice(m[1]);
  return { tp: d ? d.text : null, note: text.slice(m[0].length).trim() };
}

/** Splits "**AT** 12 **PA** 5 **TP** 1W6+5 **RW** mittel" into {AT:"12", PA:"5", ...}. */
export function splitFields(desc: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\*\*([A-Za-zÄÖÜäöü]+)\*\*/g;
  const marks: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(desc))) marks.push({ key: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const text = desc.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : desc.length).trim();
    if (!(marks[i].key in out)) out[marks[i].key] = text;
  }
  return out;
}

export function parseWeapon(name: string, descRaw: unknown): Weapon {
  const raw = typeof descRaw === "string" ? descRaw : String(descRaw ?? "");
  const f = splitFields(raw);
  const hasFk = "FK" in f;
  const kind: Weapon["kind"] = hasFk ? "ranged" : "melee";
  const at = hasFk ? null : leadingInt(f.AT);
  const fk = hasFk ? leadingInt(f.FK) : null;
  const pa = leadingInt(f.PA);
  const tpp = f.TP !== undefined ? parseTp(f.TP) : { tp: null, note: "" };
  const rw = (f.RW ?? "").trim();
  let rwRanges: Weapon["rwRanges"] = null;
  const rm = rw.match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  if (rm) rwRanges = [parseInt(rm[1], 10), parseInt(rm[2], 10), parseInt(rm[3], 10)];
  const lz = leadingInt(f.LZ);
  const partial = (kind === "ranged" ? fk : at) === null || tpp.tp === null;
  return { name, kind, at, pa, fk, tp: tpp.tp, tpNote: tpp.note, rw, rwRanges, lz, raw, partial };
}

/**
 * Frontmatter object -> Combatant. Never throws.
 * status: "nostats" (no statblock), "manual" (lep/ini = "variabel"), "partial" (something unreadable/missing), "ok".
 */
export function parseCreature(frontmatter: Record<string, unknown> | null | undefined, sourcePath: string, fallbackName: string): BestiaryParseResult {
  const fm = frontmatter ?? {};
  const problems: string[] = [];
  const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : fallbackName;
  const combatant: Combatant = { name, kind: "creature", sourcePath, lepMax: null, iniBase: null, rs: null, vw: null, weapons: [], needsManual: [] };

  // Trefferzonen data (only used when the setting is on; derived from existing fields, no note needs editing)
  const body = deriveBody(fm);
  combatant.bodyType = body.bodyType;
  combatant.size = body.size;
  combatant.ko = body.ko;
  if (body.zoneRs) combatant.zoneRs = body.zoneRs;

  const hasStats = ["lep", "ini", "attacks", "rs", "vw"].some((k) => fm[k] !== undefined);
  if (!hasStats) return { status: "nostats", combatant, problems: ["kein Wertekasten im Frontmatter"] };

  // LeP
  if (isVariabel(fm.lep)) combatant.needsManual.push("lep");
  else {
    const v = leadingInt(fm.lep) ?? leadingInt(fm.hp);
    if (v === null) problems.push("lep fehlt/unlesbar");
    combatant.lepMax = v;
  }
  // INI
  if (isVariabel(fm.ini)) combatant.needsManual.push("ini");
  else {
    const v = parseIniBase(fm.ini);
    if (v === null) problems.push("ini fehlt/unlesbar");
    combatant.iniBase = v;
  }
  // RS / VW
  combatant.rs = leadingInt(fm.rs) ?? leadingInt(fm.ac);
  if (combatant.rs === null) problems.push("rs fehlt/unlesbar");
  combatant.vw = leadingInt(fm.vw);
  if (combatant.vw === null) problems.push("vw fehlt/unlesbar");

  // attacks
  if (Array.isArray(fm.attacks)) {
    for (const a of fm.attacks) {
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        const w = parseWeapon(typeof o.name === "string" ? o.name : "Angriff", o.desc);
        combatant.weapons.push(w);
        if (w.partial) problems.push(`Waffe "${w.name}": ${w.kind === "ranged" ? "FK" : "AT"} oder TP nicht lesbar ("${w.raw.slice(0, 40)}")`);
      }
    }
  } else problems.push("keine attacks");
  if (Array.isArray(fm.attacks) && fm.attacks.length === 0) problems.push("attacks leer");

  const status: ParseStatus = combatant.needsManual.length ? "manual" : problems.length ? "partial" : "ok";
  return { status, combatant, problems };
}
