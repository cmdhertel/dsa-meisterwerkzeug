// Sitzungsregie: small pure text helpers for the UI (no obsidian imports).
import type { InlineAction } from "./types";
import type { JournalKind, SessionRun } from "./run";

// ------------------------------------------------------------------ scene labels

export interface SceneLabel {
  /** "3" for "Szene 03 - Titel"; null if the title has no number prefix */
  number: string | null;
  /** title without the "Szene NN:" prefix (the full title if nothing is left) */
  label: string;
}

/** "Szene 03 - Der Eid" -> { number: "3", label: "Der Eid" }; "Szene 0: Lotsen" works too. */
export function parseSceneLabel(title: string): SceneLabel {
  const t = title.trim();
  const m = /^Szene\s+(\d+)\s*[:\-–—]\s*(.*)$/i.exec(t);
  if (!m) return { number: null, label: t };
  const rest = m[2].trim();
  return { number: String(parseInt(m[1], 10)), label: rest || t };
}

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });
/** Natural order ("Szene 2" < "Szene 10"). */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

export interface Sortable {
  position: number | null;
  name: string;
}
/** position (numeric, missing last), then natural file name order */
export function compareScenes(a: Sortable, b: Sortable): number {
  const pa = a.position ?? Number.POSITIVE_INFINITY;
  const pb = b.position ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return naturalCompare(a.name, b.name);
}

// ------------------------------------------------------------------ frontmatter values

/** "[[Foo|x]]" / "[[Folder/Foo#h]]" -> "Folder/Foo" (link text for getFirstLinkpathDest); plain strings pass through. */
export function linkText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /\[\[([^\]]+)\]\]/.exec(v);
  let s = (m ? m[1] : v).split("|")[0].split("#")[0].split("^")[0].trim();
  s = s.replace(/\.md$/i, "");
  return s || null;
}

/** All link texts of a frontmatter value (string or list; nested lists from unquoted [[x]] are flattened). */
export function linkList(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else {
      const t = linkText(x);
      if (t) out.push(t);
    }
  };
  walk(v);
  return out;
}

/** First usable image path/link text of an `image` property ("[[a.png]]", "[[a.png|x]]", "path/a.png", "[[a.png]] ### note"). */
export function imageTarget(v: unknown): string | null {
  const first = Array.isArray(v) ? (v.flat(5) as unknown[])[0] : v;
  if (typeof first !== "string") return null;
  const m = /\[\[([^\]|]+)/.exec(first);
  const s = (m ? m[1] : first.split("###")[0]).trim();
  return s || null;
}

export const initials = (name: string): string => {
  const parts = name.replace(/\(.*?\)/g, "").split(/[\s,-]+/).filter((p) => /^\p{L}/u.test(p));
  const pick = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return pick.map((p) => p[0].toUpperCase()).join("") || "?";
};

/** Session `datum` (string or Date from YAML) as "YYYY-MM-DD", else null. */
export function dateKey(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    return m ? m[1] : null;
  }
  return null;
}

export const localDateKey = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ------------------------------------------------------------------ note text

/** Removes the YAML frontmatter and a leading H1; handles CRLF. */
export function stripFrontmatterAndH1(text: string): string {
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (/^---\s*$/.test(lines[0] ?? "")) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j])) {
        i = j + 1;
        break;
      }
    }
  }
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length && /^#\s+\S/.test(lines[i])) i++;
  return lines.slice(i).join("\n").replace(/^\s*\n/, "").trimEnd();
}

const PLACEHOLDER_ITALIC = /^\s*(?:\*[^*].*\*|_[^_].*_)\s*$/;
const EMPTY_BULLET = /^\s*[-*+]\s*(?:\[[ xX]?\])?\s*(?:\[\[\s*\]\])?\s*:?\s*$/;
const EMPTY_QUOTE = /^\s*>[\s>]*$/;
const BASE_EMBED = /^\s*!\[\[[^\]]*\.base[^\]]*\]\]\s*$/i;

/**
 * Markdown of a section without the template's placeholders (italic hint lines, empty bullets / quotes,
 * Bases embeds). Returns null when nothing real is left.
 */
export function meaningfulBody(md: string | null | undefined): string | null {
  if (!md) return null;
  const keep = md
    .split(/\r?\n/)
    .filter((l) => l.trim() && !PLACEHOLDER_ITALIC.test(l) && !EMPTY_BULLET.test(l) && !EMPTY_QUOTE.test(l) && !BASE_EMBED.test(l));
  const out = keep.join("\n").trim();
  return out || null;
}

/** Removes leading "> " quote markers (for sections whose body is a blockquote). */
export const unquote = (md: string): string => md.split(/\r?\n/).map((l) => l.replace(/^\s*(?:>\s?)+/, "")).join("\n").trim();

