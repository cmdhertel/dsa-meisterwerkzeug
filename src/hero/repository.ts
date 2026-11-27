import type { App } from "obsidian";
import { readText } from "../util";
import { HeroMapping, emptyMapping, parseMapping } from "./mapping";
import { Hero, HeroJson, parseHero, talentValue, validateHeroJson } from "./model";

export interface HeroRepoConfig {
  dataFolder: () => string;
  mappingFile: () => string;
}

/** Loads the cleaned hero JSONs from the data folder. Never throws; per-file problems end up in `errors`. */
export class HeroRepository {
  private heroes: Hero[] = [];
  private map: HeroMapping = emptyMapping();
  /** null = mapping file exists but is not valid JSON (do not overwrite it) */
  mappingValid = true;
  errors: { path: string; message: string }[] = [];

  constructor(private app: App, private cfg: HeroRepoConfig) {}

  get mapping(): HeroMapping {
    return this.map;
  }

  async load(): Promise<void> {
    this.errors = [];
    const mtext = await readText(this.app, this.cfg.mappingFile());
    if (mtext === null) {
      this.map = emptyMapping();
      this.mappingValid = true;
    } else {
      const parsed = parseMapping(mtext);
      this.mappingValid = parsed !== null;
      this.map = parsed ?? emptyMapping();
      if (!parsed) this.errors.push({ path: this.cfg.mappingFile(), message: "Zuordnungsdatei ist kein gültiges JSON." });
    }

    const out: Hero[] = [];
    const folder = this.cfg.dataFolder().replace(/\/+$/, "");
    try {
      if (await this.app.vault.adapter.exists(folder)) {
        const listing = await this.app.vault.adapter.list(folder);
        for (const path of listing.files.filter((f) => f.endsWith(".dsahero.json"))) {
          try {
            const json = JSON.parse((await this.app.vault.adapter.read(path)) as string) as HeroJson;
            const problem = validateHeroJson(json);
            if (problem) {
              this.errors.push({ path, message: problem });
              continue;
            }
            const hero = parseHero(json, this.map);
            hero.dataPath = path;
            hero.notePath = this.findNote(hero.uid, hero.name);
            out.push(hero);
          } catch (e) {
            this.errors.push({ path, message: String(e instanceof Error ? e.message : e) });
          }
        }
      }
    } catch (e) {
      this.errors.push({ path: folder, message: String(e instanceof Error ? e.message : e) });
    }
    this.heroes = out.sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  /** Find the hero note by heldenschmiede_uid (metadata cache). */
  findNote(uid: string, _name?: string): string | undefined {
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm && fm.heldenschmiede_uid === uid) return f.path;
    }
    return undefined;
  }

  all(): readonly Hero[] {
    return this.heroes;
  }
  getByName(name: string): Hero | undefined {
    const n = name.trim().toLowerCase();
    return this.heroes.find((h) => h.name.toLowerCase() === n || h.callName.toLowerCase() === n);
  }
  getByPath(notePath: string): Hero | undefined {
    return this.heroes.find((h) => h.notePath === notePath);
  }
  getByUid(uid: string): Hero | undefined {
    return this.heroes.find((h) => h.uid === uid);
  }
  talentValue(hero: Hero, talent: string): number {
    return talentValue(hero, talent);
  }
}
