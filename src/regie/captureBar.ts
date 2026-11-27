// Sitzungsregie: quick-capture bar of the Mitschrift panel (kind chips + prefix shortcuts ! " > $).
import { Notice, setIcon } from "obsidian";
import type { RegieCtx } from "./ctx";
import { JournalKind, KIND_ICON, KIND_LABEL, MANUAL_KINDS } from "./run";
import { applyPrefix } from "./text";

export function buildCaptureBar(host: HTMLElement, ctx: RegieCtx): { focus(): void } {
  host.addClass("dsa-regie-capture");
  let kind: JournalKind = "notiz";
  const chips = host.createDiv({ cls: "dsa-regie-chips", attr: { role: "radiogroup", "aria-label": "Art des Eintrags" } });
  const paint = () => chips.querySelectorAll<HTMLElement>("button").forEach((b) => b.setAttr("aria-checked", String(b.dataset.kind === kind)));
  for (const k of MANUAL_KINDS) {
    const b = chips.createEl("button", { cls: "dsa-regie-chip", attr: { type: "button", role: "radio", "data-kind": k, title: KIND_LABEL[k] } });
    setIcon(b.createSpan({ cls: "dsa-regie-chip-icon" }), KIND_ICON[k]);
    b.createSpan({ text: KIND_LABEL[k] });
    b.addEventListener("click", () => {
      kind = k;
      paint();
      input.focus();
    });
  }
  const row = host.createDiv({ cls: "dsa-regie-capture-row" });
  const input = row.createEl("input", {
    cls: "dsa-regie-capture-input",
    attr: { type: "text", placeholder: "Eintrag … (! Entscheidung  \" Zitat  > Faden  $ Beute)", "aria-label": "Neuer Mitschrift-Eintrag" },
  });
  const add = row.createEl("button", { cls: "dsa-regie-btn mod-primary", attr: { type: "button", "aria-label": "Eintrag hinzufügen" } });
  setIcon(add, "plus");
  const submit = () => {
    const s = ctx.session();
    const raw = input.value.trim();
    if (!raw) return;
    if (!s) return void new Notice("Keine Session gewählt. Wähle zuerst eine Session, um Einträge zu schreiben.");
    const r = applyPrefix(raw, kind);
    if (!r.text) return;
    ctx.regie.log(s, r.kind, r.text);
    input.value = "";
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  add.addEventListener("click", submit);
  paint();
  return { focus: () => input.focus() };
}
