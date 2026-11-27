// Builder modal ("Begegnung bauen").
import { MarkdownView, Modal, Notice } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { CatalogEntry, indexCatalog, lookupCreature } from "./build";
import { loadEncounter } from "./load";
import { EncounterEntry, EncounterSpec, emptySpec, parseCountText, splitHelden, toBlock } from "./parse";
import { renderEstimatePanel } from "./panel";
import { buildCatalog, evaluate, heroRefs, resolveParty } from "./service";
import { DEFAULT_PARTY } from "./estimate";

export interface BuilderOptions {
  spec?: EncounterSpec;
  /** "edit": primary action is "Speichern" (rewrites the block) */
  mode?: "new" | "edit";
  onSave?: (spec: EncounterSpec) => Promise<void> | void;
}

const MAX_HITS = 40;
const MAX_CHIPS = 12;

type NumKey = "lep" | "ini" | "rs" | "at" | "pa" | "vw";

export class EncounterBuilderModal extends Modal {
  private spec: EncounterSpec;
  private catalog: CatalogEntry[] = [];
  private query = "";
  private typusFilter = "";
  private tagFilter = "";
  private manual = { ...DEFAULT_PARTY };
  private withHeroes = true;
  private editor: MarkdownView["editor"] | null;

  private hitsEl!: HTMLElement;
  private chosenEl!: HTMLElement;
  private estimateEl!: HTMLElement;
  private warnEl!: HTMLElement;
  private partyEl!: HTMLElement;

  constructor(private plugin: DsaMeisterwerkzeugPlugin, private opts: BuilderOptions = {}) {
    super(plugin.app);
    this.spec = opts.spec ? (JSON.parse(JSON.stringify(opts.spec)) as EncounterSpec) : emptySpec();
    this.editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor ?? null;
  }

  onOpen() {
    this.modalEl.addClass("dsa-enc-modal");
    this.titleEl.setText(this.opts.mode === "edit" ? "Begegnung bearbeiten" : "Begegnung bauen");
    this.catalog = buildCatalog(this.plugin);
    const root = this.contentEl;
    root.empty();
    root.addClass("dsa-enc");

    const nameRow = root.createDiv({ cls: "dsa-enc-row" });
    nameRow.createSpan({ text: "Name " });
    const nameIn = nameRow.createEl("input", { type: "text", placeholder: "z. B. Hinterhalt am Fluss", value: this.spec.name ?? "" });
    nameIn.addEventListener("input", () => (this.spec.name = nameIn.value.trim() || undefined));

    const cols = root.createDiv({ cls: "dsa-enc-cols" });
    const left = cols.createDiv({ cls: "dsa-enc-col" });
    const right = cols.createDiv({ cls: "dsa-enc-col" });

    // ---- bestiary search
    left.createEl("h4", { text: "Bestiarium + NSC" });
    const q = left.createEl("input", { type: "search", placeholder: "Kreatur oder NSC suchen …", cls: "dsa-enc-search" });
    q.addEventListener("input", () => {
      this.query = q.value;
      this.renderHits();
    });
    this.renderChips(left);
    this.hitsEl = left.createDiv({ cls: "dsa-enc-hits" });

    // ---- chosen entries
    right.createEl("h4", { text: "Gegner" });
    this.chosenEl = right.createDiv({ cls: "dsa-enc-chosen" });
    const add = right.createEl("button", { text: "Eigener Gegner" });
    add.addEventListener("click", () => {
      this.spec.entries.push({ count: 1, creature: "Eigener Gegner" });
      this.renderChosen();
      this.refresh();
    });

    // ---- party + estimate
    root.createEl("h4", { text: "Helden" });
    this.partyEl = root.createDiv({ cls: "dsa-enc-party" });
    this.renderParty();
    this.warnEl = root.createDiv();
    this.estimateEl = root.createDiv();

    // ---- actions
    const bar = root.createDiv({ cls: "dsa-enc-buttons" });
    const btn = (text: string, fn: () => void, cta = false) => {
      const b = bar.createEl("button", { text, cls: cta ? "mod-cta" : "" });
      b.addEventListener("click", fn);
    };
    if (this.opts.mode === "edit") {
      btn("Speichern", () => void this.save(), true);
    } else {
      btn("In Notiz einfügen", () => this.insert(), true);
    }
    btn("Ins Cockpit laden", () => void this.toCockpit());
    btn("Kopieren", () => void this.copy());
    const lab = bar.createEl("label", { cls: "dsa-enc-check" });
    const cb = lab.createEl("input", { type: "checkbox" });
    cb.checked = this.withHeroes;
    cb.addEventListener("change", () => (this.withHeroes = cb.checked));
    lab.createSpan({ text: " Helden mit laden" });

    this.renderHits();
    this.renderChosen();
    this.refresh();
  }

