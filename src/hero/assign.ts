// Decision logic: which existing hero note does an imported hero belong to? Pure, no Obsidian.

export interface ExistingHeroNote {
  path: string;
  /** file name without extension */
  basename: string;
  /** frontmatter heldenschmiede_uid, if any */
  uid?: string;
}

export type MatchReason = "uid" | "name" | "manual";

export interface TargetCandidate {
  note: ExistingHeroNote;
  reason: MatchReason;
  /** German label for the selection list */
  label: string;
  /** true for the automatic match (preselected) */
  auto: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Candidates for the target-selection step: the automatic match first (uid beats name), then every other note.
 * "Neuen Helden anlegen" is not part of this list (the UI appends it).
 */
export function findCandidates(hero: { uid: string; name: string }, notes: ExistingHeroNote[]): TargetCandidate[] {
  const byUid = notes.filter((n) => n.uid && n.uid === hero.uid);
  const byName = notes.filter((n) => !byUid.includes(n) && norm(n.basename) === norm(hero.name));
  const out: TargetCandidate[] = [];
  byUid.forEach((note, i) =>
    out.push({ note, reason: "uid", auto: i === 0, label: `${note.basename} (automatisch: gleiche Heldenschmiede-UID)` }),
  );
  // a name match is only "automatic" when no uid match exists
  byName.forEach((note, i) =>
    out.push({
      note,
      reason: "name",
      auto: !byUid.length && i === 0,
      label: `${note.basename} (automatisch: gleicher Name${note.uid ? ", aber andere UID" : ""})`,
    }),
  );
  const rest = notes
    .filter((n) => !byUid.includes(n) && !byName.includes(n))
    .sort((a, b) => a.basename.localeCompare(b.basename, "de"));
  for (const note of rest)
    out.push({ note, reason: "manual", auto: false, label: note.uid ? `${note.basename} (verknüpft mit anderem Helden)` : note.basename });
  return out;
}

/** The preselected candidate, if there is an automatic match. */
export const autoCandidate = (c: TargetCandidate[]): TargetCandidate | undefined => c.find((x) => x.auto);

/**
 * Warnings shown in the confirmation step when the chosen note does not fit the JSON hero.
 * Name differences are only a warning: the note keeps its own file name, title and name fields.
 */
export function assignmentWarnings(hero: { uid: string; name: string }, note: ExistingHeroNote, all: ExistingHeroNote[] = []): string[] {
  const w: string[] = [];
  for (const o of all)
    if (o.path !== note.path && o.uid === hero.uid)
      w.push(`Die Notiz "${o.basename}" ist bereits mit diesem Export verknüpft. Danach tragen zwei Notizen dieselbe heldenschmiede_uid; die Verknüpfung in "${o.basename}" sollte entfernt werden.`);
  if (norm(note.basename) !== norm(hero.name)) {
    w.push(`Name in der Notiz: ${note.basename} – Name im Export: ${hero.name}. Die Notiz wird nicht umbenannt.`);
  }
  if (note.uid && note.uid !== hero.uid) {
    w.push(
      "Diese Notiz ist bereits mit einem anderen Heldenschmiede-Helden verknüpft. Die Verknüpfung (heldenschmiede_uid) wird auf den importierten Helden umgestellt und alle Spielwerte werden überschrieben.",
    );
  }
  return w;
}

/**
 * File name (without folder) for the cleaned JSON copy. Rules:
 * 1. a data file that already carries this uid is reused (stable across renames and manual assignments);
 * 2. otherwise `<hero name>`; if that name belongs to another uid, `<note name>`; if that too, `<note name> (<uid prefix>)`.
 * `existing` maps file name (e.g. "Thorwin.dsahero.json") to the uid it contains ("" if unreadable).
 */
export function chooseDataFileName(
  hero: { uid: string; name: string },
  noteBasename: string,
  existing: Record<string, string>,
  safe: (s: string) => string,
): string {
  for (const [file, uid] of Object.entries(existing)) if (uid === hero.uid) return file;
  // file names are compared case-insensitively: "Alrik.md" and "alrik.md" are the same file on macOS/Windows
  const taken = new Set(Object.keys(existing).map((f) => f.toLowerCase()));
  const free = (f: string) => !taken.has(f.toLowerCase());
  const a = `${safe(hero.name)}.dsahero.json`;
  if (free(a)) return a;
  const b = `${safe(noteBasename)}.dsahero.json`;
  if (free(b)) return b;
  return `${safe(noteBasename)} (${hero.uid.slice(0, 8)}).dsahero.json`;
}
