// Sitzungsregie: Mitschrift panel (capture bar, timeline newest first with scene dividers, stats).
import { setIcon } from "obsidian";
import { buildCaptureBar } from "./captureBar";
import { hhmm } from "./ctx";
import type { RegieCtx } from "./ctx";
import { JournalEntry, KIND_ICON, KIND_LABEL, MANUAL_KINDS, formatDuration, sessionElapsed } from "./run";
import { journalStats } from "./text";

const PAGE = 120;

export interface JournalApi {
  render(): void;
  /** True while an entry is open in the editor; re-renders would discard the unsaved text. */
  isEditing(): boolean;
  focusCapture(): void;
}

export function buildJournalPanel(host: HTMLElement, ctx: RegieCtx): JournalApi {
  host.addClass("dsa-regie-panel", "dsa-regie-journal");
  const head = host.createDiv({ cls: "dsa-regie-panel-head" });
  head.createEl("h3", { text: "Mitschrift" });
  const capture = buildCaptureBar(host.createDiv(), ctx);
  const list = host.createDiv({ cls: "dsa-regie-timeline", attr: { role: "list", "aria-label": "Mitschrift-Einträge" } });
  const stats = host.createDiv({ cls: "dsa-regie-stats" });
  let editing: string | null = null;
  let limit = PAGE;

  const editor = (li: HTMLElement, e: JournalEntry, session: string) => {
    const area = li.createEl("textarea", { cls: "dsa-regie-edit", attr: { rows: "2", "aria-label": "Eintrag bearbeiten" } });
    area.value = e.text;
    let kind = e.kind;
    if (MANUAL_KINDS.includes(e.kind)) {
      const sel = li.createEl("select", { cls: "dropdown", attr: { "aria-label": "Art" } });
      for (const k of MANUAL_KINDS) sel.createEl("option", { value: k, text: KIND_LABEL[k] }).selected = k === e.kind;
      sel.addEventListener("change", () => (kind = sel.value as typeof kind));
    }
    const save = () => {
      editing = null;
      ctx.regie.editEntry(session, e.id, { text: area.value, kind });
    };
    const cancel = () => {
      editing = null;
      render();
    };
    area.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        save();
      } else if (ev.key === "Escape") {
        ev.stopPropagation();
        cancel();
      }
    });
    const row = li.createDiv({ cls: "dsa-regie-entry-actions is-open" });
    row.createEl("button", { text: "Speichern", cls: "dsa-regie-btn mod-primary", attr: { type: "button" } }).addEventListener("click", save);
    row.createEl("button", { text: "Abbrechen", cls: "dsa-regie-btn", attr: { type: "button" } }).addEventListener("click", cancel);
    setTimeout(() => area.focus(), 0);
  };

  const render = () => {
    const session = ctx.session();
    list.empty();
    stats.empty();
    if (!session) {
      list.createDiv({ cls: "dsa-regie-empty", text: "Keine Session gewählt." });
      return;
    }
    const run = ctx.run();
    const entries = run.journal.slice().sort((a, b) => b.t - a.t || (a.id < b.id ? 1 : -1));
    if (!entries.length) list.createDiv({ cls: "dsa-regie-empty", text: "Noch keine Einträge. Proben, Kämpfe und Szenen werden automatisch mitgeschrieben, sobald die Session läuft." });
    let prevScene: string | undefined | null = null;
    for (const e of entries.slice(0, limit)) {
      if (e.scene !== prevScene) {
        list.createDiv({ cls: "dsa-regie-divider", text: e.scene ?? "Ohne Szene", attr: { role: "separator" } });
        prevScene = e.scene;
      }
      const li = list.createDiv({ cls: `dsa-regie-entry kind-${e.kind}`, attr: { role: "listitem" } });
      li.createSpan({ cls: "dsa-regie-entry-time", text: hhmm(e.t) });
      setIcon(li.createSpan({ cls: "dsa-regie-entry-icon", attr: { title: KIND_LABEL[e.kind] } }), KIND_ICON[e.kind]);
      if (editing === e.id) {
        editor(li, e, session);
        continue;
      }
      li.createSpan({ cls: "dsa-regie-entry-text", text: e.text });
      const act = li.createDiv({ cls: "dsa-regie-entry-actions" });
      const ed = act.createEl("button", { cls: "dsa-regie-iconbtn", attr: { type: "button", "aria-label": "Eintrag bearbeiten" } });
      setIcon(ed, "pencil");
      ed.addEventListener("click", () => {
        editing = e.id;
        render();
      });
      const del = act.createEl("button", { cls: "dsa-regie-iconbtn", attr: { type: "button", "aria-label": "Eintrag löschen" } });
      setIcon(del, "trash-2");
      del.addEventListener("click", () => ctx.regie.deleteEntry(session, e.id));
    }
    if (entries.length > limit) {
      const more = list.createEl("button", { cls: "dsa-regie-btn", text: `Ältere anzeigen (${entries.length - limit})`, attr: { type: "button" } });
      more.addEventListener("click", () => {
        limit += PAGE;
        render();
      });
    }
    const st = journalStats(run);
    const bits = [`${st.proben} Proben`, `${st.kaempfe} ${st.kaempfe === 1 ? "Kampf" : "Kämpfe"}`, `${st.enthuellt} enthüllt`];
    if (run.startedAt !== null) bits.push(formatDuration(sessionElapsed(run, Date.now())) + " h");
    stats.setText(bits.join(" · "));
  };
  return { render, isEditing: () => editing !== null, focusCapture: () => capture.focus() };
}
