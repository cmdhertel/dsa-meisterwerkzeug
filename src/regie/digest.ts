// Sitzungsregie: pure markdown digest of a session/scene/NPC note (no obsidian imports).
import type { ActionKind, Fact, Kurzprofil, NoteDigest, TaskItem } from "./types";

export type { TaskItem, BlockRef, InlineAction, ReadAloud, Fact, Section, NoteDigest, Kurzprofil } from "./types";

interface Ln {
  /** 0-based line in the full text */
  no: number;
  /** raw line without line terminator */
  raw: string;
  /** line with callout/blockquote prefix removed */
  eff: string;
  /** true when the raw line starts with ">" */
  quoted: boolean;
  /** inside a fenced block (fence lines themselves included) */
  fence: boolean;
}

interface Fence {
  open: Ln;
  lang: string;
  body: string[];
}

const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const QUOTE_RE = /^\s*(?:>\s?)+/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\](?:\s+(.*))?$/;

/** Splits into lines (LF or CRLF), skips frontmatter, tracks fences. Line numbers stay original. */
function scan(text: string): { lines: Ln[]; fences: Fence[] } {
  const raws = text.split(/\r?\n/);
  let start = 0;
  if (raws[0] !== undefined && /^---\s*$/.test(raws[0])) {
    for (let i = 1; i < raws.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(raws[i])) {
        start = i + 1;
        break;
      }
    }
  }
  const lines: Ln[] = [];
  const fences: Fence[] = [];
  let cur: Fence | null = null;
  let marker = "";
  for (let i = start; i < raws.length; i++) {
    const raw = raws[i];
    const quoted = /^\s*>/.test(raw);
    const eff = quoted ? raw.replace(QUOTE_RE, "") : raw;
    const m = FENCE_RE.exec(eff);
    const ln: Ln = { no: i, raw, eff, quoted, fence: !!cur };
    if (cur) {
      if (m && m[1][0] === marker[0] && m[1].length >= marker.length && eff.trim() === m[1]) {
        ln.fence = true;
        fences.push(cur);
        cur = null;
      } else {
        cur.body.push(eff);
      }
    } else if (m) {
      ln.fence = true;
      marker = m[1];
      cur = { open: ln, lang: m[2].toLowerCase(), body: [] };
    }
    lines.push(ln);
  }
  if (cur) fences.push(cur);
  return { lines, fences };
}

const headingOf = (l: Ln): { level: number; text: string } | null => {
  if (l.fence || l.quoted) return null;
  const m = HEADING_RE.exec(l.raw);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
};

