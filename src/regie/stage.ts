// Sitzungsregie: the stage (Auftakt or selected scene): facts, Vorlesen, quick actions, persons, places, clues, whole note.
import { Component, setIcon } from "obsidian";
import { runAction, runBlock } from "./actions";
import type { RegieCtx } from "./ctx";
import { digestNote, secretTasks, sectionBody } from "./digest";
import type { NoteDigest } from "./digest";
import { renderInline, renderMd, renderPersons, renderPlaces } from "./persons";
import { ACTION_ICON, actionLabel, meaningfulBody, stripFrontmatterAndH1, unquote } from "./text";
import { linkedByTyp, loadPerson, loadPlace, toggleTaskInNote } from "./vault";

export interface StageApi {
  /** full re-render (async, stale results are dropped) */
  render(): Promise<void>;
  /** only the title row (status buttons) */
  renderHead(): void;
  dispose(): void;
}

const AUFTAKT: [string, RegExp][] = [
  ["Rückblick", /^Rückblick/i],
  ["Charaktere prüfen", /^Charaktere prüfen/i],
  ["Starker Einstieg", /^Starker Einstieg/i],
  ["Mögliche Szenen", /^Mögliche Szenen/i],
  ["Schauplätze", /^Schauplätze/i],
  ["Belohnungen", /^Belohnung/i],
];

const plainLink = (s: string) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1");

