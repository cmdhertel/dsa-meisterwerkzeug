import { MarkdownRenderChild } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { registerGroupProbeCommands } from "./command";
import { groupProbeEditorExtension } from "./editor";
import { isGroupProbeCode } from "./parse";
import { mountGroupProbe } from "./view";

export function registerGroupProbe(plugin: DsaMeisterwerkzeugPlugin): void {
  // reading view
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const code of Array.from(el.querySelectorAll("code"))) {
      if (code.parentElement?.tagName === "PRE") continue;
      const raw = code.textContent ?? "";
      if (!isGroupProbeCode(raw)) continue;
      const child = new MarkdownRenderChild(code);
      ctx.addChild(child);
      code.replaceWith(mountGroupProbe(plugin, raw, ctx.sourcePath));
    }
  });
  // live preview
  plugin.registerEditorExtension(groupProbeEditorExtension(plugin));
  registerGroupProbeCommands(plugin);
}
