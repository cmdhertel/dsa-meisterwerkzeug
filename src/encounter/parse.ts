// `dsa-kampf` code block: pure parser + serializer (no obsidian imports).
import { parseIniBase } from "../bestiary/adapter";
import { tryParseDice } from "../engine/dice";

export interface EncounterEntry {
  /** fixed count (>= 1); for dice entries this is 1 and `countDice` holds the expression */
  count: number;
  /** normalized dice count such as "1W6" */
  countDice?: string;
  /** bestiary note name (or the name of an ad-hoc enemy) */
  creature: string;
  lep?: number;
  ini?: number;
  rs?: number;
  at?: number;
  pa?: number;
  vw?: number;
  /** normalized damage dice, e.g. "1W6+3" */
  tp?: string;
  /** display name override */
  name?: string;
}

export interface EncounterSpec {
  name?: string;
  /** campaign name or comma list of hero names */
  helden?: string;
  entries: EncounterEntry[];
  /** lines that could not be understood; kept so that editing does not lose them */
  extra: string[];
}

export interface ParsedEncounter {
  spec: EncounterSpec;
  warnings: string[];
}

export const BLOCK_LANG = "dsa-kampf";

const COUNT_RE = /^(\d+|\d*[WwDd]\d+(?:\s*[+\-–−]\s*\d+)?)(?:\s*[x×X]\s*|\s+)(.+)$/;
const LINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
const INT_FIELDS = ["lep", "ini", "rs", "at", "pa", "vw"] as const;
type IntField = (typeof INT_FIELDS)[number];

export const emptySpec = (): EncounterSpec => ({ entries: [], extra: [] });

/** Parses a dice count such as "1W6" / "2d6+1" or a plain integer. Returns null if invalid. */
export function parseCountText(text: string): { count: number; dice?: string } | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 ? { count: n } : null;
  }
  const d = tryParseDice(t);
  if (d && d.sides > 0 && d.count > 0) return { count: 1, dice: d.text };
  return null;
}

const toInt = (v: string): number | null => (/^[-–]?\d+$/.test(v.trim()) ? parseInt(v.trim().replace("–", "-"), 10) : null);

function parseEntryLine(line: string, warn: (m: string) => void): EncounterEntry | null {
  const body = line.replace(/^[-*]\s*/, "").replace(LINK_RE, "$1");
  const parts = body.split("|").map((p) => p.trim());
  const head = parts.shift() ?? "";
  let count = 1;
  let countDice: string | undefined;
  let creature = head;
  const m = head.match(COUNT_RE);
  if (m) {
    const c = parseCountText(m[1]);
    if (!c) {
      warn(`Anzahl „${m[1]}“ ungültig: ${line.trim()}`);
      return null;
    }
    count = c.count;
    countDice = c.dice;
    creature = m[2].trim();
  }
  if (!creature) {
    warn(`Kein Kreaturname: ${line.trim()}`);
    return null;
  }
  const e: EncounterEntry = { count, creature };
  if (countDice) e.countDice = countDice;
  for (const p of parts) {
    if (!p) continue;
    const km = p.match(/^([A-Za-zÄÖÜäöü]+)\s*[:=]?\s*(.+)$/);
    if (!km) {
      warn(`Überschreibung nicht lesbar „${p}“ in: ${line.trim()}`);
      continue;
    }
    const key = km[1].toLowerCase();
    const val = km[2].trim();
    if (key === "name") e.name = val;
    else if (key === "tp") {
      const d = tryParseDice(val);
      if (d) e.tp = d.text;
      else warn(`TP „${val}“ ungültig (${creature}).`);
    } else if (key === "ini") {
      const n = parseIniBase(val);
      if (n === null) warn(`INI „${val}“ ungültig (${creature}).`);
      else e.ini = n;
    } else if ((INT_FIELDS as readonly string[]).includes(key)) {
      const n = toInt(val);
      if (n === null) warn(`${km[1]} „${val}“ ist keine Zahl (${creature}).`);
      else e[key as IntField] = n;
    } else warn(`Unbekannte Überschreibung „${km[1]}“ (${creature}).`);
  }
  return e;
}

/** Parses the body of a `dsa-kampf` block. Never throws; problems end up in `warnings` (and unknown lines in `spec.extra`). */
export function parseEncounter(text: string): ParsedEncounter {
  const spec = emptySpec();
  const warnings: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*]\s/.test(line) || line === "-") {
      const e = parseEntryLine(line, (m) => warnings.push(m));
      if (e) spec.entries.push(e);
      else spec.extra.push(line);
      continue;
    }
    const kv = line.match(/^([A-Za-zÄÖÜäöü]+)\s*:\s*(.*)$/);
    if (kv && kv[1].toLowerCase() === "name") spec.name = kv[2].trim() || undefined;
    else if (kv && kv[1].toLowerCase() === "helden") spec.helden = kv[2].trim() || undefined;
    else {
      warnings.push(`Zeile nicht verstanden: ${line}`);
      spec.extra.push(line);
    }
  }
  return { spec, warnings };
}

export function serializeEntry(e: EncounterEntry): string {
  const parts = [`${e.countDice ?? e.count}x ${e.creature}`];
  if (e.lep !== undefined) parts.push(`LeP ${e.lep}`);
  if (e.ini !== undefined) parts.push(`INI ${e.ini}`);
  if (e.rs !== undefined) parts.push(`RS ${e.rs}`);
  if (e.at !== undefined) parts.push(`AT ${e.at}`);
  if (e.pa !== undefined) parts.push(`PA ${e.pa}`);
  if (e.vw !== undefined) parts.push(`VW ${e.vw}`);
  if (e.tp !== undefined) parts.push(`TP ${e.tp}`);
  if (e.name) parts.push(`Name ${e.name}`);
  return "- " + parts.join(" | ");
}

/** Block body (without the fences). */
export function serializeEncounter(spec: EncounterSpec): string {
  const lines: string[] = [];
  if (spec.name) lines.push(`name: ${spec.name}`);
  if (spec.helden) lines.push(`helden: ${spec.helden}`);
  for (const e of spec.entries) lines.push(serializeEntry(e));
  lines.push(...spec.extra);
  return lines.join("\n");
}

/** Complete fenced block. */
export const toBlock = (spec: EncounterSpec): string => "```" + BLOCK_LANG + "\n" + serializeEncounter(spec) + "\n```";

/**
 * Replaces the body of the fenced block spanning lines [lineStart, lineEnd] (as given by getSectionInfo) with `newBody`.
 * Keeps the original fence lines. Returns null if those lines are not a `dsa-kampf` fence (document changed meanwhile).
 */
export function replaceBlockBody(fileText: string, lineStart: number, lineEnd: number, newBody: string): string | null {
  const lines = fileText.split("\n");
  if (lineStart < 0 || lineEnd >= lines.length || lineEnd <= lineStart) return null;
  const open = lines[lineStart];
  const close = lines[lineEnd];
  if (!new RegExp("^\\s*(```+|~~~+)\\s*" + BLOCK_LANG + "\\s*$").test(open.replace(/\r$/, ""))) return null;
  if (!/^\s*(```+|~~~+)\s*$/.test(close.replace(/\r$/, ""))) return null;
  lines.splice(lineStart + 1, lineEnd - lineStart - 1, ...(newBody === "" ? [] : newBody.split("\n")));
  return lines.join("\n");
}

/** "Die Nebelfurt, Ilma" -> ["Die Nebelfurt", "Ilma"] */
export const splitHelden = (text: string | undefined): string[] => (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
