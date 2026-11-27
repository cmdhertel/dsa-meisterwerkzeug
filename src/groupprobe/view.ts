// Group probe UI: inline button + dialog.
import { Component, MarkdownRenderer, Modal, Notice, Setting, TFile } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { formatModifier } from "../probe/parse";
import { subjectFromHero } from "../probe/logic";
import { HeroEntry, orderedHeroChoices, statePenaltyFor } from "../probe/view";
import {
  GroupKind,
  KIND_LABEL,
  Participant,
  ParticipantRoll,
  SammelState,
  groupEventText,
  groupLine,
  insertBelow,
  newSammel,
  restartSammel,
  rollParticipants,
  rollWord,
  sammelLine,
  sammelStatusText,
  summarizeGroup,
  applySammelRound,
} from "./logic";
import { GroupSpec, OutcomeText, groupOutcomeTexts, parseAttrValue, parseGroupProbe, probeKey, requiredQsOf, requiredSuccessesOf, sammelOutcomeTexts } from "./parse";
import { ManualPart, clearSammel, loadSaved, saveSammel } from "./state";

const isSammel = (k: GroupKind) => k !== "gruppe";
const singleHero = (k: GroupKind) => k === "sammel";

/** Dialog for one group/Sammel probe. `raw` = inline code (null when started from a command). */
export class GroupProbeModal extends Modal {
  private owner = new Component();
  private heroes: HeroEntry[] = [];
  private selected = new Set<string>();
  private mods = new Map<string, number>();
  private manual: ManualPart[] = [];
  private common: number;
  private state: SammelState | null = null;
  private rolls: ParticipantRoll[] = [];
  private key: string | null;
  private partsEl!: HTMLElement;
  private outEl!: HTMLElement;
  private rollBtnHost!: HTMLElement;
  private manualSeq = 0;

  /** 0-based line of the probe in the note, when known (see insertBelow) */
  constructor(private plugin: DsaMeisterwerkzeugPlugin, private spec: GroupSpec, private sourcePath: string, private raw: string | null, private line: number | null = null) {
    super(plugin.app);
    this.common = spec.modifier;
    this.key = raw ? probeKey(sourcePath, raw) : null;
    if (isSammel(spec.kind)) this.state = newSammel({ target: spec.target ?? undefined, maxAttempts: spec.maxAttempts, interval: spec.interval });
  }

  onOpen() {
    this.owner.load();
    this.modalEl.addClass("dsa-gp-modal");
    const { primary, others } = orderedHeroChoices(this.plugin, this.sourcePath);
    this.heroes = [...primary, ...others];

    const saved = this.key && isSammel(this.spec.kind) ? loadSaved(this.plugin, this.key) : null;
    if (saved) {
      this.state = saved.state;
      this.common = saved.common;
      this.manual = saved.manual;
      this.manualSeq = saved.manual.length;
      this.selected = new Set(saved.selected);
      for (const [k, v] of Object.entries(saved.mods)) this.mods.set(k, v);
      new Notice("Unfertige Sammelprobe fortgesetzt.");
    } else if (singleHero(this.spec.kind)) {
      if (this.heroes[0]) this.selected.add(this.heroes[0].uid);
    } else for (const h of this.heroes) this.selected.add(h.uid);

    const t = this.spec;
    this.titleEl.setText(`${KIND_LABEL[t.kind]}: ${t.talent.name}${formatModifier(t.modifier) ? " " + formatModifier(t.modifier) : ""}`);
    this.contentEl.createDiv({ cls: "dsa-gp-attrs", text: `${t.talent.attrs.join(" / ")}${t.interval ? ` · Intervall: ${t.interval}` : ""}` });
    for (const w of this.spec.warnings) this.contentEl.createDiv({ cls: "dsa-gp-warn", text: `⚠ ${w}` });

    this.partsEl = this.contentEl.createDiv({ cls: "dsa-gp-parts" });
    this.renderParts();

    new Setting(this.contentEl)
      .setName("Modifikator für alle")
      .setDesc("+ = leichter, - = schwerer")
      .addText((x) => {
        x.inputEl.type = "number";
        x.inputEl.addClass("dsa-gp-num");
        x.setValue(String(this.common)).onChange((v) => (this.common = Math.trunc(Number(v) || 0)));
      });

    this.rollBtnHost = this.contentEl.createDiv({ cls: "dsa-gp-actions" });
    this.outEl = this.contentEl.createDiv({ cls: "dsa-gp-out" });
    this.renderActions();
    this.renderOut();
  }