  onClose() {
    this.contentEl.empty();
  }

  // ------------------------------------------------------------ search

  private renderChips(el: HTMLElement) {
    const typus = new Map<string, number>();
    const tags = new Map<string, number>();
    for (const c of this.catalog) {
      if (c.status === "nostats") continue;
      const t = c.typus.split(",")[0].trim();
      if (t) typus.set(t, (typus.get(t) ?? 0) + 1);
      for (const tag of c.tags) if (tag !== "monster") tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CHIPS).map(([k]) => k).sort((a, b) => a.localeCompare(b, "de"));
    const row = (label: string, items: string[], get: () => string, set: (v: string) => void) => {
      if (!items.length) return;
      const r = el.createDiv({ cls: "dsa-enc-chips" });
      r.createSpan({ text: label, cls: "dsa-mw-muted" });
      const chips: HTMLElement[] = [];
      for (const it of items) {
        const c = r.createEl("button", { text: it, cls: "dsa-enc-chip" });
        chips.push(c);
        c.addEventListener("click", () => {
          set(get() === it ? "" : it);
          chips.forEach((x) => x.toggleClass("is-active", x.textContent === get()));
          this.renderHits();
        });
      }
    };
    row("Typus", top(typus), () => this.typusFilter, (v) => (this.typusFilter = v));
    row("Tag", top(tags), () => this.tagFilter, (v) => (this.tagFilter = v));
  }

  private renderHits() {
    const el = this.hitsEl;
    el.empty();
    const q = this.query.trim().toLowerCase();
    const hits = this.catalog.filter((c) => {
      if (c.status === "nostats") return false;
      if (q && !c.name.toLowerCase().includes(q) && !c.basename.toLowerCase().includes(q)) return false;
      if (this.typusFilter && c.typus.split(",")[0].trim() !== this.typusFilter) return false;
      if (this.tagFilter && !c.tags.includes(this.tagFilter)) return false;
      return true;
    });
    for (const c of hits.slice(0, MAX_HITS)) {
      const row = el.createDiv({ cls: "dsa-enc-hit" });
      row.createDiv({ text: c.name });
      const cb = c.combatant;
      const lep = cb.needsManual.includes("lep") ? "variabel" : (cb.lepMax ?? "?");
      const ini = cb.needsManual.includes("ini") ? "variabel" : (cb.iniBase ?? "?");
      row.createEl("small", { text: `LeP ${lep} · INI ${ini} · RS ${cb.rs ?? "?"}` + (c.anzahl ? ` · Anzahl ${c.anzahl}` : ""), cls: "dsa-mw-muted" });
      row.addEventListener("click", () => this.addCreature(c));
    }
    if (!hits.length) el.createDiv({ text: "Keine Treffer.", cls: "dsa-mw-muted" });
    else if (hits.length > MAX_HITS) el.createDiv({ text: `… ${hits.length - MAX_HITS} weitere, Suche eingrenzen.`, cls: "dsa-mw-muted" });
  }

  private addCreature(c: CatalogEntry) {
    const same = this.spec.entries.find((e) => e.creature.toLowerCase() === c.basename.toLowerCase() && !e.countDice && Object.keys(e).length === 2);
    if (same) same.count++;
    else this.spec.entries.push({ count: 1, creature: c.basename });
    this.renderChosen();
    this.refresh();
  }

  // ------------------------------------------------------------ chosen entries