export function buildStage(host: HTMLElement, ctx: RegieCtx): StageApi {
  host.addClass("dsa-regie-stage");
  const head = host.createDiv({ cls: "dsa-regie-stage-head" });
  let body = host.createDiv({ cls: "dsa-regie-stage-body" });
  let comp: Component | null = null;
  let token = 0;
  let lastKey: string | null = null;
  const personMemo = new Map<string, boolean>();
  const wholeMemo = new Map<string, boolean>();

  const renderHead = () => {
    head.empty();
    const key = ctx.selected();
    const session = ctx.session();
    if (!key || !session) return;
    const scene = ctx.scenes().all.find((s) => s.path === key);
    const row = head.createDiv({ cls: "dsa-regie-stage-title" });
    const lead = row.createDiv({ cls: "dsa-regie-stage-lead" });
    const badge = lead.createSpan({ cls: "dsa-regie-badge" });
    if (scene) badge.setText(scene.number || "•");
    else setIcon(badge, "flag");
    const text = lead.createDiv({ cls: "dsa-regie-stage-text" });
    text.createEl("h2", { text: scene ? scene.label : "Auftakt" });
    if (scene?.kurz) text.createDiv({ cls: "dsa-regie-stage-kurz", text: scene.kurz });
    const act = row.createDiv({ cls: "dsa-regie-stage-actions" });
    if (scene) {
      const st = ctx.run().scenes[scene.path]?.status ?? "offen";
      const live = ctx.run().activeScene === scene.path && st === "läuft";
      const start = act.createEl("button", { cls: `dsa-regie-btn ${live ? "" : "mod-primary"}`, attr: { type: "button" } });
      setIcon(start.createSpan({ cls: "dsa-regie-btn-icon" }), live ? "circle-dot" : "play");
      start.createSpan({ cls: "dsa-regie-btn-text", text: live ? "Läuft" : st === "gespielt" ? "Erneut starten" : "Szene starten" });
      start.disabled = live;
      start.addEventListener("click", () => ctx.start(scene));
      if (st !== "gespielt") {
        const done = act.createEl("button", { cls: "dsa-regie-btn", attr: { type: "button", "aria-label": "Als gespielt markieren" } });
        setIcon(done.createSpan({ cls: "dsa-regie-btn-icon" }), "check");
        done.createSpan({ cls: "dsa-regie-btn-text", text: "Gespielt" });
        done.addEventListener("click", () => ctx.regie.setSceneStatus(session, scene.path, "gespielt"));
      }
    }
    const open = act.createEl("button", { cls: "dsa-regie-btn", attr: { type: "button", "aria-label": "Notiz öffnen" } });
    setIcon(open.createSpan({ cls: "dsa-regie-btn-icon" }), "file-text");
    open.createSpan({ cls: "dsa-regie-btn-text", text: "Notiz" });
    open.addEventListener("click", () => ctx.openNote(key));
  };

  const section = (parent: HTMLElement, title: string, cls = ""): HTMLElement => {
    const s = parent.createDiv({ cls: `dsa-regie-section ${cls}`.trim() });
    s.createEl("h3", { cls: "dsa-regie-h", text: title });
    return s;
  };

  async function fill(el: HTMLElement, key: string, c: Component): Promise<void> {
    const file = ctx.app.vault.getFileByPath(key);
    if (!file) {
      el.createDiv({ cls: "dsa-regie-empty", text: "Die Notiz wurde nicht gefunden. Sie wurde vielleicht gelöscht oder verschoben." });
      return;
    }
    let text = "";
    try {
      text = await ctx.app.vault.cachedRead(file);
    } catch {
      el.createDiv({ cls: "dsa-regie-empty", text: "Die Notiz konnte nicht gelesen werden." });
      return;
    }
    const isAuftakt = key === ctx.session();
    const d = digestNote(text);
    const sourcePath = key;

    if (d.facts.length) {
      const row = el.createDiv({ cls: "dsa-regie-chips dsa-regie-facts" });
      for (const f of d.facts) {
        const chip = row.createSpan({ cls: "dsa-regie-fact" });
        chip.createSpan({ cls: "dsa-regie-fact-key", text: f.label });
        chip.createSpan({ text: plainLink(f.value) });
      }
    }

    if (isAuftakt) {
      for (const [title, re] of AUFTAKT) {
        const raw = meaningfulBody(sectionBody(text, re));
        if (!raw) continue;
        const s = section(el, title);
        const quote = title === "Starker Einstieg";
        const md = s.createDiv({ cls: `markdown-rendered dsa-regie-md ${quote ? "dsa-regie-readaloud dsa-regie-vorlesen" : ""}` });
        await renderMd(ctx, quote ? unquote(raw) : raw, md, sourcePath, c);
      }
    } else {
      for (const ra of d.readAloud) {
        const s = section(el, ra.title || "Vorlesen", "dsa-regie-readaloud");
        const md = s.createDiv({ cls: "markdown-rendered dsa-regie-md dsa-regie-vorlesen" });
        await renderMd(ctx, ra.text, md, sourcePath, c);
      }
    }

    await quickActions(el, d, sourcePath);

    // persons / places
    let personLinks = d.linkPaths;
    let placeLinks = d.linkPaths;
    if (isAuftakt) {
      personLinks = digestNote(sectionBody(text, /^Wichtige NSC/i) ?? "").linkPaths;
      placeLinks = digestNote(sectionBody(text, /^Schauplätze/i) ?? "").linkPaths;
    }
    const persons = await Promise.all(linkedByTyp(ctx.app, key, "personen", personLinks, "nsc").slice(0, 24).map((f) => loadPerson(ctx.app, f)));
    await renderPersons(el, ctx, c, persons, personMemo);
    renderPlaces(el, ctx, linkedByTyp(ctx.app, key, "orte", placeLinks, "ort").slice(0, 24).map((f) => loadPlace(ctx.app, f)));

    if (!isAuftakt) await clues(el, d, key, c);

    if (text.trim()) {
      const det = el.createEl("details", { cls: "dsa-regie-whole" });
      det.createEl("summary", { text: "Ganze Notiz" });
      const inner = det.createDiv({ cls: "markdown-rendered dsa-regie-md" });
      let done = false;
      const load = () => {
        if (done) return;
        done = true;
        void renderMd(ctx, stripFrontmatterAndH1(text), inner, sourcePath, c);
      };
      det.addEventListener("toggle", () => {
        wholeMemo.set(key, det.open);
        if (det.open) load();
      });
      // nothing digestible in this note: show it right away instead of an almost empty stage
      const bare = !el.querySelector(".dsa-regie-section");
      if (wholeMemo.get(key) ?? bare) {
        det.open = true;
        load();
      }
    }
  }

  async function quickActions(el: HTMLElement, d: NoteDigest, sourcePath: string): Promise<void> {
    const seen = new Set<string>();
    const actions = d.actions.filter((a) => !seen.has(a.raw) && !!seen.add(a.raw));
    if (!actions.length && !d.blocks.length) return;
    const s = section(el, "Schnellaktionen");
    const row = s.createDiv({ cls: "dsa-regie-actions" });
    const session = ctx.session() ?? sourcePath;
    for (const a of actions) {
      const b = row.createEl("button", { cls: "dsa-regie-action", attr: { type: "button", title: a.raw } });
      setIcon(b.createSpan({ cls: "dsa-regie-btn-icon" }), ACTION_ICON[a.kind]);
      b.createSpan({ text: actionLabel(a) });
      b.addEventListener("click", () => runAction(ctx.plugin, a, session));
    }
    for (const blk of d.blocks) {
      const b = row.createEl("button", { cls: "dsa-regie-action mod-fight", attr: { type: "button" } });
      setIcon(b.createSpan({ cls: "dsa-regie-btn-icon" }), "swords");
      b.createSpan({ text: `Kampf laden: ${blk.title}` });
      b.addEventListener("click", () => void runBlock(ctx.plugin, blk));
    }
  }

  async function clues(el: HTMLElement, d: NoteDigest, path: string, c: Component): Promise<void> {
    // only tasks under a Geheimnis/Hinweis heading are clues (docs/VAULT.md)
    const tasks = secretTasks(d);
    if (!tasks.length) return;
    const s = section(el, "Hinweise");
    const list = s.createEl("ul", { cls: "dsa-regie-tasks" });
    for (const t of tasks) {
      const li = list.createEl("li", { cls: "dsa-regie-task" });
      const label = li.createEl("label");
      const cb = label.createEl("input", { attr: { type: "checkbox" } });
      cb.checked = t.checked;
      li.toggleClass("is-done", t.checked);
      const span = label.createSpan({ cls: "dsa-regie-task-text" });
      await renderInline(ctx, t.text, span, path, c);
      cb.addEventListener("change", async () => {
        const want = cb.checked;
        cb.disabled = true;
        const ok = await toggleTaskInNote(ctx.app, path, t, want);
        cb.disabled = false;
        if (!ok) {
          cb.checked = !want;
          return;
        }
        t.checked = want;
        li.toggleClass("is-done", want);
        const session = ctx.session();
        if (want && session && ctx.isRunning()) ctx.regie.log(session, "geheimnis", t.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1"));
      });
    }
  }

  const render = async (): Promise<void> => {
    const my = ++token;
    const key = ctx.selected();
    renderHead();
    if (!key || !ctx.session()) {
      body.empty();
      body.createDiv({ cls: "dsa-regie-empty", text: "Wähle oben eine Session, um die Regie zu starten." });
      lastKey = null;
      return;
    }
    const next = createDiv({ cls: "dsa-regie-stage-body" });
    const c = new Component();
    ctx.owner.addChild(c);
    try {
      await fill(next, key, c);
    } catch (e) {
      console.error("Sitzungsregie: Bühne konnte nicht aufgebaut werden", e);
      next.empty();
      next.createDiv({ cls: "dsa-regie-empty", text: "Die Szene konnte nicht dargestellt werden." });
    }
    if (my !== token) {
      ctx.owner.removeChild(c);
      return;
    }
    const scroll = host.scrollTop;
    const same = key === lastKey;
    if (comp) ctx.owner.removeChild(comp);
    comp = c;
    body.replaceWith(next);
    body = next;
    lastKey = key;
    host.scrollTop = same ? scroll : 0;
  };

  return {
    render,
    renderHead,
    dispose: () => {
      token++;
      if (comp) ctx.owner.removeChild(comp);
      comp = null;
    },
  };
}
