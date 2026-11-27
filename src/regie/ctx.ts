// Sitzungsregie: the surface the view exposes to its panels (keeps the panel files free of view internals).
import type { App, Component } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import type { SessionRun } from "./run";
import type { RegieState } from "./state";
import type { SceneInfo, SceneSet, SessionInfo } from "./vault";

export interface RegieCtx {
  plugin: DsaMeisterwerkzeugPlugin;
  app: App;
  regie: RegieState;
  /** lifecycle owner for rendered markdown; unloaded with the view */
  owner: Component;
  /** selected session note path (null = none) */
  session(): string | null;
  sessionInfo(): SessionInfo | null;
  sessions(): SessionInfo[];
  campaign(): string;
  run(): SessionRun;
  isRunning(): boolean;
  scenes(): SceneSet;
  /** session path = Auftakt, else scene path */
  selected(): string | null;
  select(key: string): void;
  /** select + activate (starts the session if needed) */
  start(scene: SceneInfo): void;
  openNote(path: string, newLeaf?: boolean): void;
  quickNote(): void;
  pickSession(): void;
  writeMitschrift(): void;
  endSession(): void;
  /** scene path -> title, for the Mitschrift */
  sceneTitles(): Record<string, string>;
  registerCleanup(fn: () => void): void;
}

export const hhmm = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
