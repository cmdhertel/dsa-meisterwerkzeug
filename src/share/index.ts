import { Notice } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { SHARE_BLOCK, registerPlayerBlock } from "./render";

const PLAYER_SCREEN_ID = "ttrpg-tools-screen";
/** Constant text: the player screen de-duplicates by text, so repeated sharing never piles up items. */
export const SHARE_MARKDOWN = "```" + SHARE_BLOCK + "\n```";

export const SHARE_MARKDOWN_AVENTURISCH = "```" + SHARE_BLOCK + "\nstil: aventurisch\n```";
export const SHARE_MARKDOWN_SCHLICHT = "```" + SHARE_BLOCK + "\nstil: schlicht\n```";

interface PlayerScreenApi {
  sendMarkdown?: (markdown: string, sourcePath: string) => Promise<void>;
}

/** Send the live combat view to the "TTRPG Tools - Player Screen" window. */
export async function shareFight(plugin: DsaMeisterwerkzeugPlugin, markdown: string = SHARE_MARKDOWN): Promise<void> {
  const plugins = (plugin.app as unknown as { plugins?: { plugins?: Record<string, PlayerScreenApi | undefined> } }).plugins?.plugins;
  const ps = plugins?.[PLAYER_SCREEN_ID];
  if (!ps || typeof ps.sendMarkdown !== "function") {
    new Notice("Das Plugin „TTRPG Tools - Player Screen“ ist nicht installiert oder nicht aktiviert.");
    return;
  }
  try {
    await ps.sendMarkdown(markdown, "");
  } catch (err) {
    console.error("Share to player screen failed", err);
    new Notice("Teilen auf den Spielerbildschirm fehlgeschlagen (siehe Konsole).");
  }
}

/** Registers the player-view code block and the share command. */
export function registerShare(plugin: DsaMeisterwerkzeugPlugin): void {
  registerPlayerBlock(plugin);
  plugin.addCommand({ id: "share-fight", name: "Kampf auf Spielerbildschirm zeigen", callback: () => void shareFight(plugin) });
  plugin.addCommand({ id: "share-fight-aventurisch", name: "Kampf an Spielerbildschirm senden (Aventurisch)", callback: () => void shareFight(plugin, SHARE_MARKDOWN_AVENTURISCH) });
  plugin.addCommand({ id: "share-fight-schlicht", name: "Kampf an Spielerbildschirm senden (Schlicht)", callback: () => void shareFight(plugin, SHARE_MARKDOWN_SCHLICHT) });
}
