// Sitzungsregie: Obsidian-side loading (sessions, scene discovery, NSC cards, hero resources, task scan).
// Discovery uses the metadata cache only; files are read lazily and only when needed.
import { Notice, type App, type TFile } from "obsidian";
import { digestNote, gmSecret, parseKurzprofil, secretTasks, toggleTask } from "./digest";
import type { Kurzprofil, TaskItem } from "./types";
import { campaignsOf } from "../probe/logic";
import { energyNumber } from "../magic/casters";
import type DsaMeisterwerkzeugPlugin from "../main";
import { compareScenes, dateKey, imageTarget, linkList, localDateKey, parseSceneLabel } from "./text";

type Fm = Record<string, unknown>;

export const fmOf = (app: App, path: string): Fm | undefined => app.metadataCache.getCache(path)?.frontmatter;
const typOf = (fm: Fm | undefined): string => (typeof fm?.typ === "string" ? fm.typ.trim().toLowerCase() : "");
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** Resolve a link text relative to a note; never throws. */
export function resolveLink(app: App, link: string, from: string): TFile | null {
  try {
    return app.metadataCache.getFirstLinkpathDest(link.replace(/\.md$/i, ""), from) ?? null;
  } catch {
    return null;
  }
}

/** Resolve the first link of a frontmatter property to a file. */
export function resolveFmLink(app: App, value: unknown, from: string): TFile | null {
  for (const l of linkList(value)) {
    const f = resolveLink(app, l, from);
    if (f) return f;
  }
  return null;
}

export function campaignName(app: App, path: string): string {
  return campaignsOf(fmOf(app, path)?.kampagne)[0] ?? "";
}

// ------------------------------------------------------------------ sessions

export interface SessionInfo {
  path: string;
  title: string;
  campaign: string;
  datum: string | null;
}

export function noteTitle(app: App, file: TFile): string {
  const h = app.metadataCache.getFileCache(file)?.headings?.find((x) => x.level === 1);
  return h?.heading.trim() || file.basename;
}

export function listSessions(app: App): SessionInfo[] {
  const out: SessionInfo[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = fmOf(app, f.path);
    if (typOf(fm) !== "session") continue;
    out.push({ path: f.path, title: f.basename, campaign: campaignsOf(fm?.kampagne)[0] ?? "", datum: dateKey(fm?.datum) });
  }
  return sortSessions(out);
}

/** Campaigns alphabetically, inside a campaign newest `datum` first (undated last). */
export function sortSessions(list: SessionInfo[]): SessionInfo[] {
  return list.slice().sort((a, b) => {
    const c = a.campaign.localeCompare(b.campaign, "de");
    if (c) return c;
    if (a.datum !== b.datum) return a.datum === null ? 1 : b.datum === null ? -1 : a.datum < b.datum ? 1 : -1;
    return b.title.localeCompare(a.title, "de", { numeric: true });
  });
}

/** last used -> session of today -> newest by datum. */
export function pickDefaultSession(list: SessionInfo[], last: string | null, today = localDateKey()): string | null {
  if (last && list.some((s) => s.path === last)) return last;
  const t = list.find((s) => s.datum === today);
  if (t) return t.path;
  const dated = list.filter((s) => s.datum).sort((a, b) => (a.datum! < b.datum! ? 1 : -1));
  return (dated[0] ?? list[0])?.path ?? null;
}

// ------------------------------------------------------------------ scenes

export interface SceneInfo {
  path: string;
  title: string;
  label: string;
  /** badge text: position, else number of the title, else "" */
  number: string;
  szenentyp: string;
  kurz: string;
  position: number | null;
  name: string;
}

export interface ChapterGroup {
  /** null = scenes directly under the adventure */
  chapter: string | null;
  scenes: SceneInfo[];
}
export interface AdventureGroup {
  path: string;
  name: string;
  chapters: ChapterGroup[];
}
export interface SceneSet {
  own: SceneInfo[];
  adventures: AdventureGroup[];
  /** own scenes, then adventure scenes in rail order */
  all: SceneInfo[];
}

function sceneInfo(app: App, f: TFile): SceneInfo {
  const fm = fmOf(app, f.path);
  const title = noteTitle(app, f);
  const { number, label } = parseSceneLabel(title);
  const pos = typeof fm?.position === "number" ? fm.position : fm?.position !== undefined && /^\d+(\.\d+)?$/.test(str(fm.position)) ? Number(fm.position) : null;
  return { path: f.path, title, label, number: pos !== null ? String(pos) : number ?? "", szenentyp: str(fm?.szenentyp).toLowerCase(), kurz: str(fm?.kurz), position: pos, name: f.name };
}

