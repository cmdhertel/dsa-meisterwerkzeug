// Pure helpers: rolling for a subject, hero ordering, campaign links, combat matching.
import { TalentCheckResult, rollTalentCheck } from "../engine/talent";
import type { Roller } from "../engine/dice";
import type { TalentDef } from "../engine/types";
import { Hero, talentValue } from "../hero/model";

export interface Subject {
  name: string;
  attrs: [number, number, number];
  fw: number;
  /** positive = harder */
  statePenalty: number;
}

export interface ProbeRun {
  subject: Subject;
  result: TalentCheckResult;
}

export function subjectFromHero(hero: Hero, talent: TalentDef, statePenalty = 0): Subject {
  const attrs = talent.attrs.map((k) => hero.attributes[k] ?? 0) as [number, number, number];
  return { name: hero.callName || hero.name, attrs, fw: talentValue(hero, talent.name), statePenalty };
}

export function runCheck(subject: Subject, modifier: number, roller?: Roller): ProbeRun {
  const result = rollTalentCheck(
    {
      attrs: subject.attrs,
      fw: subject.fw,
      modifiers: modifier ? [{ label: "Probe", value: modifier }] : [],
      statePenalty: subject.statePenalty,
    },
    roller,
  );
  return { subject, result };
}

/** Best run: highest QS (failures = 0), ties broken by remaining points. */
export function bestRun(runs: readonly ProbeRun[]): ProbeRun | null {
  let best: ProbeRun | null = null;
  for (const r of runs) {
    if (!best || r.result.qs > best.result.qs || (r.result.qs === best.result.qs && r.result.remaining > best.result.remaining)) best = r;
  }
  return best;
}

/** "[[Die Nebelfurt|x]]" / "[[Die Nebelfurt#h]]" -> "Die Nebelfurt" (null if not a link-ish string). */
export function linkTarget(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /\[\[([^\]|#]+)/.exec(v);
  const s = (m ? m[1] : v).trim();
  return s ? s.replace(/^.*\//, "").replace(/\.md$/i, "") : null;
}

/** Campaign names from a frontmatter `kampagne` value (string or list). */
export function campaignsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.map(linkTarget).filter((x): x is string => !!x);
}

export interface HeroChoice {
  uid: string;
  name: string;
  campaigns: string[];
}

/**
 * Order for the hero menu: heroes of the note's campaign first (if the note has one and at least one hero matches),
 * the others in `others`. Inside each group the last chosen hero comes first, the rest alphabetical.
 */
export function orderHeroes<T extends HeroChoice>(heroes: readonly T[], noteCampaigns: readonly string[], lastUid: string | null): { primary: T[]; others: T[] } {
  const norm = (s: string) => s.trim().toLowerCase();
  const wanted = new Set(noteCampaigns.map(norm));
  const matches = (h: T) => h.campaigns.some((c) => wanted.has(norm(c)));
  const useSplit = wanted.size > 0 && heroes.some(matches);
  const sort = (a: T, b: T) => {
    if (lastUid) {
      if (a.uid === lastUid && b.uid !== lastUid) return -1;
      if (b.uid === lastUid && a.uid !== lastUid) return 1;
    }
    return a.name.localeCompare(b.name, "de");
  };
  const primary = (useSplit ? heroes.filter(matches) : [...heroes]).sort(sort);
  const others = useSplit ? heroes.filter((h) => !matches(h)).sort(sort) : [];
  return { primary, others };
}

export interface CombatEntryLike {
  id: string;
  kind: string;
  name: string;
  sourcePath: string;
}

/** The combat entry of a hero (by note path, else by name), or null. */
export function findCombatEntry<E extends CombatEntryLike>(entries: readonly E[], hero: { name: string; callName: string; notePath?: string }): E | null {
  const heroes = entries.filter((e) => e.kind === "hero");
  if (hero.notePath) {
    const byPath = heroes.find((e) => e.sourcePath === hero.notePath);
    if (byPath) return byPath;
  }
  const names = new Set([hero.name.toLowerCase(), hero.callName.toLowerCase()]);
  return heroes.find((e) => names.has(e.name.toLowerCase())) ?? null;
}

/** Signed modifier with a real minus sign; "" for 0. */
export function signedModifier(n: number): string {
  return n === 0 ? "" : n > 0 ? `+${n}` : `−${-n}`;
}

/** Outcome words for the table log: "gelungen, QS 2" / "kritischer Erfolg, QS 4" / "misslungen" / "Patzer". */
export function outcomeText(success: boolean, qs: number, critical: "success" | "patzer" | null): string {
  if (critical === "patzer") return "Patzer";
  if (critical === "success") return `kritischer Erfolg, QS ${qs}`;
  return success ? `gelungen, QS ${qs}` : "misslungen";
}

/** One-line table log text for a single probe: "Thorwin: Klettern −1 gelungen, QS 2". */
export function probeEventText(who: string, talent: string, modifier: number, success: boolean, qs: number, critical: "success" | "patzer" | null): string {
  const mod = signedModifier(modifier);
  return `${who}: ${talent}${mod ? " " + mod : ""} ${outcomeText(success, qs, critical)}`;
}

/** Short per-hero part of a group probe: "Thorwin QS 2" / "Godhard misslungen" / "Gwyn Patzer". */
function groupPart(who: string, success: boolean, qs: number, critical: "success" | "patzer" | null): string {
  if (critical === "patzer") return `${who} Patzer`;
  return `${who} ${success ? `QS ${qs}${critical === "success" ? " (kritisch)" : ""}` : "misslungen"}`;
}

/** One summary line for "Alle Helden": "Alle Helden: Sinnesschärfe — Thorwin QS 2, Godhard misslungen". */
export function probeAllEventText(talent: string, modifier: number, runs: readonly ProbeRun[]): string {
  const mod = signedModifier(modifier);
  const parts = runs.map((r) => groupPart(r.subject.name, r.result.success, r.result.qs, r.result.critical));
  return `Alle Helden: ${talent}${mod ? " " + mod : ""} — ${parts.join(", ")}`;
}
