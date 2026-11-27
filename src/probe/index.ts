import { MarkdownRenderChild } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { ProbeModal } from "./command";
import { probeEditorExtension } from "./editor";
import { isProbeCode } from "./parse";
import { mountProbe } from "./view";

export function registerProbe(plugin: DsaMeisterwerkzeugPlugin): void {
  // reading view
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const code of Array.from(el.querySelectorAll("code"))) {
      if (code.parentElement?.tagName === "PRE") continue;
      const raw = code.textContent ?? "";
      if (!isProbeCode(raw)) continue;
      const child = new MarkdownRenderChild(code);
      ctx.addChild(child);
      const { el: repl, view } = mountProbe(plugin, raw, ctx.sourcePath, child);
      code.replaceWith(repl);
      if (view) child.register(() => view.destroy());
    }
  });
  // live preview
  plugin.registerEditorExtension(probeEditorExtension(plugin));
  plugin.addCommand({ id: "probe-wuerfeln", name: "Proben: Probe würfeln", callback: () => new ProbeModal(plugin).open() });
}
