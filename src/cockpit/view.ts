// Kampf-Cockpit: right-sidebar ItemView on top of the CombatStore.
import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import type { CombatEntry } from "../combat/store";
import { DefenseMode } from "../engine/constants";
import { STATE_LABELS, isDying, schmerzFromLep } from "../engine/states";
import type { Weapon } from "../model";
import { confirm } from "../hero/modals";
import { heroToCombatant } from "../hero/model";
import { addEnemyFlow, addFromFile, addHeroesFlow, filesFromDrop, loadFromNoteFlow } from "./actions";
import { AttackModal, RollLogEntry } from "./attackModal";
import { openEncounterBuilder } from "../encounter";
import { promptEnergy, promptLepDelta, promptNumber, promptStats } from "./dialogs";
import { shareFight } from "../share";
import { EffectModal, renderEffectChips } from "./effectsUi";
import { adjustEnergy } from "./energy";
import { COCKPIT_VIEW_TYPE, CockpitLayout, LAYOUT_LABEL, LAYOUT_ORDER, ResolvedLayout, isWide, normalizeLayout, resolveLayout, setCockpitLayout } from "./layout";
import { EnergyKind, energyPct } from "../combat/energy";
import { durationText, effectLabel, effectsOf } from "../engine/effects";
import { CastResult, Caster, casterFromHero, openCastDialog } from "../magic";
import { magicRepo } from "../magic/repository";
import { LastHit, ZONE_LABEL } from "../engine/hitzones";
import { ROMAN, entryStatePenalty, lastHitText, manualDefenseDelta, weaponValue, zoneOverview } from "./logic";
import { asyncHandler } from "../util";

export { COCKPIT_VIEW_TYPE };
const MAX_LOG = 20;

/** State that survives closing/reopening the view (roll log only; combat state lives in the store). */
export class CockpitSession {
  log: RollLogEntry[] = [];
  push(e: RollLogEntry) {
    this.log.unshift(e);
    this.log.length = Math.min(this.log.length, MAX_LOG);
  }
}

const MODE_LABEL: Record<DefenseMode, string> = { cumulative: "−3 je Abwehr", single: "1× je KR", unlimited: "unbegrenzt" };
const LAYOUT_ICON: Record<CockpitLayout, string> = { auto: "sparkles", kompakt: "layout-list", detail: "layout-grid" };
const ENERGIES: EnergyKind[] = ["AsP", "KaP"];

interface Pending {
  attackerId: string;
  weapon: Weapon | null;
}

