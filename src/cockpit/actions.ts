// Flows that add combatants to the CombatStore (bestiary search, drag & drop, heroes, encounter blocks).
import { Notice, TFile } from "obsidian";
import { Hero, heroToCombatant } from "../hero/model";
import type { Combatant } from "../model";
import type DsaMeisterwerkzeugPlugin from "../main";
import { HeroChoice, ManualHeroInput, pickHeroes, promptCount, promptManualHero, promptStats, suggestCreature } from "./dialogs";
import { manualCombatant, matchCreatureName, needsStatsPrompt, parseDragPayload, parseEncounterBlocks } from "./logic";

/** Hero -> Combatant; starts with LeP_aktuell from the hero note (written by Rast) if present, else full LeP. */
export function heroCombatant(plugin: DsaMeisterwerkzeugPlugin, hero: Hero): Combatant {
  const c = heroToCombatant(hero);
  if (hero.notePath) {
    const f = plugin.app.vault.getFileByPath(hero.notePath);
    const raw = f ? plugin.app.metadataCache.getFileCache(f)?.frontmatter?.["LeP_aktuell"] : undefined;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw) ? Number(raw) : null;
    if (n !== null && Number.isFinite(n)) c.lepCurrent = n;
  }
  return c;
}

/** Add `count` copies of a creature; asks for LeP/INI first when the statblock lacks them. Returns number added. */
export async function addCreature(plugin: DsaMeisterwerkzeugPlugin, c: Combatant, count: number, hp?: number): Promise<number> {
  let opts: { lepMax?: number; iniBase?: number } = {};
  if (hp !== undefined) opts.lepMax = hp;
  const probe: Combatant = {
    ...c,
    lepMax: opts.lepMax ?? c.lepMax,
    needsManual: c.needsManual.filter((f) => !(f === "lep" && opts.lepMax !== undefined)),
  };
  if (needsStatsPrompt(probe)) {
    const st = await promptStats(plugin.app, probe);
    if (!st) return 0;
    opts = { ...opts, ...st };
  }
  for (let i = 0; i < count; i++) plugin.combat.addCombatant(c, opts);
  return count;
}

export async function addEnemyFlow(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const c = await suggestCreature(plugin.app, (q) => plugin.bestiary.search(q, 50));
  if (!c) return;
  const n = await promptCount(plugin.app, c.name);
  if (n === null) return;
  const added = await addCreature(plugin, c, n);
  if (added) new Notice(`${added}× ${c.name} hinzugefügt.`);
}

export const campaignOf = (plugin: DsaMeisterwerkzeugPlugin, notePath?: string): string => {
  if (!notePath) return "";
  const f = plugin.app.vault.getFileByPath(notePath);
  const raw = f ? plugin.app.metadataCache.getFileCache(f)?.frontmatter?.kampagne : null;
  const s = Array.isArray(raw) ? String(raw[0] ?? "") : typeof raw === "string" ? raw : "";
  return s.replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
};

export async function addHeroesFlow(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const inCombat = new Set(plugin.combat.entries.filter((e) => e.kind === "hero").map((e) => e.name));
  const heroes = plugin.heroes.all();
  const choices: HeroChoice[] = heroes.map((h) => ({
    id: h.uid,
    label: h.name,
    campaign: campaignOf(plugin, h.notePath),
    disabledHint: inCombat.has(h.name) ? "bereits im Kampf" : undefined,
  }));
  const res = await pickHeroes(plugin.app, choices);
  if (!res) return;
  if (res.manual) return void (await addManualHero(plugin));
  let n = 0;
  for (const id of res.ids) {
    const h = plugin.heroes.getByUid(id);
    if (!h) continue;
    plugin.combat.addCombatant(heroCombatant(plugin, h));
    n++;
  }
  if (n) new Notice(`${n} Held(en) hinzugefügt.`);
}

