// Sitzungsregie: session run state as pure, JSON-serializable reducers (no obsidian imports).

export type SceneStatus = "offen" | "läuft" | "gespielt";
/** ms = accumulated play time, since = timestamp when it became active (null while not running) */
export interface SceneRun {
  status: SceneStatus;
  ms: number;
  since: number | null;
}
export type JournalKind =
  | "start"
  | "ende"
  | "szene"
  | "probe"
  | "zauber"
  | "gruppe"
  | "kampf"
  | "geheimnis"
  | "datum"
  | "rast"
  | "notiz"
  | "entscheidung"
  | "zitat"
  | "faden"
  | "beute";
/** scene = TITLE of the scene active at that time */
export interface JournalEntry {
  id: string;
  t: number;
  kind: JournalKind;
  text: string;
  scene?: string;
}
export interface SessionRun {
  version: 1;
  sessionPath: string;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  activeScene: string | null;
  scenes: Record<string, SceneRun>;
  journal: JournalEntry[];
}

export const MAX_JOURNAL = 2000;

export const MANUAL_KINDS: JournalKind[] = ["notiz", "entscheidung", "zitat", "faden", "beute"];

export const KIND_LABEL: Record<JournalKind, string> = {
  start: "Start",
  ende: "Ende",
  szene: "Szene",
  probe: "Probe",
  zauber: "Zauber",
  gruppe: "Gruppenprobe",
  kampf: "Kampf",
  geheimnis: "Geheimnis",
  datum: "Datum",
  rast: "Rast",
  notiz: "Notiz",
  entscheidung: "Entscheidung",
  zitat: "Zitat",
  faden: "Faden",
  beute: "Beute",
};

export const KIND_ICON: Record<JournalKind, string> = {
  start: "play",
  ende: "flag",
  szene: "clapperboard",
  probe: "dices",
  zauber: "sparkles",
  gruppe: "users",
  kampf: "swords",
  geheimnis: "key-round",
  datum: "calendar-days",
  rast: "moon",
  notiz: "pencil",
  entscheidung: "git-branch",
  zitat: "quote",
  faden: "link",
  beute: "gem",
};

const KINDS = Object.keys(KIND_LABEL) as JournalKind[];
const isKind = (k: unknown): k is JournalKind => typeof k === "string" && (KINDS as string[]).includes(k);
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const numOrNull = (n: unknown): number | null => (isNum(n) ? n : null);

export function newRun(sessionPath: string): SessionRun {
  return { version: 1, sessionPath, startedAt: null, endedAt: null, pausedAt: null, activeScene: null, scenes: {}, journal: [] };
}

