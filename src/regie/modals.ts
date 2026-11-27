// Sitzungsregie: modals (session picker, quick note, Mitschrift).
import { App, Component, FuzzySuggestModal, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { renderMitschrift, hasMitschrift, upsertMitschrift } from "./journal";
import { KIND_ICON, KIND_LABEL, MANUAL_KINDS, JournalKind, SessionRun } from "./run";
import { applyPrefix } from "./text";
import type { SessionInfo } from "./vault";
import { calendarOf } from "../calendar/state";
import { formatDate } from "../calendar/engine";
import { campaignName } from "./vault";

export class SessionPicker extends FuzzySuggestModal<SessionInfo> {
  constructor(app: App, private items: SessionInfo[], private running: string | null, private onPick: (s: SessionInfo) => void) {
    super(app);
    this.setPlaceholder("Session wählen …");
  }
  getItems(): SessionInfo[] {
    return this.items;
  }
  getItemText(s: SessionInfo): string {
    return `${s.campaign ? s.campaign + " · " : ""}${s.title}${s.datum ? " · " + s.datum : ""}${s.path === this.running ? " · läuft" : ""}`;
  }
  onChooseItem(s: SessionInfo): void {
    this.onPick(s);
  }
}

/** One-line capture with kind chips. Enter saves and closes, Shift+Enter inserts a line break. */
export class QuickNoteModal extends Modal {
  private kind: JournalKind = "notiz";
  constructor(app: App, private onSubmit: (kind: JournalKind, text: string) => void) {
    super(app);
  }
  onOpen(): void {
    this.titleEl.setText("Notiz zur Mitschrift");
    const chips = this.contentEl.createDiv({ cls: "dsa-regie-chips", attr: { role: "radiogroup", "aria-label": "Art des Eintrags" } });
    const area = this.contentEl.createEl("textarea", { cls: "dsa-regie-note-input", attr: { rows: "3", "aria-label": "Text", placeholder: "Text … (! Entscheidung, \" Zitat, > Faden, $ Beute)" } });
    const paint = () => chips.querySelectorAll("button").forEach((b) => b.setAttr("aria-checked", String(b.dataset.kind === this.kind)));
    for (const k of MANUAL_KINDS) {
      const b = chips.createEl("button", { cls: "dsa-regie-chip", attr: { role: "radio", "data-kind": k, type: "button" } });
      setIcon(b.createSpan({ cls: "dsa-regie-chip-icon" }), KIND_ICON[k]);
      b.createSpan({ text: KIND_LABEL[k] });
      b.addEventListener("click", () => {
        this.kind = k;
        paint();
        area.focus();
      });
    }
    paint();
    const submit = () => {
      const r = applyPrefix(area.value.trim(), this.kind);
      if (!r.text) return;
      this.onSubmit(r.kind, r.text);
      this.close();
    };
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    const row = this.contentEl.createDiv({ cls: "dsa-regie-modal-actions" });
    row.createEl("button", { text: "Hinzufügen", cls: "mod-cta" }).addEventListener("click", submit);
    row.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
    setTimeout(() => area.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export function buildMitschrift(plugin: DsaMeisterwerkzeugPlugin, run: SessionRun, titles: Record<string, string>): string {
  let avDate: string | undefined;
  try {
    const camp = campaignName(plugin.app, run.sessionPath);
    avDate = formatDate(calendarOf(plugin).getDate(camp || undefined));
  } catch {
    avDate = undefined;
  }
  return renderMitschrift(run, { avDate, sceneTitles: titles });
}

export class MitschriftModal extends Modal {
  private owner = new Component();
  constructor(private plugin: DsaMeisterwerkzeugPlugin, private run: SessionRun, private titles: Record<string, string>, private afterWrite?: () => void) {
    super(plugin.app);
  }
  async onOpen(): Promise<void> {
    this.owner.load();
    this.modalEl.addClass("dsa-regie-modal");
    this.titleEl.setText("Mitschrift schreiben");
    const md = buildMitschrift(this.plugin, this.run, this.titles);
    const file = this.app.vault.getFileByPath(this.run.sessionPath);
    let replaces = false;
    try {
      if (file) replaces = hasMitschrift(await this.app.vault.cachedRead(file));
    } catch {
      /* unreadable: treat as new */
    }
    this.contentEl.createDiv({
      cls: "dsa-regie-muted",
      text: file ? (replaces ? `Ersetzt den vorhandenen Mitschrift-Abschnitt in „${file.basename}“.` : `Wird in „${file.basename}“ eingefügt.`) : "Die Session-Notiz wurde nicht gefunden.",
    });
    const prev = this.contentEl.createDiv({ cls: "dsa-regie-mitschrift-preview markdown-rendered" });
    try {
      await MarkdownRenderer.render(this.app, md, prev, this.run.sessionPath, this.owner);
    } catch {
      prev.setText(md);
    }
    const row = this.contentEl.createDiv({ cls: "dsa-regie-modal-actions" });
    const write = row.createEl("button", { text: "In Session-Notiz schreiben", cls: "mod-cta" });
    write.disabled = !file;
    write.addEventListener("click", async () => {
      if (!file) return;
      try {
        await this.app.vault.process(file, (t) => upsertMitschrift(t, md));
        new Notice("Mitschrift in die Session-Notiz geschrieben.");
        this.afterWrite?.();
        this.close();
      } catch (e) {
        console.error("Sitzungsregie: Schreiben fehlgeschlagen", e);
        new Notice("Mitschrift konnte nicht geschrieben werden.");
      }
    });
    row.createEl("button", { text: "In Zwischenablage kopieren" }).addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(md);
        new Notice("Mitschrift kopiert.");
      } catch {
        new Notice("Kopieren nicht möglich.");
      }
    });
    row.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
  }
  onClose(): void {
    this.owner.unload();
    this.contentEl.empty();
  }
}

/** Writes the Mitschrift without a preview (command). */
export async function writeMitschriftDirect(plugin: DsaMeisterwerkzeugPlugin, run: SessionRun, titles: Record<string, string>): Promise<boolean> {
  const file = plugin.app.vault.getFileByPath(run.sessionPath);
  if (!file) {
    new Notice("Session-Notiz nicht gefunden.");
    return false;
  }
  try {
    const md = buildMitschrift(plugin, run, titles);
    await plugin.app.vault.process(file, (t) => upsertMitschrift(t, md));
    new Notice("Mitschrift in die Session-Notiz geschrieben.");
    return true;
  } catch (e) {
    console.error("Sitzungsregie: Schreiben fehlgeschlagen", e);
    new Notice("Mitschrift konnte nicht geschrieben werden.");
    return false;
  }
}
