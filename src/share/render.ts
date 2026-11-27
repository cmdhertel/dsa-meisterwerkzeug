// Live player view of the CombatStore as a markdown code block ("dsa-kampf-spieler").
import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { renderAventurisch } from "./aventurisch";
import { PlayerRow, ShareOptions, buildPlayerView, optionsFromSettings, parseBlockOptions } from "./viewModel";

export const SHARE_BLOCK = "dsa-kampf-spieler";
export const ROMAN = ["0", "I", "II", "III", "IV"];

const live = new Set<() => void>();
/** Re-render all open player views (e.g. after a settings change). */
export const refreshPlayerViews = () => live.forEach((f) => f());

class PlayerViewChild extends MarkdownRenderChild {
  private timer: number | null = null;
  constructor(el: HTMLElement, private plugin: DsaMeisterwerkzeugPlugin, private source: string) {
    super(el);
  }
  onload() {
    this.register(this.plugin.combat.on(() => this.schedule()));
    live.add(this.draw);
    this.register(() => live.delete(this.draw));
    this.draw();
  }
  onunload() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
  private schedule() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.draw();
    }, 30);
  }
  private draw = () => {
    const opts: ShareOptions = parseBlockOptions(this.source, optionsFromSettings(this.plugin.settings));
    const view = buildPlayerView(this.plugin.combat.state, opts);
    if (opts.style === "aventurisch") renderAventurisch(this.containerEl, view);
    else renderPlayerView(this.containerEl, view);
  };
}

export function registerPlayerBlock(plugin: DsaMeisterwerkzeugPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(SHARE_BLOCK, (source, el, ctx: MarkdownPostProcessorContext) => {
    ctx.addChild(new PlayerViewChild(el, plugin, source));
  });
}

/** DOM rendering; elements are created via el.createEl so it also works inside the popout window. */
export function renderPlayerView(el: HTMLElement, view: ReturnType<typeof buildPlayerView>): void {
  el.empty();
  el.removeClass("dsa-psa");
  el.addClass("dsa-ps");
  if (view.empty) {
    el.createDiv({ cls: "dsa-ps-empty", text: "Kein Kampf aktiv" });
    return;
  }
  el.createDiv({ cls: "dsa-ps-round", text: `Kampfrunde ${view.round}` });
  const list = el.createDiv({ cls: "dsa-ps-list" });
  for (const r of view.rows) renderRow(list, r);
}

function renderRow(parent: HTMLElement, r: PlayerRow): void {
  const row = parent.createDiv({ cls: "dsa-ps-row" });
  row.addClass(r.isHero ? "dsa-ps-hero" : "dsa-ps-enemy");
  if (r.current) row.addClass("dsa-ps-current");
  if (r.next) row.addClass("dsa-ps-next");
  if (r.down) row.addClass("dsa-ps-down");
  if (r.placeholder) row.addClass("dsa-ps-placeholder");

  const top = row.createDiv({ cls: "dsa-ps-top" });
  top.createSpan({ cls: "dsa-ps-name", text: r.name });
  if (r.current) top.createSpan({ cls: "dsa-ps-tag dsa-ps-tag-now", text: "am Zug" });
  else if (r.next) top.createSpan({ cls: "dsa-ps-tag", text: "als Nächstes" });
  top.createSpan({ cls: "dsa-ps-spacer" });
  if (r.ini) top.createSpan({ cls: "dsa-ps-ini", text: r.ini });
  if (r.placeholder) return;

  if (r.word) row.createDiv({ cls: `dsa-ps-word dsa-ps-word-${r.word.replace(/ /g, "-")}`, text: r.word });
  if (r.barPct !== null) {
    const bar = row.createDiv({ cls: "dsa-ps-bar" });
    const fill = bar.createDiv({ cls: "dsa-ps-fill" });
    fill.style.width = `${r.barPct}%`;
    fill.addClass(r.barPct > 50 ? "ok" : r.barPct > 25 ? "warn" : "crit");
    if (r.lepText) bar.createSpan({ cls: "dsa-ps-bartext", text: r.lepText });
  }
  const chips = row.createDiv({ cls: "dsa-ps-chips" });
  if (r.isHero) chips.createSpan({ cls: "dsa-ps-chip" + (r.schmerz > 0 ? " on" : ""), text: `Schmerz ${ROMAN[r.schmerz] ?? r.schmerz}` });
  for (const s of r.states) chips.createSpan({ cls: "dsa-ps-chip on", text: `${s.label} ${ROMAN[s.level] ?? s.level}` });
  for (const t of r.effects ?? []) chips.createSpan({ cls: "dsa-ps-chip on dsa-ps-fx", text: t });
  if (!chips.childElementCount) chips.remove();
}