/** Tolerant loader: never throws, always returns a valid run for `sessionPath`. */
export function normalizeRun(raw: unknown, sessionPath: string): SessionRun {
  const run = newRun(sessionPath);
  try {
    if (!raw || typeof raw !== "object") return run;
    const r = raw as Record<string, unknown>;
    run.startedAt = numOrNull(r.startedAt);
    run.endedAt = numOrNull(r.endedAt);
    run.pausedAt = numOrNull(r.pausedAt);
    if (r.scenes && typeof r.scenes === "object") {
      for (const [k, v] of Object.entries(r.scenes as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const s = v as Record<string, unknown>;
        const status: SceneStatus = s.status === "läuft" || s.status === "gespielt" ? s.status : "offen";
        run.scenes[k] = { status, ms: isNum(s.ms) && s.ms > 0 ? s.ms : 0, since: status === "läuft" ? numOrNull(s.since) : null };
      }
    }
    run.activeScene = typeof r.activeScene === "string" && run.scenes[r.activeScene]?.status === "läuft" ? r.activeScene : null;
    if (Array.isArray(r.journal)) {
      const ids = new Set<string>();
      let n = 0;
      for (const e of r.journal) {
        if (!e || typeof e !== "object") continue;
        const x = e as Record<string, unknown>;
        if (!isNum(x.t) || typeof x.text !== "string") continue;
        let id = typeof x.id === "string" && x.id ? x.id : `x${n}`;
        while (ids.has(id)) id += "_";
        ids.add(id);
        n++;
        const entry: JournalEntry = { id, t: x.t, kind: isKind(x.kind) ? x.kind : "notiz", text: x.text };
        if (typeof x.scene === "string") entry.scene = x.scene;
        run.journal.push(entry);
      }
      if (run.journal.length > MAX_JOURNAL) run.journal = run.journal.slice(-MAX_JOURNAL);
    }
  } catch {
    return newRun(sessionPath);
  }
  return run;
}

// ---------------------------------------------------------------------------

let counter = 0;
function freshId(run: SessionRun, now: number): string {
  const used = new Set(run.journal.map((e) => e.id));
  for (;;) {
    counter = (counter + 1) % 1296;
    const id = now.toString(36) + counter.toString(36).padStart(2, "0");
    if (!used.has(id)) return id;
  }
}

function cap(journal: JournalEntry[]): JournalEntry[] {
  return journal.length > MAX_JOURNAL ? journal.slice(journal.length - MAX_JOURNAL) : journal;
}

function clone(run: SessionRun): SessionRun {
  const scenes: Record<string, SceneRun> = {};
  for (const [k, v] of Object.entries(run.scenes)) scenes[k] = { ...v };
  return { ...run, scenes, journal: run.journal.slice() };
}

function pushEntry(run: SessionRun, kind: JournalKind, text: string, now: number, scene?: string, id?: string): void {
  const e: JournalEntry = { id: id ?? freshId(run, now), t: now, kind, text };
  if (scene !== undefined) e.scene = scene;
  run.journal.push(e);
  run.journal = cap(run.journal);
}

/** Stops the clock of scene `path` (adds elapsed to ms). Mutates the (already cloned) run. */
function stopClock(run: SessionRun, path: string, now: number, status: SceneStatus): void {
  const s = run.scenes[path];
  if (!s) return;
  if (s.since !== null) s.ms += Math.max(0, now - s.since);
  s.since = null;
  s.status = status;
}

export function startSession(run: SessionRun, now: number): SessionRun {
  const r = clone(run);
  const first = r.startedAt === null;
  if (first) r.startedAt = now;
  r.endedAt = null;
  r.pausedAt = null;
  if (first) pushEntry(r, "start", "Session begonnen", now);
  return r;
}

export function endSession(run: SessionRun, now: number): SessionRun {
  const r = clone(run);
  const sceneTitle = r.activeScene ? titleOfActive(run) : undefined;
  if (r.activeScene) {
    stopClock(r, r.activeScene, now, "gespielt");
    r.activeScene = null;
  }
  r.endedAt = now;
  r.pausedAt = null;
  const total = r.startedAt === null ? 0 : Math.max(0, now - r.startedAt);
  pushEntry(r, "ende", `Session beendet (${formatDuration(total)})`, now, sceneTitle);
  return r;
}

/** Title of the active scene as recorded by the latest "szene" journal entry. */
function titleOfActive(run: SessionRun): string | undefined {
  for (let i = run.journal.length - 1; i >= 0; i--) if (run.journal[i].kind === "szene") return run.journal[i].scene;
  return undefined;
}

export function activateScene(run: SessionRun, path: string, title: string, now: number): SessionRun {
  if (run.activeScene === path && run.scenes[path]?.status === "läuft") return run;
  let r = run.startedAt === null ? startSession(run, now) : clone(run);
  if (r.endedAt !== null) r.endedAt = null;
  if (r.activeScene) {
    stopClock(r, r.activeScene, now, "gespielt");
    r.activeScene = null;
  }
  const prev = r.scenes[path];
  r.scenes[path] = { status: "läuft", ms: prev?.ms ?? 0, since: now };
  r.activeScene = path;
  pushEntry(r, "szene", `Szene: ${title}`, now, title);
  r = { ...r };
  return r;
}

export function setSceneStatus(run: SessionRun, path: string, status: SceneStatus, now: number): SessionRun {
  const r = clone(run);
  const cur = r.scenes[path] ?? { status: "offen" as SceneStatus, ms: 0, since: null };
  r.scenes[path] = cur;
  if (r.activeScene === path) r.activeScene = null;
  stopClock(r, path, now, status);
  if (status === "läuft") {
    // manual "läuft" is treated as activation without a journal entry
    r.scenes[path].since = now;
    r.activeScene = path;
  }
  return r;
}

export function addEntry(
  run: SessionRun,
  e: { kind: JournalKind; text: string; sceneTitle?: string },
  now: number,
  id?: string,
): SessionRun {
  const text = e.text.trim();
  if (!text) return run;
  const r = clone(run);
  let useId = id;
  if (useId !== undefined && r.journal.some((x) => x.id === useId)) useId = undefined;
  pushEntry(r, e.kind, text, now, e.sceneTitle, useId);
  return r;
}

export function removeEntry(run: SessionRun, id: string): SessionRun {
  if (!run.journal.some((e) => e.id === id)) return run;
  return { ...clone(run), journal: run.journal.filter((e) => e.id !== id) };
}

export function updateEntry(run: SessionRun, id: string, patch: { text?: string; kind?: JournalKind }): SessionRun {
  const r = clone(run);
  r.journal = r.journal.map((e) => {
    if (e.id !== id) return e;
    const text = patch.text !== undefined ? patch.text.trim() || e.text : e.text;
    return { ...e, text, kind: patch.kind ?? e.kind };
  });
  return r;
}

export function sceneElapsed(run: SessionRun, path: string, now: number): number {
  const s = run.scenes[path];
  if (!s) return 0;
  return s.ms + (s.since !== null ? Math.max(0, now - s.since) : 0);
}

export function sessionElapsed(run: SessionRun, now: number): number {
  if (run.startedAt === null) return 0;
  return Math.max(0, (run.endedAt ?? now) - run.startedAt);
}

/** "0:07", "1:23" (h:mm). */
export function formatDuration(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/** "mm:ss" below one hour, else "h:mm:ss". */
export function formatClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}
