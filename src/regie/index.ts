// Sitzungsregie: registration (view, ribbon, commands, state, auto-log, rename handling).
import { Notice } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { registerAutoLog } from "./autolog";
import { QuickNoteModal, writeMitschriftDirect } from "./modals";
import { RegieState, regieOf, setRegie } from "./state";
import { nextScenePath } from "./text";
import { REGIE_VIEW_TYPE, RegieView } from "./view";
import { discoverScenes, sessionOfNote } from "./vault";

export interface OpenOptions {
  session?: string | null;
  scene?: string | null;
}

/** Opens (or reveals) the Sitzungsregie as a main-area tab, optionally jumping to a session / scene. */
export async function openRegie(plugin: DsaMeisterwerkzeugPlugin, opts: OpenOptions = {}): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(REGIE_VIEW_TYPE)[0];
  if (!leaf) {
    leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: REGIE_VIEW_TYPE, active: true, state: { session: opts.session ?? null, scene: opts.scene ?? null } });
  } else if (opts.session && leaf.view instanceof RegieView) {
    await leaf.view.setSession(opts.session, opts.scene);
  }
  await workspace.revealLeaf(leaf);
}

/** The session commands act on: the running one, else the last used one. */
function targetSession(state: RegieState): string | null {
  return state.running()?.sessionPath ?? state.data.lastSession;
}

export function registerRegie(plugin: DsaMeisterwerkzeugPlugin): void {
  const dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
  const state = new RegieState(plugin.app, `${dir}/regie.json`);
  setRegie(plugin, state);
  void state.load();
  plugin.register(() => void state.flush());

  plugin.registerView(REGIE_VIEW_TYPE, (leaf) => new RegieView(leaf, plugin));
  plugin.addRibbonIcon("clapperboard", "Sitzungsregie öffnen", () => void openRegie(plugin));
  registerAutoLog(plugin, state);

  plugin.registerEvent(plugin.app.vault.on("rename", (f, old) => state.rename(old, f.path)));

  plugin.addCommand({ id: "regie-open", name: "Sitzungsregie öffnen", callback: () => void openRegie(plugin) });

  plugin.addCommand({
    id: "regie-open-current",
    name: "Sitzungsregie für aktuelle Notiz öffnen",
    callback: () => {
      const f = plugin.app.workspace.getActiveFile();
      if (!f) return void new Notice("Keine aktive Notiz.");
      const session = sessionOfNote(plugin.app, f.path) ?? regieOf(plugin).data.lastSession;
      void openRegie(plugin, { session, scene: session && session !== f.path ? f.path : null });
    },
  });

  plugin.addCommand({
    id: "regie-quick-note",
    name: "Sitzungsregie: Notiz zur Mitschrift",
    callback: () => {
      const s = targetSession(state);
      if (!s) return void new Notice("Keine Session gewählt. Bitte zuerst die Sitzungsregie öffnen.");
      new QuickNoteModal(plugin.app, (k, t) => state.log(s, k, t)).open();
    },
  });

  plugin.addCommand({
    id: "regie-next-scene",
    name: "Sitzungsregie: Nächste Szene starten",
    callback: () => {
      const s = targetSession(state);
      if (!s) return void new Notice("Keine Session gewählt. Bitte zuerst die Sitzungsregie öffnen.");
      const set = discoverScenes(plugin.app, s);
      const next = nextScenePath(set.all.map((x) => x.path), state.run(s));
      const scene = set.all.find((x) => x.path === next);
      if (!scene) return void new Notice("Keine weitere Szene.");
      state.activate(s, scene.path, scene.title);
      new Notice(`Szene gestartet: ${scene.label}`);
    },
  });

  plugin.addCommand({
    id: "regie-write-mitschrift",
    name: "Sitzungsregie: Mitschrift in Session-Notiz schreiben",
    callback: () => {
      const s = targetSession(state);
      if (!s) return void new Notice("Keine Session gewählt.");
      const titles = Object.fromEntries(discoverScenes(plugin.app, s).all.map((x) => [x.path, x.title]));
      void writeMitschriftDirect(plugin, state.run(s), titles);
    },
  });
}
