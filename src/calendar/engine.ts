// Aventurian calendar engine. Pure, no obsidian imports.
import { HOLY_DAYS } from "./holydays";

export const MONTHS = ["Praios", "Rondra", "Efferd", "Travia", "Boron", "Hesinde", "Firun", "Tsa", "Phex", "Peraine", "Ingerimm", "Rahja"] as const;
/** month index of the five Namenlose Tage */
export const NAMENLOSE = 12;
export const DAYS_PER_MONTH = 30;
export const NAMENLOSE_DAYS = 5;
export const DAYS_PER_YEAR = 365;

export const WEEKDAYS = ["Windstag", "Erdstag", "Markttag", "Praiostag", "Rohalstag", "Feuertag", "Wassertag"] as const;
/** ASSUMPTION (editable): weekday index (into WEEKDAYS) of 1. Praios 1 BF. */
export const WEEKDAY_EPOCH = 0;
/** ASSUMPTION (editable): day number (0 = 1. Praios 1 BF) on which a Tote Mada (Neumond) cycle starts. */
export const MOON_EPOCH = 0;
export const MOON_CYCLE = 28;

export interface MoonPhase {
  index: number;
  name: string;
  alt: string;
}
export const MOON_PHASES: MoonPhase[] = [
  { index: 0, name: "Tote Mada", alt: "Neumond" },
  { index: 1, name: "Kelch", alt: "zunehmend" },
  { index: 2, name: "Rad", alt: "Vollmond" },
  { index: 3, name: "Helm", alt: "abnehmend" },
];

export type Season = "Frühling" | "Sommer" | "Herbst" | "Winter";
/** Aventurian months mirror the northern year (Praios ~ July). Namenlose Tage count as Sommer. */
export const SEASON_BY_MONTH: Season[] = [
  "Sommer", "Sommer", "Herbst", "Herbst", "Herbst", "Winter", "Winter", "Winter", "Frühling", "Frühling", "Frühling", "Sommer", "Sommer",
];

export interface AvDate {
  year: number;
  /** 0..11 = Praios..Rahja, 12 = Namenlose Tage */
  month: number;
  /** 1..30 (1..5 in the Namenlose Tage) */
  day: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export const daysInMonth = (month: number): number => (month === NAMENLOSE ? NAMENLOSE_DAYS : DAYS_PER_MONTH);

export function isValidDate(d: AvDate): boolean {
  return (
    Number.isInteger(d.year) && Number.isInteger(d.month) && Number.isInteger(d.day) &&
    d.month >= 0 && d.month <= NAMENLOSE && d.day >= 1 && d.day <= daysInMonth(d.month)
  );
}

/** Absolute day number; 1. Praios 1 BF = 0. */
export function toDayNumber(d: AvDate): number {
  return (d.year - 1) * DAYS_PER_YEAR + d.month * DAYS_PER_MONTH + (d.day - 1);
}

export function fromDayNumber(n: number): AvDate {
  const year = Math.floor(n / DAYS_PER_YEAR) + 1;
  const r = mod(n, DAYS_PER_YEAR);
  if (r >= NAMENLOSE * DAYS_PER_MONTH) return { year, month: NAMENLOSE, day: r - NAMENLOSE * DAYS_PER_MONTH + 1 };
  return { year, month: Math.floor(r / DAYS_PER_MONTH), day: (r % DAYS_PER_MONTH) + 1 };
}

export const addDays = (d: AvDate, n: number): AvDate => fromDayNumber(toDayNumber(d) + n);
/** a - b in days */
export const diffDays = (a: AvDate, b: AvDate): number => toDayNumber(a) - toDayNumber(b);
export const compareDates = (a: AvDate, b: AvDate): number => diffDays(a, b);
export const sameDate = (a: AvDate, b: AvDate): boolean => a.year === b.year && a.month === b.month && a.day === b.day;

export const weekdayIndex = (d: AvDate): number => mod(toDayNumber(d) + WEEKDAY_EPOCH, 7);
export const weekdayName = (d: AvDate): string => WEEKDAYS[weekdayIndex(d)];

export function moonDay(d: AvDate): number {
  return mod(toDayNumber(d) - MOON_EPOCH, MOON_CYCLE);
}
export function moonPhase(d: AvDate): MoonPhase {
  return MOON_PHASES[Math.floor(moonDay(d) / (MOON_CYCLE / MOON_PHASES.length))];
}

export const seasonOf = (d: AvDate): Season => SEASON_BY_MONTH[d.month];

export function holyDay(d: AvDate): string | null {
  return HOLY_DAYS.find((h) => h.month === d.month && h.day === d.day)?.name ?? null;
}

export function monthName(month: number, long = false): string {
  if (month === NAMENLOSE) return long ? "Namenloser Tag" : "Namenlose Tage";
  return MONTHS[month];
}

/** "12. Praios 1028 BF", "3. Namenloser Tag 1028 BF" */
export function formatDate(d: AvDate, withYear = true): string {
  const base = `${d.day}. ${monthName(d.month, true)}`;
  return withYear ? `${base} ${d.year} BF` : base;
}

/** Month abbreviations (first 3 letters, "Phe"/"Per" are unambiguous) */
function monthFromWord(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (/^namenlos/.test(w) || w === "nam" || w === "nt") return NAMENLOSE;
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.toLowerCase().startsWith(w));
  return i >= 0 ? i : null;
}

/**
 * Lenient parser: "12. Praios 1028 BF", "12. PRA 1028", "3. Namenloser Tag 1028 BF", "1 Rondra 1030".
 * Returns null for anything invalid. `defaultYear` is used when the text has no year.
 */
export function parseDate(text: unknown, defaultYear?: number): AvDate | null {
  if (typeof text !== "string") return null;
  const m = /^\s*(\d{1,2})\s*\.?\s*(namenlose[rn]?\s+tag(?:e|es)?|[a-zäöüß]+)\.?\s*(?:(\d{1,5})\s*(?:v\.?\s*)?(?:bf|b\.\s*f\.?)?)?\s*(?:bf)?\s*$/i.exec(text.trim());
  if (!m) return null;
  const month = monthFromWord(m[2].replace(/\s+/g, " "));
  if (month === null) return null;
  const year = m[3] !== undefined ? parseInt(m[3], 10) : defaultYear;
  if (year === undefined || !Number.isFinite(year)) return null;
  const d: AvDate = { year, month, day: parseInt(m[1], 10) };
  return isValidDate(d) ? d : null;
}
