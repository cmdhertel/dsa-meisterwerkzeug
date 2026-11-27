// Markdown code block processor for `dsa-kampf`.
import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, TFile } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { rollCounts } from "./build";
import { loadEncounter } from "./load";
import { EncounterBuilderModal } from "./modal";
import { EncounterSpec, parseEncounter, replaceBlockBody, serializeEncounter } from "./parse";
import { renderEnemyTable, renderEstimatePanel } from "./panel";
import { buildCatalog, evaluate } from "./service";

/** Rewrites exactly this block in its note. Falls back to a Notice with the text when the block cannot be located. */
async function saveBlock(plugin: DsaMeisterwerkzeugPlugin, el: HTMLElement, ctx: MarkdownPostProcessorContext, spec: EncounterSpec): Promise<void> {
  const body = serializeEncounter(spec);
  const info = ctx.getSectionInfo(el);
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!info || !(file instanceof TFile)) {
    new Notice("Der Block konnte nicht gefunden werden. Text zum Kopieren:\n\n```dsa-kampf\n" + body + "\n```", 15000);
    return;
  }
  let ok = true;
  await plugin.app.vault.process(file, (data) => {
    const out = replaceBlockBody(data, info.lineStart, info.lineEnd, body);
    if (out === null) {
      ok = false;
      return data;
    }
    return out;
  });
  if (!ok) new Notice("Die Notiz hat sich geändert, der Block wurde nicht überschrieben. Text zum Kopieren:\n\n```dsa-kampf\n" + body + "\n```", 15000);
  else new Notice("Begegnung gespeichert.");
}

class EncounterCard extends MarkdownRenderChild {
  private counts: Record<number, number> = {};
  private withHeroes = true;

  constructor(private plugin: DsaMeisterwerkzeugPlugin, containerEl: HTMLElement, private source: string, private ctx: MarkdownPostProcessorContext) {
    super(containerEl);
  }

  onload() {
    this.render();
  }

  private render() {
    const root = this.containerEl;
    root.empty();
    root.addClass("dsa-enc");
    const { spec, warnings } = parseEncounter(this.source);
    const catalog = buildCatalog(this.plugin);
    const ev = evaluate(this.plugin, spec, catalog, this.counts);

    root.createDiv({ text: spec.name || "Begegnung", cls: "dsa-enc-title" });
    if (!spec.entries.length) root.createDiv({ text: "Keine Gegner im Block. Mit „Bearbeiten“ welche hinzufügen.", cls: "dsa-mw-muted" });
    else renderEnemyTable(root, ev.resolved, { openNote: (p) => void this.plugin.app.workspace.openLinkText(p, this.ctx.sourcePath) });

    const warn = [...warnings, ...ev.resolved.flatMap((r) => r.warnings), ...(ev.party.unresolved.length ? [`Helden nicht gefunden: ${ev.party.unresolved.join(", ")}`] : [])];
    if (warn.length) {
      const ul = root.createEl("ul", { cls: "dsa-enc-warnings" });
      for (const w of warn) ul.createEl("li", { text: w });
    }
    if (spec.entries.length) renderEstimatePanel(root.createDiv(), ev.estimate, ev.party.label);

    const bar = root.createDiv({ cls: "dsa-enc-buttons" });
    const btn = (text: string, fn: () => void, cta = false) => {
      const b = bar.createEl("button", { text, cls: cta ? "mod-cta" : "" });
      b.addEventListener("click", fn);
      return b;
    };
    btn("Ins Cockpit laden", () => void loadEncounter(this.plugin, spec, catalog, { withHeroes: this.withHeroes && ev.party.heroNames.length > 0, counts: this.counts }), true);
    if (ev.party.heroNames.length) {
      const lab = bar.createEl("label", { cls: "dsa-enc-check" });
      const cb = lab.createEl("input", { type: "checkbox" });
      cb.checked = this.withHeroes;
      cb.addEventListener("change", () => (this.withHeroes = cb.checked));
      lab.createSpan({ text: " Helden mit laden" });
    }
    if (spec.entries.some((e) => e.countDice)) {
      btn("Anzahl würfeln", () => {
        this.counts = rollCounts(spec);
        this.render();
      });
    }
    btn("Bearbeiten", () => {
      new EncounterBuilderModal(this.plugin, {
        spec,
        mode: "edit",
        onSave: async (s) => saveBlock(this.plugin, this.containerEl, this.ctx, s),
      }).open();
    });
  }
}

export function registerEncounterBlock(plugin: DsaMeisterwerkzeugPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("dsa-kampf", (source, el, ctx) => {
    const child = new EncounterCard(plugin, el, source, ctx);
    ctx.addChild(child);
  });
}