  private renderChosen() {
    const el = this.chosenEl;
    el.empty();
    if (!this.spec.entries.length) el.createDiv({ text: "Noch keine Gegner. Links auf eine Kreatur klicken.", cls: "dsa-mw-muted" });
    // same rule as build/load: the first catalog entry wins for a duplicate name
    const index = indexCatalog(this.catalog);
    this.spec.entries.forEach((e, i) => {
      const cat = lookupCreature(index, e.creature);
      const adhoc = !cat || cat.status === "nostats";
      const box = el.createDiv({ cls: "dsa-enc-entry" });
      const top = box.createDiv({ cls: "dsa-enc-entry-top" });

      const minus = top.createEl("button", { text: "−" });
      const cnt = top.createEl("input", { type: "text", value: e.countDice ?? String(e.count), cls: "dsa-enc-count", attr: { title: "Zahl oder Würfel, z. B. 1W6" } });
      const plus = top.createEl("button", { text: "+" });
      const setCount = (text: string) => {
        const c = parseCountText(text);
        if (!c) return cnt.addClass("dsa-enc-invalid");
        cnt.removeClass("dsa-enc-invalid");
        e.count = c.count;
        if (c.dice) e.countDice = c.dice;
        else delete e.countDice;
        this.refresh();
      };
      cnt.addEventListener("change", () => setCount(cnt.value));
      minus.addEventListener("click", () => {
        if (e.countDice) return;
        e.count = Math.max(1, e.count - 1);
        cnt.value = String(e.count);
        this.refresh();
      });
      plus.addEventListener("click", () => {
        if (e.countDice) return;
        e.count++;
        cnt.value = String(e.count);
        this.refresh();
      });

      if (adhoc) {
        const nm = top.createEl("input", { type: "text", value: e.creature, cls: "dsa-enc-creature" });
        nm.addEventListener("change", () => {
          e.creature = nm.value.trim() || "Eigener Gegner";
          this.renderChosen();
          this.refresh();
        });
        top.createSpan({ text: cat ? "ohne Wertekasten" : "eigener Gegner", cls: "dsa-mw-muted" });
      } else {
        top.createSpan({ text: cat!.name, cls: "dsa-enc-creature-label" });
        if (cat!.anzahl) top.createEl("small", { text: `Anzahl lt. Bestiarium: ${cat!.anzahl}`, cls: "dsa-mw-muted" });
      }
      const rm = top.createEl("button", { text: "✕", cls: "dsa-enc-remove", attr: { title: "Entfernen" } });
      rm.addEventListener("click", () => {
        this.spec.entries.splice(i, 1);
        this.renderChosen();
        this.refresh();
      });

      const fields = box.createDiv({ cls: "dsa-enc-fields" });
      const base = cat?.combatant;
      const num = (key: NumKey, label: string, placeholder: string, required: boolean) => {
        const w = fields.createEl("label", { cls: "dsa-enc-field" });
        w.createSpan({ text: label + (required ? " *" : "") });
        const inp = w.createEl("input", { type: "text", value: e[key] === undefined ? "" : String(e[key]), placeholder });
        const mark = () => inp.toggleClass("dsa-enc-required", required && e[key] === undefined);
        mark();
        inp.addEventListener("change", () => {
          const t = inp.value.trim();
          if (t === "") delete e[key];
          else if (/^-?\d+$/.test(t)) e[key] = parseInt(t, 10);
          else return inp.addClass("dsa-enc-invalid");
          inp.removeClass("dsa-enc-invalid");
          mark();
          this.refresh();
        });
      };
      const ph = (v: number | null | undefined, variabel = false) => (variabel ? "variabel" : v === null || v === undefined ? "" : String(v));
      num("lep", "LeP", ph(base?.lepMax, base?.needsManual.includes("lep")), !!base?.needsManual.includes("lep"));
      num("ini", "INI", ph(base?.iniBase, base?.needsManual.includes("ini")), !!base?.needsManual.includes("ini"));
      num("rs", "RS", ph(base?.rs), false);
      if (adhoc) {
        num("at", "AT", "", false);
        num("pa", "PA", "", false);
        num("vw", "VW", "", false);
        const w = fields.createEl("label", { cls: "dsa-enc-field" });
        w.createSpan({ text: "TP" });
        const tp = w.createEl("input", { type: "text", value: e.tp ?? "", placeholder: "1W6+3" });
        tp.addEventListener("change", () => {
          const t = tp.value.trim();
          if (!t) delete e.tp;
          else {
            const d = this.normalizeDice(t);
            if (!d) return tp.addClass("dsa-enc-invalid");
            e.tp = d;
          }
          tp.removeClass("dsa-enc-invalid");
          this.refresh();
        });
      }
      const w = fields.createEl("label", { cls: "dsa-enc-field dsa-enc-field-wide" });
      w.createSpan({ text: "Anzeigename" });
      const nm = w.createEl("input", { type: "text", value: e.name ?? "", placeholder: cat?.name ?? e.creature });
      nm.addEventListener("change", () => {
        if (nm.value.trim()) e.name = nm.value.trim();
        else delete e.name;
        this.refresh();
      });
    });
  }

  private normalizeDice(t: string): string | null {
    const m = t.trim().replace(/\s+/g, "").match(/^(\d*)[WwDd](\d+)([+\-–−]\d+)?$/);
    if (!m) return null;
    const bonus = m[3] ? m[3].replace(/[–−]/, "-") : "";
    return `${m[1] || "1"}W${m[2]}${bonus}`;
  }

  // ------------------------------------------------------------ party

