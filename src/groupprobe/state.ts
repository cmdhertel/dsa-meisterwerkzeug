// Persistence of unfinished Sammelproben inside plugin.settings.groupprobe (saved with settings via plugin.persist()).
import type DsaMeisterwerkzeugPlugin from "../main";
import { SAVED_SAMMEL_LIMIT } from "./constants";
import type { SammelState } from "./logic";

export interface ManualPart {
  id: string;
  name: string;
  attrs: [number, number, number];
  fw: number;
}

export interface SavedSammel {
  state: SammelState;
  selected: string[];
  mods: Record<string, number>;
  common: number;
  manual: ManualPart[];
  updated: number;
}

export type SavedMap = Record<string, SavedSammel>;

/** Keep only the `limit` most recently updated entries. Pure. */
export function pruneSaved(map: SavedMap, limit = SAVED_SAMMEL_LIMIT): SavedMap {
  const keys = Object.keys(map).sort((a, b) => map[b].updated - map[a].updated);
  const out: SavedMap = {};
  for (const k of keys.slice(0, limit)) out[k] = map[k];
  return out;
}

function store(plugin: DsaMeisterwerkzeugPlugin): SavedMap {
  const s = plugin.settings;
  if (!s.groupprobe || typeof s.groupprobe !== "object") s.groupprobe = {};
  return s.groupprobe;
}

export function loadSaved(plugin: DsaMeisterwerkzeugPlugin, key: string): SavedSammel | null {
  const e = store(plugin)[key];
  return e && e.state && e.state.status === "läuft" ? e : null;
}

export async function saveSammel(plugin: DsaMeisterwerkzeugPlugin, key: string, entry: SavedSammel): Promise<void> {
  plugin.settings.groupprobe = pruneSaved({ ...store(plugin), [key]: entry });
  await plugin.persist();
}

export async function clearSammel(plugin: DsaMeisterwerkzeugPlugin, key: string): Promise<void> {
  const m = store(plugin);
  if (!(key in m)) return;
  delete m[key];
  await plugin.persist();
}
