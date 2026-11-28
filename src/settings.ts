import { App, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "./main";
import { shareSettingsSection } from "./share/settings";
import { LAYOUT_LABEL, LAYOUT_ORDER, normalizeLayout, refreshCockpitLayouts } from "./cockpit/layout";
import { DEFAULT_SETTINGS, normalizeSettingPath } from "./settingsData";
import { VAULT_DOC_URL } from "./docLink";

export { DEFAULT_SETTINGS, folderPath, resolveSettings } from "./settingsData";
export type { DsaSettings, PluginData } from "./settingsData";

/** Delay after the last keystroke before a folder field is saved and its data rescanned. */
const PATH_SAVE_DELAY_MS = 600;

/** One settings row. `desc` is a factory because a DocumentFragment can only be inserted once. */
export interface SettingRow {
  name: string;
  desc: () => string | DocumentFragment;
  /** Adds the controls to the row; rows without it are plain text. */
  render?: (setting: Setting) => void;
}

/** Rows under a shared heading (no heading = rows at the top of the tab). */
export interface SettingSection {
  heading?: string;
  rows: SettingRow[];
}

const text = (s: string) => () => s;

export class DsaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DsaMeisterwerkzeugPlugin) {
    super(app, plugin);
  }

  /** Obsidian 1.13+: renders the tab from these definitions and indexes them for the settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((section) => ({
      type: "group",
      heading: section.heading,
      items: section.rows.map((row) => {
        const render = row.render;
        return render
          ? { name: row.name, desc: row.desc(), render: (setting: Setting) => render(setting) }
          : { name: row.name, desc: row.desc() };
      }),
    }));
  }

  /** Fallback for Obsidian < 1.13, which does not call getSettingDefinitions(). */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const section of this.sections()) {
      if (section.heading) new Setting(containerEl).setName(section.heading).setHeading();
      for (const row of section.rows) {
        const setting = new Setting(containerEl).setName(row.name).setDesc(row.desc());
        row.render?.(setting);
      }
    }
  }

  private sections(): SettingSection[] {
    const plugin = this.plugin;

    type PathKey = "bestiaryFolder" | "heroesFolder" | "heroDataFolder" | "mappingFile" | "heroTemplate" | "spellFolder" | "liturgyFolder" | "campaignsFolder";
    const HERO_KEYS: PathKey[] = ["heroesFolder", "heroDataFolder", "mappingFile"];
    const pathRow = (name: string, desc: string, key: PathKey): SettingRow => ({
      name,
      desc: text(desc),
      render: (setting) => {
        let timer: number | undefined;
        // Normalizes the typed path, saves it and rescans the data it affects.
        const commit = async (raw: string) => {
          const cleaned = normalizeSettingPath(raw, DEFAULT_SETTINGS[key]);
          plugin.settings[key] = cleaned ? normalizePath(cleaned) : cleaned;
          await plugin.persist();
          if (key === "bestiaryFolder") await plugin.bestiary.reload();
          if (HERO_KEYS.includes(key)) await plugin.heroes.load();
        };
        setting.addText((t) =>
          t
            .setPlaceholder(DEFAULT_SETTINGS[key] || "z. B. Vorlagen/Held.md")
            .setValue(plugin.settings[key])
            .onChange((v) => {
              window.clearTimeout(timer);
              timer = window.setTimeout(() => void commit(v), PATH_SAVE_DELAY_MS);
            }),
        );
      },
    });

    const guide = (): DocumentFragment => {
      const frag = createFragment();
      frag.appendText("Pfade sind relativ zum Vault-Ordner. Welche Frontmatter-Felder das Plugin liest, steht in der ");
      frag.createEl("a", { text: "Anleitung (docs/VAULT.md)", href: VAULT_DOC_URL });
      frag.appendText(".");
      return frag;
    };

    return [
      { rows: [{ name: "Vault-Aufbau", desc: guide }] },
      {
        heading: "Ordner",
        rows: [
          pathRow("Bestiarium-Ordner", "Ordner mit den Kreaturen-Notizen (Frontmatter-Wertekasten).", "bestiaryFolder"),
          pathRow("Kampagnen-Ordner", "Ein Unterordner pro Kampagne. Der Kalender folgt der Kampagne der geöffneten Notiz.", "campaignsFolder"),
          pathRow("Zauber-Ordner", "Regelnotizen der Zauber (eine Notiz pro Zauber).", "spellFolder"),
          pathRow("Liturgie-Ordner", "Regelnotizen der Liturgien (eine Notiz pro Liturgie).", "liturgyFolder"),
        ],
      },
      {
        heading: "Helden",
        rows: [
          pathRow("Helden-Ordner", "Hier werden Heldennotizen gesucht und neue angelegt.", "heroesFolder"),
          pathRow("Helden-Daten-Ordner", "Bereinigte .dsahero.json-Kopien (Datenquelle für Würfe).", "heroDataFolder"),
          pathRow("Schlüssel-Zuordnung", "JSON-Datei, in der Heldenschmiede-Schlüssel (Zauber, Waffen ...) Namen zugeordnet werden.", "mappingFile"),
          pathRow("Vorlage für neue Helden", "Optionale Notiz als Vorlage (Platzhalter <% k.titel %> und <% k.kampagne %>). Leer = eingebaute Vorlage.", "heroTemplate"),
          {
            name: "Helden neu laden",
            desc: text("Liest Daten-Ordner und Zuordnungsdatei erneut ein."),
            render: (setting) => {
              setting.addButton((b) => {
                b.setButtonText("Neu laden").onClick(() => void plugin.heroes.load());
              });
            },
          },
        ],
      },
      {
        heading: "Kampf",
        rows: [
          {
            name: "Kampf-Cockpit: Ansicht",
            desc: text("Kompakt (Seitenleiste), Detail (Vollbild) oder automatisch nach Breite des Cockpits."),
            render: (setting) => {
              setting.addDropdown((d) => {
                for (const l of LAYOUT_ORDER) d.addOption(l, LAYOUT_LABEL[l]);
                d.setValue(normalizeLayout(plugin.settings.cockpitLayout)).onChange((v) => {
                  plugin.settings.cockpitLayout = normalizeLayout(v);
                  void plugin.persist().then(() => refreshCockpitLayouts(this.app));
                });
              });
            },
          },
          {
            name: "Trefferzonen",
            desc: text("Nach einem ungeparierten Treffer wird die getroffene Körperzone gewürfelt (oder gezielt gewählt); Zonen-RS und Wundeffekte werden berücksichtigt."),
            render: (setting) => {
              setting.addToggle((t) => {
                t.setValue(plugin.settings.hitZones === true).onChange((v) => {
                  plugin.settings.hitZones = v;
                  void plugin.persist().then(() => refreshCockpitLayouts(this.app));
                });
              });
            },
          },
        ],
      },
      {
        heading: "Sitzungsregie",
        rows: [
          {
            name: "Automatische Mitschrift",
            desc: text("Proben, Zauber, Kämpfe, Rasten und Datumswechsel werden mitgeschrieben, solange eine Session läuft. Eigene Einträge und Szenenwechsel bleiben immer erhalten."),
            render: (setting) => {
              setting.addToggle((t) => {
                t.setValue(plugin.settings.regieAutoLog !== false).onChange((v) => {
                  plugin.settings.regieAutoLog = v;
                  void plugin.persist();
                });
              });
            },
          },
          {
            name: "Offene Geheimnisse aus früheren Sessions",
            desc: text("So viele frühere Sessions der Kampagne werden nach offenen Geheimnissen durchsucht (0 = nur die aktuelle Session)."),
            render: (setting) => {
              setting.addDropdown((d) => {
                for (const n of [0, 1, 3, 5, 10]) d.addOption(String(n), String(n));
                d.setValue(String(plugin.settings.regieEarlierSessions ?? 5)).onChange((v) => {
                  plugin.settings.regieEarlierSessions = Number(v) || 0;
                  void plugin.persist();
                });
              });
            },
          },
        ],
      },
      shareSettingsSection(plugin),
    ];
  }
}