  private renderParty() {
    const el = this.partyEl;
    el.empty();
    const heroes = heroRefs(this.plugin);
    if (!heroes.length) {
      const r = el.createDiv({ cls: "dsa-enc-row" });
      r.createSpan({ text: "Keine Heldendaten importiert. " });
      r.createSpan({ text: "helden: " });
      const t = r.createEl("input", { type: "text", value: this.spec.helden ?? "", placeholder: "Kampagne oder Heldennamen (optional)" });
      t.addEventListener("input", () => {
        this.spec.helden = t.value.trim() || undefined;
        this.refresh();
      });
      this.manualFields(el);
      return;
    }
    const campaigns = [...new Set(heroes.map((h) => h.campaign).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    const toks = splitHelden(this.spec.helden);
    let mode = "";
    if (toks.length === 1 && campaigns.some((c) => c.toLowerCase() === toks[0].toLowerCase())) mode = campaigns.find((c) => c.toLowerCase() === toks[0].toLowerCase())!;
    else if (toks.length) mode = "__single";

    const r = el.createDiv({ cls: "dsa-enc-row" });
    const sel = r.createEl("select");
    sel.createEl("option", { text: "Manuell (Anzahl und LeP)", value: "" });
    for (const c of campaigns) sel.createEl("option", { text: `Kampagne: ${c}`, value: c });
    sel.createEl("option", { text: "Einzelne Helden …", value: "__single" });
    sel.value = mode;
    sel.addEventListener("change", () => {
      const v = sel.value;
      this.spec.helden = v === "" ? undefined : v === "__single" ? (resolveParty(this.plugin, this.spec.helden).heroNames.join(", ") || undefined) : v;
      this.renderParty();
      this.refresh();
    });
    if (mode === "__single") {
      const chosen = new Set(resolveParty(this.plugin, this.spec.helden).heroNames);
      const list = el.createDiv({ cls: "dsa-enc-herolist" });
      for (const h of heroes) {
        const lab = list.createEl("label", { cls: "dsa-enc-check" });
        const cb = lab.createEl("input", { type: "checkbox" });
        cb.checked = chosen.has(h.name);
        lab.createSpan({ text: ` ${h.name}` });
        cb.addEventListener("change", () => {
          cb.checked ? chosen.add(h.name) : chosen.delete(h.name);
          this.spec.helden = heroes.filter((x) => chosen.has(x.name)).map((x) => x.name).join(", ") || undefined;
          this.refresh();
        });
      }
    }
    if (mode === "") this.manualFields(el);
  }

  private manualFields(el: HTMLElement) {
    const r = el.createDiv({ cls: "dsa-enc-row" });
    const f = (label: string, key: "count" | "lep") => {
      r.createSpan({ text: label });
      const inp = r.createEl("input", { type: "number", value: String(this.manual[key]), cls: "dsa-enc-count" });
      inp.min = "1";
      inp.addEventListener("input", () => {
        const n = parseInt(inp.value, 10);
        if (n >= 1) {
          this.manual[key] = n;
          this.refresh();
        }
      });
    };
    f("Anzahl Helden ", "count");
    f(" durchschnittliche LeP ", "lep");
  }

  // ------------------------------------------------------------ estimate + actions

  private refresh() {
    const ev = evaluate(this.plugin, this.spec, this.catalog, undefined, this.manual);
    this.warnEl.empty();
    const warn = [...ev.resolved.flatMap((r) => r.warnings), ...(ev.party.unresolved.length ? [`Helden nicht gefunden: ${ev.party.unresolved.join(", ")}`] : [])];
    if (warn.length) {
      const ul = this.warnEl.createEl("ul", { cls: "dsa-enc-warnings" });
      for (const w of warn) ul.createEl("li", { text: w });
    }
    if (!this.spec.entries.length) {
      this.estimateEl.empty();
      return;
    }
    renderEstimatePanel(this.estimateEl, ev.estimate, ev.party.label);
  }

  private cleaned(): EncounterSpec {
    return { ...this.spec, name: this.spec.name?.trim() || undefined, helden: this.spec.helden?.trim() || undefined };
  }

  private insert() {
    if (!this.spec.entries.length) return void new Notice("Keine Gegner gewählt.");
    if (!this.editor) return void new Notice("Keine geöffnete Notiz mit Editor. „Kopieren“ verwenden.");
    this.editor.replaceSelection(toBlock(this.cleaned()) + "\n");
    this.close();
  }

  private async save() {
    if (!this.spec.entries.length) return void new Notice("Keine Gegner gewählt.");
    await this.opts.onSave?.(this.cleaned());
    this.close();
  }

  private async toCockpit() {
    const spec = this.cleaned();
    const party = resolveParty(this.plugin, spec.helden);
    const ok = await loadEncounter(this.plugin, spec, this.catalog, { withHeroes: this.withHeroes && party.heroNames.length > 0 });
    if (ok) this.close();
  }

  private async copy() {
    if (!this.spec.entries.length) return void new Notice("Keine Gegner gewählt.");
    try {
      await navigator.clipboard.writeText(toBlock(this.cleaned()));
      new Notice("Block in die Zwischenablage kopiert.");
    } catch {
      new Notice("Kopieren nicht möglich.");
    }
  }
}

export const openEncounterBuilder = (plugin: DsaMeisterwerkzeugPlugin, opts: BuilderOptions = {}): void => new EncounterBuilderModal(plugin, opts).open();
