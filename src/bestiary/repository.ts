import { App, TAbstractFile, TFile, parseYaml } from "obsidian";
import type { Plugin } from "obsidian";
import type { Combatant } from "../model";
import { BestiaryParseResult, parseCreature } from "./adapter";
import { NPC_TYPES, extractStatblockYaml, hasCombatStats, normalizeStatblock } from "./statblock";

/**
 * Reads creature notes from the bestiary folder through Obsidian's metadata cache,
 * plus NSC notes (typ: nsc / fraktion) anywhere in the vault that carry a ```statblock block with combat values.
 */
export class BestiaryRepository {
  /** NSC note path -> normalized statblock (only notes with combat values) */
  private npcs = new Map<string, Record<string, unknown>>();

  constructor(private app: App, private getFolder: () => string) {}

  private folder(): string {
    return this.getFolder().replace(/\/+$/, "");
  }

  private inBestiary(path: string): boolean {
    return path.startsWith(this.folder() + "/");
  }

  /** Keeps the NSC cache current. Call once from onload. */
  register(plugin: Plugin): void {
    plugin.registerEvent(this.app.metadataCache.on("changed", (file, data) => this.updateNpc(file, data)));
    plugin.registerEvent(this.app.vault.on("delete", (f: TAbstractFile) => void this.npcs.delete(f.path)));
    plugin.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, old: string) => {
        const v = this.npcs.get(old);
        this.npcs.delete(old);
        if (v && f instanceof TFile) this.npcs.set(f.path, v);
      }),
    );
    this.app.workspace.onLayoutReady(() => void this.loadNpcs());
  }

  private isNpcCandidate(file: TFile): boolean {
    if (this.inBestiary(file.path) || file.path.startsWith("Templates/")) return false;
    const typ = this.app.metadataCache.getFileCache(file)?.frontmatter?.typ;
    return typeof typ === "string" && NPC_TYPES.has(typ.trim().toLowerCase());
  }

  private updateNpc(file: TFile, text: string): void {
    if (file.extension !== "md") return;
    if (!this.isNpcCandidate(file)) return void this.npcs.delete(file.path);
    const yaml = extractStatblockYaml(text);
    let sb: Record<string, unknown> | null = null;
    if (yaml !== null) {
      try {
        sb = normalizeStatblock(parseYaml(yaml));
      } catch {
        sb = null;
      }
    }
    if (hasCombatStats(sb)) this.npcs.set(file.path, sb!);
    else this.npcs.delete(file.path);
  }

  async loadNpcs(): Promise<void> {
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!this.isNpcCandidate(f)) continue;
      try {
        this.updateNpc(f, await this.app.vault.cachedRead(f));
      } catch {
        /* unreadable note: skip */
      }
    }
  }

  isNpc(path: string): boolean {
    return this.npcs.has(path);
  }

  /** Bestiary notes + NSC notes with a statblock. */
  files(): TFile[] {
    const out = this.app.vault.getMarkdownFiles().filter((f) => this.inBestiary(f.path));
    for (const p of this.npcs.keys()) {
      const f = this.app.vault.getFileByPath(p);
      if (f) out.push(f);
    }
    return out;
  }

  /**
   * The values the adapter reads: the frontmatter for bestiary notes; for NSC notes the statblock,
   * with tags from the frontmatter and typus "NSC" (so the builder offers it as a filter).
   */
  frontmatter(file: TFile): Record<string, unknown> | undefined {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const sb = this.npcs.get(file.path);
    if (!sb) return fm;
    return { ...sb, typus: typeof sb.typus === "string" ? sb.typus : "NSC", tags: fm?.tags ?? sb.tags };
  }

  frontmatterByPath(path: string): Record<string, unknown> | undefined {
    const f = this.app.vault.getFileByPath(path);
    return f ? this.frontmatter(f) : undefined;
  }

  parseFile(file: TFile): BestiaryParseResult {
    const fm = this.frontmatter(file);
    // the NSC statblock name often carries an alias ("Brodo Hagen (Brodo der Schlächter)"); show the note name
    const r = parseCreature(fm, file.path, file.basename);
    if (this.npcs.has(file.path)) r.combatant.name = file.basename;
    return r;
  }

  /** All creatures that have at least a partial statblock. */
  all(): BestiaryParseResult[] {
    return this.files().map((f) => this.parseFile(f));
  }

  getByPath(path: string): BestiaryParseResult | null {
    const f = this.app.vault.getFileByPath(path);
    return f ? this.parseFile(f) : null;
  }

  /** Case-insensitive name search (basename or statblock name). */
  search(query: string, limit = 25): Combatant[] {
    const q = query.trim().toLowerCase();
    return this.all()
      .filter((r) => r.status !== "nostats" && r.combatant.name.toLowerCase().includes(q))
      .slice(0, limit)
      .map((r) => r.combatant);
  }
}
