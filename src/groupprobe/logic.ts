// Pure logic: group rolls, Sammelprobe state machine, result lines. No obsidian imports.
import type { Roller } from "../engine/dice";
import { TalentCheckResult, rollTalentCheck } from "../engine/talent";
import {
  SAMMEL_CRIT_MULTIPLIER,
  SAMMEL_DEFAULT_ATTEMPTS,
  SAMMEL_DEFAULT_TARGET,
  SAMMEL_PATZER_ENDS,
  SAMMEL_PATZER_RESET_QS,
  SAMMEL_TEILERFOLG_MIN_QS,
} from "./constants";

export type GroupKind = "gruppe" | "sammel" | "gruppensammel";

export const KIND_LABEL: Record<GroupKind, string> = {
  gruppe: "Gruppenprobe",
  sammel: "Sammelprobe",
  gruppensammel: "Gruppensammelprobe",
};

export interface Participant {
  id: string;
  name: string;
  attrs: [number, number, number];
  fw: number;
  /** individual modifier on top of the common one (+ = easier) */
  modifier: number;
  /** positive = harder (combat states) */
  statePenalty: number;
  manual?: boolean;
}

export interface ParticipantRoll {
  id: string;
  name: string;
  /** common + individual modifier */
  modifier: number;
  result: TalentCheckResult;
}

/** Each participant rolls once with own values; dice are drawn in participant order. */
export function rollParticipants(parts: readonly Participant[], commonModifier: number, roller?: Roller): ParticipantRoll[] {
  return parts.map((p) => {
    const modifier = commonModifier + p.modifier;
    const result = rollTalentCheck(
      { attrs: p.attrs, fw: Math.max(0, p.fw), modifiers: modifier ? [{ label: "Probe", value: modifier }] : [], statePenalty: p.statePenalty },
      roller,
    );
    return { id: p.id, name: p.name, modifier, result };
  });
}

export interface GroupRequirement {
  /** required total QS */
  qs?: number | null;
  /** required number of successes */
  successes?: number | null;
}

export interface GroupSummary {
  count: number;
  successes: number;
  totalQs: number;
  best: ParticipantRoll | null;
  worst: ParticipantRoll | null;
  patzer: number;
  criticalSuccesses: number;
  /** null = no requirement given */
  metQs: boolean | null;
  metSuccesses: boolean | null;
  /** all given requirements met; null if none given */
  met: boolean | null;
}

/** better = higher QS, ties by remaining points */
const score = (r: ParticipantRoll) => r.result.qs * 1000 + Math.max(-500, Math.min(499, r.result.remaining));

export function summarizeGroup(rolls: readonly ParticipantRoll[], req: GroupRequirement = {}): GroupSummary {
  const successes = rolls.filter((r) => r.result.success).length;
  const totalQs = rolls.reduce((s, r) => s + (r.result.success ? r.result.qs : 0), 0);
  let best: ParticipantRoll | null = null;
  let worst: ParticipantRoll | null = null;
  for (const r of rolls) {
    if (!best || score(r) > score(best)) best = r;
    if (!worst || score(r) < score(worst)) worst = r;
  }
  const metQs = req.qs != null && req.qs > 0 ? totalQs >= req.qs : null;
  const metSuccesses = req.successes != null && req.successes > 0 ? successes >= req.successes : null;
  const given = [metQs, metSuccesses].filter((x): x is boolean => x !== null);
  return {
    count: rolls.length,
    successes,
    totalQs,
    best,
    worst,
    patzer: rolls.filter((r) => r.result.critical === "patzer").length,
    criticalSuccesses: rolls.filter((r) => r.result.critical === "success").length,
    metQs,
    metSuccesses,
    met: given.length ? given.every(Boolean) : null,
  };
}

// ---------------------------------------------------------------- Sammelprobe

export type SammelStatus = "läuft" | "geschafft" | "gescheitert";

export interface SammelRound {
  attempt: number;
  /** QS added (after crit multiplier), 0 on Patzer */
  gain: number;
  patzer: boolean;
  critical: boolean;
  qsAfter: number;
  /** one line per participant, for the history */
  lines: string[];
}

export interface SammelState {
  target: number;
  maxAttempts: number;
  interval: string;
  qs: number;
  attempts: number;
  status: SammelStatus;
  /** attempts ran out but >= SAMMEL_TEILERFOLG_MIN_QS reached */
  teilerfolg: boolean;
  /** the run ended because of a Patzer */
  patzer: boolean;
  rounds: SammelRound[];
}

export function newSammel(opts: { target?: number; maxAttempts?: number; interval?: string } = {}): SammelState {
  return {
    target: Math.max(1, Math.trunc(opts.target ?? SAMMEL_DEFAULT_TARGET)),
    maxAttempts: Math.max(1, Math.trunc(opts.maxAttempts ?? SAMMEL_DEFAULT_ATTEMPTS)),
    interval: opts.interval ?? "",
    qs: 0,
    attempts: 0,
    status: "läuft",
    teilerfolg: false,
    patzer: false,
    rounds: [],
  };
}