export async function addManualHero(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const h: ManualHeroInput | null = await promptManualHero(plugin.app);
  if (!h) return;
  plugin.combat.addCombatant(manualCombatant(h.name, h.lepMax, h.iniBase, h.rs, h.vw));
}

/** Resolve a vault path / link text (from a drag) to a TFile. */
export function resolveFile(plugin: DsaMeisterwerkzeugPlugin, pathOrLink: string): TFile | null {
  const app = plugin.app;
  const cands = [pathOrLink, pathOrLink.endsWith(".md") ? pathOrLink : pathOrLink + ".md"];
  for (const c of cands) {
    const f = app.vault.getFileByPath(c);
    if (f) return f;
  }
  return app.metadataCache.getFirstLinkpathDest(pathOrLink.replace(/\.md$/, ""), "") ?? null;
}

/** Drop of an explorer item: bestiary note -> creature (asks for count), hero note -> hero. Fails soft with a Notice. */
export async function addFromFile(plugin: DsaMeisterwerkzeugPlugin, file: TFile): Promise<void> {
  const hero = plugin.heroes.getByPath(file.path);
  if (hero) {
    plugin.combat.addCombatant(heroCombatant(plugin, hero));
    new Notice(`${hero.name} hinzugefügt.`);
    return;
  }
  const r = plugin.bestiary.parseFile(file);
  if (r.status === "nostats") return void new Notice(`„${file.basename}“ hat keinen Wertekasten (kein Bestiarium-Eintrag bzw. kein statblock in der NSC-Notiz?).`);
  const n = await promptCount(plugin.app, r.combatant.name);
  if (n === null) return;
  const added = await addCreature(plugin, r.combatant, n);
  if (added) new Notice(`${added}× ${r.combatant.name} hinzugefügt.`);
}

/** Extract candidate files from a DragEvent; never throws. */
export function filesFromDrop(plugin: DsaMeisterwerkzeugPlugin, e: DragEvent): TFile[] {
  const out = new Map<string, TFile>();
  try {
    // Obsidian's internal drag manager (not an official API)
    const dm = (plugin.app as unknown as { dragManager?: { draggable?: { file?: TFile; files?: TFile[] } } }).dragManager;
    const d = dm?.draggable;
    for (const f of [d?.file, ...(d?.files ?? [])]) if (f && typeof f.path === "string") out.set(f.path, f);
  } catch {
    /* ignore */
  }
  try {
    for (const type of ["text/plain", "text/uri-list"]) {
      const p = parseDragPayload(e.dataTransfer?.getData(type));
      if (!p) continue;
      const f = resolveFile(plugin, p);
      if (f) out.set(f.path, f);
    }
  } catch {
    /* ignore */
  }
  return [...out.values()];
}

export async function loadFromNoteFlow(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) return void new Notice("Keine aktive Notiz.");
  const text = await plugin.app.vault.cachedRead(file);
  const list = parseEncounterBlocks(text);
  if (!list.length) return void new Notice("Keine encounter-Blöcke mit Kreaturen in dieser Notiz.");
  const known = plugin.bestiary.all().filter((r) => r.status !== "nostats").map((r) => r.combatant);
  let total = 0;
  const missing: string[] = [];
  for (const item of list) {
    const c = matchCreatureName(item.name, known);
    if (c) total += await addCreature(plugin, c, item.amount, item.hp);
    else {
      missing.push(item.name);
      // not in the bestiary: add as a plain creature with the stats from the block (INI is asked)
      const stub: Combatant = { name: item.name, kind: "creature", sourcePath: "", lepMax: item.hp ?? null, iniBase: null, rs: 0, vw: null, weapons: [], needsManual: [] };
      total += await addCreature(plugin, stub, item.amount);
    }
  }
  new Notice(`${total} Kämpfer aus „${file.basename}“ geladen.` + (missing.length ? ` Nicht im Bestiarium: ${missing.join(", ")}.` : ""));
}
