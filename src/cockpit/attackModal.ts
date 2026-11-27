// Attack dialog: prepared roll (itemised) -> resolveAttack -> result card -> apply / discard.
import { App, Modal, Notice } from "obsidian";
import type { CombatStore, CombatEntry } from "../combat/store";
import { AttackKind, AttackParams, AttackResult, RangedDefenseKind, reassignZone, resolveAttack } from "../engine/combat";
import { defaultRoller } from "../engine/dice";
import { reachFromText } from "../engine/effects";
import { STATE_LABELS } from "../engine/states";
import { ZONE_LABEL, ZoneKey, rollWoundExtraSP, targetableZones, woundEffectToApply, WOUND_EXTRA_SP } from "../engine/hitzones";
import type { Weapon } from "../model";
import {
  AttackInput, OUTCOME_LABEL, ROMAN, buildAttackParams, defenseOptions, describeCheck, describeDamage, describeWound, describeZone, effectInfo, previewAttack, reachOfDefenseOption,
  summarizeResult, validateAttackInput, weaponValue, PreviewCheck,
} from "./logic";

export interface RollLogEntry {
  time: number;
  text: string;
  /** "effect" = log line of a timed effect (tick, expiry, added/removed) */
  outcome: AttackResult["outcome"] | "effect";
  applied: boolean;
}

const STATE_PREFIXES = Object.values(STATE_LABELS);
/** modifier lines that stem from Zustände (e.g. "Schmerz II"), Status ("Status Liegend") or free effects ("Effekt …") */
const isEffectLine = (label: string): boolean => label.startsWith("Status ") || label.startsWith("Effekt ") || STATE_PREFIXES.some((p) => label.startsWith(p + " "));
const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "±0");

export class AttackModal extends Modal {
  private kind: AttackKind;
  private atValue = "";
  private tp = "";
  private atMod = "0";
  private tpMod = "0";
  private rangedMod = "0";
  private defMod = "0";
  private rangedType: RangedDefenseKind = "schuss";
  private defId: string;
  private defValue = "";
  private patzerMode: "tabelle" | "sp" = "tabelle";
  private ignoreBlock = false;
  /** Trefferzonen: zone the attacker aims at ("" = roll after an undefended hit) and Gezielter Angriff/Schuss */
  private zone: ZoneKey | "" = "";
  private zoneSf = false;
  /** Trefferzonen: zone fixed by hand ("" = none); no roll, no penalty */
  private zoneFixed: ZoneKey | "" = "";
  /** params of the current roll, needed to move the hit to another zone without re-rolling */
  private params: AttackParams | null = null;
  private previewEl!: HTMLElement;
  private formEl!: HTMLElement;
  private resultEl!: HTMLElement;
  private result: AttackResult | null = null;
  private logEntry: RollLogEntry | null = null;
  private applied = false;

  constructor(
    app: App,
    private store: CombatStore,
    private attackerId: string,
    private defenderId: string,
    private weapon: Weapon | null,
    private pushLog: (e: RollLogEntry) => void,
    private onLogChange: () => void,
    /** setting "Trefferzonen"; false = the dialog behaves exactly as without the rule */
    private hitZones = false,
  ) {
    super(app);
    this.kind = weapon?.kind === "ranged" ? "fernkampf" : "nahkampf";
    const v = weaponValue(weapon);
    this.atValue = v !== null ? String(v) : "";
    this.tp = weapon?.tp ?? "";
    const d = this.defender();
    this.defId = d ? defenseOptions(d, this.kind).defaultId : "none";
    this.syncDefValue();
  }

  private attacker = (): CombatEntry | undefined => this.store.get(this.attackerId);
  private defender = (): CombatEntry | undefined => this.store.get(this.defenderId);

  private syncDefValue() {
    const d = this.defender();
    if (!d) return;
    const o = defenseOptions(d, this.kind).options.find((x) => x.id === this.defId);
    this.defValue = o?.value !== null && o?.value !== undefined ? String(o.value) : "";
  }

