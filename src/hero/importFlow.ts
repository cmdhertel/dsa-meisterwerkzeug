import { Notice, TFile } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { ensureFolder, readText, safeFileName, writeText } from "../util";
import { applyBlock, renderSpielwerte } from "./block";
import { cleanHeroJson } from "./clean";
import { diffFrontmatter, diffHeroes, frontmatterValues } from "./diff";
import { addStubs, collectKeys, parseMapping, serializeMapping } from "./mapping";
import { Hero, HeroJson, parseHero, validateHeroJson } from "./model";
import { ExistingHeroNote, assignmentWarnings, chooseDataFileName, findCandidates } from "./assign";
import { NEW_HERO, pick, previewModal, promptText, targetModal } from "./modals";

/** Walk the vault via the adapter (fallback if the file index does not know .json files). */
async function walkJson(plugin: DsaMeisterwerkzeugPlugin, root = ""): Promise<string[]> {
  const out: string[] = [];
  const ad = plugin.app.vault.adapter;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let l;
    try {
      l = await ad.list(dir);
    } catch {
      continue;
    }
    for (const f of l.files) if (f.endsWith(".dsahero.json")) out.push(f);
    for (const d of l.folders) if (!d.split("/").pop()?.startsWith(".")) stack.push(d);
  }
  return out;
}

async function listCandidates(plugin: DsaMeisterwerkzeugPlugin): Promise<string[]> {
  const dataFolder = plugin.settings.heroDataFolder.replace(/\/+$/, "") + "/";
  const viaVault = plugin.app.vault.getFiles().filter((f) => f.name.endsWith(".dsahero.json")).map((f) => f.path);
  const all = viaVault.length ? viaVault : await walkJson(plugin);
  return all.filter((p) => !p.startsWith(dataFolder));
}

/** Template SC.md without the Templater block; placeholders replaced. */
function renderTemplate(tpl: string, kampagne: string, titel: string): string {
  return tpl
    .replace(/<%\*[\s\S]*?-?%>\s*/m, "")
    .replace(/<%\s*k\.kampagne\s*%>/g, kampagne)
    .replace(/<%\s*k\.titel\s*%>/g, titel);
}

/** Built-in note template for new heroes (used when no template note is configured). */
export const BUILTIN_HERO_TEMPLATE = `---
typ: sc
kampagne: <% k.kampagne %>
spieler:
---

# <% k.titel %>
`;

/** Configured template note, or the built-in one (with a notice if the configured note is missing). */
async function heroTemplate(plugin: DsaMeisterwerkzeugPlugin): Promise<string> {
  const path = plugin.settings.heroTemplate.trim();
  if (!path) return BUILTIN_HERO_TEMPLATE;
  const file = plugin.app.vault.getFileByPath(path) ?? plugin.app.vault.getFileByPath(path + ".md");
  if (file) return plugin.app.vault.read(file);
  new Notice(`Vorlage „${path}“ nicht gefunden, eingebaute Vorlage wird verwendet.`);
  return BUILTIN_HERO_TEMPLATE;
}