export function discoverScenes(app: App, sessionPath: string): SceneSet {
  const empty: SceneSet = { own: [], adventures: [], all: [] };
  const session = app.vault.getFileByPath(sessionPath);
  if (!session) return empty;

  // one pass over the cache: scene/chapter notes with their parent
  const scenes: { f: TFile; parent: string | null }[] = [];
  const chapters: { f: TFile; parent: string | null }[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    const fm = fmOf(app, f.path);
    const t = typOf(fm);
    if (t !== "szene" && t !== "kapitel") continue;
    const parent = resolveFmLink(app, fm?.teil_von, f.path)?.path ?? null;
    (t === "szene" ? scenes : chapters).push({ f, parent });
  }
  const seen = new Set<string>();
  const take = (list: TFile[]): SceneInfo[] =>
    list
      .filter((f) => !seen.has(f.path) && !!seen.add(f.path))
      .map((f) => sceneInfo(app, f))
      .sort(compareScenes);

  const own = take(scenes.filter((s) => s.parent === session.path).map((s) => s.f));

  const adventures: AdventureGroup[] = [];
  const advFm = fmOf(app, sessionPath)?.abenteuer;
  for (const link of linkList(advFm)) {
    const adv = resolveLink(app, link, sessionPath);
    if (!adv || adventures.some((a) => a.path === adv.path)) continue;
    const groups: ChapterGroup[] = [];
    const direct = take(scenes.filter((s) => s.parent === adv.path).map((s) => s.f));
    if (direct.length) groups.push({ chapter: null, scenes: direct });
    const chs = chapters
      .filter((c) => c.parent === adv.path)
      .map((c) => ({ c, pos: typeof fmOf(app, c.f.path)?.position === "number" ? (fmOf(app, c.f.path)?.position as number) : null }))
      .sort((a, b) => compareScenes({ position: a.pos, name: a.c.f.name }, { position: b.pos, name: b.c.f.name }));
    for (const { c } of chs) {
      const list = take(scenes.filter((s) => s.parent === c.f.path).map((s) => s.f));
      if (list.length) groups.push({ chapter: noteTitle(app, c.f), scenes: list });
    }
    if (groups.length) adventures.push({ path: adv.path, name: noteTitle(app, adv), chapters: groups });
  }
  const all = [...own, ...adventures.flatMap((a) => a.chapters.flatMap((c) => c.scenes))];
  return { own, adventures, all };
}

/** Session note that a scene belongs to (follows kapitel/abenteuer parents up to 4 hops), else null. */
export function sessionOfNote(app: App, path: string): string | null {
  let cur = path;
  for (let i = 0; i < 4; i++) {
    const fm = fmOf(app, cur);
    const t = typOf(fm);
    if (t === "session") return cur;
    const p = resolveFmLink(app, fm?.teil_von, cur);
    if (!p) return null;
    cur = p.path;
  }
  return null;
}

// ------------------------------------------------------------------ persons / places

export interface PersonInfo {
  path: string;
  name: string;
  profession: string;
  kurz: string;
  role: string;
  imageUrl: string | null;
  kp: Kurzprofil | null;
  secret: string | null;
}
export interface PlaceInfo {
  path: string;
  name: string;
  kurz: string;
}

