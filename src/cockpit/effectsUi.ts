// Cockpit UI for timed effects: chip row per combatant and the add/edit dialog.
import { App, Menu, Modal, Setting } from "obsidian";
import type { CombatEntry, CombatStore } from "../combat/store";
import { EFFECT_PRESETS_FREE, STATUS_DEFS, STATUS_IDS, StatusId } from "../engine/effectConstants";
import { Effect, EffectTick, NewEffect, durationText, effectLabel, effectsOf } from "../engine/effects";
import { STATE_IDS, STATE_LABELS, STATE_LEVEL_TEXT, StateId, clampLevel } from "../engine/states";
import { tryParseDice } from "../engine/dice";
import { ROMAN } from "./logic";
import { markDestructive } from "../util";

const toInt = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Tooltip (GM only) of an effect chip. */
export function effectTooltip(e: Effect): string {
  const parts: string[] = [];
  if (e.kind === "zustand" && e.key) parts.push(STATE_LEVEL_TEXT[e.key as StateId][clampLevel(e.level)]);
  if (e.kind === "status" && e.key) parts.push(STATUS_DEFS[e.key as StatusId].note);
  if (e.tick) parts.push(`${e.tick.mode === "damage" ? "Schaden" : "Heilung"} ${e.tick.dice} pro KR (zu Beginn des Zuges)`);
  if (e.mods) parts.push(["AT", "PA", "VW"].map((k) => ({ k, v: e.mods?.[k.toLowerCase() as "at" | "pa" | "vw"] })).filter((x) => x.v).map((x) => `${x.k} ${x.v}`).join(", "));
  if (e.source) parts.push(`Quelle: ${e.source}`);
  if (e.gmNote) parts.push(e.gmNote);
  parts.push("Klick: ändern · × oder Rechtsklick: entfernen");
  return parts.filter(Boolean).join("\n");
}

/** Row of chips: stored (permanent) Zustände, then timed effects, then the "+ Effekt" button. */
export function renderEffectChips(parent: HTMLElement, store: CombatStore, e: CombatEntry, app: App): void {
  // stored Zustände (set earlier / via the API): permanent, edit via menu
  for (const id of STATE_IDS) {
    const lvl = e.states[id] ?? 0;
    if (id === "schmerz" || lvl <= 0) {
      if (!(id === "schmerz" && lvl > 0)) continue;
    }
    const chip = parent.createSpan({ text: `${STATE_LABELS[id]} ${ROMAN[lvl]} ∞`, cls: "dsa-cp-chip on dsa-cp-fx-state" });
    chip.setAttr("aria-label", `${STATE_LEVEL_TEXT[id][lvl]}\nKlick: Stufe ändern`);
    chip.addEventListener("click", (ev) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Stufe +1").onClick(() => store.setState(e.id, id, lvl + 1)));
      m.addItem((i) => i.setTitle("Stufe −1").onClick(() => store.setState(e.id, id, lvl - 1)));
      m.addItem((i) => i.setTitle("Entfernen").onClick(() => store.setState(e.id, id, 0)));
      m.showAtMouseEvent(ev);
    });
  }
  for (const fx of effectsOf(e)) {
    const chip = parent.createSpan({ cls: `dsa-cp-chip on dsa-cp-fx dsa-cp-fx-${fx.kind}` });
    chip.createSpan({ text: effectLabel(fx) });
    chip.createSpan({ text: ` · ${durationText(fx)}`, cls: "dsa-cp-fx-dur" });
    if (fx.tick) chip.createSpan({ text: fx.tick.mode === "damage" ? ` ${fx.tick.dice}↓` : ` ${fx.tick.dice}↑`, cls: "dsa-cp-fx-tick" });
    if (fx.secret) chip.createSpan({ text: " 🙈" });
    // touch path: the × removes the effect (right-click does the same on desktop)
    const remove = chip.createEl("button", { text: "×", cls: "dsa-cp-fx-remove", attr: { "aria-label": `${effectLabel(fx)} entfernen` } });
    remove.addEventListener("click", (ev) => {
      ev.stopPropagation();
      store.removeEffect(e.id, fx.id);
    });
    chip.setAttr("aria-label", effectTooltip(fx));
    chip.addEventListener("click", () => new EffectModal(app, store, e.id, fx).open());
    chip.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      store.removeEffect(e.id, fx.id);
    });
  }
  const add = parent.createEl("button", { text: "+ Effekt", cls: "dsa-cp-fx-add" });
  add.setAttr("aria-label", "Effekt hinzufügen: Zustand, Status oder Freitext, mit Dauer und Schaden/Heilung pro KR");
  add.addEventListener("click", () => new EffectModal(app, store, e.id, null).open());
}