  onClose() {
    this.owner.unload();
    this.contentEl.empty();
  }

  // ------------------------------------------------------------ participants

  private participants(): Participant[] {
    const out: Participant[] = [];
    for (const h of this.heroes) {
      if (!this.selected.has(h.uid)) continue;
      const s = subjectFromHero(h.hero, this.spec.talent, statePenaltyFor(this.plugin, h.hero));
      out.push({ id: h.uid, name: h.name, attrs: s.attrs, fw: s.fw, modifier: this.mods.get(h.uid) ?? 0, statePenalty: s.statePenalty });
    }
    for (const m of this.manual) {
      if (!this.selected.has(m.id)) continue;
      out.push({ id: m.id, name: m.name, attrs: m.attrs, fw: m.fw, modifier: this.mods.get(m.id) ?? 0, statePenalty: 0, manual: true });
    }
    return out;
  }

  private toggle(id: string, on: boolean) {
    if (singleHero(this.spec.kind)) this.selected = new Set(on ? [id] : []);
    else if (on) this.selected.add(id);
    else this.selected.delete(id);
    this.renderParts();
  }

  private row(parent: HTMLElement, id: string, name: string, info: string, extra?: (row: HTMLElement) => void) {
    const row = parent.createDiv({ cls: "dsa-gp-part" });
    const cb = row.createEl("input", { attr: { type: singleHero(this.spec.kind) ? "radio" : "checkbox", name: "dsa-gp-pick" } });
    cb.checked = this.selected.has(id);
    cb.addEventListener("change", () => this.toggle(id, cb.checked));
    row.createSpan({ cls: "dsa-gp-part-name", text: name });
    row.createSpan({ cls: "dsa-gp-part-info", text: info });
    const mod = row.createEl("input", { cls: "dsa-gp-num", attr: { type: "number", title: "individueller Modifikator", placeholder: "±" } });
    mod.value = this.mods.get(id) ? String(this.mods.get(id)) : "";
    mod.addEventListener("input", () => this.mods.set(id, Math.trunc(Number(mod.value) || 0)));
    extra?.(row);
  }

  private renderParts() {
    const el = this.partsEl;
    el.empty();
    el.createDiv({ cls: "dsa-gp-h", text: singleHero(this.spec.kind) ? "Held" : "Teilnehmer" });
    if (!this.heroes.length) {
      el.createDiv({
        cls: "dsa-gp-empty",
        text: "Keine Helden gefunden. Importiere Helden (Befehl „Held aus JSON importieren“) oder füge unten Teilnehmer von Hand hinzu.",
      });
    }
    const list = el.createDiv({ cls: "dsa-gp-list" });
    for (const h of this.heroes) {
      const s = subjectFromHero(h.hero, this.spec.talent);
      this.row(list, h.uid, h.name, `${s.attrs.join("/")} · FW ${s.fw}`);
    }
    for (const m of this.manual) {
      this.row(list, m.id, m.name, `${m.attrs.join("/")} · FW ${m.fw}`, (row) => {
        const rm = row.createEl("button", { cls: "dsa-gp-x", text: "✕", attr: { title: "Entfernen" } });
        rm.addEventListener("click", () => {
          this.manual = this.manual.filter((x) => x.id !== m.id);
          this.selected.delete(m.id);
          this.renderParts();
        });
      });
    }
    if (!singleHero(this.spec.kind) || !this.heroes.length) this.renderManualAdd(el);
  }

