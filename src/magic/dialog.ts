// Cast dialog: caster -> spell -> modifiers -> roll -> result (+ apply cost). Look and feel like the probe result.
import { AbstractInputSuggest, App, Modal, Notice, Setting } from "obsidian";
import { ATTR_KEYS, AttrKey } from "../engine/types";
import type DsaMeisterwerkzeugPlugin from "../main";
import { Caster, findKnown } from "./casters";
import { magicRepo } from "./repository";
import { CastInput, CastResult, canAfford, castEventText, energyOf, fullCost, resolveCast } from "./resolve";
import { SpellDef, SpellKind, findSpell } from "./spells";
import { asyncHandler } from "../util";

export interface CastDialogOptions {
  casterName?: string;
  heroPath?: string;
  creaturePath?: string;
  spell?: string;
  kind?: SpellKind;
  modifier?: number;
  /** called after every resolved roll (e.g. cockpit log) */
  onResult?: (result: CastResult) => void;
  /** when set, the cost can be applied to a creature (only for `creaturePath`); the caller tracks the spent energy */
  onSpend?: (energy: "AsP" | "KaP", amount: number) => void;
  /** energy the creature still has in the current combat (overrides the statblock value for `creaturePath`) */
  energyLeft?: { AsP?: number | null; KaP?: number | null };
}

class NameSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, input: HTMLInputElement, private names: () => string[], private onPick: (n: string) => void) {
    super(app, input);
  }
  getSuggestions(q: string) {
    const n = q.toLowerCase();
    return this.names().filter((x) => x.toLowerCase().includes(n)).slice(0, 30);
  }
  renderSuggestion(v: string, el: HTMLElement) {
    el.setText(v);
  }
  selectSuggestion(v: string) {
    this.onPick(v);
    this.close();
  }
}

const NO_CASTER = "__none__";

export class CastModal extends Modal {
  private kind: SpellKind;
  private casters: Caster[] = [];
  private caster: Caster | null = null;
  private rules: SpellDef[] = [];
  private spellName = "";
  private spell: SpellDef | null = null;
  private fw = 0;
  private attrKeys: [AttrKey, AttrKey, AttrKey] = ["MU", "KL", "IN"];
  private attrVals: [number, number, number] = [10, 10, 10];
  private costBasis: number | null = null;
  private costMult = 1;
  private modifier = 0;
  private useRes = false;
  private resValue = 0;
  private statePenalty = 0;
  private resultEl!: HTMLElement;
  private formEl!: HTMLElement;
  private override = false;

  constructor(private plugin: DsaMeisterwerkzeugPlugin, private opts: CastDialogOptions = {}) {
    super(plugin.app);
    this.kind = opts.kind ?? "zauber";
    this.modifier = opts.modifier ?? 0;
    this.spellName = opts.spell ?? "";
  }

  async onOpen() {
    this.modalEl.addClass("dsa-magic-modal");
    this.titleEl.setText(this.kind === "zauber" ? "Zauber wirken" : "Liturgie wirken");
    const repo = magicRepo(this.plugin);
    this.rules = await repo.all();
    this.casters = [...repo.heroCasters(), ...repo.creatureCasters()];
    const o = this.opts;
    if (o.creaturePath && !this.casters.some((c) => c.notePath === o.creaturePath)) {
      const c = repo.creatureCaster(o.creaturePath);
      if (c) this.casters.push(c);
    }
    this.caster =
      (o.heroPath && this.casters.find((c) => c.kind === "hero" && c.notePath === o.heroPath)) ||
      (o.creaturePath && this.casters.find((c) => c.kind === "creature" && c.notePath === o.creaturePath)) ||
      (o.casterName && this.casters.find((c) => c.label.toLowerCase() === o.casterName!.toLowerCase())) ||
      null;
    if (this.caster?.kind === "creature" && o.energyLeft && this.caster.notePath === o.creaturePath) {
      if (o.energyLeft.AsP !== undefined) this.caster.asp = o.energyLeft.AsP;
      if (o.energyLeft.KaP !== undefined) this.caster.kap = o.energyLeft.KaP;
    }
    if (!this.caster && !o.casterName && !o.heroPath && !o.creaturePath) this.caster = this.casters.find((c) => c.kind === "hero") ?? null;
    await this.pickSpell(this.spellName, true);
    this.formEl = this.contentEl.createDiv({ cls: "dsa-magic-form" });
    this.resultEl = this.contentEl.createDiv({ cls: "dsa-magic-resulthost" });
    this.renderForm();
  }

