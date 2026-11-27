import { Plugin } from "obsidian";
import { BestiaryRepository } from "./bestiary/repository";
import { TableBus } from "./bus";
import { CombatStore } from "./combat/store";
import { HeroRepository } from "./hero/repository";
import { importHero } from "./hero/importFlow";
import { registerCalendar } from "./calendar";
import { registerCockpit } from "./cockpit";
import { registerEncounter } from "./encounter";
import { registerGroupProbe } from "./groupprobe";
import { registerMagic } from "./magic";
import { registerProbe } from "./probe";
import { registerRegie } from "./regie";
import { registerShare } from "./share";
import { DEFAULT_SETTINGS, DsaSettingTab, DsaSettings, PluginData, resolveSettings } from "./settings";

export default class DsaMeisterwerkzeugPlugin extends Plugin {
  settings: DsaSettings = { ...DEFAULT_SETTINGS, groupprobe: {} };
  /** what happens at the table (probes, casts ...); see bus.ts */
  readonly table = new TableBus();
  combat!: CombatStore;
  heroes!: HeroRepository;
  bestiary!: BestiaryRepository;

  async onload() {
    const data = ((await this.loadData()) ?? {}) as Partial<PluginData>;
    this.settings = resolveSettings(data.settings);
    if (!this.settings.groupprobe || typeof this.settings.groupprobe !== "object") this.settings.groupprobe = {};

    this.combat = new CombatStore(() => this.persist());
    this.combat.load(data.combat ?? null);
    this.bestiary = new BestiaryRepository(this.app, () => this.settings.bestiaryFolder);
    this.bestiary.register(this);
    this.heroes = new HeroRepository(this.app, {
      dataFolder: () => this.settings.heroDataFolder,
      mappingFile: () => this.settings.mappingFile,
    });

    this.addSettingTab(new DsaSettingTab(this.app, this));
    this.addCommand({
      id: "import-hero-json",
      name: "Held aus JSON importieren",
      callback: () => void importHero(this),
    });
    registerCockpit(this);
    registerProbe(this);
    registerMagic(this);
    registerGroupProbe(this);
    registerEncounter(this);
    registerShare(this);
    registerCalendar(this);
    registerRegie(this);
    this.app.workspace.onLayoutReady(() => void this.heroes.load());
  }

  async onunload() {
    await this.combat?.flush();
  }

  /** Save settings + combat state in one data.json. */
  async persist(): Promise<void> {
    const s = this.combat.state;
    await this.saveData({ settings: this.settings, combat: s } satisfies PluginData);
  }
}