  private renderManualAdd(parent: HTMLElement) {
    const det = parent.createEl("details", { cls: "dsa-gp-add" });
    det.createEl("summary", { text: "Teilnehmer von Hand hinzufügen" });
    const box = det.createDiv({ cls: "dsa-gp-add-row" });
    const name = box.createEl("input", { attr: { type: "text", placeholder: "Name" } });
    const labels = this.spec.talent.attrs;
    const attrs = labels.map((l) => box.createEl("input", { cls: "dsa-gp-num", attr: { type: "number", placeholder: l, title: l } }));
    const fw = box.createEl("input", { cls: "dsa-gp-num", attr: { type: "number", placeholder: "FW", title: "Fertigkeitswert" } });
    const add = box.createEl("button", { text: "Hinzufügen" });
    add.addEventListener("click", () => {
      const n = name.value.trim();
      if (!n) return void new Notice("Bitte einen Namen eingeben.");
      const values = attrs.map((a) => parseAttrValue(a.value));
      if (values.some((v) => v === null)) return void new Notice(`Bitte alle Eigenschaften (${labels.join(", ")}) als Zahl eingeben.`);
      const id = `m:${++this.manualSeq}:${n}`;
      this.manual.push({
        id,
        name: n,
        attrs: values as [number, number, number],
        fw: Math.max(0, Number(fw.value) || 0),
      });
      this.selected.add(id);
      this.renderParts();
    });
  }

  // ------------------------------------------------------------ actions

  private renderActions() {
    const host = this.rollBtnHost;
    host.empty();
    const st = this.state;
    const running = !st || st.status === "läuft";
    if (running) {
      const label = !st ? "Würfeln" : st.attempts === 0 ? "Würfeln" : "Nächster Versuch";
      host.createEl("button", { cls: "mod-cta", text: label }).addEventListener("click", () => this.roll());
    }
    if (st && st.attempts > 0) {
      host.createEl("button", { text: "Neu starten" }).addEventListener("click", () => {
        this.state = restartSammel(st);
        this.rolls = [];
        if (this.key) void clearSammel(this.plugin, this.key);
        this.renderActions();
        this.renderOut();
      });
    }
    host.createEl("button", { text: "Ergebnis in Notiz einfügen" }).addEventListener("click", () => void this.insertResult());
  }

  private roll() {
    const parts = this.participants();
    if (!parts.length) return void new Notice(this.heroes.length || this.manual.length ? "Bitte mindestens einen Teilnehmer auswählen." : "Keine Helden gefunden.");
    this.rolls = rollParticipants(parts, this.common);
    if (this.state) {
      this.state = applySammelRound(this.state, this.rolls);
      void this.persistState();
    }
    const line = this.resultLine();
    if (line) {
      const st = this.state;
      this.plugin.table.emit({
        type: "group",
        text: groupEventText(line),
        sourcePath: this.sourcePath || undefined,
        data: {
          kind: this.spec.kind,
          talent: this.spec.talent.name,
          modifier: this.common,
          results: this.rolls.map((r) => ({ who: r.name, success: r.result.success, qs: r.result.qs, critical: r.result.critical })),
          ...(st ? { status: st.status, attempts: st.attempts, qs: st.qs, target: st.target } : {}),
        },
      });
    }
    this.renderActions();
    this.renderOut();
  }

  private async persistState() {
    if (!this.key || !this.state) return;
    try {
      if (this.state.status !== "läuft" || this.state.attempts === 0) return await clearSammel(this.plugin, this.key);
      const mods: Record<string, number> = {};
      this.mods.forEach((v, k) => v && (mods[k] = v));
      await saveSammel(this.plugin, this.key, {
        state: this.state,
        selected: [...this.selected],
        mods,
        common: this.common,
        manual: this.manual,
        updated: Date.now(),
      });
    } catch (err) {
      console.error("Sammelprobe konnte nicht gespeichert werden", err);
      new Notice("Sammelprobe konnte nicht gespeichert werden. Der Fortschritt geht beim Schließen verloren.");
    }
  }