/** Add (existing = null) or edit/remove an effect. */
export class EffectModal extends Modal {
  private choice: string;
  private name = "";
  private level = 1;
  private duration = "";
  private source = "";
  private gmNote = "";
  private tickDice = "";
  private tickMode: "damage" | "heal" = "damage";
  private at = "";
  private pa = "";
  private vw = "";
  private secret = false;
  private body!: HTMLElement;

  constructor(app: App, private store: CombatStore, private entryId: string, private existing: Effect | null) {
    super(app);
    if (existing) {
      this.choice = existing.kind === "zustand" ? `z:${existing.key}` : existing.kind === "status" ? `s:${existing.key}` : "f:";
      this.name = existing.kind === "frei" ? existing.name : "";
      this.level = existing.level;
      this.duration = existing.duration === null ? "" : String(existing.duration);
      this.source = existing.source ?? "";
      this.gmNote = existing.gmNote ?? "";
      this.tickDice = existing.tick?.dice ?? "";
      this.tickMode = existing.tick?.mode ?? "damage";
      this.at = existing.mods?.at ? String(existing.mods.at) : "";
      this.pa = existing.mods?.pa ? String(existing.mods.pa) : "";
      this.vw = existing.mods?.vw ? String(existing.mods.vw) : "";
      this.secret = !!existing.secret;
    } else this.choice = "z:furcht";
  }

  private applyPreset() {
    const [t, k] = [this.choice[0], this.choice.slice(2)];
    this.tickDice = "";
    if (t === "s") {
      const tk = STATUS_DEFS[k as StatusId].tick;
      if (tk) [this.tickDice, this.tickMode] = [tk.dice, tk.mode];
    } else if (t === "p") {
      const p = EFFECT_PRESETS_FREE[Number(k)];
      this.name = p.name;
      [this.tickDice, this.tickMode] = [p.tick.dice, p.tick.mode];
    }
  }

  onOpen() {
    const e = this.store.get(this.entryId);
    if (!e) return this.close();
    this.titleEl.setText(`${e.name}: ${this.existing ? "Effekt ändern" : "Effekt hinzufügen"}`);
    this.body = this.contentEl.createDiv();
    this.build();
  }
  onClose() {
    this.contentEl.empty();
  }

