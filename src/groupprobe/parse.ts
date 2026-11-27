// Parser for inline codes: `gruppenprobe: ...`, `sammelprobe: ...`, `gruppensammelprobe: ...`. Pure.
import type { TalentDef } from "../engine/types";
import { findTalent, splitSegments } from "../probe/parse";
import { SAMMEL_DEFAULT_ATTEMPTS, SAMMEL_DEFAULT_TARGET } from "./constants";
import type { GroupKind } from "./logic";

export interface QsText {
  min: number;
  text: string;
}

export interface GroupSpec {
  kind: GroupKind;
  talent: TalentDef;
  modifier: number;
  /** Sammelproben: target QS; Gruppenprobe: optional required total (`Ziel N`) */
  target: number | null;
  maxAttempts: number;
  interval: string;
  /** `ab N QS: Text` sorted by min */
  qsTexts: QsText[];
  /** `sonst: Text` */
  elseTexts: string[];
  /** `mind. N Erfolge: Text` sorted by min */
  successTexts: QsText[];
  /** `geschafft:` / `gescheitert:` / `Teilerfolg:` for Sammelproben */
  doneText: string[];
  failText: string[];
  partialText: string[];
}

export type GroupParse = { ok: true; spec: GroupSpec } | { ok: false; error: string; raw: string };

const PREFIX = /^\s*(gruppensammelprobe|gruppenprobe|sammelprobe)\s*:/i;

export function isGroupProbeCode(text: string): boolean {
  return PREFIX.test(text);
}

export function kindOf(text: string): GroupKind | null {
  const m = PREFIX.exec(text);
  if (!m) return null;
  const k = m[1].toLowerCase();
  return k === "gruppensammelprobe" ? "gruppensammel" : k === "sammelprobe" ? "sammel" : "gruppe";
}

const MOD_RE = /^(.*?)\s*([+\-−–])\s*(\d+)\s*$/;
const AB_RE = /^ab\s*(\d+)\s*QS\s*:\s*([\s\S]*)$/i;
const ELSE_RE = /^(?:sonst|misslungen|Fehlschlag)\s*:\s*([\s\S]*)$/i;
const MIND_RE = /^mind(?:estens|\.)?\s*(\d+)\s*Erfolgen?\s*:\s*([\s\S]*)$/i;
const ZIEL_RE = /^Ziel\s*:?\s*(\d+)\s*(?:QS)?$/i;
const VERS_RE = /^Versuche?\s*:?\s*(\d+)$/i;
const INTV_RE = /^Intervall\s*:?\s*([\s\S]+)$/i;
const DONE_RE = /^(geschafft|gescheitert|Teilerfolg)\s*:\s*([\s\S]*)$/i;