  private resultLine(): string | null {
    if (!this.rolls.length) return null;
    if (this.state) return sammelLine(this.spec.talent.name, this.common, this.spec.kind, this.state);
    const s = summarizeGroup(this.rolls, { qs: requiredQsOf(this.spec), successes: requiredSuccessesOf(this.spec) });
    return groupLine(this.spec.talent.name, this.common, this.rolls, s, this.spec.kind);
  }

  private async insertResult() {
    const line = this.resultLine();
    if (!line) return void new Notice("Erst würfeln.");
    const file = this.app.vault.getAbstractFileByPath(this.sourcePath);
    if (this.raw && file instanceof TFile) {
      let ok = false;
      await this.app.vault.process(file, (text) => {
        const next = insertBelow(text, this.raw as string, line, this.line);
        ok = next !== null;
        return next ?? text;
      });
      new Notice(ok ? "Ergebnis eingefügt." : "Die Probe-Zeile wurde in der Notiz nicht gefunden.");
      return;
    }
    const editor = this.app.workspace.activeEditor?.editor;
    if (editor) {
      editor.replaceRange(line + "\n", editor.getCursor());
      new Notice("Ergebnis an der Cursorposition eingefügt.");
    } else {
      await navigator.clipboard?.writeText(line).catch(() => undefined);
      new Notice("Keine offene Notiz: Ergebnis in die Zwischenablage kopiert.");
    }
  }

  // ------------------------------------------------------------ output

  private md(el: HTMLElement, text: string) {
    const c = new Component();
    this.owner.addChild(c);
    void MarkdownRenderer.render(this.app, text, el, this.sourcePath, c);
  }

  private renderTexts(parent: HTMLElement, texts: OutcomeText[]) {
    if (!texts.length) return;
    const box = parent.createDiv({ cls: "dsa-gp-texts" });
    for (const t of texts) {
      const row = box.createDiv({ cls: "dsa-gp-text" });
      row.createSpan({ cls: "dsa-gp-text-label", text: t.label });
      this.md(row.createDiv({ cls: "dsa-gp-text-body" }), t.text);
    }
  }

  private renderTable(parent: HTMLElement) {
    const table = parent.createEl("table", { cls: "dsa-gp-table" });
    const head = table.createEl("thead").createEl("tr");
    ["Teilnehmer", "Würfe", "Ergebnis"].forEach((h) => head.createEl("th", { text: h }));
    const body = table.createEl("tbody");
    for (const r of this.rolls) {
      const res = r.result;
      const tr = body.createEl("tr");
      tr.createEl("td", { text: r.name });
      const dice = tr.createEl("td", { cls: "dsa-gp-dice" });
      res.dice.forEach((d, i) => {
        dice.createSpan({ cls: `dsa-gp-die${d === 1 ? " is-one" : d === 20 ? " is-twenty" : d > res.attrEffective[i] ? " is-over" : ""}`, text: String(d) });
        dice.createSpan({ cls: "dsa-gp-vs", text: `/${res.attrEffective[i]} ` });
      });
      dice.createSpan({ cls: "dsa-gp-pts", text: `FW ${res.fw}${r.modifier ? `, Mod ${r.modifier > 0 ? "+" : ""}${r.modifier}` : ""}` });
      const crit = res.critical === "success" ? " · kritisch" : res.critical === "patzer" ? " · Patzer" : "";
      tr.createEl("td", { cls: res.success ? "is-success" : "is-fail", text: (res.success ? `QS ${res.qs}` : "misslungen") + crit });
    }
  }