  onClose() {
    this.contentEl.empty();
  }

  /** Resolve the rule note / remembered attributes / known FW for the current spell name. */
  private async pickSpell(name: string, initial = false) {
    this.spellName = name.trim();
    this.spell = this.spellName ? findSpell(this.rules, this.spellName, this.kind) ?? findSpell(this.rules, this.spellName) : null;
    if (this.spell) {
      this.attrKeys = this.spell.probe;
      this.costBasis = this.spell.kostenBasis;
      if (this.spell.kind !== this.kind) this.kind = this.spell.kind;
      if (this.spell.modifizierbar && !initial) this.useRes = true;
      if (initial && this.spell.modifizierbar) this.useRes = false;
    } else if (this.spellName) {
      const mem = await magicRepo(this.plugin).remembered(this.spellName);
      if (mem) {
        this.attrKeys = mem.probe;
        this.costBasis = mem.kosten ?? null;
      }
    }
    // FW of the spell for this caster; 0 when the caster does not know it (no stale FW from the previous spell)
    const known = this.caster && this.spellName ? findKnown(this.caster, this.spellName) : null;
    this.fw = known?.fw ?? 0;
    this.syncAttrValues();
  }

  /** Attribute values from the caster; an attribute the caster does not have keeps the value at the same index (or 10). */
  private syncAttrValues() {
    const c = this.caster;
    this.attrVals = this.attrKeys.map((k, i) => c?.attrs[k] ?? this.attrVals[i] ?? 10) as [number, number, number];
  }

  private energyAvailable(): number | null {
    if (!this.caster) return null;
    return energyOf(this.kind) === "AsP" ? this.caster.asp : this.caster.kap;
  }

