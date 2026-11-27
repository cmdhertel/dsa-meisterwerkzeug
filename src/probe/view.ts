// Probe UI: button + result rendering shared by inline widgets and the command modal.
import { App, Component, MarkdownRenderer, Menu, Modal, Notice, Setting } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import type { Hero } from "../hero/model";
import { ParseResult, ProbeSpec, formatModifier, parseProbe, unlockedOutcomes } from "./parse";
import { HeroChoice, ProbeRun, Subject, bestRun, campaignsOf, findCombatEntry, orderHeroes, probeAllEventText, probeEventText, runCheck, subjectFromHero } from "./logic";

export type Selection = { kind: "hero"; uid: string } | { kind: "all" } | { kind: "manual"; attrs: [number, number, number]; fw: number };

/** last chosen hero uid, for this session only */
let lastHeroUid: string | null = null;
export const rememberHero = (uid: string | null) => (lastHeroUid = uid);

export function noteCampaigns(plugin: DsaMeisterwerkzeugPlugin, sourcePath: string): string[] {
  return campaignsOf(plugin.app.metadataCache.getCache(sourcePath)?.frontmatter?.kampagne);
}

export interface HeroEntry extends HeroChoice {
  hero: Hero;
}

export function heroChoices(plugin: DsaMeisterwerkzeugPlugin): HeroEntry[] {
  return plugin.heroes.all().map((hero) => {
    const fm = hero.notePath ? plugin.app.metadataCache.getCache(hero.notePath)?.frontmatter : undefined;
    return { uid: hero.uid, name: hero.callName || hero.name, campaigns: campaignsOf(fm?.kampagne), hero };
  });
}

export function orderedHeroChoices(plugin: DsaMeisterwerkzeugPlugin, sourcePath: string) {
  return orderHeroes(heroChoices(plugin), noteCampaigns(plugin, sourcePath), lastHeroUid);
}

export function statePenaltyFor(plugin: DsaMeisterwerkzeugPlugin, hero: Hero): number {
  const e = findCombatEntry(plugin.combat.entries, hero);
  return e ? plugin.combat.statePenalty(e.id) : 0;
}

export function runSelection(plugin: DsaMeisterwerkzeugPlugin, spec: { talent: ProbeSpec["talent"]; modifier: number }, sel: Selection): ProbeRun[] {
  const { talent, modifier } = spec;
  if (sel.kind === "manual") return [runCheck({ name: "Manuell", attrs: sel.attrs, fw: sel.fw, statePenalty: 0 }, modifier)];
  const heroes = sel.kind === "all" ? plugin.heroes.all() : [plugin.heroes.getByUid(sel.uid)].filter((h): h is Hero => !!h);
  return heroes.map((h) => runCheck(subjectFromHero(h, talent, statePenaltyFor(plugin, h)), modifier));
}

function selectionLabel(plugin: DsaMeisterwerkzeugPlugin, sel: Selection): string {
  return sel.kind === "all" ? "Alle Helden" : sel.kind === "manual" ? "Manuell" : plugin.heroes.getByUid(sel.uid)?.callName ?? "Held";
}

/** Renders the results of one probe (collapsible) into `host`. Owns its markdown child components. */
export class ProbeView {
  private runs: ProbeRun[] = [];
  private sel: Selection | null = null;
  private resultEl: HTMLElement;
  private btn: HTMLButtonElement;
  private children: Component[] = [];

