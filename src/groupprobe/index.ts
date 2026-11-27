import { MarkdownRenderChild } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { registerGroupProbeCommands } from "./command";
import { groupProbeEditorExtension } from "./editor";
import { nthLineWithCode } from "./logic";
import { isGroupProbeCode } from "./parse";
import { mountGroupProbe } from "./view";

export function registerGroupProbe(plugin: DsaMeisterwerkzeugPlugin): void {
  // reading view
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const seen = new Map<string, number>();
    for (const code of Array.from(el.querySelectorAll("code"))) {
      if (code.parentElement?.tagName === "PRE") continue;
      const raw = code.textContent ?? "";
      if (!isGroupProbeCode(raw)) continue;
      const child = new MarkdownRenderChild(code);
      ctx.addChild(child);
      // source line of this probe: the n-th rendered copy of the same code is the n-th occurrence in the section
      const nth = seen.get(raw) ?? 0;
      seen.set(raw, nth + 1);
      const info = ctx.getSectionInfo(el);
      const rel = info ? nthLineWithCode(info.text, raw, nth) : null;
      code.replaceWith(mountGroupProbe(plugin, raw, ctx.sourcePath, info && rel !== null ? info.lineStart + rel : undefined));
    }
  });
  // live preview
  plugin.registerEditorExtension(groupProbeEditorExtension(plugin));
  registerGroupProbeCommands(plugin);
}
