// Sitzungsregie: heroes strip (LeP/AsP/KaP bars + click menu).
import { Menu } from "obsidian";
import { openCastDialog } from "../magic";
import { ProbeModal } from "../probe/command";
import type { RegieCtx } from "./ctx";
import { HeroInfo, Pool, loadHeroes } from "./vault";

const POOLS = [
  ["LeP", "lep"],
  ["AsP", "asp"],
  ["KaP", "kap"],
] as const;

function bar(parent: HTMLElement, label: string, pool: Pool, cls: string): void {
  const row = parent.createDiv({ cls: `dsa-regie-bar ${cls}` });
  row.createSpan({ cls: "dsa-regie-bar-label", text: label });
  const pct = pool.max > 0 ? Math.round((pool.cur / pool.max) * 100) : 0;
  const track = row.createDiv({
    cls: "dsa-regie-bar-track",
    attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(pool.max), "aria-valuenow": String(pool.cur), "aria-label": `${label} ${pool.cur} von ${pool.max}` },
  });
  const fill = track.createDiv({ cls: "dsa-regie-bar-fill" });
  fill.setCssProps({ "--dsa-w": `${Math.max(0, Math.min(100, pct))}%` });
  if (pct <= 33) row.addClass("is-low");
  row.createSpan({ cls: "dsa-regie-bar-value", text: `${pool.cur}/${pool.max}` });
}

export function buildPartyStrip(host: HTMLElement, ctx: RegieCtx): { render(): void } {
  host.addClass("dsa-regie-party");
  host.setAttr("aria-label", "Helden");
  const menu = (h: HeroInfo, ev: MouseEvent) => {
    const m = new Menu();
    const src = ctx.session() ?? "";
    if (h.notePath) m.addItem((i) => i.setTitle("Heldennotiz öffnen").setIcon("file-text").onClick(() => ctx.openNote(h.notePath!)));
    m.addItem((i) => i.setTitle("Probe würfeln").setIcon("dices").onClick(() => new ProbeModal(ctx.plugin, { sourcePath: src }).open()));
    if (h.asp || h.kap) m.addItem((i) => i.setTitle("Zauber wirken").setIcon("sparkles").onClick(() => openCastDialog(ctx.plugin, { kind: "zauber", casterName: h.name, heroPath: h.notePath })));
    m.showAtMouseEvent(ev);
  };
  const render = () => {
    host.empty();
    const heroes = loadHeroes(ctx.plugin, ctx.campaign());
    if (!heroes.length) {
      host.createDiv({ cls: "dsa-regie-empty", text: "Keine Helden importiert." });
      return;
    }
    for (const h of heroes) {
      const card = host.createEl("button", { cls: "dsa-regie-hero", attr: { type: "button", "aria-label": `${h.name}: Menü` } });
      card.createSpan({ cls: "dsa-regie-hero-name", text: h.name });
      const bars = card.createDiv({ cls: "dsa-regie-bars" });
      for (const [label, key] of POOLS) {
        const p = h[key];
        if (p) bar(bars, label, p, `is-${key}`);
      }
      card.addEventListener("click", (ev) => menu(h, ev));
    }
  };
  return { render };
}