const stripCode = (s: string): string => s.replace(/`[^`]*`/g, "");

function fightTitle(kind: "dsa-kampf" | "encounter", body: string[]): string {
  for (const l of body) {
    const m = /^\s*name\s*:\s*(.+?)\s*$/i.exec(l);
    if (m) return m[1];
  }
  const parts: string[] = [];
  for (const l of body) {
    let t = l.trim().replace(/^[-*+]\s+/, "");
    if (!t) continue;
    const num = /^(\d+)\s*:\s*(.+)$/.exec(t);
    if (num) t = `${num[1]}x ${num[2]}`;
    else if (/^[\wäöüÄÖÜß]+\s*:/.test(t)) continue;
    t = t.split("|")[0].trim();
    if (!t) continue;
    parts.push(t);
    if (parts.length >= 3) break;
  }
  void kind;
  return parts.length ? parts.join(", ") : "Kampf";
}

const ACTION_RE = /^\s*(gruppensammelprobe|gruppenprobe|sammelprobe|probe|zauber|liturgie)\s*:/i;

/** Splits "**A:** x · **B:** y" into facts. Returns [] when the line does not start with a bold label. */
function parseFactLine(s: string): Fact[] {
  const t = s.trim().replace(/^[-*+]\s+/, "");
  if (!t.startsWith("**")) return [];
  const re = /\*\*([^*]+?):\*\*|\*\*([^*]+?)\*\*:/g;
  const ms: { label: string; s: number; e: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) ms.push({ label: (m[1] ?? m[2]).trim(), s: m.index, e: m.index + m[0].length });
  if (!ms.length || ms[0].s !== 0) return [];
  const out: Fact[] = [];
  ms.forEach((x, i) => {
    const end = i + 1 < ms.length ? ms[i + 1].s : t.length;
    const value = t.slice(x.e, end).trim().replace(/\s*[·|]\s*$/, "").trim();
    if (value && value !== "—" && value !== "-") out.push({ label: x.label, value });
  });
  return out;
}

/** Contiguous quoted blocks starting at index i (lines whose raw starts with ">"). */
function quoteRun(lines: Ln[], i: number): number {
  let j = i;
  while (j < lines.length && lines[j].quoted) j++;
  return j;
}

/** Parses a wiki-link inner text to { base, path } or null if it is a placeholder / non-note. */
function linkTarget(inner: string): { base: string; path: string } | null {
  let t = inner.split("|")[0];
  t = t.split("#")[0].split("^")[0].trim();
  if (!t) return null;
  if (/\.base$/i.test(t)) return null;
  const base = t.replace(/^.*\//, "").replace(/\.md$/i, "").trim();
  if (!base || base === "NSC-Name") return null;
  return { base, path: t };
}

export function digestNote(text: string): NoteDigest {
  const { lines, fences } = scan(text);
  const d: NoteDigest = { title: "", facts: [], readAloud: [], tasks: [], blocks: [], actions: [], links: [], linkPaths: [], sections: [] };
  const seenLink = new Set<string>();
  let heading = "";
  let firstH2 = false;
  let titleFound = false;

  for (const f of fences) {
    if (f.lang === "dsa-kampf" || f.lang === "encounter") {
      const source = f.body.join("\n");
      d.blocks.push({ kind: f.lang, line: f.open.no, source, title: fightTitle(f.lang, f.body) });
    }
  }

  // read-aloud context: heading text of "## Vorlesetext" / "## Starker Einstieg" while inside it
  let readHeading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.fence) continue;
    const h = headingOf(l);
    if (h) {
      d.sections.push({ heading: h.text, level: h.level, line: l.no });
      heading = h.text;
      if (h.level === 1 && !titleFound) {
        d.title = h.text;
        titleFound = true;
      }
      if (h.level === 2) firstH2 = true;
      readHeading = /^(vorlesetext|starker einstieg)\b/i.test(h.text) ? h.text : null;
      continue;
    }

    // leading facts
    if (!firstH2 && !l.quoted) d.facts.push(...parseFactLine(l.raw));

    // callouts / blockquotes
    if (l.quoted && (i === 0 || !lines[i - 1].quoted || lines[i - 1].fence)) {
      const end = quoteRun(lines, i);
      const run = lines.slice(i, end);
      const cm = /^\[!([\w-]+)\][+-]?\s*(.*)$/.exec(run[0].eff.trim());
      const inner = (from: number) => run.slice(from).filter((x) => !x.fence);
      if (cm) {
        const type = cm[1].toLowerCase();
        if (type === "vorlesen") {
          const body = run.slice(1).map((x) => x.eff.replace(/\s+$/, "")).join("\n").trim();
          if (body) d.readAloud.push({ title: cm[2].trim() || "Vorlesen", text: body, line: l.no });
        } else if (type === "abstract" && /auf einen blick/i.test(cm[2])) {
          for (const x of inner(1)) d.facts.push(...parseFactLine(x.eff));
        } else if (type === "abstract" && !firstH2) {
          for (const x of inner(1)) d.facts.push(...parseFactLine(x.eff));
        }
      } else if (readHeading) {
        const body = run.map((x) => x.eff.replace(/\s+$/, "")).join("\n").trim();
        if (body) d.readAloud.push({ title: readHeading, text: body, line: l.no });
      }
    }

    // tasks (also inside callouts)
    const tm = TASK_RE.exec(l.eff);
    if (tm) {
      const t = (tm[2] ?? "").trim();
      if (t) d.tasks.push({ line: l.no, text: t, checked: tm[1] !== " ", heading });
    }

    // inline code spans and links (code spans do not contribute links)
    const codeRe = /`([^`]+)`/g;
    let cm2: RegExpExecArray | null;
    while ((cm2 = codeRe.exec(l.eff))) {
      const am = ACTION_RE.exec(cm2[1]);
      if (am) d.actions.push({ kind: am[1].toLowerCase() as ActionKind, raw: cm2[1], line: l.no });
    }
    const linkRe = /\[\[([^\]]*)\]\]/g;
    const bare = stripCode(l.eff);
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(bare))) {
      const tgt = linkTarget(lm[1]);
      if (!tgt) continue;
      const key = tgt.path;
      if (seenLink.has(key)) continue;
      seenLink.add(key);
      d.links.push(tgt.base);
      d.linkPaths.push(tgt.path);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Sections

const normHeading = (s: string) => s.trim().toLowerCase();

/** Markdown under the first matching heading, up to the next heading of the same or higher level. */
export function sectionBody(text: string, heading: string | RegExp): string | null {
  const { lines } = scan(text);
  for (let i = 0; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (!h) continue;
    const ok = typeof heading === "string" ? normHeading(h.text) === normHeading(heading) : new RegExp(heading.source, heading.flags.replace("g", "")).test(h.text);
    if (!ok) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h2 = headingOf(lines[j]);
      if (h2 && h2.level <= h.level) break;
      body.push(lines[j].raw);
    }
    return body.join("\n").trim();
  }
  return null;
}

