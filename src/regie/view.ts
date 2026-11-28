// Sitzungsregie: the main-area view (layout, wiring of header, rail, stage and side panels).
import { ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf, Component } from "obsidian";
import { calendarOf } from "../calendar/state";
import type DsaMeisterwerkzeugPlugin from "../main";
import type { RegieCtx } from "./ctx";
import { buildHeader, HeaderApi } from "./header";
import { buildJournalPanel, JournalApi } from "./journalPanel";
import { MitschriftModal, QuickNoteModal, SessionPicker } from "./modals";
import { buildPartyStrip } from "./partyStrip";
import { buildRail, RailApi } from "./rail";
import type { SessionRun } from "./run";
import { buildSecretsPanel, SecretsApi } from "./secretsPanel";
import { buildStage, StageApi } from "./stage";
import { RegieState, regieOf } from "./state";
import { SceneInfo, SceneSet, SessionInfo, campaignName, discoverScenes, fmOf, listSessions, pickDefaultSession } from "./vault";
import { valueText } from "../valueText";

export const REGIE_VIEW_TYPE = "dsa-regie";
type Layout = "wide" | "medium" | "narrow";
type Flag = "sessions" | "set" | "stage" | "secrets" | "party";
const TABS = [
  ["szene", "Szene"],
  ["geheimnisse", "Geheimnisse"],
  ["mitschrift", "Mitschrift"],
  ["helden", "Helden"],
] as const;
const EMPTY_SET: SceneSet = { own: [], adventures: [], all: [] };

export class RegieView extends ItemView implements RegieCtx {
  readonly regie: RegieState;
  private sessionPath: string | null = null;
  private sel: string | null = null;
  private set: SceneSet = EMPTY_SET;
  private list: SessionInfo[] = [];
  private lastActive: string | null = null;
  private header!: HeaderApi;
  private rail!: RailApi;
  private stage!: StageApi;
  private secrets!: SecretsApi;
  private journal!: JournalApi;
  private party!: { render(): void };
  private root!: HTMLElement;
  private flags = new Set<Flag>();
  private timer: number | null = null;
  private partyTimer: number | null = null;
  private resolvedTimer: number | null = null;
  /** Frontmatter of the session note and its scene notes at the last refresh (see sigOf). */
  private relevantSig = "";

  constructor(leaf: WorkspaceLeaf, readonly plugin: DsaMeisterwerkzeugPlugin) {
    super(leaf);
    this.regie = regieOf(plugin);
  }

  // real methods (not class fields): the base constructor calls them
  getViewType(): string {
    return REGIE_VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Sitzungsregie";
  }
  getIcon(): string {
    return "clapperboard";
  }

  // ------------------------------------------------------------ RegieCtx
  get owner(): Component {
    return this;
  }
  session = () => this.sessionPath;
  sessionInfo = () => this.list.find((s) => s.path === this.sessionPath) ?? null;
  sessions = () => this.list;
  campaign = () => this.sessionInfo()?.campaign ?? (this.sessionPath ? campaignName(this.app, this.sessionPath) : "");
  run = (): SessionRun => this.regie.run(this.sessionPath ?? "");
  isRunning = () => !!this.sessionPath && this.regie.isRunning(this.sessionPath);
  scenes = () => this.set;
  selected = () => this.sel;
  sceneTitles = () => Object.fromEntries(this.set.all.map((s) => [s.path, s.title]));
  registerCleanup = (fn: () => void) => this.register(fn);

  select(key: string): void {
    if (this.sel === key) return;
    this.sel = key;
    this.rail.render();
    void this.stage.render();
  }
  start(scene: SceneInfo): void {
    if (!this.sessionPath) return;
    this.regie.activate(this.sessionPath, scene.path, scene.title);
    this.select(scene.path);
  }
  openNote(path: string, newTab = false): void {
    const f = this.app.vault.getFileByPath(path);
    if (!f) return void new Notice("Notiz nicht gefunden.");
    void this.app.workspace.getLeaf(newTab ? "tab" : "split").openFile(f);
  }
  quickNote(): void {
    const s = this.sessionPath;
    if (s) new QuickNoteModal(this.app, (k, t) => this.regie.log(s, k, t)).open();
  }
  pickSession(): void {
    this.list = listSessions(this.app);
    new SessionPicker(this.app, this.list, this.regie.running()?.sessionPath ?? null, (s) => void this.setSession(s.path)).open();
  }
  writeMitschrift(): void {
    if (this.sessionPath) new MitschriftModal(this.plugin, this.run(), this.sceneTitles()).open();
  }
  endSession(): void {
    const s = this.sessionPath;
    if (!s) return;
    this.regie.end(s);
    new MitschriftModal(this.plugin, this.regie.run(s), this.sceneTitles()).open();
  }

