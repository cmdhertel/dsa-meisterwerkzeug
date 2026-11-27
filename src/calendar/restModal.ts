// Rast (Regenerationsphase) modal.
import { Modal, Notice, TFile } from "obsidian";
import { defaultRoller } from "../engine/dice";
import type DsaMeisterwerkzeugPlugin from "../main";
import { calendarOf } from "./state";
import { formatDate } from "./engine";
import { POOL_LABEL, PoolKey, RestHeroInput, RestHeroResult, RestPoolResult, rerollHero, restEventText, rollRest, withManualValue } from "./rest";

const KEYS: PoolKey[] = ["lep", "asp", "kap"];
/** Frontmatter keys holding the current values (own keys; the import-managed LeP/AsP/KaP stay maxima). */
export const CURRENT_KEY: Record<PoolKey, string> = { lep: "LeP_aktuell", asp: "AsP_aktuell", kap: "KaP_aktuell" };
const MAX_KEY: Record<PoolKey, string> = { lep: "LeP", asp: "AsP", kap: "KaP" };

const toNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export function openRestModal(plugin: DsaMeisterwerkzeugPlugin): void {
  new RestModal(plugin).open();
}

class RestModal extends Modal {
  private inputs: (RestHeroInput & { path: string })[] = [];
  private results: RestHeroResult[] = [];
  private globalMod = 0;
  private days = 1;
  private body!: HTMLElement;

  constructor(private plugin: DsaMeisterwerkzeugPlugin) {
    super(plugin.app);
  }

  onOpen() {
    this.titleEl.setText("Rast (Regenerationsphase)");
    this.modalEl.addClass("dsa-cal-rest");
    this.loadHeroes();
    if (!this.inputs.length) {
      this.contentEl.createEl("p", { text: "Keine Helden mit Notiz gefunden (Heldenimport zuerst durchführen)." });
      return;
    }
    const top = this.contentEl.createDiv({ cls: "dsa-cal-rest-top" });
    const gm = top.createEl("label", { text: "Globaler Modifikator " });
    const gsel = this.modSelect(gm, this.globalMod, (v) => (this.globalMod = v));
    gsel.title = "Gute Unterkunft +1, schlechte Bedingungen −1 …";
    const dl = top.createEl("label", { text: "Dauer (Tage) " });
    const di = dl.createEl("input", { type: "number", value: String(this.days), attr: { min: "0", max: "30" } });
    di.addClass("dsa-cal-rest-num");
    di.onchange = () => (this.days = Math.max(0, Math.trunc(parseFloat(di.value) || 0)));
    top.createEl("button", { text: "Würfeln" }).onclick = () => this.roll();
    this.body = this.contentEl.createDiv({ cls: "dsa-cal-rest-body" });
    this.roll();
    const foot = this.contentEl.createDiv({ cls: "dsa-cal-rest-foot" });
    foot.createEl("button", { text: "Anwenden", cls: "mod-cta" }).onclick = () => void this.apply();
    foot.createEl("button", { text: "Abbrechen" }).onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }

  private modSelect(parent: HTMLElement, cur: number, set: (v: number) => void): HTMLSelectElement {
    const s = parent.createEl("select", { cls: "dropdown" });
    for (let m = -2; m <= 2; m++) s.createEl("option", { text: m > 0 ? `+${m}` : String(m), value: String(m) });
    s.value = String(cur);
    s.onchange = () => set(parseInt(s.value, 10));
    return s;
  }

  private loadHeroes() {
    const { app, heroes } = this.plugin;
    for (const h of heroes.all()) {
      if (!h.notePath) continue;
      const f = app.vault.getAbstractFileByPath(h.notePath);
      const fm = f instanceof TFile ? ((app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>) : {};
      const pool = (k: PoolKey, fallbackMax: number) => {
        const max = toNum(fm[MAX_KEY[k]]) ?? fallbackMax;
        const cur = toNum(fm[CURRENT_KEY[k]]);
        return { max, current: cur === null ? max : Math.min(cur, max) };
      };
      this.inputs.push({ id: h.uid, name: h.callName || h.name, path: h.notePath, mod: 0, lep: pool("lep", h.lep.max), asp: pool("asp", h.asp.max), kap: pool("kap", 0) });
    }
  }

  private roll() {
    this.results = rollRest(this.inputs, this.globalMod, defaultRoller);
    this.draw();
  }

  /** Re-rolls only the hero at index i; the others keep their results and manual values. */
  private rerollAt(i: number) {
    this.results = rerollHero(this.inputs, this.results, i, this.globalMod, defaultRoller);
    this.draw();
  }

  private draw() {
    this.body.empty();
    const table = this.body.createEl("table", { cls: "dsa-cal-rest-table" });
    const hr = table.createEl("thead").createEl("tr");
    for (const t of ["Held", "Mod.", "LeP", "AsP", "KaP"]) hr.createEl("th", { text: t });
    const tb = table.createEl("tbody");
    this.inputs.forEach((h, i) => {
      const r = this.results[i];
      const tr = tb.createEl("tr");
      tr.createEl("td", { text: h.name });
      const tdm = tr.createEl("td");
      this.modSelect(tdm, h.mod, (v) => {
        h.mod = v;
        this.rerollAt(i);
      });
      for (const k of KEYS) this.poolCell(tr.createEl("td"), r, k);
    });
  }

  private poolCell(td: HTMLElement, hero: RestHeroResult, k: PoolKey) {
    const p: RestPoolResult = hero[k];
    if (!p.active) {
      td.createSpan({ text: "–", cls: "dsa-cal-muted" });
      return;
    }
    td.createDiv({ cls: "dsa-cal-muted", text: `${p.before}/${p.max} · W6 ${p.roll}${p.mod ? (p.mod > 0 ? "+" : "") + p.mod : ""}` });
    const inp = td.createEl("input", { type: "number", value: String(p.after), attr: { min: "0", max: String(p.max) } });
    inp.addClass("dsa-cal-rest-num");
    inp.onchange = () => {
      hero[k] = withManualValue(p, parseFloat(inp.value) || 0);
      inp.value = String(hero[k].after);
    };
  }

  private async apply() {
    let failed = 0;
    const applied: RestHeroResult[] = [];
    for (let i = 0; i < this.inputs.length; i++) {
      const h = this.inputs[i];
      const r = this.results[i];
      const f = this.app.vault.getAbstractFileByPath(h.path);
      if (!(f instanceof TFile)) {
        failed++;
        continue;
      }
      try {
        await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
          for (const k of KEYS) if (r[k].active) fm[CURRENT_KEY[k]] = r[k].after;
        });
        applied.push(r);
      } catch {
        failed++;
      }
    }
    if (applied.length) {
      this.plugin.table.emit({
        type: "rest",
        text: restEventText(applied, this.days),
        data: {
          days: this.days,
          heroes: applied.map((h) => ({ who: h.name, lep: h.lep.active ? h.lep.after - h.lep.before : null, asp: h.asp.active ? h.asp.after - h.asp.before : null, kap: h.kap.active ? h.kap.after - h.kap.before : null })),
        },
      });
    }
    const cal = calendarOf(this.plugin);
    if (this.days > 0) cal.advance(this.days);
    new Notice(`Rast angewendet. Datum: ${formatDate(cal.getDate())}${failed ? ` (${failed} Notiz(en) nicht beschreibbar)` : ""}`);
    this.close();
  }
}

/** Heroes' current LeP/AsP/KaP key names, exported for documentation. */
export { POOL_LABEL };
