import { App, Modal, Setting } from "obsidian";

/** Small text prompt; resolves null on cancel. */
export function promptText(app: App, title: string, placeholder: string, initial = "", validate?: (v: string) => string | null): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    class P extends Modal {
      onOpen() {
        this.titleEl.setText(title);
        let value = initial;
        const err = this.contentEl.createDiv({ cls: "dsa-cal-error" });
        const submit = () => {
          const msg = validate ? validate(value) : null;
          if (msg) return err.setText(msg);
          done = true;
          resolve(value);
          this.close();
        };
        new Setting(this.contentEl).addText((t) => {
          t.setPlaceholder(placeholder).setValue(initial).onChange((v) => (value = v));
          t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit());
          window.setTimeout(() => t.inputEl.focus(), 0);
        });
        new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(submit));
      }
      onClose() {
        this.contentEl.empty();
        if (!done) resolve(null);
      }
    }
    new P(app).open();
  });
}