/** Name + outcome of one roll as short text: "Alrik QS 2", "Ilma misslungen", "Thorwin Patzer". */
export function rollWord(r: ParticipantRoll): string {
  const c = r.result.critical;
  if (c === "patzer") return `${r.name} Patzer`;
  if (!r.result.success) return `${r.name} misslungen`;
  return `${r.name} QS ${r.result.qs}${c === "success" ? " (kritisch)" : ""}`;
}

/** Applies one interval (all participants' rolls) to the state. Returns a new state; finished states are returned unchanged. */
export function applySammelRound(state: SammelState, rolls: readonly ParticipantRoll[]): SammelState {
  if (state.status !== "läuft") return state;
  const patzer = rolls.some((r) => r.result.critical === "patzer");
  let gain = 0;
  let critical = false;
  for (const r of rolls) {
    if (!r.result.success) continue;
    if (r.result.critical === "success") {
      critical = true;
      gain += r.result.qs * SAMMEL_CRIT_MULTIPLIER;
    } else gain += r.result.qs;
  }
  const attempts = state.attempts + 1;
  let qs = state.qs + gain;
  let status: SammelStatus = "läuft";
  let teilerfolg = false;
  if (patzer) {
    qs = SAMMEL_PATZER_RESET_QS;
    gain = 0;
    if (SAMMEL_PATZER_ENDS) status = "gescheitert";
  }
  if (status === "läuft") {
    if (qs >= state.target) status = "geschafft";
    else if (attempts >= state.maxAttempts) {
      status = "gescheitert";
      teilerfolg = qs >= SAMMEL_TEILERFOLG_MIN_QS;
    }
  }
  const round: SammelRound = { attempt: attempts, gain, patzer, critical, qsAfter: qs, lines: rolls.map(rollWord) };
  return { ...state, qs, attempts, status, teilerfolg, patzer: patzer && SAMMEL_PATZER_ENDS, rounds: [...state.rounds, round] };
}

/** Same settings, progress cleared. */
export function restartSammel(state: SammelState): SammelState {
  return newSammel({ target: state.target, maxAttempts: state.maxAttempts, interval: state.interval });
}

export function sammelStatusText(s: SammelState): string {
  if (s.status === "geschafft") return "geschafft";
  if (s.status === "gescheitert") return s.patzer ? "gescheitert (Patzer)" : s.teilerfolg ? "Teilerfolg" : "gescheitert";
  return "läuft";
}

// ---------------------------------------------------------------- result lines

export function signed(n: number): string {
  return n === 0 ? "" : n > 0 ? ` +${n}` : ` -${-n}`;
}

/** `> Gruppenprobe Sinnesschärfe +2: Alrik QS 2, Thorwin QS 3, Ilma misslungen → 5 QS` */
export function groupLine(talent: string, modifier: number, rolls: readonly ParticipantRoll[], s: GroupSummary, kind: GroupKind = "gruppe"): string {
  const req = s.met === null ? "" : s.met ? " (geschafft)" : " (nicht geschafft)";
  return `> ${KIND_LABEL[kind]} ${talent}${signed(modifier)}: ${rolls.map(rollWord).join(", ")} → ${s.totalQs} QS${req}`;
}

/** `> Sammelprobe Fährtensuchen -1, Versuch 3/7 (1 Stunde): Alrik QS 2 → 6/10 QS (läuft)` */
export function sammelLine(talent: string, modifier: number, kind: GroupKind, st: SammelState): string {
  const last = st.rounds[st.rounds.length - 1];
  const iv = st.interval ? ` (${st.interval})` : "";
  const who = last ? `: ${last.lines.join(", ")}` : "";
  return `> ${KIND_LABEL[kind]} ${talent}${signed(modifier)}, Versuch ${st.attempts}/${st.maxAttempts}${iv}${who} → ${st.qs}/${st.target} QS (${sammelStatusText(st)})`;
}

/**
 * Insert `line` directly below the first line containing `` `raw` ``. If the following line already starts
 * with the same prefix (text up to the first colon), it is replaced. Returns null if the code is not found.
 */
export function insertBelow(text: string, raw: string, line: string): string | null {
  const lines = text.split("\n");
  const needle = "`" + raw + "`";
  let idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) idx = lines.findIndex((l) => l.includes("`" + raw.trim() + "`"));
  if (idx < 0) return null;
  const key = (l: string) => l.split(":")[0].replace(/, Versuch.*$/, "");
  const next = lines[idx + 1];
  if (next !== undefined && next.startsWith("> ") && key(next) === key(line)) lines[idx + 1] = line;
  else lines.splice(idx + 1, 0, line);
  return lines.join("\n");
}

/** Table log text from a result line: drops the blockquote marker and markdown emphasis. */
export function groupEventText(line: string): string {
  return line.replace(/^\s*>\s?/, "").replace(/\*\*|__|\*|(?<![\w])_|_(?![\w])/g, "").trim();
}
