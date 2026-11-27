// Pure: turn note frontmatter into calendar events.
import { AvDate, parseDate, toDayNumber } from "./engine";

export interface CalEvent {
  path: string;
  title: string;
  typ: string;
  campaign: string | null;
  date: AvDate;
  day: number;
}

const DATE_KEYS = ["datum_bf", "datum_aventurisch", "aventurisches_datum"];
const EVENT_TYPES = new Set(["ereignis", "session", "szene", "kapitel", "abenteuer"]);

/** "[[Die Nebelfurt]]" / "[[a|b]]" -> "Die Nebelfurt" */
export function linkTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /\[\[([^\]|#]+)/.exec(v);
  return (m ? m[1] : v).trim() || null;
}

export function eventFromFrontmatter(path: string, title: string, fm: Record<string, unknown> | undefined | null): CalEvent | null {
  if (!fm) return null;
  const typ = typeof fm.typ === "string" ? fm.typ.toLowerCase() : "";
  if (!EVENT_TYPES.has(typ)) return null;
  for (const k of DATE_KEYS) {
    const raw = fm[k];
    if (raw === undefined || raw === null) continue;
    const date = parseDate(typeof raw === "number" ? "" : String(raw));
    if (date) return { path, title, typ, campaign: linkTarget(fm.kampagne), date, day: toDayNumber(date) };
  }
  return null;
}

export function indexByDay(events: CalEvent[]): Map<number, CalEvent[]> {
  const m = new Map<number, CalEvent[]>();
  for (const e of events) {
    const l = m.get(e.day) ?? [];
    l.push(e);
    m.set(e.day, l);
  }
  return m;
}
