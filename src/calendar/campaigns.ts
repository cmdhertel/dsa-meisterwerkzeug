// Which campaigns exist, and which campaign a note belongs to.
// A campaign is a subfolder of the campaigns folder (settings) or a note with `typ: kampagne`.
import { TFile, TFolder } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { campaignsOf } from "../probe/logic";
import { folderPath } from "../settingsData";
import { isKampagneTyp } from "./events";

/** Cached campaign list per plugin; dropped only when a campaign can have changed (see registerCampaignCache). */
const CACHE = new WeakMap<object, string[]>();

function scanCampaigns(plugin: DsaMeisterwerkzeugPlugin): string[] {
  const { vault, metadataCache } = plugin.app;
  const names = new Set<string>();
  const root = vault.getAbstractFileByPath(folderPath(plugin.settings.campaignsFolder));
  if (root instanceof TFolder) for (const c of root.children) if (c instanceof TFolder) names.add(c.name);
  for (const f of vault.getMarkdownFiles()) {
    if (isKampagneTyp(metadataCache.getFileCache(f)?.frontmatter?.typ)) names.add(f.basename);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "de"));
}

export function listCampaigns(plugin: DsaMeisterwerkzeugPlugin): string[] {
  let list = CACHE.get(plugin);
  if (!list) {
    list = scanCampaigns(plugin);
    CACHE.set(plugin, list);
  }
  return list;
}

/** Drops the cached campaign list; the next listCampaigns() rescans the vault. */
export function invalidateCampaigns(plugin: object): void {
  CACHE.delete(plugin);
}

/**
 * Keeps the campaign cache in sync. Invalidates for folder changes (campaign folders) and for
 * notes that are, or were, campaigns (`typ: kampagne` or a name in the cached list).
 */
export function registerCampaignCache(plugin: DsaMeisterwerkzeugPlugin): void {
  const { app } = plugin;
  const isCampaignName = (name: string) => CACHE.get(plugin)?.includes(name) ?? false;
  const noteChanged = (f: TFile, oldName?: string) => {
    const kampagne = isKampagneTyp(app.metadataCache.getFileCache(f)?.frontmatter?.typ);
    if (kampagne || isCampaignName(f.basename) || (oldName !== undefined && isCampaignName(oldName))) invalidateCampaigns(plugin);
  };
  const nameOf = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

  plugin.registerEvent(
    app.metadataCache.on("changed", (f: TFile) => {
      if (f.extension === "md") noteChanged(f);
    }),
  );
  plugin.registerEvent(
    app.vault.on("create", (f) => {
      if (f instanceof TFolder) invalidateCampaigns(plugin);
      else if (f instanceof TFile && f.extension === "md") noteChanged(f);
    }),
  );
  plugin.registerEvent(
    app.vault.on("delete", (f) => {
      if (f instanceof TFolder) invalidateCampaigns(plugin);
      else if (f instanceof TFile && f.extension === "md" && isCampaignName(f.basename)) invalidateCampaigns(plugin);
    }),
  );
  plugin.registerEvent(
    app.vault.on("rename", (f, oldPath) => {
      if (f instanceof TFolder) invalidateCampaigns(plugin);
      else if (f instanceof TFile && f.extension === "md") noteChanged(f, nameOf(oldPath));
    }),
  );
}

/** Campaign of a note: its `kampagne` frontmatter link, else the campaign folder it lies in. */
export function campaignOfFile(plugin: DsaMeisterwerkzeugPlugin, file: TFile): string | null {
  const known = listCampaigns(plugin);
  const fromFm = campaignsOf(plugin.app.metadataCache.getFileCache(file)?.frontmatter?.kampagne).find((c) => known.includes(c));
  if (fromFm) return fromFm;
  const root = folderPath(plugin.settings.campaignsFolder);
  if (!root || !file.path.startsWith(root + "/")) return null;
  const name = file.path.slice(root.length + 1).split("/")[0];
  return file.path.slice(root.length + 1).includes("/") && known.includes(name) ? name : null;
}
