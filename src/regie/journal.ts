// Sitzungsregie: renders the journal ("Mitschrift") as markdown and writes it into the session note (pure).
import { KIND_LABEL, formatDuration } from "./run";
import type { JournalEntry, JournalKind, SessionRun } from "./run";

export const BLOCK_START = "%% dsa-mitschrift:start %%";
export const BLOCK_END = "%% dsa-mitschrift:end %%";

export interface RenderOptions {
  /** minutes east of UTC; when given, times are computed deterministically from it */
  timeZoneOffsetMinutes?: number;
  /** Aventurian date shown in the summary line, e.g. "12. Praios 1028 BF" */
  avDate?: string;
  /** scene path -> scene title; used to look up scene durations */
  sceneTitles?: Record<string, string>;
}

const oneLine = (s: string): string => s.trim().replace(/\s*[\r\n]+\s*/g, " / ");

function clock(t: number, off?: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  if (off !== undefined) {
    const d = new Date(t + off * 60000);
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }
  const d = new Date(t);
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function highlights(run: SessionRun): {
  entscheidungen: string[];
  faeden: string[];
  beute: string[];
  zitate: string[];
  geheimnisse: string[];
} {
  const pick = (k: JournalKind) => run.journal.filter((e) => e.kind === k).map((e) => oneLine(e.text));
  return {
    entscheidungen: pick("entscheidung"),
    faeden: pick("faden"),
    beute: pick("beute"),
    zitate: pick("zitat"),
    geheimnisse: pick("geheimnis"),
  };
}

function sceneMs(run: SessionRun, title: string, opts: RenderOptions): number | null {
  for (const [path, s] of Object.entries(run.scenes)) {
    const t = opts.sceneTitles?.[path] ?? path.replace(/^.*\//, "").replace(/\.md$/i, "");
    if (t === title && s.ms > 0) return s.ms;
  }
  return null;
}

export function renderMitschrift(run: SessionRun, opts: RenderOptions = {}): string {
  const out: string[] = ["## Mitschrift", "*Automatisch aus der Sitzungsregie. Dieser Abschnitt wird beim nächsten Schreiben ersetzt; eigene Notizen bitte außerhalb.*", ""];

  const count = (...k: JournalKind[]) => run.journal.filter((e) => k.includes(e.kind)).length;
  const parts: string[] = [];
  if (run.startedAt !== null) {
    const end = run.endedAt ?? (run.journal.length ? run.journal[run.journal.length - 1].t : run.startedAt);
    parts.push(`**Dauer:** ${formatDuration(Math.max(0, end - run.startedAt))}`);
  }
  const scenes = Object.values(run.scenes).filter((s) => s.status !== "offen").length;
  if (scenes) parts.push(`**Szenen:** ${scenes}`);
  const proben = count("probe", "zauber", "gruppe");
  if (proben) parts.push(`**Proben:** ${proben}`);
  // "Kampf beendet ..." entries close a fight that was already counted when it began
  const kaempfe = run.journal.filter((e) => e.kind === "kampf" && !/^Kampf beendet/.test(e.text)).length;
  if (kaempfe) parts.push(`**Kämpfe:** ${kaempfe}`);
  const geh = count("geheimnis");
  if (geh) parts.push(`**Enthüllt:** ${geh}`);
  if (opts.avDate) parts.push(`**Aventurisch:** ${opts.avDate}`);
  if (parts.length) out.push(parts.join(" · "), "");

  const h = highlights(run);
  const hl: string[] = [];
  const add = (label: string, items: string[]) => {
    if (items.length) hl.push(`- **${label}:** ${items.join("; ")}`);
  };
  add("Entscheidungen", h.entscheidungen);
  add("Neue Fäden", h.faeden);
  add("Beute", h.beute);
  add("Zitate", h.zitate.map((z) => `„${z}“`));
  add("Enthüllte Geheimnisse", h.geheimnisse);
  if (hl.length) out.push("### Höhepunkte", ...hl, "");

  out.push("### Verlauf");
  let cur: string | null = null; // group key: scene title or "" for Auftakt
  const seen = new Set<string>();
  let started = false;
  for (const e of run.journal) {
    const key = e.scene ?? "";
    if (!started || key !== cur) {
      started = true;
      cur = key;
      let head = key === "" ? "Auftakt" : key;
      if (key !== "" && !seen.has(key)) {
        const ms = sceneMs(run, key, opts);
        if (ms !== null) head += ` (${formatDuration(ms)})`;
      }
      seen.add(key);
      // a heading is only emitted for non-"szene" content or for the scene start itself
      out.push("", `#### ${oneLine(head)}`);
    }
    if (e.kind === "szene") continue;
    out.push(`- ${clock(e.t, opts.timeZoneOffsetMinutes)} · ${KIND_LABEL[e.kind]} · ${oneLine(e.text)}`);
  }
  if (!run.journal.length) out.push("", "*Noch keine Einträge.*");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------

function findRegion(text: string): { start: number; end: number } | null {
  const e = text.indexOf(BLOCK_END);
  if (e < 0) return null;
  const s = text.lastIndexOf(BLOCK_START, e);
  if (s < 0) return null;
  return { start: s, end: e + BLOCK_END.length };
}

export function hasMitschrift(noteText: string): boolean {
  return findRegion(noteText) !== null;
}

export function upsertMitschrift(noteText: string, block: string): string {
  const crlf = noteText.includes("\r\n");
  const nl = crlf ? "\r\n" : "\n";
  const body = block.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n").join(nl);
  const region = `${BLOCK_START}${nl}${body}${nl}${BLOCK_END}`;

  const r = findRegion(noteText);
  if (r) return noteText.slice(0, r.start) + region + noteText.slice(r.end);

  const corrupt = noteText.includes(BLOCK_START) || noteText.includes(BLOCK_END);
  if (!corrupt) {
    const m = /^#{1,3}[ \t]+Nach der Session[ \t]*#*[ \t]*\r?$/im.exec(noteText);
    if (m) {
      const before = noteText.slice(0, m.index).replace(/(\r?\n)+$/, "");
      return (before ? before + nl + nl : "") + region + nl + nl + noteText.slice(m.index);
    }
  }
  if (!noteText) return region + nl;
  const sep = noteText.endsWith(nl + nl) ? "" : noteText.endsWith(nl) ? nl : nl + nl;
  return noteText + sep + region + nl;
}
