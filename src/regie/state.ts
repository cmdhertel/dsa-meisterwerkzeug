// Sitzungsregie: live state of all session runs. Own file (regie.json) because plugin.persist() only saves settings + combat.
import type { App } from "obsidian";
import {
  JournalKind, SessionRun, SceneStatus, activateScene, addEntry, endSession, newRun, normalizeRun, removeEntry, setSceneStatus, startSession, updateEntry,
} from "./run";
import { activeSceneTitle } from "./text";

export interface RegieData {
  version: 1;
  lastSession: string | null;
  runs: Record<string, SessionRun>;
}

export const emptyRegieData = (): RegieData => ({ version: 1, lastSession: null, runs: {} });

export function normalizeRegieData(raw: unknown): RegieData {
  const out = emptyRegieData();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.lastSession === "string") out.lastSession = r.lastSession;
  if (r.runs && typeof r.runs === "object") {
    for (const [path, v] of Object.entries(r.runs as Record<string, unknown>)) out.runs[path] = normalizeRun(v, path);
  }
  return out;
}

export type RegieLoadResult = { ok: true; data: RegieData } | { ok: false };

/**
 * Interprets the content of regie.json. `text` is null if there is no file yet (a fresh start, which is fine).
 * A file that exists but is not a JSON object counts as broken: it must never be replaced by empty data,
 * because the next save would destroy it.
 */
/** Saving is allowed unless the last load found a broken file. */
export const mayWrite = (loadFailed: boolean): boolean => !loadFailed;

export function loadRegieText(text: string | null): RegieLoadResult {
  if (text === null) return { ok: true, data: emptyRegieData() };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, data: normalizeRegieData(parsed) };
  } catch {
    return { ok: false };
  }
}

/** Re-keys runs and scene entries after a note was renamed/moved. Pure; returns a new object. */
export function renameInData(data: RegieData, from: string, to: string): RegieData {
  if (from === to) return data;
  const runs: Record<string, SessionRun> = {};
  for (const [path, run] of Object.entries(data.runs)) {
    const scenes: SessionRun["scenes"] = {};
    for (const [sp, s] of Object.entries(run.scenes)) scenes[sp === from ? to : sp] = s;
    const key = path === from ? to : path;
    runs[key] = { ...run, sessionPath: key, scenes, activeScene: run.activeScene === from ? to : run.activeScene };
  }
  return { ...data, lastSession: data.lastSession === from ? to : data.lastSession, runs };
}

export class RegieState {
  data: RegieData = emptyRegieData();
  private listeners = new Set<(sessionPath: string | null) => void>();
  private timer: number | null = null;
  private dirty = false;
  /** Set when the file existed but could not be read or parsed; flush() then refuses to overwrite it. */
  loadFailed = false;

  constructor(private app: App, private path: string, private now: () => number = Date.now) {}

  /** Loads regie.json. Returns false if the file exists but is broken (the caller should tell the user). */
  async load(): Promise<boolean> {
    let text: string | null = null;
    let readFailed = false;
    try {
      if (await this.app.vault.adapter.exists(this.path)) text = await this.app.vault.adapter.read(this.path);
    } catch {
      readFailed = true;
    }
    const res: RegieLoadResult = readFailed ? { ok: false } : loadRegieText(text);
    if (res.ok) {
      this.data = res.data;
    } else {
      // Keep the broken file as a backup and refuse to write until it is repaired.
      this.loadFailed = true;
      this.data = emptyRegieData();
      if (text !== null) {
        try {
          await this.app.vault.adapter.write(`${this.path}.bak`, text);
        } catch (e) {
          console.error("Sitzungsregie: Sicherung fehlgeschlagen", e);
        }
      }
    }
    this.emit(null);
    return res.ok;
  }

  on(fn: (sessionPath: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(path: string | null): void {
    for (const l of [...this.listeners]) {
      try {
        l(path);
      } catch (e) {
        console.error("Sitzungsregie: Listener fehlgeschlagen", e);
      }
    }
  }

  private changed(path: string | null): void {
    this.emit(path);
    this.dirty = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    if (!mayWrite(this.loadFailed)) {
      console.error("Sitzungsregie: Speichern verweigert, regie.json war beim Laden beschädigt");
      return;
    }
    this.dirty = false;
    try {
      await this.app.vault.adapter.write(this.path, JSON.stringify(this.data));
    } catch (e) {
      this.dirty = true;
      console.error("Sitzungsregie: Speichern fehlgeschlagen", e);
    }
  }

  // ------------------------------------------------------------ queries
  /** The run of a session (an unsaved empty run if there is none yet). */
  run(path: string): SessionRun {
    return this.data.runs[path] ?? newRun(path);
  }
  isRunning(path: string): boolean {
    const r = this.data.runs[path];
    return !!r && r.startedAt !== null && r.endedAt === null;
  }
  /** The session that is currently running (last used one first), or null. */
  running(): SessionRun | null {
    const last = this.data.lastSession ? this.data.runs[this.data.lastSession] : undefined;
    if (last && last.startedAt !== null && last.endedAt === null) return last;
    let best: SessionRun | null = null;
    for (const r of Object.values(this.data.runs)) {
      if (r.startedAt !== null && r.endedAt === null && (!best || r.startedAt > (best.startedAt ?? 0))) best = r;
    }
    return best;
  }

  // ------------------------------------------------------------ mutations
  private set(path: string, run: SessionRun, last = true): void {
    this.data.runs[path] = run;
    if (last) this.data.lastSession = path;
    this.changed(path);
  }

  setLast(path: string | null): void {
    if (this.data.lastSession === path) return;
    this.data.lastSession = path;
    this.changed(null);
  }

  start(path: string): void {
    this.set(path, startSession(this.run(path), this.now()));
  }
  end(path: string): void {
    const r = this.run(path);
    if (r.startedAt === null || r.endedAt !== null) return;
    this.set(path, endSession(r, this.now()));
  }
  activate(path: string, scenePath: string, title: string): void {
    this.set(path, activateScene(this.run(path), scenePath, title, this.now()));
  }
  setSceneStatus(path: string, scenePath: string, status: SceneStatus): void {
    this.set(path, setSceneStatus(this.run(path), scenePath, status, this.now()), false);
  }
  /** Adds a journal entry with the title of the scene that is active in that run. */
  log(path: string, kind: JournalKind, text: string): void {
    const run = this.run(path);
    const next = addEntry(run, { kind, text, sceneTitle: activeSceneTitle(run) }, this.now());
    if (next !== run) this.set(path, next, false);
  }
  editEntry(path: string, id: string, patch: { text?: string; kind?: JournalKind }): void {
    this.set(path, updateEntry(this.run(path), id, patch), false);
  }
  deleteEntry(path: string, id: string): void {
    const run = this.run(path);
    const next = removeEntry(run, id);
    if (next !== run) this.set(path, next, false);
  }
  reset(path: string): void {
    delete this.data.runs[path];
    this.changed(path);
  }
  rename(from: string, to: string): void {
    const involved = Object.entries(this.data.runs).some(([p, r]) => p === from || r.scenes[from] !== undefined || r.activeScene === from) || this.data.lastSession === from;
    if (!involved) return;
    this.data = renameInData(this.data, from, to);
    this.changed(null);
  }
}

const REGISTRY = new WeakMap<object, RegieState>();
export const setRegie = (plugin: object, s: RegieState): void => void REGISTRY.set(plugin, s);
export function regieOf(plugin: object): RegieState {
  const s = REGISTRY.get(plugin);
  if (!s) throw new Error("Sitzungsregie nicht initialisiert");
  return s;
}