export async function importHero(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const app = plugin.app;
  const s = plugin.settings;

  const candidates = await listCandidates(plugin);
  if (!candidates.length) {
    new Notice("Keine .dsahero.json-Datei im Vault gefunden.");
    return;
  }
  const src = await pick(app, candidates, (p) => p, "Heldenschmiede-JSON wählen ...");
  if (!src) return;

  let json: HeroJson;
  try {
    json = JSON.parse(await app.vault.adapter.read(src)) as HeroJson;
  } catch (e) {
    new Notice(`Datei ist kein gültiges JSON: ${String(e)}`);
    return;
  }
  const problem = validateHeroJson(json);
  if (problem) {
    new Notice(`Import abgebrochen: ${problem}`);
    return;
  }

  // mapping (never overwrite an unparsable one)
  let mappingText: string | null;
  try {
    mappingText = await readText(app, s.mappingFile);
  } catch (e) {
    new Notice(`Zuordnungsdatei „${s.mappingFile}“ kann nicht gelesen werden. Import abgebrochen: ${String(e)}`);
    return;
  }
  let mapping = mappingText === null ? parseMapping("{}") : parseMapping(mappingText);
  const mappingBroken = mapping === null;
  if (!mapping) mapping = parseMapping("{}")!;

  const cleaned = cleanHeroJson(json) as HeroJson;
  const hero: Hero = parseHero(cleaned, mapping);
  const character = (cleaned.character ?? {}) as Record<string, unknown>;
  const stubbed = addStubs(mapping, collectKeys(character));

  // choose target note: automatic match is preselected, every other hero note can be picked
  const notes: ExistingHeroNote[] = app.vault
    .getMarkdownFiles()
    .map((f) => ({ f, fm: app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined }))
    .filter((x) => String(x.fm?.typ ?? "").toLowerCase() === "sc")
    .map((x) => ({ path: x.f.path, basename: x.f.basename, uid: typeof x.fm?.heldenschmiede_uid === "string" ? (x.fm.heldenschmiede_uid as string) : undefined }));
  const cands = findCandidates(hero, notes);
  const chosen = await targetModal(app, hero.name, cands.map((c) => ({ label: c.label, path: c.note.path, auto: c.auto })));
  if (chosen === null) return;
  let file: TFile | null = null;
  let target: ExistingHeroNote | null = null;
  let isNew = false;
  if (chosen !== NEW_HERO) {
    file = app.vault.getFileByPath(chosen);
    target = notes.find((n) => n.path === chosen) ?? null;
    if (!file || !target) {
      new Notice("Notiz nicht gefunden.");
      return;
    }
  }

  let newContent = "";
  if (!file) {
    isNew = true;
    const kamps = app.vault
      .getMarkdownFiles()
      .filter((f) => String(app.metadataCache.getFileCache(f)?.frontmatter?.typ ?? "").trim().toLowerCase() === "kampagne");
    // campaign is optional: without any `typ: kampagne` note the hero is created without one
    let kampagne = '""';
    if (kamps.length) {
      const kamp = await pick(app, kamps, (f) => f.basename, "Kampagne wählen ...");
      if (!kamp) return;
      kampagne = `"[[${kamp.basename}]]"`;
    }
    const spieler = await promptText(app, "Spieler", "Name des Spielers / der Spielerin", "");
    if (spieler === null) return;
    newContent = renderTemplate(await heroTemplate(plugin), kampagne, hero.name);
    // spieler is written below via processFrontMatter after creation
    const folder = s.heroesFolder.replace(/\/+$/, "");
    await ensureFolder(app, folder);
    let path = `${folder}/${safeFileName(hero.name)}.md`;
    let n = 2;
    while (app.vault.getFileByPath(path)) path = `${folder}/${safeFileName(hero.name)} ${n++}.md`;
    // preview before creating anything
    const lines = [`Neue Notiz: ${path}`, ...diffFrontmatter(null, frontmatterValues(hero)), ...diffHeroes(null, hero)];
    const ok = await previewModal(app, {
      title: `Import: ${hero.name}`,
      isNew,
      lines,
      stubs: stubbed.added,
      warnings: mappingBroken ? ["Zuordnungsdatei ist ungültiges JSON: sie wird nicht verändert."] : [],
    });
    if (!ok) return;
    file = await app.vault.create(path, newContent);
    // Spieler key (existing convention: case-insensitive; template uses lowercase)
    await app.fileManager.processFrontMatter(file, (fm) => {
      const key = Object.keys(fm).find((k) => k.toLowerCase() === "spieler") ?? "spieler";
      fm[key] = spieler;
    });
    await finish(plugin, file, hero, cleaned, stubbed, mappingBroken);
    return;
  }

  // existing note: diff
  const fmCache = app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
  const dataFolder = s.heroDataFolder.replace(/\/+$/, "");
  const dataName = await resolveDataName(plugin, hero, file.basename);
  let prevText: string | null;
  try {
    prevText = await readText(app, `${dataFolder}/${dataName}`);
  } catch (e) {
    // an unreadable copy must not be treated as "new" and overwritten
    new Notice(`Bestehende Helden-Daten konnten nicht gelesen werden. Import abgebrochen: ${String(e)}`);
    return;
  }
  let prevHero: Hero | null = null;
  if (prevText) {
    try {
      prevHero = parseHero(JSON.parse(prevText) as HeroJson, mapping);
    } catch {
      prevHero = null;
    }
  }
  const fmLines = diffFrontmatter(fmCache ?? null, frontmatterValues(hero));
  const lines = [...fmLines, ...diffHeroes(prevHero, hero)];
  const warnings = [
    ...(target ? assignmentWarnings(hero, target, notes) : []),
    ...(mappingBroken ? ["Zuordnungsdatei ist ungültiges JSON: sie wird nicht verändert."] : []),
  ];
  const ok = await previewModal(app, {
    title: `Import: ${hero.name} → ${file.basename}`,
    isNew: false,
    lines,
    stubs: stubbed.added,
    warnings,
  });
  if (!ok) return;
  await finish(plugin, file, hero, cleaned, stubbed, mappingBroken);
}

