import { App, FuzzySuggestModal, Modal, Setting, TFile } from "obsidian";

export function pick<T>(app: App, items: T[], label: (t: T) => string, placeholder: string): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    class M extends FuzzySuggestModal<T> {
      getItems() {
        return items;
      }
      getItemText(t: T) {
        return label(t);
      }
      onChooseItem(t: T) {
        done = true;
        resolve(t);
      }
      onClose() {
        setTimeout(() => {
          if (!done) resolve(null);
        }, 0);
      }
    }
    const m = new M(app);
    m.setPlaceholder(placeholder);
    m.open();
  });
}

export function confirm(app: App, title: string, text: string, okLabel = "Ja"): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    class M extends Modal {
      onOpen() {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", { text });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText(okLabel).setCta().onClick(() => { done = true; resolve(true); this.close(); }))
          .addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()));
      }
      onClose() {
        if (!done) resolve(false);
      }
    }
    new M(app).open();
  });
}

export function promptText(app: App, title: string, label: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let value = initial;
    class M extends Modal {
      onOpen() {
        this.titleEl.setText(title);
        new Setting(this.contentEl).setName(label).addText((t) => {
          t.setValue(initial).onChange((v) => (value = v));
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { done = true; resolve(value); this.close(); }
          });
        });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("OK").setCta().onClick(() => { done = true; resolve(value); this.close(); }))
          .addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()));
      }
      onClose() {
        if (!done) resolve(null);
      }
    }
    new M(app).open();
  });
}

export interface PreviewData {
  title: string;
  isNew: boolean;
  lines: string[];
  stubs: string[];
  warnings: string[];
}

/** Preview of an import: diff lines + apply/cancel. Resolves true on apply. */
export function previewModal(app: App, data: PreviewData): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    class M extends Modal {
      onOpen() {
        this.titleEl.setText(data.title);
        const c = this.contentEl;
        c.createEl("p", { text: data.isNew ? "Neue Heldennotiz wird angelegt." : "Bestehende Notiz wird aktualisiert (nur Frontmatter-Werte und der Block zwischen den Import-Markern)." });
        for (const w of data.warnings) c.createEl("p", { text: w, cls: "dsa-warning" });
        c.createEl("h4", { text: `Änderungen (${data.lines.length})` });
        const ul = c.createEl("ul");
        if (!data.lines.length) ul.createEl("li", { text: "Keine Änderungen." });
        for (const l of data.lines.slice(0, 200)) ul.createEl("li", { text: l });
        if (data.lines.length > 200) ul.createEl("li", { text: `... und ${data.lines.length - 200} weitere` });
        if (data.stubs.length) {
          c.createEl("h4", { text: `Neue Zuordnungs-Platzhalter (${data.stubs.length})` });
          c.createEl("p", { text: data.stubs.slice(0, 40).join(", ") + (data.stubs.length > 40 ? " ..." : "") });
        }
        new Setting(c)
          .addButton((b) => b.setButtonText("Übernehmen").setCta().onClick(() => { done = true; resolve(true); this.close(); }))
          .addButton((b) => b.setButtonText("Abbrechen").onClick(() => this.close()));
      }
      onClose() {
        if (!done) resolve(false);
      }
    }
    new M(app).open();
  });
}

export const isFile = (x: unknown): x is TFile => !!x && typeof (x as TFile).path === "string" && "extension" in (x as object);

export const NEW_HERO = Symbol("new-hero");

/** Target selection after the JSON is chosen. Resolves a note path, NEW_HERO, or null (cancelled). */
export function targetModal(
  app: App,
  heroName: string,
  candidates: { label: string; path: string; auto: boolean }[],
): Promise<string | typeof NEW_HERO | null> {
  type Item = { label: string; value: string | typeof NEW_HERO };
  const items: Item[] = candidates.map((c) => ({ label: c.label, value: c.path }));
  const autoIdx = candidates.findIndex((c) => c.auto);
  if (autoIdx > 0) items.unshift(...items.splice(autoIdx, 1));
  items.push({ label: "Neuen Helden anlegen", value: NEW_HERO });
  return pick(app, items, (i) => i.label, `Zu welcher Notiz gehört "${heroName}"?`).then((r) => (r ? r.value : null));
}
