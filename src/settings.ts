import { App, PluginSettingTab, Setting } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "./main";
import { addShareSettings } from "./share/settings";
import { LAYOUT_LABEL, LAYOUT_ORDER, normalizeLayout, refreshCockpitLayouts } from "./cockpit/layout";
import { DEFAULT_SETTINGS } from "./settingsData";

export { DEFAULT_SETTINGS, folderPath, resolveSettings } from "./settingsData";
export type { DsaSettings, PluginData } from "./settingsData";

export class DsaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: DsaMeisterwerkzeugPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "DSA Meisterwerkzeug" });

    type PathKey = "bestiaryFolder" | "heroesFolder" | "heroDataFolder" | "mappingFile" | "heroTemplate" | "spellFolder" | "liturgyFolder" | "campaignsFolder";
    const field = (name: string, desc: string, key: PathKey) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) =>
          t
            .setPlaceholder(DEFAULT_SETTINGS[key] || "z. B. Vorlagen/Held.md")
            .setValue(this.plugin.settings[key])
            .onChange(async (v) => {
              this.plugin.settings[key] = v.trim() || DEFAULT_SETTINGS[key];
              await this.plugin.persist();
            }),
        );

    containerEl.createEl("p", {
      text: "Pfade sind relativ zum Vault-Ordner. Welche Frontmatter-Felder das Plugin liest, steht in der Anleitung (docs/VAULT.md im Repository).",
      cls: "setting-item-description",
    });

    containerEl.createEl("h3", { text: "Ordner" });
    field("Bestiarium-Ordner", "Ordner mit den Kreaturen-Notizen (Frontmatter-Wertekasten).", "bestiaryFolder");
    field("Kampagnen-Ordner", "Ein Unterordner pro Kampagne. Der Kalender folgt der Kampagne der geöffneten Notiz.", "campaignsFolder");
    field("Zauber-Ordner", "Regelnotizen der Zauber (eine Notiz pro Zauber).", "spellFolder");
    field("Liturgie-Ordner", "Regelnotizen der Liturgien (eine Notiz pro Liturgie).", "liturgyFolder");

    containerEl.createEl("h3", { text: "Helden" });
    field("Helden-Ordner", "Hier werden Heldennotizen gesucht und neue angelegt.", "heroesFolder");
    field("Helden-Daten-Ordner", "Bereinigte .dsahero.json-Kopien (Datenquelle für Würfe).", "heroDataFolder");
    field("Schlüssel-Zuordnung", "JSON-Datei, in der Heldenschmiede-Schlüssel (Zauber, Waffen ...) Namen zugeordnet werden.", "mappingFile");
    field("Vorlage für neue Helden", "Optionale Notiz als Vorlage (Platzhalter <% k.titel %> und <% k.kampagne %>). Leer = eingebaute Vorlage.", "heroTemplate");

    containerEl.createEl("h3", { text: "Kampf" });
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
