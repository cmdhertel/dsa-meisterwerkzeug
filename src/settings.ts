import { App, PluginSettingTab, Setting } from "obsidian";
import type { CombatState } from "./combat/store";
import type DsaMeisterwerkzeugPlugin from "./main";
import type { SavedMap } from "./groupprobe/state";
import { SHARE_DEFAULTS, ShareSettings } from "./share/viewModel";
import { addShareSettings } from "./share/settings";
import { CockpitLayout, LAYOUT_LABEL, LAYOUT_ORDER, normalizeLayout, refreshCockpitLayouts } from "./cockpit/layout";

export interface DsaSettings extends ShareSettings {
  bestiaryFolder: string;
  heroesFolder: string;
  /** folder for cleaned hero JSON copies (the plugin's data source for rolls) */
  heroDataFolder: string;
  /** user-editable Heldenschmiede key -> name mapping */
  mappingFile: string;
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
  bestiaryFolder: "30 - Bestiarium",
  heroesFolder: "Assets/08. Player Characters",
  heroDataFolder: "Assets/08. Player Characters/_Daten",
  mappingFile: "Assets/08. Player Characters/_Daten/heldenschmiede-keys.json",
  groupprobe: {},
  cockpitLayout: "auto",
  hitZones: false,
  regieAutoLog: true,
  regieEarlierSessions: 5,
  ...SHARE_DEFAULTS,
};

/** Everything stored via loadData()/saveData(). */
export interface PluginData {
  settings: DsaSettings;
  combat: CombatState | null;
}

export class DsaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DsaMeisterwerkzeugPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "DSA Meisterwerkzeug" });

    const field = (name: string, desc: string, key: "bestiaryFolder" | "heroesFolder" | "heroDataFolder" | "mappingFile") =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t
            .setPlaceholder(DEFAULT_SETTINGS[key])
            .setValue(this.plugin.settings[key])
            .onChange(async (v) => {
              this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
              await this.plugin.persist();
            }),
        );

    field("Bestiarium-Ordner", "Ordner mit den Kreaturen-Notizen (Frontmatter-Wertekasten).", "bestiaryFolder");
    field("Helden-Ordner", "Hier werden Heldennotizen gesucht und neue angelegt.", "heroesFolder");
    field("Helden-Daten-Ordner", "Bereinigte .dsahero.json-Kopien (Datenquelle für Würfe).", "heroDataFolder");
    field("Schlüssel-Zuordnung", "JSON-Datei, in der Heldenschmiede-Schlüssel (Zauber, Waffen ...) Namen zugeordnet werden.", "mappingFile");

    new Setting(containerEl)
      .setName("Kampf-Cockpit: Ansicht")
      .setDesc("Kompakt (Seitenleiste), Detail (Vollbild) oder automatisch nach Breite des Cockpits.")
      .addDropdown((d) => {
        for (const l of LAYOUT_ORDER) d.addOption(l, LAYOUT_LABEL[l]);
        d.setValue(normalizeLayout(this.plugin.settings.cockpitLayout)).onChange(async (v) => {
          this.plugin.settings.cockpitLayout = normalizeLayout(v);
          await this.plugin.persist();
          refreshCockpitLayouts(this.app);
        });
      });

    new Setting(containerEl)
      .setName("Trefferzonen")
      .setDesc("Nach einem ungeparierten Treffer wird die getroffene Körperzone gewürfelt (oder gezielt gewählt); Zonen-RS und Wundeffekte werden berücksichtigt.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.hitZones === true).onChange(async (v) => {
          this.plugin.settings.hitZones = v;
          await this.plugin.persist();
          refreshCockpitLayouts(this.app);
        }),
      );

    new Setting(containerEl)
      .setName("Helden neu laden")
      .setDesc("Liest Daten-Ordner und Zuordnungsdatei erneut ein.")
      .addButton((b) =>
        b.setButtonText("Neu laden").onClick(async () => {
          await this.plugin.heroes.load();
        }),
      );

    containerEl.createEl("h3", { text: "Sitzungsregie" });
    new Setting(containerEl)
      .setName("Automatische Mitschrift")
      .setDesc("Proben, Zauber, Kämpfe, Rasten und Datumswechsel werden mitgeschrieben, solange eine Session läuft. Eigene Einträge und Szenenwechsel bleiben immer erhalten.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.regieAutoLog !== false).onChange(async (v) => {
          this.plugin.settings.regieAutoLog = v;
          await this.plugin.persist();
        }),
      );
    new Setting(containerEl)
      .setName("Offene Geheimnisse aus früheren Sessions")
      .setDesc("So viele frühere Sessions der Kampagne werden nach offenen Geheimnissen durchsucht (0 = nur die aktuelle Session).")
      .addDropdown((d) => {
        for (const n of [0, 1, 3, 5, 10]) d.addOption(String(n), String(n));
        d.setValue(String(this.plugin.settings.regieEarlierSessions ?? 5)).onChange(async (v) => {
          this.plugin.settings.regieEarlierSessions = Number(v) || 0;
          await this.plugin.persist();
        });
      });

    addShareSettings(containerEl, this.plugin);
  }
}