// ------------------------------------------------------------------ actions

/** "probe: Klettern -1 | QS2: ..." -> "Klettern −1"; "zauber: Ignifaxius +2 @Thorwin" -> "Ignifaxius +2 (Thorwin)". */
export function actionLabel(a: Pick<InlineAction, "kind" | "raw">): string {
  let body = a.raw.replace(/^\s*[\wäöüÄÖÜ]+\s*:/, "").trim();
  const segs = body.split("|").map((s) => s.trim()).filter(Boolean);
  const extra: string[] = [];
  let head = segs[0] ?? body;
  for (const s of segs.slice(1)) {
    const z = /^Ziel\s*:?\s*(\d+)/i.exec(s);
    if (z) extra.push(`Ziel ${z[1]}`);
  }
  const hero = /\s@(.+)$/.exec(head);
  let who = "";
  if (hero) {
    who = hero[1].trim();
    head = head.slice(0, hero.index).trim();
  }
  head = head.replace(/\s*[-–−]\s*(\d+)\s*$/, " −$1").replace(/\s*\+\s*(\d+)\s*$/, " +$1");
  body = head + (extra.length ? ` (${extra.join(", ")})` : "") + (who ? ` (${who})` : "");
  return body || a.raw;
}

export const ACTION_ICON: Record<InlineAction["kind"], string> = {
  probe: "dices",
  gruppenprobe: "users",
  sammelprobe: "repeat",
  gruppensammelprobe: "users",
  zauber: "sparkles",
  liturgie: "sun",
};

export const KIND_PREFIX: Record<string, JournalKind> = { "!": "entscheidung", '"': "zitat", "„": "zitat", ">": "faden", $: "beute" };

/** First-character shortcuts of the capture bar: "!text" -> entscheidung. */
export function applyPrefix(text: string, kind: JournalKind): { kind: JournalKind; text: string } {
  const k = KIND_PREFIX[text.charAt(0)];
  if (!k) return { kind, text };
  return { kind: k, text: text.slice(1).replace(/^\s+/, "") };
}

// ------------------------------------------------------------------ scenes in the journal

/** Title of the scene that is active in `run` (from the latest "szene" journal entry), or undefined. */
export function activeSceneTitle(run: SessionRun): string | undefined {
  if (!run.activeScene) return undefined;
  for (let i = run.journal.length - 1; i >= 0; i--) if (run.journal[i].kind === "szene") return run.journal[i].scene;
  return undefined;
}

// ------------------------------------------------------------------ combat summary

const baseName = (n: string): string => n.replace(/\s+\d+$/, "").trim() || n;

/** ["Wolf", "Wolf 2", "Gardist"] -> "2× Wolf, Gardist" (in order of first appearance). */
export function groupNames(names: string[]): string {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const n of names) {
    const b = baseName(n);
    if (!count.has(b)) order.push(b);
    count.set(b, (count.get(b) ?? 0) + 1);
  }
  return order.map((b) => ((count.get(b) ?? 1) > 1 ? `${count.get(b)}× ${b}` : b)).join(", ");
}

export const combatStartText = (foes: string[]): string => `Kampf begonnen: ${groupNames(foes)}`;

export function combatEndText(rounds: number, fallen: string[]): string {
  const r = Math.max(1, Math.trunc(rounds) || 1);
  return `Kampf beendet nach ${r} ${r === 1 ? "Kampfrunde" : "Kampfrunden"}` + (fallen.length ? `; gefallen: ${groupNames(fallen)}` : "");
}

/** Stats of the footer line. */
export function journalStats(run: SessionRun): { proben: number; kaempfe: number; enthuellt: number } {
  const n = (f: (e: SessionRun["journal"][number]) => boolean) => run.journal.filter(f).length;
  return {
    proben: n((e) => e.kind === "probe" || e.kind === "zauber" || e.kind === "gruppe"),
    kaempfe: n((e) => e.kind === "kampf" && !/^Kampf beendet/.test(e.text)),
    enthuellt: n((e) => e.kind === "geheimnis"),
  };
}

// ------------------------------------------------------------------ scene order

/** Next scene to play: the first not-yet-played one after the active scene, else the first unplayed one. */
export function nextScenePath(order: string[], run: SessionRun): string | null {
  const played = (p: string) => run.scenes[p]?.status === "gespielt";
  const at = run.activeScene ? order.indexOf(run.activeScene) : -1;
  for (let i = at + 1; i < order.length; i++) if (!played(order[i])) return order[i];
  if (at >= 0) return null;
  return order.find((p) => !played(p)) ?? null;
}
