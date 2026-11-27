// Sitzungsregie: side panel "Geheimnisse & Hinweise" (open clues, leftovers of earlier sessions, revealed list).
import { Component, setIcon } from "obsidian";
import type { RegieCtx } from "./ctx";
import { renderInline } from "./persons";
import type { TaskItem } from "./types";
import { NoteTasks, SceneSet, discoverScenes, loadNoteTasks, toggleTaskInNote } from "./vault";

export interface SecretsApi {
  render(): Promise<void>;
  /** Drops cached scene lists; call when scene, chapter or session metadata changed. */
  invalidate(): void;
}


export function buildSecretsPanel(host: HTMLElement, ctx: RegieCtx): SecretsApi {
  host.addClass("dsa-regie-panel", "dsa-regie-secrets");
  const head = host.createDiv({ cls: "dsa-regie-panel-head" });
  head.createEl("h3", { text: "Geheimnisse & Hinweise" });
  const count = head.createSpan({ cls: "dsa-regie-count" });
  let bodyHost = host.createDiv({ cls: "dsa-regie-panel-body" });
  let comp: Component | null = null;
  let token = 0;
  let revealedOpen = false;
  const sceneCache = new Map<string, SceneSet>();
  const scenesOf = (sessionPath: string): SceneSet => {
    let s = sceneCache.get(sessionPath);
    if (!s) {
      s = discoverScenes(ctx.app, sessionPath);
      sceneCache.set(sessionPath, s);
    }
    return s;
  };

  const notesOf = async (paths: string[]): Promise<NoteTasks[]> => {
    const out: NoteTasks[] = [];
    for (const p of paths) {
      const n = await loadNoteTasks(ctx.app, p);
      if (n && n.secrets.length) out.push(n);
    }
    return out;
  };

  const previous = (): string[] => {
    const cur = ctx.sessionInfo();
    if (!cur) return [];
    const all = ctx.sessions().filter((s) => s.campaign === cur.campaign);
    const idx = all.findIndex((s) => s.path === cur.path);
    const earlier = all.filter((s, i) => s.path !== cur.path && (cur.datum && s.datum ? s.datum < cur.datum : i > idx));
    return earlier.slice(0, Math.max(0, Number(ctx.plugin.settings.regieEarlierSessions ?? 5) || 0)).flatMap((s) => [s.path, ...scenesOf(s.path).own.map((x) => x.path)]);
  };

  const row = (list: HTMLElement, n: NoteTasks, t: TaskItem, c: Component, again: () => void) => {
    const li = list.createEl("li", { cls: "dsa-regie-task" });
    li.toggleClass("is-done", t.checked);
    const label = li.createEl("label");
    const cb = label.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = t.checked;
    const span = label.createSpan({ cls: "dsa-regie-task-text" });
    void renderInline(ctx, t.text, span, n.path, c);
    const src = li.createEl("button", { cls: "dsa-regie-link", text: n.name, attr: { type: "button", title: "Notiz öffnen" } });
    src.addEventListener("click", () => ctx.openNote(n.path));
    cb.addEventListener("change", async () => {
      const want = cb.checked;
      cb.disabled = true;
      const ok = await toggleTaskInNote(ctx.app, n.path, t, want);
      cb.disabled = false;
      if (!ok) {
        cb.checked = !want;
        return;
      }
      const s = ctx.session();
      if (want && s && ctx.isRunning()) ctx.regie.log(s, "geheimnis", t.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1"));
      again();
    });
  };

  const render = async (): Promise<void> => {
    const my = ++token;
    const s = ctx.session();
    if (!s) {
      bodyHost.empty();
      count.setText("");
      bodyHost.createDiv({ cls: "dsa-regie-empty", text: "Keine Session gewählt." });
      return;
    }
    const current = await notesOf([s, ...ctx.scenes().all.map((x) => x.path)]);
    const old = await notesOf(previous());
    if (my !== token) return;
    const next = createDiv({ cls: "dsa-regie-panel-body" });
    const c = new Component();
    ctx.owner.addChild(c);
    const open = current.map((n) => ({ n, items: n.secrets.filter((t) => !t.checked) })).filter((x) => x.items.length);
    const done = current.map((n) => ({ n, items: n.secrets.filter((t) => t.checked) })).filter((x) => x.items.length);
    const olds = old.map((n) => ({ n, items: n.secrets.filter((t) => !t.checked) })).filter((x) => x.items.length);
    const again = () => void render();
    const openCount = open.reduce((a, x) => a + x.items.length, 0);
    count.setText(openCount ? String(openCount) : "");

    const group = (parent: HTMLElement, title: string | null, list: { n: NoteTasks; items: TaskItem[] }[]) => {
      if (title) parent.createDiv({ cls: "dsa-regie-subhead", text: title });
      const ul = parent.createEl("ul", { cls: "dsa-regie-tasks" });
      for (const g of list) for (const t of g.items) row(ul, g.n, t, c, again);
    };
    if (open.length) group(next, null, open);
    else next.createDiv({ cls: "dsa-regie-empty", text: "Keine offenen Geheimnisse in dieser Session." });
    if (olds.length) group(next, "Aus früheren Sessions", olds);
    if (done.length) {
      const det = next.createEl("details", { cls: "dsa-regie-revealed" });
      det.open = revealedOpen;
      det.addEventListener("toggle", () => (revealedOpen = det.open));
      const sum = det.createEl("summary");
      setIcon(sum.createSpan({ cls: "dsa-regie-chip-icon" }), "eye");
      sum.createSpan({ text: `Enthüllt (${done.reduce((a, x) => a + x.items.length, 0)})` });
      group(det, null, done);
    }
    if (comp) ctx.owner.removeChild(comp);
    comp = c;
    bodyHost.replaceWith(next);
    bodyHost = next;
  };
  return { render: () => render(), invalidate: () => sceneCache.clear() };
}
