// Sitzungsregie: scene rail (Auftakt, own scenes, collapsible adventure groups).
import { Menu, setIcon } from "obsidian";
import type { RegieCtx } from "./ctx";
import { formatDuration, sceneElapsed } from "./run";
import type { SceneInfo } from "./vault";
import { appendVaultDocLink } from "../docLink";

export interface RailApi {
  render(): void;
  /** refreshes the time labels only */
  updateTimes(): void;
}

const TYPE_ICON: Record<string, string> = {
  kampf: "swords",
  sozial: "messages-square",
  erkundung: "compass",
  rätsel: "puzzle",
  raetsel: "puzzle",
  dramatisch: "drama",
  reise: "route",
  ruhe: "moon",
};
const STATUS_LABEL = { offen: "offen", läuft: "läuft", gespielt: "gespielt" } as const;
const statusClass = (s: string) => (s === "läuft" ? "is-live" : s === "gespielt" ? "is-done" : "is-open");

export function buildRail(host: HTMLElement, ctx: RegieCtx): RailApi {
  host.addClass("dsa-regie-rail");
  // Not a listbox: the rows contain buttons, which are not allowed inside role="option". Arrow keys still work.
  host.setAttr("role", "group");
  host.setAttr("aria-label", "Szenen");
  const collapsed = new Set<string>();

  host.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const keys = Array.from(host.querySelectorAll<HTMLElement>(".dsa-regie-rail-item")).map((n) => n.dataset.key!);
    const i = keys.indexOf(ctx.selected() ?? "");
    const next = keys[Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    ctx.select(next);
    host.querySelector<HTMLElement>(`.dsa-regie-rail-item[data-key="${CSS.escape(next)}"] .dsa-regie-rail-main`)?.focus();
  });

  const item = (parent: HTMLElement, key: string, scene: SceneInfo | null): HTMLElement => {
    const run = ctx.run();
    const st = scene ? run.scenes[scene.path] : undefined;
    const status = st?.status ?? "offen";
    const sel = ctx.selected() === key;
    const el = parent.createDiv({ cls: "dsa-regie-rail-item", attr: { "data-key": key } });
    el.toggleClass("is-selected", sel);
    el.toggleClass("is-active", !!scene && run.activeScene === scene.path);
    el.toggleClass("is-done", status === "gespielt");
    const main = el.createEl("button", { cls: "dsa-regie-rail-main", attr: { type: "button", tabindex: sel ? "0" : "-1" } });
    if (sel) main.setAttr("aria-current", "true");
    const badge = main.createSpan({ cls: "dsa-regie-badge" });
    if (scene) badge.setText(scene.number || "•");
    else setIcon(badge, "flag");
    const body = main.createSpan({ cls: "dsa-regie-rail-body" });
    body.createSpan({ cls: "dsa-regie-rail-label", text: scene ? scene.label : "Auftakt" });
    const meta = body.createSpan({ cls: "dsa-regie-rail-meta" });
    if (scene?.szenentyp) {
      const t = meta.createSpan({ cls: "dsa-regie-tag" });
      setIcon(t.createSpan({ cls: "dsa-regie-tag-icon" }), TYPE_ICON[scene.szenentyp] ?? "tag");
      t.createSpan({ text: scene.szenentyp });
    }
    if (scene && status !== "offen") meta.createSpan({ cls: `dsa-regie-rail-status ${statusClass(status)}`, text: STATUS_LABEL[status] });
    if (scene) meta.createSpan({ cls: "dsa-regie-rail-time", attr: { "data-scene": scene.path } });
    if (scene?.kurz) body.createSpan({ cls: "dsa-regie-rail-kurz", text: scene.kurz });
    if (scene) {
      main.createSpan({ cls: `dsa-regie-dot ${statusClass(status)}`, attr: { "aria-label": `Status: ${STATUS_LABEL[status]}`, role: "img" } });
    }
    main.addEventListener("click", () => ctx.select(key));
    main.addEventListener("dblclick", () => scene && ctx.start(scene));
    main.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && scene) {
        e.preventDefault();
        ctx.start(scene);
      }
    });
    const kebab = el.createEl("button", { cls: "dsa-regie-rail-kebab", attr: { type: "button", "aria-label": "Szenen-Menü", tabindex: "-1" } });
    setIcon(kebab, "more-vertical");
    const menu = (ev: MouseEvent) => {
      const m = new Menu();
      if (scene) {
        const s = ctx.session();
        m.addItem((i) => i.setTitle("Szene starten").setIcon("play").onClick(() => ctx.start(scene)));
        if (s) {
          m.addItem((i) => i.setTitle("Als gespielt markieren").setIcon("check").onClick(() => ctx.regie.setSceneStatus(s, scene.path, "gespielt")));
          m.addItem((i) => i.setTitle("Zurück auf offen").setIcon("circle").onClick(() => ctx.regie.setSceneStatus(s, scene.path, "offen")));
        }
        m.addSeparator();
      }
      const path = scene?.path ?? key;
      m.addItem((i) => i.setTitle("Notiz öffnen").setIcon("file-text").onClick(() => ctx.openNote(path)));
      m.addItem((i) => i.setTitle("In neuem Tab öffnen").setIcon("external-link").onClick(() => ctx.openNote(path, true)));
      m.showAtMouseEvent(ev);
    };
    kebab.addEventListener("click", (e) => {
      e.stopPropagation();
      menu(e);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      menu(e);
    });
    return el;
  };

  const render = () => {
    const focused = host.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>(".dsa-regie-rail-item")?.dataset.key : undefined;
    host.empty();
    const s = ctx.session();
    if (!s) {
      appendVaultDocLink(host.createDiv({ cls: "dsa-regie-empty", text: "Keine Session gewählt. Sessions sind Notizen mit typ: session." }));
      return;
    }
    const set = ctx.scenes();
    const list = host.createDiv({ cls: "dsa-regie-rail-list" });
    item(list, s, null);
    if (!set.all.length) {
      appendVaultDocLink(list.createDiv({ cls: "dsa-regie-empty", text: "Keine Szenen gefunden. Szenen-Notizen brauchen typ: szene und teil_von: [[Session]]." }));
    }
    set.own.forEach((sc) => item(list, sc.path, sc));
    for (const adv of set.adventures) {
      const open = !collapsed.has(adv.path);
      const head = list.createEl("button", { cls: "dsa-regie-rail-group", attr: { type: "button", "aria-expanded": String(open) } });
      setIcon(head.createSpan({ cls: "dsa-regie-group-chevron" }), open ? "chevron-down" : "chevron-right");
      head.createSpan({ text: `Aus dem Abenteuer: ${adv.name}` });
      head.addEventListener("click", () => {
        if (collapsed.has(adv.path)) collapsed.delete(adv.path);
        else collapsed.add(adv.path);
        render();
      });
      if (!open) continue;
      for (const ch of adv.chapters) {
        if (ch.chapter) list.createDiv({ cls: "dsa-regie-rail-chapter", text: ch.chapter });
        ch.scenes.forEach((sc) => item(list, sc.path, sc));
      }
    }
    updateTimes();
    if (focused) host.querySelector<HTMLElement>(`.dsa-regie-rail-item[data-key="${CSS.escape(focused)}"] .dsa-regie-rail-main`)?.focus();
  };

  const updateTimes = () => {
    const run = ctx.run();
    const now = Date.now();
    host.querySelectorAll<HTMLElement>(".dsa-regie-rail-time").forEach((el) => {
      const ms = sceneElapsed(run, el.dataset.scene ?? "", now);
      el.setText(ms >= 60000 || run.scenes[el.dataset.scene ?? ""]?.status === "läuft" ? formatDuration(ms) : "");
    });
  };
  return { render, updateTimes };
}