  private renderForm() {
    const el = this.formEl;
    el.empty();
    const energy = energyOf(this.kind);

    new Setting(el).setName("Art").addDropdown((d) =>
      d
        .addOption("zauber", "Zauber")
        .addOption("liturgie", "Liturgie")
        .setValue(this.kind)
        .onChange(asyncHandler(async (v: string) => {
          this.kind = v as SpellKind;
          this.titleEl.setText(this.kind === "zauber" ? "Zauber wirken" : "Liturgie wirken");
          await this.pickSpell(this.spellName);
          this.renderForm();
        })),
    );

    new Setting(el).setName("Wirkender").addDropdown((d) => {
      d.addOption(NO_CASTER, "Ohne Wirkenden (manuell)");
      const heroes = this.casters.filter((c) => c.kind === "hero");
      const creatures = this.casters.filter((c) => c.kind === "creature");
      for (const c of heroes) d.addOption(c.id, c.label);
      for (const c of creatures) d.addOption(c.id, `${c.label} (Bestiarium)`);
      d.setValue(this.caster?.id ?? NO_CASTER).onChange(asyncHandler(async (v: string) => {
        this.caster = this.casters.find((c) => c.id === v) ?? null;
        await this.pickSpell(this.spellName);
        this.renderForm();
      }));
    });

    new Setting(el)
      .setName(this.kind === "zauber" ? "Zauber" : "Liturgie")
      .setDesc(this.spell ? `${this.spell.merkmal || "–"} · Probe ${this.spell.probe.join("/")}${this.spell.modifizierbar ? ` (mod. ${this.spell.modifizierbar})` : ""}${this.spell.probeFallback ? " · Hinweis: Probe-Zeile nicht lesbar, Standard MU/KL/IN – bitte in der Regelnotiz prüfen." : ""}` : this.spellName ? "Keine Regelnotiz gefunden – Eigenschaften unten angeben." : "")
      .addText((t) => {
        t.setPlaceholder("Name").setValue(this.spellName);
        const names = () => {
          const known = (this.caster?.known ?? []).filter((k) => k.kind === this.kind).map((k) => k.name);
          const rules = this.rules.filter((r) => r.kind === this.kind).map((r) => r.name);
          return [...new Set([...known, ...rules])];
        };
        new NameSuggest(this.app, t.inputEl, names, (n) => {
          t.setValue(n);
          void this.pickSpell(n).then(() => this.renderForm());
        });
        t.inputEl.addEventListener("change", () => {
          void this.pickSpell(t.inputEl.value).then(() => this.renderForm());
        });
      });

    if (this.caster && this.caster.known.length) {
      const chips = el.createDiv({ cls: "dsa-magic-chips" });
      for (const k of this.caster.known.filter((x) => x.kind === this.kind)) {
        const b = chips.createEl("button", { cls: "dsa-magic-chip", text: `${k.name} ${k.fw}` });
        if (k.unresolved) b.title = "Name noch nicht in heldenschmiede-keys.json eingetragen";
        b.addEventListener("click", () => {
          this.fw = k.fw;
          void this.pickSpell(k.name).then(() => this.renderForm());
        });
      }
    }

    new Setting(el).setName("Fertigkeitswert (FW)").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.addClass("dsa-magic-num");
      t.setValue(String(this.fw)).onChange((v) => (this.fw = Math.max(0, Number(v) || 0)));
    });

    // attributes: selects only when there is no rule note
    const row = el.createDiv({ cls: "dsa-magic-attrs" });
    for (let i = 0; i < 3; i++) {
      const cell = row.createDiv({ cls: "dsa-magic-attr" });
      if (this.spell) cell.createSpan({ text: this.attrKeys[i] });
      else {
        const sel = cell.createEl("select");
        for (const k of ATTR_KEYS) sel.createEl("option", { text: k, value: k });
        sel.value = this.attrKeys[i];
        sel.addEventListener("change", () => {
          this.attrKeys[i] = sel.value as AttrKey;
          this.attrVals[i] = this.caster?.attrs[this.attrKeys[i]] ?? this.attrVals[i];
          this.renderForm();
        });
      }
      const inp = cell.createEl("input", { type: "number" });
      inp.addClass("dsa-magic-num");
      inp.value = String(this.attrVals[i]);
      inp.addEventListener("input", () => (this.attrVals[i] = Number(inp.value) || 0));
    }

    new Setting(el)
      .setName(`Basiskosten (${energy})`)
      .setDesc(this.spell ? this.spell.kostenText : "")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("dsa-magic-num");
        t.setValue(this.costBasis === null ? "" : String(this.costBasis)).onChange((v) => (this.costBasis = v.trim() === "" ? null : Number(v)));
      })
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.step = "0.05";
        t.inputEl.addClass("dsa-magic-num");
        t.inputEl.title = "Kostenfaktor (Kosten senken: z. B. 0,75)";
        t.setValue(String(this.costMult)).onChange((v) => (this.costMult = Number(v.replace(",", ".")) || 1));
      });

    new Setting(el).setName("Modifikator").setDesc("positiv = leichter, negativ = schwerer (Erschwernis für Zauberdauer/Reichweite etc.)").addText((t) => {
      t.inputEl.type = "number";
      t.inputEl.addClass("dsa-magic-num");
      t.setValue(String(this.modifier)).onChange((v) => (this.modifier = Number(v) || 0));
    });

    const res = this.spell?.modifizierbar ?? null;
    new Setting(el)
      .setName(`Ziel-${res ?? "SK/ZK"} abziehen`)
      .setDesc(res ? `Die Probe ist mod. ${res}.` : "Nur wenn die Regel es verlangt.")
      .addToggle((tg) => tg.setValue(this.useRes).onChange((v) => (this.useRes = v)))
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.addClass("dsa-magic-num");
        t.setValue(String(this.resValue)).onChange((v) => (this.resValue = Math.max(0, Number(v) || 0)));
      });

    if (this.spell) {
      const info = el.createDiv({ cls: "dsa-magic-info" });
      for (const [l, v] of [["Dauer", this.spell.zauberdauer], ["Reichweite", this.spell.reichweite], ["Wirkungsdauer", this.spell.wirkungsdauer], ["Ziel", this.spell.zielkategorie]] as const)
        if (v) info.createSpan({ text: `${l}: ${v}` });
    }
    const avail = this.energyAvailable();
    if (this.caster) el.createDiv({ cls: "dsa-magic-energy", text: avail === null ? `${energy}: unbekannt` : `${energy} aktuell: ${avail}` });

    new Setting(el).addButton((b) =>
      b
        .setButtonText("Wirken")
        .setCta()
        .onClick(() => this.cast()),
    );
  }

  private currentInput(): CastInput | null {
    if (!this.spellName) {
      new Notice(`Bitte ${this.kind === "zauber" ? "einen Zauber" : "eine Liturgie"} wählen.`);
      return null;
    }
    return {
      name: this.spell?.name ?? this.spellName,
      kind: this.kind,
      attrs: [...this.attrVals] as [number, number, number],
      attrLabels: [...this.attrKeys] as [string, string, string],
      fw: this.fw,
      modifier: this.modifier,
      resistance: this.useRes ? this.resValue : 0,
      resistanceLabel: this.spell?.modifizierbar ?? null,
      costBasis: this.costBasis,
      costMultiplier: this.costMult,
      spell: this.spell,
    };
  }

  private cast(force = false) {
    const input = this.currentInput();
    if (!input) return;
    const energy = energyOf(this.kind);
    const need = fullCost(input.costBasis, input.costMultiplier);
    const avail = this.energyAvailable();
    if (!force && this.caster && !canAfford(avail, need)) {
      this.resultEl.empty();
      const box = this.resultEl.createDiv({ cls: "dsa-magic-refuse" });
      box.createSpan({ text: `${this.caster.label} hat nicht genug ${energy}: ${avail} von ${need} nötig.` });
      const b = box.createEl("button", { text: "Trotzdem wirken" });
      b.addEventListener("click", () => this.cast(true));
      new Notice(`Nicht genug ${energy}.`);
      return;
    }
    if (!this.spell) void magicRepo(this.plugin).remember(this.spellName, { probe: this.attrKeys, kosten: this.costBasis });
    const result = resolveCast(input);
    const casterName = this.caster?.label ?? "Wirkender";
    this.plugin.table.emit({
      type: "cast",
      text: castEventText(casterName, result),
      data: { caster: casterName, spell: result.input.name, kind: result.input.kind, success: result.success, qs: result.qs, critical: result.critical, cost: result.costPaid, energy: result.energy },
    });
    this.renderResult(result);
    try {
      this.opts.onResult?.(result);
    } catch (err) {
      console.error("cast onResult failed", err);
    }
  }

  private renderResult(r: CastResult) {
    const el = this.resultEl;
    el.empty();
    const wrap = el.createDiv({ cls: "dsa-probe dsa-probe-result dsa-magic-result" });
    const head = wrap.createDiv({ cls: "dsa-magic-head" });
    head.createSpan({ cls: "dsa-probe-name", text: `${this.caster?.label ?? "Wirkender"}: ${r.input.name}` });
    const crit = r.critical === "success" ? " · kritischer Erfolg" : r.critical === "patzer" ? " · Patzer" : "";
    head.createSpan({ cls: `dsa-probe-verdict ${r.success ? "is-success" : "is-fail"}`, text: (r.success ? `QS ${r.qs}` : "misslungen") + crit });

    const c = r.check;
    const line = wrap.createDiv({ cls: "dsa-probe-dice" });
    c.dice.forEach((d, i) => {
      const cls = d === 1 ? "dsa-probe-die is-one" : d === 20 ? "dsa-probe-die is-twenty" : d > c.attrEffective[i] ? "dsa-probe-die is-over" : "dsa-probe-die";
      const dieEl = line.createSpan({ cls });
      dieEl.setText(`${d}`);
      dieEl.title = `${r.input.attrLabels?.[i] ?? ""} ${c.attrEffective[i]}${c.modifierTotal ? ` (Basis ${c.attrBase[i]}, Modifikator ${c.modifierTotal > 0 ? "+" : ""}${c.modifierTotal})` : ""}`;
      line.createSpan({ cls: "dsa-probe-vs", text: `/${c.attrEffective[i]}` });
    });
    line.createSpan({ cls: "dsa-probe-points", text: `FW ${c.fw}, benötigt ${c.fwUsed} → ${c.remaining >= 0 ? "Rest " + c.remaining : "fehlen " + -c.remaining}` });

    const cost = wrap.createDiv({ cls: "dsa-magic-cost" });
    if (r.costPaid === null) cost.setText(`Kosten unbekannt (${r.input.spell?.kostenText || "keine Angabe"}).`);
    else {
      const f = r.costFactor === 1 ? "" : ` (${r.costFull} ${r.energy}, ×${r.costFactor})`;
      cost.setText(`Kosten: ${r.costPaid} ${r.energy}${f}`);
      if (r.input.spell && /je |\+/.test(r.input.spell.kostenText)) cost.createSpan({ cls: "dsa-probe-points", text: ` · laufend: ${r.input.spell.kostenText}` });
    }

    if (r.success && (r.wirkung || r.wirkungsdauer)) {
      const t = wrap.createDiv({ cls: "dsa-magic-effect" });
      if (r.wirkungsdauer) t.createDiv({ text: `Wirkungsdauer: ${r.wirkungsdauer}` });
      if (r.wirkung) t.createDiv({ text: r.wirkung });
    } else if (!r.success && r.input.spell?.wirkung) {
      wrap.createEl("details", { cls: "dsa-probe-hidden" }).createEl("summary", { text: "Wirkung bei Erfolg" }).parentElement!.createDiv({ text: r.input.spell.wirkung });
    }

    const tools = wrap.createDiv({ cls: "dsa-magic-tools" });
    const again = tools.createEl("button", { text: "↻ Neu würfeln" });
    again.addEventListener("click", () => this.cast(true));
    if (r.costPaid !== null && r.costPaid > 0) {
      const heroCaster = this.caster?.kind === "hero" && this.caster.notePath;
      const canApply = !!heroCaster || this.canSpendCreature();
      const apply = tools.createEl("button", { cls: "mod-cta", text: canApply ? `${r.costPaid} ${r.energy} abziehen` : `${r.costPaid} ${r.energy} (nur Anzeige)` });
      if (!canApply) apply.disabled = true;
      apply.addEventListener("click", () => void this.applyCost(r, apply));
    }
  }

  private canSpendCreature(): boolean {
    return !!this.opts.onSpend && this.caster?.kind === "creature" && !!this.opts.creaturePath && this.caster.notePath === this.opts.creaturePath;
  }

  private async applyCost(r: CastResult, btn: HTMLButtonElement) {
    const caster = this.caster;
    if (!caster || r.costPaid === null) return;
    const avail = r.energy === "AsP" ? caster.asp : caster.kap;
    if (!this.override && !canAfford(avail, r.costPaid)) {
      btn.setText(`Zu wenig ${r.energy} (${avail}) – trotzdem abziehen`);
      this.override = true;
      return;
    }
    this.override = false;
    let left: number | null;
    if (caster.kind === "creature") {
      this.opts.onSpend?.(r.energy, r.costPaid);
      left = Math.max(0, (avail ?? 0) - r.costPaid);
    } else left = await magicRepo(this.plugin).spend(caster, r.energy, r.costPaid);
    if (left === null) {
      new Notice(`${r.energy} konnte nicht abgezogen werden (kein ${r.energy}-Wert in der Heldennotiz).`);
      return;
    }
    if (r.energy === "AsP") caster.asp = left;
    else caster.kap = left;
    btn.disabled = true;
    btn.setText(`abgezogen: ${r.energy} ${left}`);
    new Notice(`${caster.label}: ${r.energy} ${left}`);
    this.renderFormEnergyOnly();
  }

  private renderFormEnergyOnly() {
    const e = this.formEl.querySelector(".dsa-magic-energy");
    const avail = this.energyAvailable();
    if (e) e.setText(`${energyOf(this.kind)} aktuell: ${avail ?? "unbekannt"}`);
  }
}