export function gmSecret(text: string): string | null {
  const b = sectionBody(text, /^Geheimnis(se)?\b.*/i);
  return b ? b : null;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function parseKurzprofil(text: string): Kurzprofil | null {
  const body = sectionBody(text, /^Kurzprofil$/i);
  if (!body) return null;
  const kp: Kurzprofil = { auftreten: "", stimme: "", will: "", weiss: "", zitat: "", extra: [] };
  const items: { label: string; value: string }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const m = /^\s*[-*+]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(raw);
    if (m) items.push({ label: m[1].trim(), value: m[2].trim() });
    else if (items.length && raw.trim() && !/^\s*[-*+]\s/.test(raw)) {
      const it = items[items.length - 1];
      it.value = (it.value + " " + raw.trim().replace(/^>\s?/, "")).trim();
    }
  }
  for (const it of items) {
    const k = fold(it.label);
    const v = it.value;
    if (k.startsWith("auftreten")) kp.auftreten = v;
    else if (k.startsWith("stimme")) kp.stimme = v;
    else if (k === "will") kp.will = v;
    else if (k === "weiss") kp.weiss = v;
    else if (k === "zitat") kp.zitat = v;
    else if (v) kp.extra.push({ label: it.label, value: v });
  }
  if (!kp.auftreten && !kp.stimme && !kp.will && !kp.weiss && !kp.zitat && !kp.extra.length) return null;
  return kp;
}

// ---------------------------------------------------------------------------
// Secrets / tasks

/** Headings whose tasks count as secrets or clues. */
export const SECRET_HEADING = /^(geheimnis|hinweis)/i;

export function secretTasks(d: NoteDigest): TaskItem[] {
  return d.tasks.filter((t) => SECRET_HEADING.test(t.heading));
}

/**
 * Flips the checkbox at `line` if it is a task with text `expectedText`. If the line moved, the unique task
 * line with that text is used. Returns null when not found or ambiguous. Everything else stays byte-identical.
 */
export function toggleTask(text: string, line: number, expectedText: string, checked: boolean): string | null {
  const { lines } = scan(text);
  const want = expectedText.trim();
  const textOf = (l: Ln): string | null => {
    if (l.fence) return null;
    const m = TASK_RE.exec(l.eff);
    return m ? (m[2] ?? "").trim() : null;
  };
  let target: Ln | undefined = lines.find((l) => l.no === line && textOf(l) === want);
  if (!target) {
    const hits = lines.filter((l) => textOf(l) === want);
    if (hits.length !== 1) return null;
    target = hits[0];
  }
  const parts = text.split("\n");
  const orig = parts[target.no];
  const re = /^(\s*(?:>\s?)*\s*[-*+]\s+\[)[ xX](\])/;
  if (!re.test(orig)) return null;
  parts[target.no] = orig.replace(re, `$1${checked ? "x" : " "}$2`);
  return parts.join("\n");
}