  private renderOut() {
    const el = this.outEl;
    el.empty();
    const st = this.state;
    if (st) this.renderProgress(el, st);
    if (!this.rolls.length) return;
    this.renderTable(el);
    const sum = el.createDiv({ cls: "dsa-gp-summary" });
    const req = { qs: requiredQsOf(this.spec), successes: requiredSuccessesOf(this.spec) };
    const s = summarizeGroup(this.rolls, req);
    const parts = [`${s.successes}/${s.count} Erfolge`, `${s.totalQs} QS`];
    if (s.best && s.worst && s.count > 1) parts.push(`Bestes: ${rollWord(s.best)}`, `Schlechtestes: ${rollWord(s.worst)}`);
    sum.createDiv({ cls: "dsa-gp-sum-line", text: parts.join(" · ") });
    if (!st) {
      if (s.met !== null) {
        const need = [req.qs ? `${req.qs} QS` : "", req.successes ? `${req.successes} Erfolge` : ""].filter(Boolean).join(" und ");
        sum.createDiv({ cls: `dsa-gp-met ${s.met ? "is-success" : "is-fail"}`, text: s.met ? `Gruppenprobe geschafft (benötigt: ${need})` : `Nicht geschafft (benötigt: ${need})` });
      }
      this.renderTexts(sum, groupOutcomeTexts(this.spec, s.totalQs, s.successes));
    } else {
      const last = st.rounds[st.rounds.length - 1];
      if (last) sum.createDiv({ cls: "dsa-gp-sum-line", text: last.patzer ? "Patzer: gesammelte QS verfallen." : `Dieser Versuch: +${last.gain} QS${last.critical ? " (kritischer Erfolg verdoppelt)" : ""}` });
      if (st.status !== "läuft") this.renderTexts(sum, sammelOutcomeTexts(this.spec, st.status, st.teilerfolg));
    }
  }

  private renderProgress(parent: HTMLElement, st: SammelState) {
    const box = parent.createDiv({ cls: "dsa-gp-progress" });
    const bar = box.createDiv({ cls: "dsa-gp-bar" });
    const fill = bar.createDiv({ cls: `dsa-gp-bar-fill is-${st.status === "läuft" ? "run" : st.status === "geschafft" ? "ok" : "bad"}` });
    fill.setCssProps({ "--dsa-gp-w": `${Math.min(100, Math.round((st.qs / st.target) * 100))}%` });
    box.createDiv({
      cls: "dsa-gp-progress-text",
      text: `${st.qs}/${st.target} QS · Versuch ${st.attempts}/${st.maxAttempts}${st.interval ? ` (alle ${st.interval})` : ""} · ${sammelStatusText(st)}`,
    });
    if (st.rounds.length) {
      const d = box.createEl("details", { cls: "dsa-gp-history" });
      d.createEl("summary", { text: "Verlauf" });
      for (const r of st.rounds) d.createDiv({ text: `Versuch ${r.attempt}: ${r.lines.join(", ")} → ${r.patzer ? "Patzer, 0" : `+${r.gain}`} (${r.qsAfter} QS)` });
    }
  }
}

// ---------------------------------------------------------------- inline button

/** Mount a button for inline code `raw`. Returns the replacement element. */
export function mountGroupProbe(plugin: DsaMeisterwerkzeugPlugin, raw: string, sourcePath: string, line?: number): HTMLElement {
  const parsed = parseGroupProbe(raw);
  const el = document.createElement("span");
  if (!parsed.ok) {
    el.addClass("dsa-gp", "dsa-gp-error");
    el.setText(`⚠ ${parsed.error}`);
    el.title = parsed.raw;
    return el;
  }
  const spec = parsed.spec;
  el.addClass("dsa-gp");
  const mod = formatModifier(spec.modifier);
  const btn = el.createEl("button", { cls: "dsa-gp-btn" });
  const refresh = () => {
    const saved = isSammel(spec.kind) ? loadSaved(plugin, probeKey(sourcePath, raw)) : null;
    const progress = saved ? ` (${saved.state.qs}/${saved.state.target} QS, Versuch ${saved.state.attempts}/${saved.state.maxAttempts})` : "";
    btn.setText(`🎲 ${KIND_LABEL[spec.kind]}: ${spec.talent.name}${mod ? " " + mod : ""}${progress}`);
  };
  refresh();
  btn.title = spec.talent.attrs.join(" / ");
  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const modal = new GroupProbeModal(plugin, spec, sourcePath, raw, line ?? null);
    const origClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      origClose();
      refresh();
    };
    modal.open();
  });
  return el;
}