  constructor(
    private plugin: DsaMeisterwerkzeugPlugin,
    private host: HTMLElement,
    private spec: ProbeSpec,
    private sourcePath: string,
    private owner: Component,
    opts: { withButton: boolean } = { withButton: true },
  ) {
    host.addClass("dsa-probe");
    if (opts.withButton) {
      const mod = formatModifier(spec.modifier);
      this.btn = host.createEl("button", { cls: "dsa-probe-btn", text: `🎲 ${spec.talent.name}${mod ? " " + mod : ""}` });
      this.btn.title = `${spec.talent.attrs.join(" / ")}${spec.modifier ? `  (Modifikator ${formatModifier(spec.modifier)})` : ""}`;
      this.btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openMenu(ev);
      });
    } else {
      this.btn = document.createElement("button");
    }
    this.resultEl = host.createSpan({ cls: "dsa-probe-result-host" });
  }

  openMenu(ev: MouseEvent) {
    const menu = new Menu();
    const { primary, others } = orderedHeroChoices(this.plugin, this.sourcePath);
    const add = (h: HeroEntry) =>
      menu.addItem((i) => {
        const pen = statePenaltyFor(this.plugin, h.hero);
        i.setTitle(pen ? `${h.name} (Zustände ${-pen >= 0 ? "+" : ""}${-pen})` : h.name).onClick(() => {
          rememberHero(h.uid);
          this.roll({ kind: "hero", uid: h.uid });
        });
      });
    if (!primary.length) menu.addItem((i) => i.setTitle("Keine Helden geladen").setDisabled(true));
    primary.forEach(add);
    if (others.length) {
      menu.addSeparator();
      others.forEach(add);
    }
    menu.addSeparator();
    if (this.plugin.heroes.all().length > 1) menu.addItem((i) => i.setTitle("Alle Helden").setIcon("users").onClick(() => this.roll({ kind: "all" })));
    menu.addItem((i) =>
      i.setTitle("Ohne Held (manuell)…").setIcon("pencil").onClick(() => {
        new ManualModal(this.plugin.app, this.spec.talent.attrs, (attrs, fw) => this.roll({ kind: "manual", attrs, fw })).open();
      }),
    );
    menu.showAtMouseEvent(ev);
  }

  roll(sel: Selection) {
    this.sel = sel;
    this.runs = runSelection(this.plugin, this.spec, sel);
    if (!this.runs.length) new Notice("Kein Held gefunden.");
    else this.announce(sel);
    this.render();
  }

  /** Announce the finished roll on the table bus (once per roll; "Alle Helden" as one summary event). */
  private announce(sel: Selection) {
    const { talent, modifier } = this.spec;
    const sourcePath = this.sourcePath || undefined;
    if (sel.kind === "all") {
      this.plugin.table.emit({
        type: "probe",
        text: probeAllEventText(talent.name, modifier, this.runs),
        sourcePath,
        data: {
          who: "Alle Helden",
          talent: talent.name,
          modifier,
          results: this.runs.map((r) => ({ who: r.subject.name, success: r.result.success, qs: r.result.qs, critical: r.result.critical })),
        },
      });
      return;
    }
    for (const r of this.runs) {
      this.plugin.table.emit({
        type: "probe",
        text: probeEventText(r.subject.name, talent.name, modifier, r.result.success, r.result.qs, r.result.critical),
        sourcePath,
        data: { who: r.subject.name, talent: talent.name, modifier, success: r.result.success, qs: r.result.qs, critical: r.result.critical },
      });
    }
  }

  private clearChildren() {
    for (const c of this.children) this.owner.removeChild(c);
    this.children = [];
  }

  /** Call when the host DOM is discarded. */
  destroy() {
    this.clearChildren();
  }

  private md(el: HTMLElement, text: string) {
    const c = new Component();
    this.owner.addChild(c);
    this.children.push(c);
    void MarkdownRenderer.render(this.plugin.app, text, el, this.sourcePath, c);
  }

  private renderTexts(parent: HTMLElement, run: ProbeRun | null, allowHidden = true) {
    if (!run) return;
    const { shown, hidden } = unlockedOutcomes(this.spec.outcomes, this.spec.failure, run.result.success, run.result.qs);
    const box = parent.createDiv({ cls: "dsa-probe-texts" });
    for (const s of shown) {
      const row = box.createDiv({ cls: "dsa-probe-text" });
      row.createSpan({ cls: "dsa-probe-text-label", text: s.label });
      this.md(row.createDiv({ cls: "dsa-probe-text-body" }), s.text);
    }
    if (allowHidden && hidden.length) {
      const d = box.createEl("details", { cls: "dsa-probe-hidden" });
      d.createEl("summary", { text: "höhere QS anzeigen" });
      for (const s of hidden) {
        const row = d.createDiv({ cls: "dsa-probe-text" });
        row.createSpan({ cls: "dsa-probe-text-label", text: s.label });
        this.md(row.createDiv({ cls: "dsa-probe-text-body" }), s.text);
      }
    }
  }

  private runLine(parent: HTMLElement, run: ProbeRun) {
    const r = run.result;
    const line = parent.createDiv({ cls: "dsa-probe-dice" });
    r.dice.forEach((d, i) => {
      const cls = d === 1 ? "dsa-probe-die is-one" : d === 20 ? "dsa-probe-die is-twenty" : d > r.attrEffective[i] ? "dsa-probe-die is-over" : "dsa-probe-die";
      const el = line.createSpan({ cls });
      el.setText(`${d}`);
      el.title = `${this.spec.talent.attrs[i]} ${r.attrEffective[i]}${r.modifierTotal ? ` (Basis ${r.attrBase[i]}, Modifikator ${r.modifierTotal > 0 ? "+" : ""}${r.modifierTotal})` : ""}`;
      line.createSpan({ cls: "dsa-probe-vs", text: `/${r.attrEffective[i]}` });
    });
    const pts = line.createSpan({ cls: "dsa-probe-points" });
    pts.setText(`FW ${r.fw}, benötigt ${r.fwUsed} → ${r.remaining >= 0 ? "Rest " + r.remaining : "fehlen " + -r.remaining}`);
    if (run.subject.statePenalty) line.createSpan({ cls: "dsa-probe-points", text: `Zustände -${run.subject.statePenalty}` });
  }

  private verdict(run: ProbeRun): { text: string; cls: string } {
    const r = run.result;
    const crit = r.critical === "success" ? " · kritischer Erfolg" : r.critical === "patzer" ? " · Patzer" : "";
    return r.success ? { text: `QS ${r.qs}${crit}`, cls: "is-success" } : { text: `misslungen${crit}`, cls: "is-fail" };
  }

  render() {
    this.clearChildren();
    this.resultEl.empty();
    if (!this.runs.length) return;
    const wrap = this.resultEl.createEl("details", { cls: "dsa-probe-result" });
    wrap.open = true;
    const sum = wrap.createEl("summary");
    const multi = this.runs.length > 1;
    const best = bestRun(this.runs);
    if (!multi) {
      const v = this.verdict(this.runs[0]);
      sum.createSpan({ cls: "dsa-probe-name", text: this.runs[0].subject.name });
      sum.createSpan({ cls: `dsa-probe-verdict ${v.cls}`, text: v.text });
    } else {
      sum.createSpan({ cls: "dsa-probe-name", text: this.sel ? selectionLabel(this.plugin, this.sel) : "Gruppe" });
      const v = best ? this.verdict(best) : null;
      if (v) sum.createSpan({ cls: `dsa-probe-verdict ${v.cls}`, text: `bestes: ${v.text}` });
    }
    const tools = sum.createSpan({ cls: "dsa-probe-tools" });
    const again = tools.createEl("button", { cls: "dsa-probe-tool", text: "↻", attr: { "aria-label": "Neu würfeln", title: "Neu würfeln" } });
    again.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.sel) this.roll(this.sel);
    });
    const close = tools.createEl("button", { cls: "dsa-probe-tool", text: "✕", attr: { "aria-label": "Ergebnis schließen", title: "Ergebnis schließen" } });
    close.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.runs = [];
      this.render();
    });

    const body = wrap.createDiv({ cls: "dsa-probe-body" });
    if (!multi) {
      this.runLine(body, this.runs[0]);
      this.renderTexts(body, this.runs[0]);
    } else {
      for (const run of this.runs) {
        const row = body.createDiv({ cls: "dsa-probe-hero" });
        const v = this.verdict(run);
        row.createSpan({ cls: "dsa-probe-name", text: run.subject.name });
        row.createSpan({ cls: `dsa-probe-verdict ${v.cls}`, text: v.text });
        this.runLine(row, run);
      }
      if (best) {
        body.createDiv({ cls: "dsa-probe-best", text: `Texte für das beste Ergebnis (${best.subject.name}):` });
        this.renderTexts(body, best);
      }
    }
  }
}

