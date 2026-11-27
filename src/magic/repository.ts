// Obsidian side: rule notes -> SpellDef[], casters from heroes/bestiary, energy write-back, remembered attributes.
import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { AttrKey } from "../engine/types";
import { ATTR_KEYS } from "../engine/types";
import type DsaMeisterwerkzeugPlugin from "../main";
import { folderPath } from "../settingsData";
import { readText, writeText } from "../util";
import { Caster, KEY_ASP_CURRENT, KEY_KAP_CURRENT, casterFromCreature, casterFromHero, energyNumber } from "./casters";
import { RememberedSpell, parseMemoryFile } from "./parse";
import { SpellDef, SpellKind, findSpell, normalizeSpellName, parseSpellNote } from "./spells";

export type { RememberedSpell } from "./parse";

const MEMORY_FILE = "zauber-eigenschaften.json";

export class SpellRepository {
  private spells: SpellDef[] = [];
  private stamp = "";
  /** cached content of the memory file; null = not loaded or broken (then it is re-read next time and never written) */
  private memory: Record<string, RememberedSpell> | null = null;
  private brokenNoticeShown = false;

  constructor(private plugin: DsaMeisterwerkzeugPlugin) {}
  private get app(): App {
    return this.plugin.app;
  }

  private files(): { file: TFile; kind: SpellKind }[] {
    const out: { file: TFile; kind: SpellKind }[] = [];
    const spells = folderPath(this.plugin.settings.spellFolder) + "/";
    const liturgies = folderPath(this.plugin.settings.liturgyFolder) + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(spells)) out.push({ file: f, kind: "zauber" });
      else if (f.path.startsWith(liturgies)) out.push({ file: f, kind: "liturgie" });
    }
    return out;
  }

  /** (Re)load when a rule note changed. */
  async all(): Promise<SpellDef[]> {
    const files = this.files();
    const stamp = files.map((x) => `${x.file.path}:${x.file.stat.mtime}`).join("|");
    if (stamp === this.stamp) return this.spells;
    const out: SpellDef[] = [];
    for (const { file, kind } of files) {
      try {
        const def = parseSpellNote(await this.app.vault.cachedRead(file), file.path, file.basename, kind);
        if (def) out.push(def);
      } catch {
        /* skip unreadable note */
      }
    }
    this.spells = out.sort((a, b) => a.name.localeCompare(b.name, "de"));
    this.stamp = stamp;
    return this.spells;
  }

  async find(name: string, kind?: SpellKind): Promise<SpellDef | null> {
    return findSpell(await this.all(), name, kind);
  }

  // ---- casters
  heroCasters(): Caster[] {
    return this.plugin.heroes.all().map((h) => casterFromHero(h, h.notePath ? (this.app.metadataCache.getCache(h.notePath)?.frontmatter as Record<string, unknown> | undefined) : undefined));
  }
  creatureCaster(path: string): Caster | null {
    const f = this.app.vault.getFileByPath(path);
    if (!f) return null;
    return casterFromCreature(this.plugin.bestiary.frontmatter(f), path, f.basename);
  }
  /** all bestiary creatures with a zauber/liturgien string */
  creatureCasters(): Caster[] {
    const out: Caster[] = [];
    for (const f of this.plugin.bestiary.files()) {
      const fm = this.plugin.bestiary.frontmatter(f);
      if (!fm || (!fm["zauber"] && !fm["liturgien"])) continue;
      out.push(casterFromCreature(fm, f.path, f.basename));
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, "de"));
  }
  findHeroCaster(name: string): Caster | null {
    const n = name.trim().toLowerCase();
    return this.heroCasters().find((c) => c.label.toLowerCase() === n || c.label.toLowerCase().startsWith(n)) ?? null;
  }

  /** Subtract energy from a hero note (AsP_aktuell / KaP_aktuell, fallback: max). Returns the new value or null if not possible. */
  async spend(caster: Caster, energy: "AsP" | "KaP", amount: number): Promise<number | null> {
    if (caster.kind !== "hero" || !caster.notePath) return null;
    const file = this.app.vault.getFileByPath(caster.notePath);
    if (!file) return null;
    const cur = energy === "AsP" ? KEY_ASP_CURRENT : KEY_KAP_CURRENT;
    let result: number | null = null;
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      const have = energyNumber(fm[cur]) ?? energyNumber(fm[energy]);
      if (have === null) return;
      result = Math.max(0, have - amount);
      fm[cur] = result;
    });
    return result;
  }

  // ---- remembered attributes for spells without a rule note (own file: main.persist() would drop extra data.json keys)
  private memoryPath(): string {
    return `${this.plugin.settings.heroDataFolder.replace(/\/+$/, "")}/${MEMORY_FILE}`;
  }
  /**
   * Memory file content. Missing file = empty memory. Unreadable or invalid file = null: it is then never written,
   * and the user is told once (German Notice) so that the remembered spells are not silently lost.
   */
  private async loadMemory(): Promise<Record<string, RememberedSpell> | null> {
    if (this.memory) return this.memory;
    const path = this.memoryPath();
    let parsed: Record<string, RememberedSpell> | null;
    try {
      const text = await readText(this.app, path);
      parsed = text === null ? {} : parseMemoryFile(text);
    } catch {
      parsed = null;
    }
    if (parsed) return (this.memory = parsed);
    if (!this.brokenNoticeShown) {
      this.brokenNoticeShown = true;
      new Notice(`${MEMORY_FILE} ist beschädigt oder nicht lesbar. Die Datei wird nicht überschrieben – bitte im Heldenordner korrigieren oder löschen.`);
    }
    return null;
  }
  async remembered(name: string): Promise<RememberedSpell | null> {
    const memory = await this.loadMemory();
    if (!memory) return null;
    const r = memory[normalizeSpellName(name)];
    return r && Array.isArray(r.probe) && r.probe.length === 3 && r.probe.every((k) => ATTR_KEYS.includes(k)) ? r : null;
  }
  async remember(name: string, value: RememberedSpell): Promise<void> {
    const memory = await this.loadMemory();
    if (!memory) return;
    memory[normalizeSpellName(name)] = value;
    try {
      await writeText(this.app, this.memoryPath(), JSON.stringify(memory, null, 2));
    } catch {
      /* not critical */
    }
  }
}

const repos = new WeakMap<object, SpellRepository>();
/** One repository per plugin instance (main.ts has no field for it, so it lives here). */
export function magicRepo(plugin: DsaMeisterwerkzeugPlugin): SpellRepository {
  let r = repos.get(plugin);
  if (!r) repos.set(plugin, (r = new SpellRepository(plugin)));
  return r;
}