  private num(s: string): number {
    const t = s.trim().replace(",", ".");
    return t === "" ? NaN : Number(t);
  }
  private numOr0(s: string): number {
    const n = this.num(s);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  private input(): AttackInput | null {
    const a = this.attacker();
    const d = this.defender();
    if (!a || !d) return null;
    const opt = defenseOptions(d, this.kind).options.find((o) => o.id === this.defId);
    return {
      kind: this.kind,
      attacker: a,
      defender: d,
      value: this.num(this.atValue),
      tp: this.tp.trim(),
      atMod: this.numOr0(this.atMod),
      tpMod: this.numOr0(this.tpMod),
      rangedMod: this.numOr0(this.rangedMod),
      defense: opt && opt.kind ? { kind: opt.kind, value: this.num(this.defValue) } : null,
      defenseMod: this.numOr0(this.defMod),
      rangedType: this.rangedType,
      patzerMode: this.patzerMode,
      attackerReach: reachFromText(this.weapon?.rw),
      defenderReach: reachOfDefenseOption(d, this.defId),
      ignoreDefenseBlock: this.ignoreBlock,
      ...(this.hitZones ? { hitZones: { targeted: this.zone || null, sf: this.zoneSf, fixed: this.zoneFixed || null } } : {}),
    };
  }

  onOpen() {
    this.modalEl.addClass("dsa-cp-attack");
    const a = this.attacker();
    const d = this.defender();
    if (!a || !d) return this.close();
    this.titleEl.setText(`${a.name} (${this.weapon?.name ?? "manuell"}) → ${d.name}`);
    this.formEl = this.contentEl.createDiv();
    this.resultEl = this.contentEl.createDiv();
    this.buildForm();
  }

  onClose() {
    this.contentEl.empty();
  }

  // ------------------------------------------------------------ form
  private field(parent: HTMLElement, label: string, value: string, set: (v: string) => void, opts: { text?: boolean; placeholder?: string } = {}) {
    const row = parent.createDiv({ cls: "dsa-cp-field" });
    row.createEl("label", { text: label });
    const inp = row.createEl("input", { type: opts.text ? "text" : "number", value });
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    inp.addEventListener("input", () => {
      set(inp.value);
      this.renderPreview();
    });
    inp.addEventListener("keydown", (e) => e.key === "Enter" && this.roll());
    return inp;
  }

  private buildForm() {
    const f = this.formEl;
    f.empty();
    const a = this.attacker();
    const d = this.defender();
    if (!a || !d) return;
    const g = f.createDiv({ cls: "dsa-cp-grid" });

    const left = g.createDiv({ cls: "dsa-cp-col" });
    left.createEl("h4", { text: "Angriff" });
    const kindRow = left.createDiv({ cls: "dsa-cp-field" });
    kindRow.createEl("label", { text: "Art" });
    const ks = kindRow.createEl("select");
    ks.createEl("option", { text: "Nahkampf", value: "nahkampf" });
    ks.createEl("option", { text: "Fernkampf", value: "fernkampf" });
    ks.value = this.kind;
    ks.addEventListener("change", () => {
      this.kind = ks.value as AttackKind;
      this.defId = defenseOptions(d, this.kind).defaultId;
      this.syncDefValue();
      this.buildForm();
    });
    const noValue = !this.weapon || weaponValue(this.weapon) === null || !this.weapon.tp;
    if (noValue) left.createEl("p", { text: "Waffenwerte unvollständig – bitte AT/FK und TP eintragen.", cls: "dsa-cp-warn" });
    this.field(left, this.kind === "fernkampf" ? "FK" : "AT", this.atValue, (v) => (this.atValue = v));
    this.field(left, "TP (Würfel)", this.tp, (v) => (this.tp = v), { text: true, placeholder: "1W6+4" });
    this.field(left, `Mod. ${this.kind === "fernkampf" ? "FK" : "AT"} (+leichter / −schwerer)`, this.atMod, (v) => (this.atMod = v));
    this.field(left, "Mod. TP (z. B. Wuchtschlag +2)", this.tpMod, (v) => (this.tpMod = v));
    if (this.kind === "fernkampf") {
      this.field(left, "Mod. Fernkampf (Entfernung, Größe, Sicht)", this.rangedMod, (v) => (this.rangedMod = v));
      const tr = left.createDiv({ cls: "dsa-cp-field" });
      tr.createEl("label", { text: "Waffenart (Verteidigung)" });
      const ts = tr.createEl("select");
      ts.createEl("option", { text: "Schusswaffe (−4)", value: "schuss" });
      ts.createEl("option", { text: "Wurfwaffe (−2)", value: "wurf" });
      ts.value = this.rangedType;
      ts.addEventListener("change", () => {
        this.rangedType = ts.value as RangedDefenseKind;
        this.renderPreview();
      });
    }

    if (this.hitZones) this.buildZoneFields(left, d);

    const right = g.createDiv({ cls: "dsa-cp-col" });
    right.createEl("h4", { text: "Verteidigung" });
    const dr = right.createDiv({ cls: "dsa-cp-field" });
    dr.createEl("label", { text: "Verteidigung" });
    const ds = dr.createEl("select");
    const { options } = defenseOptions(d, this.kind);
    for (const o of options) ds.createEl("option", { text: o.label, value: o.id });
    ds.value = this.defId;
    ds.addEventListener("change", () => {
      this.defId = ds.value;
      this.syncDefValue();
      this.buildForm();
    });
    const cur = options.find((o) => o.id === this.defId);
    if (cur?.kind) {
      this.field(right, cur.kind === "PA" ? "PA-Wert" : "Ausweichen-Wert", this.defValue, (v) => (this.defValue = v));
      this.field(right, "Mod. Verteidigung", this.defMod, (v) => (this.defMod = v));
      const blocked = effectInfo({ ...(this.input() as AttackInput) }).defenseBlocked;
      if (blocked) {
        right.createEl("p", { text: `${blocked}.`, cls: "dsa-cp-warn" });
        const cb = right.createDiv({ cls: "dsa-cp-field" });
        cb.createEl("label", { text: "Trotzdem verteidigen lassen" });
        const box = cb.createEl("input", { type: "checkbox" });
        box.checked = this.ignoreBlock;
        box.addEventListener("change", () => {
          this.ignoreBlock = box.checked;
          this.buildForm();
        });
      }
    } else right.createEl("p", { text: "Das Ziel verteidigt sich nicht.", cls: "dsa-mw-muted" });
    const pr = right.createDiv({ cls: "dsa-cp-field" });
    pr.createEl("label", { text: "Patzer" });
    const ps = pr.createEl("select");
    ps.createEl("option", { text: "2W6-Tabelle", value: "tabelle" });
    ps.createEl("option", { text: "Pauschal 1W6+2 SP", value: "sp" });
    ps.value = this.patzerMode;
    ps.addEventListener("change", () => (this.patzerMode = ps.value as "tabelle" | "sp"));

    this.previewEl = f.createDiv({ cls: "dsa-cp-preview" });
    this.renderPreview();

    const btns = f.createDiv({ cls: "dsa-cp-buttons" });
    btns.createEl("button", { text: "Würfeln", cls: "mod-cta" }).addEventListener("click", () => this.roll());
    btns.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
  }

  private buildZoneFields(parent: HTMLElement, d: CombatEntry) {
    const zones = targetableZones(d.bodyType ?? "humanoid");
    if (this.zone && !zones.includes(this.zone)) this.zone = "";
    if (this.zoneFixed && !zones.includes(this.zoneFixed)) this.zoneFixed = "";
    const zr = parent.createDiv({ cls: "dsa-cp-field dsa-tz-field" });
    zr.createEl("label", { text: "Trefferzone" });
    const zs = zr.createEl("select", { cls: "dsa-tz-select" });
    zs.createEl("option", { text: "Auswürfeln (nach ungepariertem Treffer)", value: "" });
    if (zones.length) {
      const fg = zs.createEl("optgroup");
      fg.label = "Festlegen (ohne Erschwernis)";
      for (const z of zones) fg.createEl("option", { text: ZONE_LABEL[z], value: `f:${z}` });
      const gg = zs.createEl("optgroup");
      gg.label = "Gezielter Angriff (mit Erschwernis)";
      for (const z of zones) gg.createEl("option", { text: `Gezielt: ${ZONE_LABEL[z]}`, value: `g:${z}` });
    }
    zs.value = this.zone ? `g:${this.zone}` : this.zoneFixed ? `f:${this.zoneFixed}` : "";
    zs.addEventListener("change", () => {
      const [m, z] = zs.value.split(":");
      this.zone = m === "g" ? (z as ZoneKey) : "";
      this.zoneFixed = m === "f" ? (z as ZoneKey) : "";
      this.buildForm();
    });
    if (this.zone) {
      const sr = parent.createDiv({ cls: "dsa-cp-field dsa-tz-field" });
      sr.createEl("label", { text: "Gezielter Angriff/Schuss (SF)" });
      const box = sr.createEl("input", { type: "checkbox" });
      box.checked = this.zoneSf;
      box.addEventListener("change", () => {
        this.zoneSf = box.checked;
        this.renderPreview();
      });
    }
  }

  private renderCheck(el: HTMLElement, title: string, c: PreviewCheck) {
    const box = el.createDiv({ cls: "dsa-cp-pcol" });
    box.createEl("strong", { text: `${title}: ${c.value}` });
    const ul = box.createEl("ul");
    c.lines.forEach((l, i) => {
      const li = ul.createEl("li", { text: i === 0 ? `${l.label} ${l.value}` : `${l.label} ${fmt(l.value)}` });
      if (i > 0 && isEffectLine(l.label)) li.addClass("dsa-cp-fxline");
    });
  }

  private renderPreview() {
    const inp = this.input();
    this.previewEl.empty();
    if (!inp) return;
    const pv = previewAttack({ ...inp, value: Number.isFinite(inp.value) ? inp.value : 0, defense: inp.defense ? { ...inp.defense, value: Number.isFinite(inp.defense.value) ? inp.defense.value : 0 } : null });
    const row = this.previewEl.createDiv({ cls: "dsa-cp-prow" });
    this.renderCheck(row, this.kind === "fernkampf" ? "FK" : "AT", pv.attack);
    if (pv.defense) this.renderCheck(row, inp.defense?.kind === "PA" ? "PA" : "Ausweichen", pv.defense);
    else row.createDiv({ cls: "dsa-cp-pcol dsa-mw-muted", text: "Keine Verteidigung" });
    const info = effectInfo(inp);
    const fxLines = [...pv.attack.lines, ...(pv.defense?.lines ?? [])].filter((l, i) => isEffectLine(l.label) && l.value !== 0 && i >= 0);
    if (fxLines.length) this.previewEl.createDiv({ cls: "dsa-cp-fxhint", text: "Hervorgehoben: Modifikatoren aus Zuständen, Status und Effekten." });
    const notes = [...info.attackerNotes.map((n) => `Angreifer – ${n}`), ...info.defenderNotes.map((n) => `Ziel – ${n}`)];
    if (info.defenseBlocked && !this.ignoreBlock) notes.unshift(`Ziel – ${info.defenseBlocked}`);
    if (notes.length) {
      const ul = this.previewEl.createEl("ul", { cls: "dsa-cp-fxnotes" });
      notes.forEach((n) => ul.createEl("li", { text: n }));
    }
    const err = validateAttackInput(inp);
    if (err) this.previewEl.createEl("p", { text: err, cls: "dsa-cp-warn" });
  }

  // ------------------------------------------------------------ roll + result
  private roll() {
    const inp = this.input();
    if (!inp) return;
    const err = validateAttackInput(inp);
    if (err) return void new Notice(err);
    const params = buildAttackParams(inp);
    this.params = params;
    const r = resolveAttack(params);
    this.result = r;
    this.applied = false;
    const text = summarizeResult(r, inp.attacker.name, inp.defender.name, this.weapon?.name ?? "manuell");
    this.logEntry = { time: Date.now(), text, outcome: r.outcome, applied: false };
    this.pushLog(this.logEntry);
    this.onLogChange();
    this.formEl.hide();
    this.renderResult(inp);
  }

  /** Wound effect: shown as a suggestion with one-click apply buttons, never applied silently. */
  private renderWound(card: HTMLElement, w: NonNullable<AttackResult["wound"]>, defenderId: string) {
    const box = card.createDiv({ cls: "dsa-tz-wound" });
    box.createEl("strong", { text: "Wundeffekt: " });
    box.createSpan({ text: describeWound(w) });
    const row = box.createDiv({ cls: "dsa-cp-buttons dsa-tz-wound-btns" });
    const once = (b: HTMLButtonElement, fn: () => void) =>
      b.addEventListener("click", () => {
        if (b.disabled) return;
        fn();
        b.disabled = true;
        b.setText(`${b.textContent} ✓`);
      });
    const fx = woundEffectToApply(w);
    const name = this.store.get(defenderId)?.name ?? "Ziel";
    if (fx?.kind === "zustand") {
      once(row.createEl("button", { text: `${STATE_LABELS[fx.key]} ${ROMAN[fx.level]} setzen` }), () => {
        this.store.addEffect(defenderId, { kind: "zustand", key: fx.key, level: fx.level, source: "Wundeffekt (Kopf)" });
        new Notice(`${name}: ${STATE_LABELS[fx.key]} ${ROMAN[fx.level]} gesetzt.`);
      });
    } else if (fx?.kind === "status") {
      once(row.createEl("button", { text: "Liegend setzen" }), () => {
        this.store.addEffect(defenderId, { kind: "status", key: fx.key, source: "Wundeffekt (Bein)" });
        new Notice(`${name}: Liegend gesetzt.`);
      });
    } else if (w.effect.kind === "zusatzSP") {
      once(row.createEl("button", { text: `${WOUND_EXTRA_SP} SP abziehen` }), () => {
        const x = rollWoundExtraSP(defaultRoller);
        this.store.applyPatch({ changes: [{ id: defenderId, lepDelta: -x.total }] }, `Wundeffekt Torso: ${name} −${x.total} SP`);
        new Notice(`${name}: ${WOUND_EXTRA_SP} [${x.rolls.join(", ")}] = ${x.total} SP abgezogen.`);
      });
    } else {
      box.createDiv({ text: "Kein Zustand zum Setzen: Waffe fällt aus der Hand, Meister entscheidet.", cls: "dsa-mw-muted" });
    }
  }

  /** Move the hit to another zone with the same dice: recompute RS / damage / wound / patch, refresh card and log. */
  private changeZone(inp: AttackInput, zone: ZoneKey | "") {
    if (!zone || !this.result || !this.params) return;
    const r = reassignZone(this.result, this.params, zone);
    if (r === this.result) return;
    this.result = r;
    const text = summarizeResult(r, inp.attacker.name, inp.defender.name, this.weapon?.name ?? "manuell");
    if (this.logEntry) this.logEntry.text = text;
    this.onLogChange();
    this.renderResult(inp);
  }

  private renderResult(inp: AttackInput) {
    const r = this.result;
    const el = this.resultEl;
    el.empty();
    if (!r) return;
    const card = el.createDiv({ cls: `dsa-cp-result dsa-cp-out-${r.outcome}` });
    card.createEl("h3", { text: OUTCOME_LABEL[r.outcome].toUpperCase() });
    if (r.criticalHit) card.createEl("p", { text: "Kritischer Treffer: Verteidigung halbiert, Schaden verdoppelt.", cls: "dsa-cp-crit" });

    const block = (label: string, text: string) => {
      const p = card.createDiv({ cls: "dsa-cp-rline" });
      p.createEl("strong", { text: `${label}: ` });
      p.createSpan({ text });
      return p;
    };
    const itemised = (base: number, mods: { label: string; value: number }[], state: number, extra: { label: string; value: number }[]) => {
      const parts = [`${base}`];
      for (const m of mods) parts.push(`${m.label} ${fmt(m.value)}`);
      if (state) parts.push(`Zustände ${fmt(-state)}`);
      for (const m of extra) parts.push(`${m.label} ${fmt(-m.value)}`);
      return parts.join(" ");
    };
    const at = r.attack;
    block(inp.kind === "fernkampf" ? "FK" : "AT", `${itemised(at.base, at.modifiers, at.statePenalty, at.extraPenalties)} = ${at.valueBeforeHalving}. ${describeCheck(at)}`);
    if (r.defense) {
      if (!r.defense.possible) block("Verteidigung", r.defense.reason === "single" ? "nicht möglich (bereits verteidigt, Einzelverteidigung)" : "nicht möglich (Wert ≤ 0)");
      else if (r.defense.check) {
        const c = r.defense.check;
        block(r.defense.kind === "PA" ? "PA" : "Ausweichen", `${itemised(c.base, c.modifiers, c.statePenalty, c.extraPenalties)} = ${c.valueBeforeHalving}. ${describeCheck(c)}`);
        if (r.defense.passierschlag) block("Hinweis", "Kritische Parade bestätigt: Passierschlag möglich.");
      }
    } else if (r.outcome === "hit" || r.outcome === "defended") block("Verteidigung", "keine");
    const dmg = describeDamage(r);
    const zoneText = describeZone(r);
    if (zoneText) {
      const zl = block("Trefferzone", zoneText);
      const zones = this.params?.zones ? targetableZones(this.params.zones.bodyType) : [];
      if (r.zone && this.params && zones.length) {
        const sel = zl.createEl("select", { cls: "dsa-tz-change" });
        sel.setAttr("aria-label", "Zone ändern (ohne neu zu würfeln)");
        sel.createEl("option", { text: "Zone ändern …", value: "" });
        for (const z of zones) if (z !== r.zone.zone) sel.createEl("option", { text: ZONE_LABEL[z], value: z });
        sel.addEventListener("change", () => this.changeZone(inp, sel.value as ZoneKey));
      }
    }
    if (dmg) block("Schaden", dmg);
    if (r.wound) this.renderWound(card, r.wound, inp.defender.id);
    if (r.patzer) {
      const p = r.patzer;
      if (p.entry) block("Patzer", `2W6 [${p.roll?.rolls.join(", ")}] = ${p.entry.roll}: ${p.entry.name}. ${p.entry.effect}`);
      if (p.fallbackSP) block("Patzer", `Pauschalschaden ${p.fallbackSP.total} SP`);
      if (p.selfDamage) block("Selbstschaden", `${p.selfDamage.total} SP`);
      const sug = p.entry?.suggestedState;
      if (sug) block("Vorschlag", `${STATE_LABELS[sug.state]} ${ROMAN[sug.level]} (${sug.duration}) – von Hand setzen.`);
    }
    block("Würfel", r.allRolls.join(", ") || "–");

    // patch summary with before -> after
    const sum = card.createDiv({ cls: "dsa-cp-patch" });
    if (!r.patch.changes.length) sum.createSpan({ text: "Keine Änderungen am Kampfzustand.", cls: "dsa-mw-muted" });
    for (const c of r.patch.changes) {
      const e = this.store.get(c.id);
      const parts: string[] = [];
      if (c.lepDelta) parts.push(`LeP ${e?.lep ?? "?"} → ${(e?.lep ?? 0) + c.lepDelta} (${fmt(c.lepDelta)})`);
      if (c.defensesDelta) parts.push(`Verteidigungszähler ${fmt(c.defensesDelta)}${c.defensePenaltyDelta ? ` (Malus ${fmt(-c.defensePenaltyDelta)})` : ""}`);
      if (c.lastHit) parts.push(`Zone ${ZONE_LABEL[c.lastHit.zone]}`);
      sum.createDiv({ text: `${e?.name ?? c.id}: ${parts.join(", ")}` });
    }

    const btns = card.createDiv({ cls: "dsa-cp-buttons" });
    const apply = btns.createEl("button", { text: "Anwenden", cls: "mod-cta" });
    apply.addEventListener("click", () => {
      if (this.applied) return;
      this.applied = true;
      const a = this.attacker();
      const d = this.defender();
      this.store.applyPatch(r.patch, `Angriff ${a?.name ?? "?"} → ${d?.name ?? "?"}: ${OUTCOME_LABEL[r.outcome]}`);
      if (this.logEntry) this.logEntry.applied = true;
      this.onLogChange();
      this.close();
    });
    btns.createEl("button", { text: "Verwerfen" }).addEventListener("click", () => this.close());
    btns.createEl("button", { text: "Nochmal würfeln" }).addEventListener("click", () => {
      this.result = null;
      this.resultEl.empty();
      this.formEl.show();
      this.roll();
    });
  }
}
