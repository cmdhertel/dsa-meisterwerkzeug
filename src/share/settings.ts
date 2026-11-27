import { Setting } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { refreshPlayerViews } from "./render";
import type { EnemyLepMode, ShareStyle } from "./viewModel";

/** "Spielerbildschirm" section of the settings tab. */
export function addShareSettings(containerEl: HTMLElement, plugin: DsaMeisterwerkzeugPlugin): void {
  const save = async () => {
    await plugin.persist();
    refreshPlayerViews();
  };
  new Setting(containerEl).setName("Spielerbildschirm").setHeading();
  new Setting(containerEl)
    .setName("Stil")
    .setDesc("Darstellung auf dem Spielerbildschirm. Pro Block überschreibbar mit der Zeile „stil: aventurisch“ oder „stil: schlicht“.")
    .addDropdown((d) =>
      d
        .addOptions({ schlicht: "Schlicht", aventurisch: "Aventurisch (Pergament)" })
        .setValue(plugin.settings.shareStyle)
        .onChange(async (v) => {
          plugin.settings.shareStyle = v as ShareStyle;
          await save();
        }),
    );
  new Setting(containerEl)
    .setName("Gegner-LeP auf dem Spielerbildschirm")
    .setDesc("Wie viel die Spieler über die Lebensenergie der Gegner erfahren. Helden zeigen immer ihre Zahlen.")
    .addDropdown((d) =>
      d
        .addOptions({ wort: "Zustandswort (unverletzt … am Boden)", balken: "Balken ohne Zahlen", exakt: "exakte Zahlen", aus: "gar nicht" })
        .setValue(plugin.settings.shareEnemyLep)
        .onChange(async (v) => {
          plugin.settings.shareEnemyLep = v as EnemyLepMode;
          await save();
        }),
    );
  new Setting(containerEl)
    .setName("Gegnernamen zeigen")
    .setDesc("Aus: die Gegner heißen „Gegner 1“, „Gegner 2“ ...")
    .addToggle((t) =>
      t.setValue(plugin.settings.shareEnemyNames).onChange(async (v) => {
        plugin.settings.shareEnemyNames = v;
        await save();
      }),
    );
  new Setting(containerEl)
    .setName("INI-Werte zeigen")
    .setDesc("Initiative-Zahlen der Gegner anzeigen (die der Helden sind immer sichtbar).")
    .addToggle((t) =>
      t.setValue(plugin.settings.shareEnemyIni).onChange(async (v) => {
        plugin.settings.shareEnemyIni = v;
        await save();
      }),
    );
}