  private build() {
    const el = this.body;
    el.empty();
    const kind = this.choice[0];
    if (!this.existing) {
      new Setting(el).setName("Vorlage").addDropdown((d) => {
        const g = (label: string) => d.selectEl.createEl("optgroup", { attr: { label } });
        const z = g("Zustände (Stufe I–IV)");
        for (const id of STATE_IDS) z.createEl("option", { text: STATE_LABELS[id], value: `z:${id}` });
        const s = g("Status");
        for (const id of STATUS_IDS) s.createEl("option", { text: STATUS_DEFS[id].label, value: `s:${id}` });
        const p = g("Mit Schaden/Heilung pro KR");
        EFFECT_PRESETS_FREE.forEach((x, i) => p.createEl("option", { text: x.name, value: `p:${i}` }));
        g("Freitext").createEl("option", { text: "Eigener Effekt …", value: "f:" });
        d.setValue(this.choice).onChange((v) => {
          this.choice = v;
          this.applyPreset();
          this.build();
        });
      });
    }
    const isFree = kind === "f" || kind === "p";
    if (isFree) new Setting(el).setName("Name").addText((t) => t.setValue(this.name).setPlaceholder("z. B. Gift, Segen, Netz").onChange((v) => (this.name = v)));
    if (kind === "z") {
      new Setting(el).setName("Stufe").addDropdown((d) => {
        for (const n of [1, 2, 3, 4]) d.addOption(String(n), ROMAN[n]);
        d.setValue(String(this.level || 1)).onChange((v) => {
          this.level = Number(v);
          hint.setText(STATE_LEVEL_TEXT[this.choice.slice(2) as StateId][this.level]);
        });
      });
      const hint = el.createEl("p", { cls: "dsa-mw-muted", text: STATE_LEVEL_TEXT[this.choice.slice(2) as StateId]?.[this.level || 1] ?? "" });
    }
    if (kind === "s") el.createEl("p", { cls: "dsa-mw-muted", text: STATUS_DEFS[this.choice.slice(2) as StatusId].note });
    new Setting(el).setName("Dauer (Kampfrunden)").setDesc("leer = unbegrenzt; wird bei jedem Rundenwechsel um 1 verringert").addText((t) => {
      t.setValue(this.duration).setPlaceholder("∞").onChange((v) => (this.duration = v));
      t.inputEl.type = "number";
      t.inputEl.min = "1";
    });
    new Setting(el).setName("Quelle").addText((t) => t.setValue(this.source).setPlaceholder("z. B. Feuerball, Giftpfeil").onChange((v) => (this.source = v)));
    new Setting(el).setName("Pro KR (zu Beginn des Zuges)").setDesc("Würfel, z. B. 1W6 oder 1W3+1; leer = nichts").addText((t) => {
      t.setValue(this.tickDice).setPlaceholder("1W6").onChange((v) => (this.tickDice = v));
      t.inputEl.addClass("dsa-cp-input-dice");
    }).addDropdown((d) => d.addOption("damage", "Schaden (SP)").addOption("heal", "Heilung (LeP)").setValue(this.tickMode).onChange((v) => (this.tickMode = v as "damage" | "heal")));
    if (isFree) {
      new Setting(el).setName("Modifikatoren AT / PA / VW").setDesc("negativ = schwerer").addText((t) => this.num(t, this.at, "AT", (v) => (this.at = v))).addText((t) => this.num(t, this.pa, "PA", (v) => (this.pa = v))).addText((t) => this.num(t, this.vw, "VW", (v) => (this.vw = v)));
    }
    new Setting(el).setName("Notiz (nur Spielleiter)").addText((t) => t.setValue(this.gmNote).onChange((v) => (this.gmNote = v)));
    new Setting(el).setName("Vor Spielern verbergen").addToggle((t) => t.setValue(this.secret).onChange((v) => (this.secret = v)));
    const err = el.createEl("p", { cls: "dsa-cp-error" });
    const btns = new Setting(el);
    btns.addButton((b) => b.setButtonText(this.existing ? "Speichern" : "Hinzufügen").setCta().onClick(() => this.save(err)));
    if (this.existing) btns.addButton((b) => markDestructive(b.setButtonText("Entfernen")).onClick(() => {
      this.store.removeEffect(this.entryId, (this.existing as Effect).id);
      this.close();
    }));
    btns.addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()));
  }

  private num(t: import("obsidian").TextComponent, v: string, ph: string, set: (v: string) => void) {
    t.setValue(v).setPlaceholder(ph).onChange(set);
    t.inputEl.type = "number";
    t.inputEl.addClass("dsa-cp-input-mod");
  }

  private save(err: HTMLElement) {
    const kindCh = this.choice[0];
    const key = this.choice.slice(2);
    const dur = toInt(this.duration);
    if (this.duration.trim() !== "" && (dur === null || dur < 1)) return void err.setText("Dauer: ganze Zahl ab 1 oder leer.");
    let tick: EffectTick | null = null;
    if (this.tickDice.trim()) {
      if (!tryParseDice(this.tickDice)) return void err.setText("Würfel unlesbar (erwartet z. B. 1W6, 1W3+1, 2).");
      tick = { dice: this.tickDice.trim(), mode: this.tickMode };
    }
    const isFree = kindCh === "f" || kindCh === "p";
    if (isFree && !this.name.trim()) return void err.setText("Bitte einen Namen eintragen.");
    const mods = isFree ? { at: toInt(this.at) ?? 0, pa: toInt(this.pa) ?? 0, vw: toInt(this.vw) ?? 0 } : undefined;
    const common = { level: this.level || 1, duration: dur, source: this.source, gmNote: this.gmNote, tick, secret: this.secret };
    if (this.existing) {
      this.store.updateEffect(this.entryId, this.existing.id, { ...common, name: isFree ? this.name : this.existing.name, mods: mods ?? this.existing.mods ?? undefined });
    } else {
      const n: NewEffect =
        kindCh === "z" ? { kind: "zustand", key: key as StateId, ...common } :
        kindCh === "s" ? { kind: "status", key: key as StatusId, ...common } :
        { kind: "frei", name: this.name, ...common, mods };
      this.store.addEffect(this.entryId, n);
    }
    this.close();
  }
}
