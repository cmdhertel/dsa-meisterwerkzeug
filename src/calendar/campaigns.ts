// Which campaigns exist, and which campaign a note belongs to.
// A campaign is a subfolder of the campaigns folder (settings) or a note with `typ: kampagne`.
import { TFile, TFolder } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { campaignsOf } from "../probe/logic";
import { folderPath } from "../settingsData";

export function listCampaigns(plugin: DsaMeisterwerkzeugPlugin): string[] {
  const { vault, metadataCache } = plugin.app;
  const names = new Set<string>();
  const root = vault.getAbstractFileByPath(folderPath(plugin.settings.campaignsFolder));
  if (root instanceof TFolder) for (const c of root.children) if (c instanceof TFolder) names.add(c.name);
  for (const f of vault.getMarkdownFiles()) {
    const typ = metadataCache.getFileCache(f)?.frontmatter?.typ;
    if (typeof typ === "string" && typ.trim().toLowerCase() === "kampagne") names.add(f.basename);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "de"));
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