/** Existing data files in the data folder -> uid they contain. */
async function resolveDataName(plugin: DsaMeisterwerkzeugPlugin, hero: Hero, noteBasename: string): Promise<string> {
  const app = plugin.app;
  const folder = plugin.settings.heroDataFolder.replace(/\/+$/, "");
  const existing: Record<string, string> = {};
  try {
    if (await app.vault.adapter.exists(folder)) {
      for (const p of (await app.vault.adapter.list(folder)).files.filter((f) => f.endsWith(".dsahero.json"))) {
        let uid = "";
        try {
          uid = String((JSON.parse(await app.vault.adapter.read(p)) as HeroJson).character?.uid ?? "");
        } catch {
          /* unreadable: counts as occupied */
        }
        existing[p.split("/").pop() as string] = uid;
      }
    }
  } catch {
    /* ignore */
  }
  return chooseDataFileName(hero, noteBasename, existing, safeFileName);
}

async function finish(
  plugin: DsaMeisterwerkzeugPlugin,
  file: TFile,
  hero: Hero,
  cleaned: HeroJson,
  stubbed: { mapping: ReturnType<typeof parseMapping> & object; added: string[] },
  mappingBroken: boolean,
): Promise<void> {
  const app = plugin.app;
  const s = plugin.settings;
  // 1. frontmatter (only the import's keys; existing key spelling is kept case-insensitively)
  const values = frontmatterValues(hero);
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [k, v] of Object.entries(values)) {
      const existing = Object.keys(fm).find((x) => x.toLowerCase() === k.toLowerCase());
      fm[existing ?? k] = v;
    }
  });
  // 2. block between markers (everything else untouched)
  const block = renderSpielwerte(hero);
  await app.vault.process(file, (content) => applyBlock(content, block));
  // 3. cleaned JSON copy
  const dataPath = `${s.heroDataFolder.replace(/\/+$/, "")}/${await resolveDataName(plugin, hero, file.basename)}`;
  await writeText(app, dataPath, JSON.stringify(cleaned, null, 2));
  // 4. mapping stubs (only if the file was valid or absent)
  if (mappingBroken) new Notice("Zuordnungsdatei ist ungültiges JSON und wurde nicht verändert.");
  else if (stubbed.added.length) {
    await writeText(app, s.mappingFile, serializeMapping(stubbed.mapping));
  }
  await plugin.heroes.load();
  new Notice(`${hero.name} importiert (${file.path}).`);
}