export class CockpitView extends ItemView {
  private pending: Pending | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private width = 0;
  private mode: ResolvedLayout = "detail";
  private shownSetting: CockpitLayout = "auto";
  /** compact mode: combatants the GM expanded to full detail */
  private expanded = new Set<string>();
  /** Trefferzonen overview: combatants whose section the GM opened (survives re-renders) */
  private zonesOpen = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: DsaMeisterwerkzeugPlugin, private session: CockpitSession) {
    super(leaf);
  }

  getViewType() {
    return COCKPIT_VIEW_TYPE;
  }
  getDisplayText() {
    return "Kampf-Cockpit";
  }
  getIcon() {
    return "swords";
  }

  private setting(): CockpitLayout {
    return normalizeLayout(this.plugin.settings.cockpitLayout);
  }

  private syncClasses() {
    const el = this.contentEl;
    el.toggleClass("dsa-cp-kompakt", this.mode === "kompakt");
    el.toggleClass("dsa-cp-detail", this.mode === "detail");
    el.toggleClass("dsa-cp-wide", this.mode === "detail" && isWide(this.width));
  }

  /** Re-resolve the layout (setting + width). Re-renders only when the setting or the resolved mode changed. */
  applyLayout() {
    const setting = this.setting();
    const mode = resolveLayout(setting, this.width);
    const changed = mode !== this.mode || setting !== this.shownSetting;
    this.mode = mode;
    this.shownSetting = setting;
    this.syncClasses();
    if (changed) this.render();
  }

  async onOpen() {
    this.contentEl.addClass("dsa-cp");
    this.width = this.contentEl.clientWidth;
    this.mode = resolveLayout(this.setting(), this.width);
    this.shownSetting = this.setting();
    this.syncClasses();
    this.register(this.plugin.combat.on(() => this.scheduleRender()));
    this.ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
      if (!w || w === this.width) return;
      this.width = w;
      this.applyLayout();
    });
    this.ro.observe(this.contentEl);
    this.registerDomEvent(this.contentEl, "dragover", (e) => {
      e.preventDefault();
      this.contentEl.addClass("dsa-cp-dragover");
    });
    this.registerDomEvent(this.contentEl, "dragleave", (e) => {
      if (e.target === this.contentEl) this.contentEl.removeClass("dsa-cp-dragover");
    });
    this.registerDomEvent(this.contentEl, "drop", (e) => {
      e.preventDefault();
      this.contentEl.removeClass("dsa-cp-dragover");
      try {
        const files = filesFromDrop(this.plugin, e);
        if (!files.length) return void new Notice("Aus dem Drop konnte keine Notiz gelesen werden. Nutze „Gegner hinzufügen“.");
        void (async () => {
          for (const f of files) await addFromFile(this.plugin, f);
        })();
      } catch (err) {
        console.error("Cockpit drop failed", err);
        new Notice("Drop fehlgeschlagen. Nutze „Gegner hinzufügen“.");
      }
    });
    this.render();
  }

  async onClose() {
    window.cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.ro = null;
  }

  private scheduleRender() {
    window.cancelAnimationFrame(this.raf);
    this.raf = window.requestAnimationFrame(() => this.render());
  }

  // ------------------------------------------------------------ render
  render() {
    const el = this.contentEl;
    const scroll = el.scrollTop;
    el.empty();
    const store = this.plugin.combat;
    if (this.pending && !store.get(this.pending.attackerId)) this.pending = null;

    this.renderHeader(el);
    this.renderAddBar(el);
    if (this.pending) this.renderBanner(el);

    const order = store.order();
    const cur = store.currentId();
    const body = el.createDiv({ cls: "dsa-cp-body" });
    const list = body.createDiv({ cls: "dsa-cp-list" });
    if (!order.length) list.createEl("p", { text: "Noch niemand im Kampf. Gegner per Drag & Drop aus dem Datei-Explorer hierher ziehen oder oben hinzufügen.", cls: "dsa-mw-muted" });
    for (const e of order) this.renderRow(list, e, e.id === cur);
    this.renderLog(body);
    el.scrollTop = scroll;
  }

  private btn(parent: HTMLElement, text: string, onClick: (e: MouseEvent) => void, opts: { cls?: string; title?: string; disabled?: boolean } = {}) {
    const b = parent.createEl("button", { text, cls: opts.cls });
    if (opts.title) b.setAttr("aria-label", opts.title);
    if (opts.disabled) b.disabled = true;
    b.addEventListener("click", onClick);
    return b;
  }

  private iconBtn(parent: HTMLElement, icon: string, title: string, onClick: (e: MouseEvent) => void, opts: { cls?: string; disabled?: boolean } = {}) {
    const b = parent.createEl("button", { cls: `dsa-cp-ibtn ${opts.cls ?? ""}` });
    setIcon(b, icon);
    b.setAttr("aria-label", title);
    if (opts.disabled) b.disabled = true;
    b.addEventListener("click", onClick);
    return b;
  }

  private layoutMenu(ev: MouseEvent) {
    const menu = new Menu();
    const cur = this.setting();
    for (const l of LAYOUT_ORDER)
      menu.addItem((i) =>
        i
          .setTitle(l === "auto" ? `Automatisch (nach Breite, jetzt ${LAYOUT_LABEL[this.mode]})` : LAYOUT_LABEL[l])
          .setIcon(LAYOUT_ICON[l])
          .setChecked(cur === l)
          .onClick(() => void setCockpitLayout(this.plugin, l)),
      );
    menu.showAtMouseEvent(ev);
  }

  private async endFight() {
    if (await confirm(this.app, "Kampf beenden", "Alle Kämpfer entfernen und die Runde zurücksetzen? (Rückgängig bleibt möglich.)", "Beenden")) this.plugin.combat.clear();
  }

  private renderHeader(el: HTMLElement) {
    const store = this.plugin.combat;
    const compact = this.mode === "kompakt";
    const h = el.createDiv({ cls: "dsa-cp-header" });
    h.createEl("strong", { text: `Runde ${store.round}`, cls: "dsa-cp-round" });
    const g = h.createDiv({ cls: "dsa-cp-hbtns" });
    const undoTitle = store.undoLabel ? `Rückgängig: ${store.undoLabel}` : "Rückgängig";
    if (compact) {
      this.iconBtn(g, "dices", "INI würfeln (INI-Basis + 1W6 für alle)", () => store.rollAllInitiative());
      this.btn(g, "Nächster", () => store.nextTurn(), { cls: "mod-cta" });
      this.iconBtn(g, "undo-2", undoTitle, () => store.undo(), { disabled: !store.canUndo, cls: "dsa-cp-undo" });
      this.iconBtn(g, LAYOUT_ICON[this.setting()], `Ansicht: ${LAYOUT_LABEL[this.setting()]} (klicken zum Wechseln)`, (ev) => this.layoutMenu(ev), { cls: "dsa-cp-layoutbtn" });
      this.iconBtn(g, "more-horizontal", "Weitere Kampf-Aktionen", (ev) => {
        const m = new Menu();
        m.addItem((i) => i.setTitle("INI nur für fehlende würfeln").setIcon("dices").onClick(() => store.rollAllInitiative(undefined, true)));
        m.addItem((i) => i.setTitle("Nächste Runde (Verteidigungszähler zurücksetzen)").setIcon("skip-forward").onClick(() => store.nextRound()));
        m.addItem((i) => i.setTitle("Auf Spielerbildschirm teilen").setIcon("monitor").onClick(() => void shareFight(this.plugin)));
        m.addSeparator();
        m.addItem((i) => i.setTitle("Kampf beenden").setIcon("trash-2").onClick(() => void this.endFight()));
        m.showAtMouseEvent(ev);
      });
      return;
    }
    this.btn(g, "INI würfeln", () => store.rollAllInitiative(), { title: "INI-Basis + 1W6 für alle" });
    this.btn(g, "nur fehlende", () => store.rollAllInitiative(undefined, true), { title: "Nur wer noch keinen INI-Wurf hat" });
    this.btn(g, "Nächster", () => store.nextTurn(), { cls: "mod-cta" });
    this.btn(g, "Nächste Runde", () => store.nextRound(), { title: "Setzt die Verteidigungszähler zurück" });
    this.btn(g, store.undoLabel ? `↶ ${store.undoLabel}` : "↶ Rückgängig", () => store.undo(), { disabled: !store.canUndo, cls: "dsa-cp-undo" });
    this.btn(g, "📺 Teilen", () => void shareFight(this.plugin), { title: "Kampf auf dem Spielerbildschirm zeigen" });
    this.btn(g, "Kampf beenden", () => void this.endFight());
    this.iconBtn(g, LAYOUT_ICON[this.setting()], `Ansicht: ${LAYOUT_LABEL[this.setting()]} (klicken zum Wechseln)`, (ev) => this.layoutMenu(ev), { cls: "dsa-cp-layoutbtn" });
  }

  private renderAddBar(el: HTMLElement) {
    const g = el.createDiv({ cls: "dsa-cp-addbar" });
    if (this.mode === "kompakt") {
      this.btn(g, "+ Hinzufügen", (ev) => {
        const m = new Menu();
        m.addItem((i) => i.setTitle("Gegner").setIcon("skull").onClick(() => void addEnemyFlow(this.plugin)));
        m.addItem((i) => i.setTitle("Helden").setIcon("user").onClick(() => void addHeroesFlow(this.plugin)));
        m.addItem((i) => i.setTitle("Aus Notiz laden").setIcon("file-input").onClick(() => void loadFromNoteFlow(this.plugin)));
        m.addItem((i) => i.setTitle("Begegnung bauen").setIcon("swords").onClick(() => openEncounterBuilder(this.plugin)));
        m.showAtMouseEvent(ev);
      });
      return;
    }
    this.btn(g, "+ Gegner", () => void addEnemyFlow(this.plugin));
    this.btn(g, "+ Helden", () => void addHeroesFlow(this.plugin));
    this.btn(g, "Aus Notiz laden", () => void loadFromNoteFlow(this.plugin));
    this.btn(g, "Begegnung bauen", () => openEncounterBuilder(this.plugin));
  }

  private renderBanner(el: HTMLElement) {
    const p = this.pending as Pending;
    const a = this.plugin.combat.get(p.attackerId);
    const b = el.createDiv({ cls: "dsa-cp-banner" });
    b.createSpan({ text: `${a?.name ?? "?"} (${p.weapon?.name ?? "manuell"}): Ziel anklicken` });
    this.btn(b, "Abbrechen", () => {
      this.pending = null;
      this.render();
    });
  }

  private renderRow(parent: HTMLElement, e: CombatEntry, isCurrent: boolean) {
    const store = this.plugin.combat;
    const dying = isDying(e.lep);
    const downBy = store.incapacitatedBy(e.id);
    const downByStatus = store.isDown(e.id) && downBy.length === 0;
    const down = dying || downBy.length > 0 || downByStatus;
    const row = parent.createDiv({ cls: "dsa-cp-row" });
    if (isCurrent) row.addClass("dsa-cp-current");
    if (down) row.addClass("dsa-cp-down");
    if (this.pending) {
      row.addClass(this.pending.attackerId === e.id ? "dsa-cp-attacker" : "dsa-cp-targetable");
      row.addEventListener("click", (ev) => {
        if ((ev.target as HTMLElement).closest("button,input,select,.dsa-cp-name,.dsa-cp-en")) return;
        this.chooseTarget(e);
      });
    }
    const why = dying ? "liegt im Sterben" : downBy.length ? `handlungsunfähig (${downBy.map((s) => STATE_LABELS[s]).join(", ")})` : "handlungsunfähig (Status)";
    const full = this.mode === "detail" || isCurrent || this.expanded.has(e.id) || (this.pending?.attackerId === e.id);
    if (full) this.renderFullRow(row, e, down ? why : null);
    else this.renderCompactRow(row, e, down ? why : null);
  }

  // ---- shared pieces
  private nameEl(parent: HTMLElement, e: CombatEntry) {
    const name = parent.createSpan({ text: e.name, cls: "dsa-cp-name" });
    name.addEventListener("click", () => this.openSource(e));
    return name;
  }

  private iniEl(parent: HTMLElement, e: CombatEntry, short: boolean) {
    const total = e.iniRoll === null ? "–" : String(e.iniBase + e.iniRoll);
    const ini = parent.createSpan({ text: short ? total : `INI ${total}`, cls: "dsa-cp-ini" });
    ini.setAttr("aria-label", `INI: Basis ${e.iniBase}${e.iniRoll !== null ? ` + W6 ${e.iniRoll}` : ""} – klicken zum Ändern des Wurfs`);
    ini.addEventListener("click", asyncHandler(async () => {
      const v = await promptNumber(this.app, `${e.name}: INI-Wurf (1W6)`, "Gewürfelter Wert", e.iniRoll ?? 1, 0);
      if (v !== null) this.plugin.combat.setInitiativeRoll(e.id, v);
    }));
    return ini;
  }

  private lepDelta(e: CombatEntry) {
    void promptLepDelta(this.app, `${e.name}: Schaden / Heilung`).then((d) => {
      if (d !== null) this.plugin.combat.adjustLep(e.id, d);
    });
  }

  /** AsP/KaP element for combatants that have the pool (max > 0); click to adjust by hand. */
  private renderEnergy(parent: HTMLElement, e: CombatEntry, kind: EnergyKind) {
    const en = this.plugin.combat.energy(e.id, kind);
    if (!en) return;
    const spent = kind === "AsP" ? e.aspSpent : e.kapSpent;
    const box = parent.createDiv({ cls: `dsa-cp-en dsa-cp-en-${kind.toLowerCase()}` });
    box.setAttr("aria-label", `${kind} ${en.cur} von ${en.max} – klicken zum Ändern${e.kind === "hero" ? " (wird in der Heldennotiz gespeichert)" : ""}`);
    const bar = box.createDiv({ cls: "dsa-cp-enbar" });
    bar.createDiv({ cls: "dsa-cp-enfill" }).setCssProps({ "--dsa-w": `${energyPct(en.max, spent)}%` });
    box.createSpan({ text: `${kind} ${en.cur}/${en.max}`, cls: "dsa-cp-entext" });
    box.addEventListener("click", asyncHandler(async () => {
      const v = await promptEnergy(this.app, `${e.name}: ${kind}`, en.cur, en.max);
      if (v !== null) adjustEnergy(this.plugin, e.id, kind, v);
    }));
  }

  private renderLepBar(parent: HTMLElement, e: CombatEntry, thin: boolean) {
    const bar = parent.createDiv({ cls: thin ? "dsa-cp-lep dsa-cp-lep-thin" : "dsa-cp-lep" });
    const pct = e.lepMax > 0 ? Math.max(0, Math.min(100, (e.lep / e.lepMax) * 100)) : 0;
    const fill = bar.createDiv({ cls: "dsa-cp-lepfill" });
    fill.setCssProps({ "--dsa-w": `${pct}%` });
    fill.addClass(pct > 50 ? "ok" : pct > 25 ? "warn" : "crit");
    if (!thin) bar.createSpan({ text: `${e.lep} / ${e.lepMax}`, cls: "dsa-cp-leptext" });
    return pct;
  }

  private renderWarn(row: HTMLElement, e: CombatEntry) {
    if (!e.needsManual.length) return;
    const w = row.createDiv({ cls: "dsa-cp-warn" });
    w.createSpan({ text: `Werte fehlen (${e.needsManual.join(", ").toUpperCase()}) ` });
    this.btn(w, "eintragen", asyncHandler(async () => {
      const st = await promptStats(this.app, { name: e.name, kind: e.kind, sourcePath: e.sourcePath, lepMax: e.lepMax || null, iniBase: e.needsManual.includes("ini") ? null : e.iniBase, rs: e.rs, vw: e.vw, weapons: [], needsManual: e.needsManual });
      if (!st) return;
      if (e.needsManual.includes("lep")) this.plugin.combat.setLepMax(e.id, st.lepMax);
      if (e.needsManual.includes("ini")) this.plugin.combat.setIniBase(e.id, st.iniBase);
    }));
  }

  private toggleHidden(e: CombatEntry) {
    this.plugin.combat.patchEntry(e.id, `${e.name}: ${e.hidden ? "für Spieler sichtbar" : "vor Spielern verborgen"}`, { hidden: !e.hidden });
  }

  private async removeEntry(e: CombatEntry) {
    if (await confirm(this.app, "Entfernen", `${e.name} aus dem Kampf entfernen?`, "Entfernen")) this.plugin.combat.removeCombatant(e.id);
  }

  /** Trefferzonen: combatants added before the rule was on have no body data yet; read it from their note. */
  private ensureBody(e: CombatEntry) {
    if (e.bodyType !== undefined) return;
    if (e.kind === "hero") {
      const h = e.sourcePath ? this.plugin.heroes.getByPath(e.sourcePath) : this.plugin.heroes.getByName(e.name);
      if (h) this.plugin.combat.fillBody(e.id, heroToCombatant(h));
      return;
    }
    // no source note stored (older fights): match the bestiary by name, "Wolf 3" -> "Wolf"
    const base = e.name.replace(/ \d+$/, "").toLowerCase();
    const c = e.sourcePath
      ? this.plugin.bestiary.getByPath(e.sourcePath)?.combatant
      : this.plugin.bestiary.search(base, 500).find((x) => x.name.toLowerCase() === base);
    if (c) this.plugin.combat.fillBody(e.id, c);
  }

  /** Trefferzonen: last hit of a combatant; undefined when the rule is off (nothing extra is rendered then). */
  private lastHitOf(e: CombatEntry): LastHit | undefined {
    return this.plugin.settings.hitZones === true ? e.lastHit : undefined;
  }

  private renderLastHit(parent: HTMLElement, h: LastHit) {
    const b = parent.createSpan({ text: `Treffer: ${lastHitText(h)}`, cls: `dsa-tz-badge${h.wound ? " dsa-tz-badge-wound" : ""}` });
    b.setAttr("aria-label", `Letzter Treffer: ${ZONE_LABEL[h.zone]}, ${h.sp} SP${h.wound ? ", Wundeffekt möglich" : ""}`);
  }

  /** Trefferzonen: collapsible overview of the damage each zone has taken (DSA 5 has no LeP per zone). Only with the rule on. */
  private renderZoneOverview(row: HTMLElement, e: CombatEntry) {
    if (this.plugin.settings.hitZones !== true) return;
    this.ensureBody(e);
    const store = this.plugin.combat;
    const ov = zoneOverview(e);
    const det = row.createEl("details", { cls: "dsa-tz-overview" });
    det.open = this.zonesOpen.has(e.id);
    det.addEventListener("toggle", () => {
      if (det.open) this.zonesOpen.add(e.id);
      else this.zonesOpen.delete(e.id);
    });
    det.createEl("summary", { text: "Trefferzonen" });
    det.createDiv({
      cls: "dsa-tz-ovhead",
      text: `LeP ${ov.lep}/${ov.lepMax} · ${ov.threshold !== null ? `Wundschwelle ${ov.threshold}` : "KO unbekannt"}`,
    });
    if (!ov.rows.length) {
      det.createDiv({ cls: "dsa-mw-muted dsa-tz-nozones", text: "Dieser Körperbau hat keine Trefferzonen." });
      return;
    }
    const tbl = det.createEl("table", { cls: "dsa-tz-table" });
    const hr = tbl.createEl("thead").createEl("tr");
    for (const h of ["Zone", "W20", "RS", "SP", "Treffer", ""]) hr.createEl("th", { text: h });
    const body = tbl.createEl("tbody");
    for (const r of ov.rows) {
      const tr = body.createEl("tr", { cls: `dsa-tz-zrow${r.wounds ? " dsa-tz-zrow-wound" : ""}` });
      tr.createEl("td", { text: r.label, cls: "dsa-tz-zname" });
      tr.createEl("td", { text: r.range, cls: "dsa-tz-zroll" });
      const rs = tr.createEl("td", { cls: "dsa-tz-zrs" });
      rs.createSpan({ text: String(r.rs) });
      rs.createEl("small", { text: r.rsSource === "zone" ? " Zone" : " ges.", cls: r.rsSource === "zone" ? "dsa-tz-rszone" : "dsa-mw-muted" });
      tr.createEl("td", { text: String(r.sp), cls: `dsa-tz-zsp${r.sp ? " on" : ""}` });
      tr.createEl("td", { text: r.hitsText, cls: "dsa-tz-zhits" });
      const act = tr.createEl("td", { cls: "dsa-tz-zact" });
      const b = act.createEl("button", { text: "±", cls: "dsa-tz-adj" });
      b.setAttr("aria-label", `SP auf ${r.label} buchen oder Zähler korrigieren`);
      b.addEventListener("click", asyncHandler(async () => {
        const n = await promptNumber(this.app, `${e.name}: ${r.label}`, "SP (positiv = Schaden an der Zone, negativ = Zähler korrigieren)", 0, -999);
        if (n) store.bookZoneDamage(e.id, r.zone, n);
      }));
    }
    const foot = det.createDiv({ cls: "dsa-tz-ovfoot" });
    const reset = foot.createEl("button", { text: "Zonen zurücksetzen", cls: "dsa-tz-reset" });
    reset.disabled = !e.zoneDamage;
    reset.setAttr("aria-label", "Zonenzähler auf 0 (LeP bleiben; rückgängig möglich)");
    reset.addEventListener("click", () => store.resetZoneDamage(e.id));
  }

  // ---- compact row: one dense line + thin bar + small badges
  private renderCompactRow(row: HTMLElement, e: CombatEntry, downWhy: string | null) {
    const store = this.plugin.combat;
    row.addClass("dsa-cp-compact");
    const c1 = row.createDiv({ cls: "dsa-cp-c1" });
    this.iniEl(c1, e, true);
    this.nameEl(c1, e);
    c1.createSpan({ cls: "dsa-cp-spacer" });
    const pct = e.lepMax > 0 ? (e.lep / e.lepMax) * 100 : 0;
    const lt = c1.createSpan({ text: `${e.lep}/${e.lepMax}`, cls: `dsa-cp-clep ${pct > 50 ? "ok" : pct > 25 ? "warn" : "crit"}` });
    lt.setAttr("aria-label", "LeP");
    this.iconBtn(c1, "sword", "Angreifen: Waffe wählen, dann Ziel anklicken", (ev) => this.startAttack(e, ev), { cls: "dsa-cp-atk" });
    this.iconBtn(c1, "heart-pulse", "Schaden / Heilung", () => this.lepDelta(e), { cls: "dsa-cp-dmg" });
    this.iconBtn(c1, "more-horizontal", "Weitere Aktionen", (ev) => this.moreMenu(e, ev), { cls: "dsa-cp-more" });
    this.iconBtn(c1, "chevron-down", "Details aufklappen", () => {
      this.expanded.add(e.id);
      this.render();
    }, { cls: "dsa-cp-expand" });
    this.renderLepBar(row, e, true);

    const fx = effectsOf(e);
    const sLevel = store.levels(e.id)?.schmerz ?? 0;
    const pen = entryStatePenalty(e);
    const hasEnergy = ENERGIES.some((k) => store.energy(e.id, k));
    const lastHit = this.lastHitOf(e);
    if (hasEnergy || fx.length || sLevel > 0 || pen || downWhy || e.hidden || e.needsManual.length || lastHit) {
      const c3 = row.createDiv({ cls: "dsa-cp-c3" });
      if (lastHit) this.renderLastHit(c3, lastHit);
      for (const k of ENERGIES) this.renderEnergy(c3, e, k);
      if (fx.length) {
        const b = c3.createSpan({ text: `✦ ${fx.length}`, cls: "dsa-cp-badge dsa-cp-badge-fx" });
        b.setAttr("aria-label", fx.map((x) => `${effectLabel(x)} · ${durationText(x)}`).join("\n"));
      }
      if (sLevel > 0) c3.createSpan({ text: `Schmerz ${ROMAN[sLevel]}`, cls: "dsa-cp-badge dsa-cp-badge-pain" });
      if (pen) c3.createSpan({ text: `−${pen}`, cls: "dsa-cp-badge dsa-cp-badge-pen" }).setAttr("aria-label", `Malus −${pen}`);
      if (e.hidden) c3.createSpan({ text: "verborgen", cls: "dsa-cp-badge" });
      if (downWhy) c3.createSpan({ text: downWhy, cls: "dsa-cp-badge dsa-cp-badge-down" });
      if (e.needsManual.length) this.renderWarn(c3, e);
    }
  }

  // ---- full row: everything visible
  private renderFullRow(row: HTMLElement, e: CombatEntry, downWhy: string | null) {
    const store = this.plugin.combat;
    const levels = store.levels(e.id);
    // line 1: name, INI, buttons
    const l1 = row.createDiv({ cls: "dsa-cp-l1" });
    this.nameEl(l1, e);
    this.iniEl(l1, e, false);
    l1.createSpan({ cls: "dsa-cp-spacer" });
    this.btn(l1, "⚔", (ev) => this.startAttack(e, ev), { cls: "dsa-cp-atk", title: "Angreifen: Waffe wählen, dann Ziel anklicken" });
    const caster = this.casterOf(e);
    if (caster && (caster.known.some((k) => k.kind === "zauber") || (caster.aspMax ?? 0) > 0))
      this.btn(l1, "✨", () => this.cast(e, "zauber"), { cls: "dsa-cp-cast", title: "Zaubern" });
    if (caster && (caster.known.some((k) => k.kind === "liturgie") || (caster.kapMax ?? 0) > 0))
      this.btn(l1, "🙏", () => this.cast(e, "liturgie"), { cls: "dsa-cp-cast", title: "Liturgie wirken" });
    if (e.kind !== "hero")
      this.btn(l1, "👁", () => this.toggleHidden(e), {
        cls: e.hidden ? "dsa-cp-eye dsa-cp-eye-off" : "dsa-cp-eye",
        title: e.hidden ? "Für Spieler verborgen – klicken zum Zeigen" : "Für Spieler sichtbar – klicken zum Verbergen",
      });
    this.btn(l1, "⋯", (ev) => this.moreMenu(e, ev), { cls: "dsa-cp-more", title: "Weitere Aktionen" });
    if (this.mode === "kompakt" && this.expanded.has(e.id))
      this.iconBtn(l1, "chevron-up", "Details zuklappen", () => {
        this.expanded.delete(e.id);
        this.render();
      }, { cls: "dsa-cp-expand" });
    this.btn(l1, "✕", () => void this.removeEntry(e), { cls: "dsa-cp-rm", title: "Entfernen" });

    if (downWhy) row.createDiv({ cls: "dsa-cp-downbadge", text: downWhy });
    const lastHit = this.lastHitOf(e);
    if (lastHit) this.renderLastHit(row.createDiv({ cls: "dsa-tz-line" }), lastHit);
    this.renderWarn(row, e);

    // line 2: LeP bar + quick input
    const l2 = row.createDiv({ cls: "dsa-cp-l2" });
    this.renderLepBar(l2, e, false);
    const qi = l2.createEl("input", { type: "number", cls: "dsa-cp-qi" });
    qi.placeholder = "±";
    qi.min = "0";
    const apply = (sign: 1 | -1) => {
      const n = Math.abs(Math.trunc(Number(qi.value)));
      if (!Number.isFinite(n) || n === 0) return;
      store.adjustLep(e.id, sign * n);
    };
    this.btn(l2, "−", () => apply(-1), { cls: "dsa-cp-dmg", title: "Schaden (Enter)" });
    this.btn(l2, "+", () => apply(1), { cls: "dsa-cp-heal", title: "Heilung" });
    qi.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") apply(ev.shiftKey ? 1 : -1);
    });

    // AsP / KaP (only for combatants that have them)
    if (ENERGIES.some((k) => store.energy(e.id, k))) {
      const l2b = row.createDiv({ cls: "dsa-cp-l2b" });
      for (const k of ENERGIES) this.renderEnergy(l2b, e, k);
    }

    // line 3: states + penalty
    const l3 = row.createDiv({ cls: "dsa-cp-l3" });
    const sLevel = levels?.schmerz ?? 0;
    const lepPain = schmerzFromLep(e.lep, e.lepMax);
    const sch = l3.createSpan({ text: `Schmerz ${ROMAN[sLevel] || "0"}`, cls: "dsa-cp-chip dsa-cp-chip-auto" });
    sch.toggleClass("on", sLevel > 0);
    sch.setAttr("aria-label", `automatisch aus LeP (LeP-Stufe ${lepPain}${(e.states.schmerz ?? 0) ? `, plus gespeichert ${e.states.schmerz}` : ""})`);
    renderEffectChips(l3, store, e, this.app);
    const pen = entryStatePenalty(e);
    l3.createSpan({ text: pen ? `Malus −${pen}` : "kein Malus", cls: `dsa-cp-pen${pen ? " on" : ""}` });

    // line 4: defense counter + mode
    const l4 = row.createDiv({ cls: "dsa-cp-l4" });
    l4.createSpan({ text: `Abwehr: ${e.defensePenalty ? `−${e.defensePenalty}` : "0"} (${e.defensesUsed}×)`, cls: "dsa-cp-def" });
    this.btn(l4, "+V", () => store.applyPatch({ changes: [{ id: e.id, ...manualDefenseDelta(e) }] }, `${e.name}: Verteidigung gezählt`), { title: "Eine Verteidigung zählen" });
    this.btn(l4, "−V", () => {
      if (e.defensesUsed <= 0) return;
      const d = manualDefenseDelta(e);
      store.applyPatch({ changes: [{ id: e.id, defensesDelta: -d.defensesDelta, defensePenaltyDelta: -Math.min(d.defensePenaltyDelta, e.defensePenalty) }] }, `${e.name}: Verteidigung zurückgenommen`);
    }, { title: "Eine Verteidigung zurücknehmen" });
    const ms = l4.createEl("select", { cls: "dsa-cp-mode" });
    (Object.keys(MODE_LABEL) as DefenseMode[]).forEach((m) => ms.createEl("option", { text: MODE_LABEL[m], value: m }));
    ms.value = e.defenseMode;
    ms.setAttr("aria-label", "Verteidigungsmodus");
    ms.addEventListener("change", () => store.patchEntry(e.id, `${e.name}: Verteidigungsmodus ${MODE_LABEL[ms.value as DefenseMode]}`, { defenseMode: ms.value as DefenseMode }));
    l4.createSpan({ text: `RS ${e.rs}${e.vw !== null ? ` · AW ${e.vw}` : ""}`, cls: "dsa-mw-muted" });

    // attacks with one-click buttons (pick the target next)
    if (e.weapons.length) {
      const l5 = row.createDiv({ cls: "dsa-cp-weapons" });
      for (const w of e.weapons) {
        const v = weaponValue(w);
        const b = this.btn(l5, `${w.kind === "ranged" ? "🏹" : "⚔"} ${w.name} ${w.kind === "ranged" ? "FK" : "AT"} ${v ?? "?"}${w.pa !== null && w.pa !== undefined ? ` · PA ${w.pa}` : ""} · TP ${w.tp ?? "?"}`, () => {
          this.pending = { attackerId: e.id, weapon: w };
          this.render();
        }, { cls: "dsa-cp-wbtn", title: `Mit ${w.name} angreifen, dann Ziel anklicken` });
        b.toggleClass("on", this.pending?.attackerId === e.id && this.pending.weapon === w);
      }
    }
    this.renderZoneOverview(row, e);
  }

  private renderLog(el: HTMLElement) {
    const box = el.createDiv({ cls: "dsa-cp-log" });
    box.createEl("h5", { text: "Würfelprotokoll" });
    if (!this.session.log.length) box.createEl("p", { text: "Noch keine Angriffe.", cls: "dsa-mw-muted" });
    for (const l of this.session.log) {
      const t = new Date(l.time);
      const li = box.createDiv({ cls: `dsa-cp-logline dsa-cp-out-${l.outcome}` });
      li.createSpan({ text: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} `, cls: "dsa-mw-muted" });
      li.createSpan({ text: l.text });
      if (!l.applied) li.createSpan({ text: " (nicht angewendet)", cls: "dsa-mw-muted" });
    }
  }

  // ------------------------------------------------------------ actions
  private openSource(e: CombatEntry) {
    if (!e.sourcePath) return void new Notice("Keine Quellnotiz hinterlegt.");
    void this.app.workspace.openLinkText(e.sourcePath, "", false);
  }

  /** Caster model of a combatant (hero note / bestiary note) with the energy this combat leaves; null without a source note. */
  private casterOf(e: CombatEntry): Caster | null {
    if (!e.sourcePath) return null;
    let c: Caster | null = null;
    if (e.kind === "hero") {
      const h = this.plugin.heroes.getByPath(e.sourcePath);
      if (h) c = casterFromHero(h, this.app.metadataCache.getCache(e.sourcePath)?.frontmatter);
    } else c = magicRepo(this.plugin).creatureCaster(e.sourcePath);
    if (c && e.kind !== "hero") {
      if (c.asp !== null) c.asp = Math.max(0, c.asp - (e.aspSpent ?? 0));
      if (c.kap !== null) c.kap = Math.max(0, c.kap - (e.kapSpent ?? 0));
    }
    return c;
  }

  private moreMenu(e: CombatEntry, ev: MouseEvent) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Zaubern").setIcon("sparkles").onClick(() => this.cast(e, "zauber")));
    menu.addItem((i) => i.setTitle("Liturgie wirken").setIcon("church").onClick(() => this.cast(e, "liturgie")));
    if (this.mode === "kompakt") {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Effekt hinzufügen").setIcon("plus").onClick(() => new EffectModal(this.app, this.plugin.combat, e.id, null).open()));
      menu.addItem((i) => i.setTitle("INI-Wurf ändern").setIcon("dices").onClick(async () => {
        const v = await promptNumber(this.app, `${e.name}: INI-Wurf (1W6)`, "Gewürfelter Wert", e.iniRoll ?? 1, 0);
        if (v !== null) this.plugin.combat.setInitiativeRoll(e.id, v);
      }));
      if (e.kind !== "hero")
        menu.addItem((i) => i.setTitle(e.hidden ? "Für Spieler zeigen" : "Vor Spielern verbergen").setIcon(e.hidden ? "eye" : "eye-off").onClick(() => this.toggleHidden(e)));
      menu.addItem((i) => i.setTitle("Entfernen").setIcon("x").onClick(() => void this.removeEntry(e)));
      menu.addSeparator();
    }
    if (e.kind !== "hero" && (e.aspSpent || e.kapSpent)) menu.addItem((i) => i.setTitle(`Verbraucht: ${e.aspSpent ?? 0} AsP, ${e.kapSpent ?? 0} KaP`).setDisabled(true));
    menu.showAtMouseEvent(ev);
  }

  private cast(e: CombatEntry, kind: "zauber" | "liturgie") {
    const caster = this.casterOf(e);
    const isHero = e.kind === "hero";
    openCastDialog(this.plugin, {
      kind,
      casterName: e.sourcePath ? undefined : e.name,
      heroPath: isHero && e.sourcePath ? e.sourcePath : undefined,
      creaturePath: !isHero && e.sourcePath ? e.sourcePath : undefined,
      energyLeft: !isHero && caster ? { AsP: caster.asp, KaP: caster.kap } : undefined,
      onSpend: !isHero ? (energy, amount) => this.plugin.combat.spendEnergy(e.id, energy, amount) : undefined,
      onResult: (r: CastResult) => {
        const cost = r.costPaid === null ? "" : `, ${r.costPaid} ${r.energy}`;
        const crit = r.critical === "success" ? " (kritisch)" : r.critical === "patzer" ? " (Patzer)" : "";
        this.session.push({ time: Date.now(), text: `${e.name}: ${r.input.name} ${r.success ? `QS ${r.qs}` : "misslungen"}${crit}${cost}`, outcome: "effect", applied: true });
        this.scheduleRender();
      },
    });
  }

  private startAttack(e: CombatEntry, ev: MouseEvent) {
    const weapons = e.weapons;
    const menu = new Menu();
    const choose = (w: Weapon | null) => {
      this.pending = { attackerId: e.id, weapon: w };
      this.render();
    };
    for (const w of weapons) {
      const v = weaponValue(w);
      const label = `${w.name} – ${w.kind === "ranged" ? "FK" : "AT"} ${v ?? "?"}, TP ${w.tp ?? "?"}`;
      menu.addItem((i) => i.setTitle(label).setIcon(w.kind === "ranged" ? "crosshair" : "sword").onClick(() => choose(w)));
    }
    if (weapons.length) menu.addSeparator();
    menu.addItem((i) => i.setTitle("Manuell (AT/TP eintragen)").setIcon("pencil").onClick(() => choose(null)));
    menu.showAtMouseEvent(ev);
  }

  private chooseTarget(target: CombatEntry) {
    const p = this.pending;
    if (!p) return;
    if (target.id === p.attackerId) return void new Notice("Ein Kämpfer kann sich nicht selbst angreifen.");
    this.pending = null;
    if (this.plugin.settings.hitZones === true) this.ensureBody(target);
    new AttackModal(this.app, this.plugin.combat, p.attackerId, target.id, p.weapon, (l) => this.session.push(l), () => this.scheduleRender(), this.plugin.settings.hitZones === true).open();
    this.render();
  }
}