export function parseGroupProbe(raw: string): GroupParse {
  const fail = (error: string): GroupParse => ({ ok: false, error, raw });
  const kind = kindOf(raw);
  if (!kind) return fail('Muss mit "gruppenprobe:", "sammelprobe:" oder "gruppensammelprobe:" beginnen.');
  const [head, ...rest] = splitSegments(raw.replace(PREFIX, ""));
  let talentName = head.trim();
  let modifier = 0;
  const m = MOD_RE.exec(talentName);
  if (m) {
    talentName = m[1];
    modifier = Number(m[3]) * (m[2] === "+" ? 1 : -1);
  }
  const found = findTalent(talentName);
  if (!found.ok) return fail(found.error);

  const sammel = kind !== "gruppe";
  const spec: GroupSpec = {
    kind,
    talent: found.talent,
    modifier,
    target: sammel ? SAMMEL_DEFAULT_TARGET : null,
    maxAttempts: SAMMEL_DEFAULT_ATTEMPTS,
    interval: "",
    qsTexts: [],
    elseTexts: [],
    successTexts: [],
    doneText: [],
    failText: [],
    partialText: [],
  };
  for (const seg of rest) {
    const t = seg.trim();
    if (!t) continue;
    let k: RegExpExecArray | null;
    if ((k = AB_RE.exec(t))) {
      if (k[2].trim()) spec.qsTexts.push({ min: Number(k[1]), text: k[2].trim() });
    } else if ((k = MIND_RE.exec(t))) {
      if (k[2].trim()) spec.successTexts.push({ min: Number(k[1]), text: k[2].trim() });
    } else if ((k = ELSE_RE.exec(t))) {
      if (k[1].trim()) spec.elseTexts.push(k[1].trim());
    } else if ((k = ZIEL_RE.exec(t))) {
      spec.target = Math.max(1, Number(k[1]));
    } else if ((k = VERS_RE.exec(t))) {
      if (!sammel) return fail("„Versuche“ gibt es nur bei Sammelproben.");
      spec.maxAttempts = Math.max(1, Number(k[1]));
    } else if ((k = INTV_RE.exec(t))) {
      if (!sammel) return fail("„Intervall“ gibt es nur bei Sammelproben.");
      spec.interval = k[1].trim();
    } else if ((k = DONE_RE.exec(t))) {
      const txt = k[2].trim();
      if (!txt) continue;
      const w = k[1].toLowerCase();
      (w === "geschafft" ? spec.doneText : w === "gescheitert" ? spec.failText : spec.partialText).push(txt);
    } else {
      return fail(`Unbekannter Abschnitt "${t.slice(0, 30)}": erwartet "ab N QS:", "sonst:", "mind. N Erfolge:", "Ziel N", "Versuche N" oder "Intervall …".`);
    }
  }
  spec.qsTexts.sort((a, b) => a.min - b.min);
  spec.successTexts.sort((a, b) => a.min - b.min);
  return { ok: true, spec };
}

export interface OutcomeText {
  label: string;
  text: string;
}

/** Texts matching a group result: highest reached `ab N QS`, else `sonst`; plus `mind. N Erfolge` if reached. */
export function groupOutcomeTexts(spec: Pick<GroupSpec, "qsTexts" | "elseTexts" | "successTexts">, totalQs: number, successes: number): OutcomeText[] {
  const out: OutcomeText[] = [];
  const reached = spec.qsTexts.filter((q) => totalQs >= q.min);
  if (reached.length) {
    const top = reached[reached.length - 1];
    out.push({ label: `ab ${top.min} QS`, text: top.text });
  } else for (const t of spec.elseTexts) out.push({ label: "sonst", text: t });
  const sr = spec.successTexts.filter((q) => successes >= q.min);
  if (sr.length) {
    const top = sr[sr.length - 1];
    out.push({ label: `mind. ${top.min} Erfolge`, text: top.text });
  }
  return out;
}

/** Required total for the summary: the lowest `ab N QS` threshold (or `Ziel` of a Gruppenprobe). */
export function requiredQsOf(spec: GroupSpec): number | null {
  if (spec.kind === "gruppe") {
    if (spec.target) return spec.target;
    return spec.qsTexts.length ? spec.qsTexts[0].min : null;
  }
  return null;
}

export function requiredSuccessesOf(spec: GroupSpec): number | null {
  return spec.successTexts.length ? spec.successTexts[0].min : null;
}

/** Texts for a finished Sammelprobe. */
export function sammelOutcomeTexts(spec: GroupSpec, status: "läuft" | "geschafft" | "gescheitert", teilerfolg: boolean): OutcomeText[] {
  if (status === "geschafft") return spec.doneText.map((text) => ({ label: "geschafft", text }));
  if (status === "gescheitert") {
    if (teilerfolg && spec.partialText.length) return spec.partialText.map((text) => ({ label: "Teilerfolg", text }));
    return spec.failText.map((text) => ({ label: "gescheitert", text }));
  }
  return [];
}

/** Stable key for remembering state: raw code without surrounding whitespace. */
export function probeKey(sourcePath: string, raw: string): string {
  return `${sourcePath}::${raw.trim().replace(/\s+/g, " ")}`;
}
