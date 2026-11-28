import type DsaMeisterwerkzeugPlugin from "../main";
import type { SettingSection } from "../settings";
import { refreshPlayerViews } from "./render";
import type { EnemyLepMode, ShareStyle } from "./viewModel";

/** "Spielerbildschirm" section of the settings tab. */
export function shareSettingsSection(plugin: DsaMeisterwerkzeugPlugin): SettingSection {
  const save = () => {
    void plugin.persist().then(refreshPlayerViews);
  };
  return {
    heading: "Spielerbildschirm",
    rows: [
      {
        name: "Stil",
        desc: () => "Darstellung auf dem Spielerbildschirm. Pro Block überschreibbar mit der Zeile „stil: aventurisch“ oder „stil: schlicht“.",
        render: (setting) => {
          setting.addDropdown((d) => {
            d
              .addOptions({ schlicht: "Schlicht", aventurisch: "Aventurisch (Pergament)" })
              .setValue(plugin.settings.shareStyle)
              .onChange((v) => {
                plugin.settings.shareStyle = v as ShareStyle;
                save();
              });
          });
        },
      },
      {
        name: "Gegner-LeP auf dem Spielerbildschirm",
        desc: () => "Wie viel die Spieler über die Lebensenergie der Gegner erfahren. Helden zeigen immer ihre Zahlen.",
        render: (setting) => {
          setting.addDropdown((d) => {
            d
              .addOptions({ wort: "Zustandswort (unverletzt … am Boden)", balken: "Balken ohne Zahlen", exakt: "exakte Zahlen", aus: "gar nicht" })
              .setValue(plugin.settings.shareEnemyLep)
              .onChange((v) => {
                plugin.settings.shareEnemyLep = v as EnemyLepMode;
                save();
              });
          });
        },
      },
      {
        name: "Gegnernamen zeigen",
        desc: () => "Aus: die Gegner heißen „Gegner 1“, „Gegner 2“ ...",
        render: (setting) => {
          setting.addToggle((t) => {
            t.setValue(plugin.settings.shareEnemyNames).onChange((v) => {
              plugin.settings.shareEnemyNames = v;
              save();
            });
          });
        },
      },
      {
        name: "INI-Werte zeigen",
        desc: () => "Initiative-Zahlen der Gegner anzeigen (die der Helden sind immer sichtbar).",
        render: (setting) => {
          setting.addToggle((t) => {
            t.setValue(plugin.settings.shareEnemyIni).onChange((v) => {
              plugin.settings.shareEnemyIni = v;
              save();
            });
          });
        },
      },
    ],
  };
}