/** Mount a probe button for inline code `raw`. Returns the replacement element. */
export function mountProbe(plugin: DsaMeisterwerkzeugPlugin, raw: string, sourcePath: string, owner: Component): { el: HTMLElement; view: ProbeView | null } {
  const parsed: ParseResult = parseProbe(raw);
  const el = document.createElement("span");
  if (!parsed.ok) {
    el.addClass("dsa-probe", "dsa-probe-error");
    el.setText(`⚠ ${parsed.error}`);
    el.title = parsed.raw;
    return { el, view: null };
  }
  return { el, view: new ProbeView(plugin, el, parsed.spec, sourcePath, owner) };
}

export class ManualModal extends Modal {
  private static last: { attrs: [number, number, number]; fw: number } = { attrs: [12, 12, 12], fw: 0 };
  constructor(app: App, private labels: readonly string[], private onSubmit: (attrs: [number, number, number], fw: number) => void) {
    super(app);
  }
  onOpen() {
    this.titleEl.setText("Probe ohne Held");
    const attrs = [...ManualModal.last.attrs] as [number, number, number];
    let fw = ManualModal.last.fw;
    this.labels.forEach((l, i) =>
      new Setting(this.contentEl).setName(l).addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(attrs[i])).onChange((v) => (attrs[i] = Number(v) || 0));
      }),
    );
    new Setting(this.contentEl).setName("Fertigkeitswert (FW)").addText((t) => {
      t.inputEl.type = "number";
      t.setValue(String(fw)).onChange((v) => (fw = Math.max(0, Number(v) || 0)));
    });
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText("Würfeln")
        .setCta()
        .onClick(() => {
          ManualModal.last = { attrs: [...attrs] as [number, number, number], fw };
          this.close();
          this.onSubmit(attrs, fw);
        }),
    );
  }
  onClose() {
    this.contentEl.empty();
  }
}
