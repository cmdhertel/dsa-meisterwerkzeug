// Settings data: defaults, migration from older versions, path helpers. No Obsidian imports (unit-tested).
import type { CombatState } from "./combat/store";
import type { SavedMap } from "./groupprobe/state";
import type { CockpitLayout } from "./cockpit/layout";
import { SHARE_DEFAULTS, ShareSettings } from "./share/viewModel";

export interface DsaSettings extends ShareSettings {
  bestiaryFolder: string;
  heroesFolder: string;
  /** folder for cleaned hero JSON copies (the plugin's data source for rolls) */
  heroDataFolder: string;
  /** user-editable Heldenschmiede key -> name mapping */
  mappingFile: string;
  /** note used as template for newly imported heroes; empty = built-in template */
  heroTemplate: string;
  /** rule notes for spells / liturgies (one note per spell) */
  spellFolder: string;
  liturgyFolder: string;
  /** one subfolder per campaign; the calendar follows the campaign of the open note */
  campaignsFolder: string;
  /** unfinished Sammelproben (groupprobe/state.ts) */
  groupprobe: SavedMap;
  /** Kampf-Cockpit layout: auto = by view width */
  cockpitLayout: CockpitLayout;
  /** Trefferzonen (Fokusregel): zone roll after an undefended hit, targeted attacks, zone armour, wound effects */
  hitZones: boolean;
  /** Sitzungsregie: write probes, fights, rests and date changes into the Mitschrift while a session runs */
  regieAutoLog: boolean;
  /** Sitzungsregie: how many earlier sessions of the campaign contribute open secrets (0 = none) */
  regieEarlierSessions: number;
}

export const DEFAULT_SETTINGS: DsaSettings = {
  bestiaryFolder: "DSA/Bestiarium",
  heroesFolder: "DSA/Helden",
  heroDataFolder: "DSA/Helden/_Daten",
  mappingFile: "DSA/Helden/_Daten/heldenschmiede-keys.json",
  heroTemplate: "",
  spellFolder: "DSA/Regeln/Zauber",
  liturgyFolder: "DSA/Regeln/Liturgien",
  campaignsFolder: "DSA/Kampagnen",
  groupprobe: {},
  cockpitLayout: "auto",
  hitZones: false,
  regieAutoLog: true,
  regieEarlierSessions: 5,
  ...SHARE_DEFAULTS,
};

/**
 * Values that were hard-coded before they became settings (0.1.0). An existing install that has saved
 * settings but lacks a key keeps its old behaviour; fresh installs get DEFAULT_SETTINGS.
 */
const LEGACY_VALUES: Partial<DsaSettings> = {
  bestiaryFolder: "30 - Bestiarium",
  heroesFolder: "Assets/08. Player Characters",
  heroDataFolder: "Assets/08. Player Characters/_Daten",
  mappingFile: "Assets/08. Player Characters/_Daten/heldenschmiede-keys.json",
  heroTemplate: "Templates/SC.md",
  spellFolder: "20 - Regeln/Zauber",
  liturgyFolder: "20 - Regeln/Liturgien",
  campaignsFolder: "Campaigns",
};

/** Merge saved settings over the defaults; saved settings from an older version get the legacy values for missing keys. */
export function resolveSettings(saved: Partial<DsaSettings> | undefined): DsaSettings {
  const base = saved ? { ...DEFAULT_SETTINGS, ...LEGACY_VALUES } : DEFAULT_SETTINGS;
  return { ...base, ...saved };
}

/** Folder path without trailing slashes. */
export const folderPath = (p: string): string => p.trim().replace(/\/+$/, "");

/**
 * Cleans a vault path typed into the settings: backslashes become slashes, repeated slashes collapse,
 * leading and trailing slashes are dropped. Blank input yields the fallback (e.g. the default path).
 */
export function normalizeSettingPath(raw: string, fallback: string): string {
  const cleaned = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").trim();
  return cleaned || fallback;
}

/** Everything stored via loadData()/saveData(). */
export interface PluginData {
  settings: DsaSettings;
  combat: CombatState | null;
}