function imageUrl(app: App, fm: Fm | undefined, from: string): string | null {
  try {
    const t = imageTarget(fm?.image);
    if (!t) return null;
    const f = app.vault.getFileByPath(t) ?? resolveLink(app, t, from) ?? app.vault.getFileByPath(t.replace(/\.md$/i, ""));
    if (!f || !/^(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(f.extension)) return null;
    return app.vault.getResourcePath(f);
  } catch {
    return null;
  }
}

/** Candidate link texts (frontmatter property + note links) resolved to files of the wanted `typ`, in order, de-duplicated. */
export function linkedByTyp(app: App, notePath: string, prop: string, linkPaths: string[], typ: string): TFile[] {
  const out: TFile[] = [];
  const add = (l: string) => {
    const f = resolveLink(app, l, notePath);
    if (f && f.path !== notePath && typOf(fmOf(app, f.path)) === typ && !out.some((o) => o.path === f.path)) out.push(f);
  };
  for (const l of linkList(fmOf(app, notePath)?.[prop])) add(l);
  for (const l of linkPaths) add(l);
  return out;
}

export async function loadPerson(app: App, file: TFile): Promise<PersonInfo> {
  const fm = fmOf(app, file.path);
  let kp: Kurzprofil | null = null;
  let secret: string | null = null;
  try {
    const text = await app.vault.cachedRead(file);
    kp = parseKurzprofil(text);
    secret = gmSecret(text);
  } catch {
    /* unreadable note: show the card without profile */
  }
  return {
    path: file.path,
    name: file.basename,
    profession: str(fm?.Profession) || str(fm?.profession),
    kurz: str(fm?.kurz),
    role: str(fm?.nsc_rolle),
    imageUrl: imageUrl(app, fm, file.path),
    kp,
    secret,
  };
}

export function loadPlace(app: App, file: TFile): PlaceInfo {
  return { path: file.path, name: file.basename, kurz: str(fmOf(app, file.path)?.kurz) };
}

// ------------------------------------------------------------------ tasks

export interface NoteTasks {
  path: string;
  name: string;
  tasks: TaskItem[];
  secrets: TaskItem[];
}

const taskCache = new Map<string, { mtime: number; value: NoteTasks }>();
const hasListTasks = (app: App, f: TFile): boolean => !!app.metadataCache.getFileCache(f)?.listItems?.some((i) => i.task !== undefined);

/** Tasks of one note (cache pre-filter, mtime-cached). Returns null if the note has none or cannot be read. */
export async function loadNoteTasks(app: App, path: string): Promise<NoteTasks | null> {
  const f = app.vault.getFileByPath(path);
  if (!f || !hasListTasks(app, f)) return null;
  const hit = taskCache.get(path);
  if (hit && hit.mtime === f.stat.mtime) return hit.value;
  try {
    const d = digestNote(await app.vault.cachedRead(f));
    const value: NoteTasks = { path, name: f.basename, tasks: d.tasks, secrets: secretTasks(d) };
    taskCache.set(path, { mtime: f.stat.mtime, value });
    return value;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ heroes

export interface Pool {
  cur: number;
  max: number;
}
export interface HeroInfo {
  uid: string;
  name: string;
  notePath?: string;
  lep: Pool | null;
  asp: Pool | null;
  kap: Pool | null;
}

const clampPool = (cur: number, max: number): Pool => ({ cur: Math.max(0, Math.min(max, cur)), max });

/** Heroes of a campaign (all heroes if none is assigned), with current values from the hero note / the running combat. */
export function loadHeroes(plugin: DsaMeisterwerkzeugPlugin, campaign: string): HeroInfo[] {
  const { app, heroes, combat } = plugin;
  const all = heroes.all();
  const inCampaign = campaign ? all.filter((h) => h.notePath && campaignsOf(fmOf(app, h.notePath)?.kampagne).includes(campaign)) : [];
  const list = inCampaign.length ? inCampaign : all;
  return list.map((h) => {
    const fm = h.notePath ? fmOf(app, h.notePath) : undefined;
    const entry = combat.entries.find((e) => e.kind === "hero" && ((h.notePath && e.sourcePath === h.notePath) || e.name === h.name));
    const lepMax = Math.max(0, energyNumber(fm?.LeP) ?? h.lep.max);
    const aspMax = Math.max(0, energyNumber(fm?.AsP) ?? h.asp.max);
    const kapMax = Math.max(0, energyNumber(fm?.KaP) ?? 0);
    let lep: Pool | null = lepMax > 0 ? clampPool(energyNumber(fm?.LeP_aktuell) ?? lepMax, lepMax) : null;
    let asp: Pool | null = aspMax > 0 ? clampPool(energyNumber(fm?.AsP_aktuell) ?? aspMax, aspMax) : null;
    let kap: Pool | null = kapMax > 0 ? clampPool(energyNumber(fm?.KaP_aktuell) ?? kapMax, kapMax) : null;
    if (entry) {
      // during a fight the combat store is the freshest source for LeP and energies
      if (entry.lepMax > 0) lep = { cur: entry.lep, max: entry.lepMax };
      const ea = combat.energy(entry.id, "AsP");
      const ek = combat.energy(entry.id, "KaP");
      if (ea && ea.max > 0) asp = ea;
      if (ek && ek.max > 0) kap = ek;
    }
    return { uid: h.uid, name: h.callName || h.name, notePath: h.notePath, lep, asp, kap };
  });
}

/** Flips one task checkbox in a note via vault.process (atomic). Returns false if the line could not be found. */
export async function toggleTaskInNote(app: App, path: string, task: TaskItem, checked: boolean): Promise<boolean> {
  const f = app.vault.getFileByPath(path);
  if (!f) {
    new Notice("Notiz nicht gefunden.");
    return false;
  }
  let ok = false;
  try {
    await app.vault.process(f, (text) => {
      const next = toggleTask(text, task.line, task.text, checked);
      ok = next !== null;
      return next ?? text;
    });
  } catch (e) {
    console.error("Sitzungsregie: Abhaken fehlgeschlagen", e);
  }
  if (!ok) new Notice("Die Zeile hat sich geändert oder wurde nicht gefunden. Bitte neu laden.");
  return ok;
}
