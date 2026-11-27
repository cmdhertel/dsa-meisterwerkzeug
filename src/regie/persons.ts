// Sitzungsregie: NSC cards and place chips of the stage.
import { Component, MarkdownRenderer, setIcon } from "obsidian";
import type { RegieCtx } from "./ctx";
import { initials } from "./text";
import type { PersonInfo, PlaceInfo } from "./vault";

/** Markdown renderer that never throws. */
/** Renders inline markdown (links, bold) without the paragraph wrapper margins. */
export async function renderInline(ctx: RegieCtx, md: string, el: HTMLElement, sourcePath: string, comp: Component): Promise<void> {
  el.addClass("dsa-regie-inline");
  await renderMd(ctx, md, el, sourcePath, comp);
}

export async function renderMd(ctx: RegieCtx, md: string, el: HTMLElement, sourcePath: string, comp: Component): Promise<void> {
  try {
    await MarkdownRenderer.render(ctx.app, md, el, sourcePath, comp);
  } catch (e) {
    console.error("Sitzungsregie: Markdown konnte nicht gerendert werden", e);
    el.setText(md);
  }
}

const ROLE_LABEL: Record<string, string> = { haupt: "Hauptfigur", neben: "Nebenfigur", statist: "Statist" };

/** @param memo remembers which cards the GM opened/closed across re-renders (key = note path) */
export async function renderPersons(host: HTMLElement, ctx: RegieCtx, comp: Component, persons: PersonInfo[], memo: Map<string, boolean>): Promise<void> {
  if (!persons.length) return;
  const sec = host.createDiv({ cls: "dsa-regie-section" });
  sec.createEl("h3", { cls: "dsa-regie-h", text: "Personen" });
  const grid = sec.createDiv({ cls: "dsa-regie-persons" });
  const collapseAll = persons.length > 4;
  for (const p of persons) {
    const card = grid.createDiv({ cls: "dsa-regie-person" });
    const head = card.createEl("button", { cls: "dsa-regie-person-head", attr: { type: "button", "aria-expanded": String(!collapseAll) } });
    const pic = head.createSpan({ cls: "dsa-regie-portrait" });
    if (p.imageUrl) pic.createEl("img", { attr: { src: p.imageUrl, alt: "", loading: "lazy" } });
    else pic.setText(initials(p.name));
    const info = head.createSpan({ cls: "dsa-regie-person-info" });
    info.createSpan({ cls: "dsa-regie-person-name", text: p.name });
    const sub = [p.profession, ROLE_LABEL[p.role]].filter(Boolean).join(" · ");
    if (sub || p.kurz) info.createSpan({ cls: "dsa-regie-person-sub", text: sub || p.kurz });
    const chev = head.createSpan({ cls: "dsa-regie-chevron" });
    const body = card.createDiv({ cls: "dsa-regie-person-body" });
    const paint = (open: boolean) => {
      head.setAttr("aria-expanded", String(open));
      body.toggle(open);
      setIcon(chev, open ? "chevron-up" : "chevron-down");
    };
    head.addEventListener("click", () => {
      const open = head.getAttr("aria-expanded") !== "true";
      memo.set(p.path, open);
      paint(open);
    });

    if (p.kurz && sub) body.createDiv({ cls: "dsa-regie-person-kurz", text: p.kurz });
    const kp = p.kp;
    if (kp) {
      const rows: [string, string][] = [
        ["Auftreten", kp.auftreten],
        ["Stimme & Marotte", kp.stimme],
        ["Will", kp.will],
        ["Weiß", kp.weiss],
        ...kp.extra.map((x) => [x.label, x.value] as [string, string]),
      ];
      const dl = body.createDiv({ cls: "dsa-regie-kp" });
      for (const [k, v] of rows) {
        if (!v) continue;
        const row = dl.createDiv({ cls: "dsa-regie-kp-row" });
        row.createSpan({ cls: "dsa-regie-kp-key", text: k });
        row.createSpan({ cls: "dsa-regie-kp-val", text: v });
      }
      if (kp.zitat) body.createEl("blockquote", { cls: "dsa-regie-quote", text: kp.zitat.replace(/^["„“]|["“”]$/g, "") });
    }
    if (p.secret) {
      const d = body.createEl("details", { cls: "dsa-regie-secret" });
      d.createEl("summary", { text: "Geheimnis (nur SL)" });
      const inner = d.createDiv({ cls: "markdown-rendered dsa-regie-md" });
      let done = false;
      d.addEventListener("toggle", () => {
        if (!d.open || done) return;
        done = true;
        void renderMd(ctx, p.secret!, inner, p.path, comp);
      });
    }
    const open = body.createEl("button", { cls: "dsa-regie-link", text: "Notiz öffnen", attr: { type: "button" } });
    open.addEventListener("click", () => ctx.openNote(p.path));
    paint(memo.get(p.path) ?? !collapseAll);
  }
}

export function renderPlaces(host: HTMLElement, ctx: RegieCtx, places: PlaceInfo[]): void {
  if (!places.length) return;
  const sec = host.createDiv({ cls: "dsa-regie-section" });
  sec.createEl("h3", { cls: "dsa-regie-h", text: "Orte" });
  const row = sec.createDiv({ cls: "dsa-regie-chips" });
  for (const p of places) {
    const b = row.createEl("button", { cls: "dsa-regie-chip", attr: { type: "button", title: p.kurz || p.name } });
    setIcon(b.createSpan({ cls: "dsa-regie-chip-icon" }), "map-pin");
    b.createSpan({ text: p.name });
    b.addEventListener("click", () => ctx.openNote(p.path));
  }
}