  // ------------------------------------------------------------ session handling
  async setSession(path: string | null, scene?: string | null): Promise<void> {
    this.sessionPath = path;
    this.sel = scene ?? path;
    this.lastActive = path ? this.regie.run(path).activeScene : null;
    if (path) this.regie.setLast(path);
    this.refreshSet();
    if (scene && !this.set.all.some((s) => s.path === scene)) this.sel = path;
    this.renderAll();
  }
  private refreshSet(): void {
    this.set = this.sessionPath ? discoverScenes(this.app, this.sessionPath) : EMPTY_SET;
    if (this.sel && this.sel !== this.sessionPath && !this.set.all.some((s) => s.path === this.sel)) this.sel = this.sessionPath;
  }
  private renderAll(): void {
    this.relevantSig = this.sigOf();
    this.header.refresh();
    this.rail.render();
    void this.stage.render();
    void this.secrets.render();
    this.journal.render();
    this.party.render();
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state ?? {}) as { session?: string; scene?: string };
    if (typeof s.session === "string" && this.root) await this.setSession(s.session, s.scene);
    await super.setState(state, result);
  }
  getState(): Record<string, unknown> {
    return { session: this.sessionPath, scene: this.sel !== this.sessionPath ? this.sel : null };
  }

  // ------------------------------------------------------------ lifecycle
  async onOpen(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass("dsa-regie-view");
    this.root = el.createDiv({ cls: "dsa-regie-root", attr: { "data-layout": "wide", "data-tab": "szene" } });
    this.header = buildHeader(this.root.createDiv(), this);
    const tabs = this.root.createDiv({ cls: "dsa-regie-tabs", attr: { role: "tablist" } });
    for (const [id, label] of TABS) {
      const b = tabs.createEl("button", { text: label, cls: "dsa-regie-tab", attr: { role: "tab", type: "button", "data-tab": id, "aria-selected": String(id === "szene") } });
      b.addEventListener("click", () => this.setTab(id));
    }
    this.party = buildPartyStrip(this.root.createDiv({ attr: { "data-pane": "helden" } }), this);
    const main = this.root.createDiv({ cls: "dsa-regie-main" });
    this.rail = buildRail(main.createDiv({ attr: { "data-pane": "szene" } }), this);
    this.stage = buildStage(main.createDiv({ attr: { "data-pane": "szene" } }), this);
    const side = main.createDiv({ cls: "dsa-regie-side" });
    this.secrets = buildSecretsPanel(side.createDiv({ attr: { "data-pane": "geheimnisse" } }), this);
    this.journal = buildJournalPanel(side.createDiv({ attr: { "data-pane": "mitschrift" } }), this);

    this.list = listSessions(this.app);
    const first = this.sessionPath ?? pickDefaultSession(this.list, this.regie.data.lastSession);
    this.sessionPath = first;
    this.sel = this.sel ?? first;
    this.refreshSet();
    this.renderAll();

    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (w) this.root.dataset.layout = (w >= 1000 ? "wide" : w >= 700 ? "medium" : "narrow") satisfies Layout;
    });
    ro.observe(el);
    this.register(() => ro.disconnect());

    this.register(
      this.regie.on((p) => {
        if (p !== null && p !== this.sessionPath) return;
        const active = this.run().activeScene;
        if (active !== this.lastActive) {
          this.lastActive = active;
          if (active && this.set.all.some((s) => s.path === active) && this.sel !== active) {
            this.sel = active;
            void this.stage.render();
          }
        }
        this.header.refresh();
        this.rail.render();
        this.stage.renderHead();
        // An open entry editor must not be re-rendered by background changes (auto-log, probes): the draft would be lost.
        if (!this.journal.isEditing()) this.journal.render();
      }),
    );
    let n = 0;
    this.registerInterval(
      window.setInterval(() => {
        this.header.tick();
        if (++n % 15 === 0) this.rail.updateTimes();
      }, 1000),
    );
    this.register(this.plugin.combat.on(() => this.later("party")));
    try {
      this.register(calendarOf(this.plugin).on(() => this.header.refresh()));
    } catch {
      /* calendar not ready: the date chip keeps its placeholder */
    }
    this.registerEvent(this.app.metadataCache.on("changed", (f) => this.onMeta(f)));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.onResolved()));
    this.registerEvent(this.app.vault.on("rename", (f, old) => this.onRename(f.path, old)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.onDelete(f.path)));
    // heroes load asynchronously after startup
    this.partyTimer = window.setTimeout(() => this.party.render(), 2000);
    this.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer);
      if (this.partyTimer !== null) window.clearTimeout(this.partyTimer);
      if (this.resolvedTimer !== null) window.clearTimeout(this.resolvedTimer);
    });
    this.register(() => this.stage.dispose());
  }

  async onClose(): Promise<void> {
    this.stage?.dispose();
    await this.regie.flush();
  }

  // ------------------------------------------------------------ change handling
  private setTab(id: string): void {
    this.root.dataset.tab = id;
    this.root.querySelectorAll<HTMLElement>(".dsa-regie-tab").forEach((b) => b.setAttr("aria-selected", String(b.dataset.tab === id)));
  }

  private later(...f: Flag[]): void {
    f.forEach((x) => this.flags.add(x));
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), 150);
  }
  private flush(): void {
    this.timer = null;
    const f = this.flags;
    this.flags = new Set();
    if (f.has("sessions")) {
      this.list = listSessions(this.app);
      if (this.sessionPath && !this.app.vault.getFileByPath(this.sessionPath)) void this.setSession(pickDefaultSession(this.list, null));
    }
    if (f.has("set")) {
      this.refreshSet();
      this.rail.render();
    }
    if (f.has("sessions") || f.has("set")) this.header.refresh();
    if (f.has("sessions") || f.has("set")) this.secrets.invalidate();
    if (f.has("stage") || f.has("set")) void this.stage.render();
    if (f.has("secrets") || f.has("set")) void this.secrets.render();
    if (f.has("party")) this.party.render();
    this.relevantSig = this.sigOf();
  }
  /** Metadata of the session note and its scene notes, as far as the regie shows them. */
  private sigOf(): string {
    const paths = [this.sessionPath, ...this.set.all.map((s) => s.path)];
    return paths.map((p) => `${p ?? ""}\n${JSON.stringify(p ? fmOf(this.app, p) ?? null : null)}`).join("\n");
  }
  /**
   * "resolved" fires for every indexed file and has no file argument, so it is debounced and only
   * triggers a refresh when the relevant frontmatter actually changed.
   */
  private onResolved(): void {
    if (this.resolvedTimer !== null) window.clearTimeout(this.resolvedTimer);
    this.resolvedTimer = window.setTimeout(() => {
      this.resolvedTimer = null;
      if (this.sigOf() !== this.relevantSig) this.later("sessions", "set", "party");
    }, 500);
  }
  private onMeta(file: TFile): void {
    const typ = valueText(fmOf(this.app, file.path)?.typ).toLowerCase();
    if (typ === "session") this.later("sessions", ...(file.path === this.sessionPath ? (["set", "stage", "secrets"] as Flag[]) : []));
    else if (typ === "szene" || typ === "kapitel" || typ === "abenteuer") this.later("set", "secrets", ...(file.path === this.sel ? (["stage"] as Flag[]) : []));
    else if (typ === "nsc" || typ === "ort") this.later("stage");
    if (this.plugin.heroes.getByPath(file.path)) this.later("party");
  }
  private onRename(path: string, old: string): void {
    if (this.sessionPath === old) this.sessionPath = path;
    if (this.sel === old) this.sel = path;
    this.later("sessions", "set", "stage", "secrets", "party");
  }
  private onDelete(path: string): void {
    if (path === this.sessionPath || path === this.sel || this.set.all.some((s) => s.path === path)) this.later("sessions", "set", "stage", "secrets");
  }
}
