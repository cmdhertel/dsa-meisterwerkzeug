// CombatStore: live combat state (no UI). Persisted by the plugin via saveData, with change events and undo.
import { DEFAULT_DEFENSE_MODE, DefenseMode } from "../engine/constants";
import { Roller, defaultRoller } from "../engine/dice";
import { rollInitiative, sortInitiative } from "../engine/initiative";
import { BodyType, LastHit, SizeCat, ZONE_LABEL, ZoneDamage, ZoneKey, ZoneRsMap, ZoneTally } from "../engine/hitzones";
import { CombatPatch, applyPatch } from "../engine/patch";
import {
  Effect, NewEffect, advanceDurations, defenseBlockFor, describeExpiry, describeTick, durationText, effectLabel, effectsOf,
  incapacitatingStatus, makeEffect, normalizeEffects, rollTicks, tickPatch, timedStateLevels,
} from "../engine/effects";
import { PenaltyContext, StateId, StateLevels, clampLevel, effectiveLevels, incapacitatedBy, totalStatePenalty } from "../engine/states";
import type { Combatant, Weapon } from "../model";
import { EnergyKind, clampSpent, energyCurrent, energyMax, spentForCurrent } from "./energy";

export interface CombatEntry {
  id: string;
  name: string;
  kind: "creature" | "hero";
  sourcePath: string;
  lepMax: number;
  /** current LeP (may be <= 0: dying/dead) */
  lep: number;
  iniBase: number;
  /** the 1W6 rolled this combat; null = not rolled yet */
  iniRoll: number | null;
  rs: number;
  vw: number | null;
  weapons: Weapon[];
  /** stored states; Schmerz here is only the non-LeP part (LeP pain is derived) */
  states: StateLevels;
  /** defenses used this combat round */
  defensesUsed: number;
  /** accumulated defense penalty this round (positive = harder) */
  defensePenalty: number;
  defenseMode: DefenseMode;
  /** "lep"/"ini" still to be entered by the GM (bestiary "variabel") */
  needsManual: string[];
  notes: string;
  /** hidden from the player screen (ambushers, unseen enemies) */
  hidden?: boolean;
  /** timed Zustände / Status / free effects (older saves lack this: migrated to []) */
  effects: Effect[];
  /** AsP / KaP spent in this combat (creatures; heroes write to their note instead) */
  aspSpent?: number;
  kapSpent?: number;
  /**
   * Maximum AsP / KaP captured when the combatant joined (heroes: note frontmatter AsP/KaP, creatures: bestiary asp/kap).
   * undefined = not captured yet, 0 = has none. Current value = max - spent (see combat/energy.ts); for heroes `*Spent`
   * mirrors max - AsP_aktuell/KaP_aktuell of the hero note.
   */
  aspMax?: number;
  kapMax?: number;
  /** Trefferzonen (optional rule): copied from the Combatant; undefined = humanoid / mittel */
  bodyType?: BodyType;
  size?: SizeCat;
  ko?: number | null;
  zoneRs?: ZoneRsMap;
  /** last hit zone (cockpit badge); only written when Trefferzonen are on */
  lastHit?: LastHit;
  /** damage taken per zone in this fight (Trefferzonen tracking; only written when the rule is on) */
  zoneDamage?: ZoneDamage;
}

export interface CombatState {
  version: 1;
  round: number;
  /** id of the acting combatant; null = nobody yet. Stored by id so that list changes do not move the turn. */
  currentId: string | null;
  entries: CombatEntry[];
  /**
   * undo snapshots (JSON of the state without history), newest last. In memory only: never persisted
   * (see CombatStore.persistable), so data.json does not grow with every change.
   */
  history: { label: string; snapshot: string; /** ids whose AsP/KaP this step changed by hand */ energyIds?: string[] }[];
}

/** Minimal shape needed for the acting order. */
export interface OrderableEntry {
  id: string;
  iniBase: number;
  iniRoll: number | null;
}

/** Entries in acting order (INI desc, tie: INI base, tie: the 1W6). Entries without a roll come last, in list order. */
export function orderEntries<T extends OrderableEntry>(entries: readonly T[]): T[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const rolled = entries.filter((e) => e.iniRoll !== null);
  const rest = entries.filter((e) => e.iniRoll === null);
  return [...sortInitiative(rolled.map((e) => ({ id: e.id, base: e.iniBase, roll: e.iniRoll as number }))).map((x) => byId.get(x.id) as T), ...rest];
}

/**
 * Lowest free name for a new combatant: the base name if free, else "Base 2", "Base 3", ... (first gap wins).
 * [Wolf, Wolf 2, Wolf 3] minus "Wolf 2" plus a new wolf gives "Wolf 2" again.
 */
export function uniqueCombatName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Current actor of a persisted state. Accepts the new `currentId` and the legacy `turnIndex` (index into the
 * acting order of the entries); anything unknown yields null.
 */
export function migrateCurrentId(raw: { currentId?: unknown; turnIndex?: unknown }, entries: readonly OrderableEntry[]): string | null {
  if (typeof raw.currentId === "string") return entries.some((e) => e.id === raw.currentId) ? raw.currentId : null;
  if (typeof raw.turnIndex === "number" && Number.isInteger(raw.turnIndex)) return orderEntries(entries)[raw.turnIndex]?.id ?? null;
  return null;
}

export type CombatEventType = "add" | "remove" | "update" | "initiative" | "turn" | "round" | "undo" | "clear" | "load" | "effect";
export interface CombatEvent {
  type: CombatEventType;
  ids: string[];
  label?: string;
  /** log lines produced by the action (effect added/removed, ticks, expiries) */
  messages?: string[];
  /** undo of a manual AsP/KaP change: these combatants' notes need the restored value written back */
  energyIds?: string[];
}
export type CombatListener = (e: CombatEvent) => void;

export const MAX_HISTORY = 50;

export const emptyCombatState = (): CombatState => ({ version: 1, round: 1, currentId: null, entries: [], history: [] });

/** Fill fields that older saves lack (effects, states, counters). Mutates a copy of each entry only. */
function sanitizeZoneDamage(raw: unknown): ZoneDamage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: ZoneDamage = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const t = v as Partial<ZoneTally>;
    const n = (x: unknown) => (Number.isFinite(Number(x)) ? Math.max(0, Math.trunc(Number(x))) : 0);
    out[k as ZoneKey] = { sp: n(t.sp), hits: n(t.hits), wounds: n(t.wounds) };
  }
  return Object.keys(out).length ? out : undefined;
}

export function migrateEntry(raw: Partial<CombatEntry>): CombatEntry {
  const zoneDamage = sanitizeZoneDamage(raw.zoneDamage);
  return {
    ...(raw as CombatEntry),
    states: raw.states && typeof raw.states === "object" ? raw.states : {},
    weapons: Array.isArray(raw.weapons) ? raw.weapons : [],
    needsManual: Array.isArray(raw.needsManual) ? raw.needsManual : [],
    defensesUsed: raw.defensesUsed ?? 0,
    defensePenalty: raw.defensePenalty ?? 0,
    defenseMode: raw.defenseMode ?? DEFAULT_DEFENSE_MODE,
    notes: raw.notes ?? "",
    effects: normalizeEffects(raw.effects),
    aspSpent: Math.max(0, Number(raw.aspSpent) || 0),
    kapSpent: Math.max(0, Number(raw.kapSpent) || 0),
    aspMax: raw.aspMax === undefined || raw.aspMax === null ? undefined : energyMax(raw.aspMax),
    kapMax: raw.kapMax === undefined || raw.kapMax === null ? undefined : energyMax(raw.kapMax),
    ...(zoneDamage ? { zoneDamage } : {}),
  };
}

let idCounter = 0;
const newId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export class CombatStore {
  private s: CombatState = emptyCombatState();
  private listeners = new Set<CombatListener>();
  private saveTimer: number | null = null;

  /** @param persist called (debounced) with the full state; the plugin writes it with saveData */
  constructor(private persist: (state: CombatState) => void | Promise<void> = () => {}) {}

  // ------------------------------------------------------------ basics
  get state(): Readonly<CombatState> {
    return this.s;
  }
  get round(): number {
    return this.s.round;
  }
  get entries(): readonly CombatEntry[] {
    return this.s.entries;
  }
  get(id: string): CombatEntry | undefined {
    return this.s.entries.find((e) => e.id === id);
  }

  on(cb: CombatListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(e: CombatEvent) {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error("CombatStore listener failed", err);
      }
    }
    this.scheduleSave();
  }
  /** The state as written to data.json: without the undo history (kept in memory only). */
  private persistable(): CombatState {
    return { ...this.s, history: [] };
  }
  private scheduleSave() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persist(this.persistable());
    }, 300);
  }
  /** Persist immediately (call on plugin unload). */
  async flush(): Promise<void> {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.persist(this.persistable());
  }

  /**
   * Load a persisted state (tolerates null/garbage). Legacy saves with `turnIndex` are mapped to `currentId`.
   * The undo history is not restored (it is never persisted).
   */
  load(data: unknown): void {
    const d = data as (Partial<CombatState> & { turnIndex?: unknown }) | null;
    if (d && d.version === 1 && Array.isArray(d.entries)) {
      const entries = d.entries.map((x) => migrateEntry(x));
      this.s = {
        version: 1,
        round: typeof d.round === "number" && d.round >= 1 ? d.round : 1,
        currentId: migrateCurrentId(d, entries),
        entries,
        history: [],
      };
    } else this.s = emptyCombatState();
    this.listeners.forEach((l) => l({ type: "load", ids: [] }));
  }

  // ------------------------------------------------------------ undo
  private snapshot(): string {
    const { history: _h, ...rest } = this.s;
    return JSON.stringify(rest);
  }
  /** `fn` may return an array of log lines; they are passed on in the event (`messages`). */
  private mutate(label: string, type: CombatEventType, ids: string[], fn: () => unknown): void {
    const snap = this.snapshot();
    const out = fn();
    const messages = Array.isArray(out) && out.every((x) => typeof x === "string") && out.length ? out : undefined;
    this.s.history.push({ label, snapshot: snap });
    if (this.s.history.length > MAX_HISTORY) this.s.history.splice(0, this.s.history.length - MAX_HISTORY);
    this.emit({ type, ids, label, messages });
  }
  get canUndo(): boolean {
    return this.s.history.length > 0;
  }
  get undoLabel(): string | null {
    return this.s.history.length ? this.s.history[this.s.history.length - 1].label : null;
  }
  undo(): boolean {
    const h = this.s.history.pop();
    if (!h) return false;
    const restored = JSON.parse(h.snapshot) as Omit<CombatState, "history">;
    this.s = { ...restored, entries: (restored.entries ?? []).map((x) => migrateEntry(x)), history: this.s.history };
    this.emit({ type: "undo", ids: [], label: h.label, energyIds: h.energyIds });
    return true;
  }

  // ------------------------------------------------------------ combatants
  /**
   * Add a combatant. Same names get a numeric suffix ("Wolf 2"). `needsManual` fields (lep/ini = "variabel")
   * stay flagged until setLepMax / setIniBase is called; until then they count as 0.
   */
  addCombatant(c: Combatant, opts: { lepMax?: number; iniBase?: number; name?: string; defenseMode?: DefenseMode } = {}): CombatEntry {
    const name = uniqueCombatName(opts.name ?? c.name, this.s.entries.map((e) => e.name));
    const lepMax = opts.lepMax ?? c.lepMax ?? 0;
    const iniBase = opts.iniBase ?? c.iniBase ?? 0;
    const needsManual = c.needsManual.filter((f) => !(f === "lep" && opts.lepMax !== undefined) && !(f === "ini" && opts.iniBase !== undefined));
    const entry: CombatEntry = {
      id: newId(),
      name,
      kind: c.kind,
      sourcePath: c.sourcePath,
      lepMax,
      lep: opts.lepMax === undefined && c.lepCurrent !== undefined && Number.isFinite(c.lepCurrent) ? Math.min(Math.trunc(c.lepCurrent), lepMax) : lepMax,
      iniBase,
      iniRoll: null,
      rs: c.rs ?? 0,
      vw: c.vw,
      weapons: c.weapons,
      states: {},
      defensesUsed: 0,
      defensePenalty: 0,
      defenseMode: opts.defenseMode ?? DEFAULT_DEFENSE_MODE,
      needsManual,
      notes: "",
      effects: [],
      aspSpent: 0,
      kapSpent: 0,
      ...(c.bodyType ? { bodyType: c.bodyType } : {}),
      ...(c.size ? { size: c.size } : {}),
      ...(c.ko !== undefined ? { ko: c.ko } : {}),
      ...(c.zoneRs ? { zoneRs: c.zoneRs } : {}),
    };
    this.mutate(`${name} hinzugefügt`, "add", [entry.id], () => this.s.entries.push(entry));
    return entry;
  }

  /**
   * Trefferzonen: fill body data a combatant lacks (it joined before the rule existed or was switched on).
   * Only sets missing fields, no undo step. Returns true when something changed.
   */
  fillBody(id: string, c: Pick<Combatant, "bodyType" | "size" | "ko" | "zoneRs">): boolean {
    const e = this.get(id);
    if (!e) return false;
    let changed = false;
    if (e.bodyType === undefined && c.bodyType) {
      e.bodyType = c.bodyType;
      changed = true;
    }
    if (e.size === undefined && c.size) {
      e.size = c.size;
      changed = true;
    }
    if (e.ko === undefined && c.ko !== undefined) {
      e.ko = c.ko;
      changed = true;
    }
    if (e.zoneRs === undefined && c.zoneRs) {
      e.zoneRs = c.zoneRs;
      changed = true;
    }
    if (changed) this.scheduleSave();
    return changed;
  }

  removeCombatant(id: string): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(`${e.name} entfernt`, "remove", [id], () => {
      const oldPos = orderEntries(this.s.entries).findIndex((x) => x.id === id);
      this.s.entries = this.s.entries.filter((x) => x.id !== id);
      if (this.s.currentId === id) {
        // the removed actor's turn passes to whoever took its place in the order (clamped to the last one)
        const after = orderEntries(this.s.entries);
        this.s.currentId = after.length ? after[Math.min(oldPos, after.length - 1)].id : null;
      }
    });
  }

  patchEntry(id: string, label: string, changes: Partial<Pick<CombatEntry, "name" | "rs" | "vw" | "notes" | "defenseMode" | "weapons" | "hidden">>): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(label, "update", [id], () => Object.assign(e, changes));
  }

  /** Track AsP/KaP spent by a combatant in this fight (undoable). */
  spendEnergy(id: string, energy: "AsP" | "KaP", amount: number): void {
    const e = this.get(id);
    if (!e || !(amount > 0)) return;
    this.mutate(`${e.name}: −${amount} ${energy}`, "update", [id], () => {
      const max = energy === "AsP" ? e.aspMax : e.kapMax;
      const total = (energy === "AsP" ? e.aspSpent : e.kapSpent) ?? 0;
      const next = max === undefined ? total + amount : clampSpent(max, total + amount);
      if (energy === "AsP") e.aspSpent = next;
      else e.kapSpent = next;
    });
  }

  /** Current AsP/KaP of a combatant (max - spent), null if it has none (or none captured yet). */
  energy(id: string, energy: EnergyKind): { cur: number; max: number } | null {
    const e = this.get(id);
    if (!e) return null;
    const max = energyMax(energy === "AsP" ? e.aspMax : e.kapMax);
    if (max <= 0) return null;
    return { cur: energyCurrent(max, energy === "AsP" ? e.aspSpent : e.kapSpent), max };
  }
  /** GM sets AsP/KaP by hand (clamped to 0..max, undoable). The caller writes hero notes back. */
  setEnergyCurrent(id: string, energy: EnergyKind, cur: number): boolean {
    const e = this.get(id);
    const have = this.energy(id, energy);
    if (!e || !have) return false;
    const spent = spentForCurrent(have.max, cur);
    this.mutate(`${e.name}: ${energy} ${have.cur} → ${have.max - spent}`, "update", [id], () => {
      if (energy === "AsP") e.aspSpent = spent;
      else e.kapSpent = spent;
    });
    const last = this.s.history[this.s.history.length - 1];
    if (last) last.energyIds = [id];
    return true;
  }
  /**
   * Record max (and optionally the spent value) captured from a source note. NOT an undo step; no-op if nothing changes.
   * Used on join and when a hero note's frontmatter changes.
   */
  syncEnergy(id: string, v: { aspMax?: number; kapMax?: number; aspSpent?: number; kapSpent?: number }): boolean {
    const e = this.get(id);
    if (!e) return false;
    const next = {
      aspMax: v.aspMax === undefined ? e.aspMax : energyMax(v.aspMax),
      kapMax: v.kapMax === undefined ? e.kapMax : energyMax(v.kapMax),
      aspSpent: 0,
      kapSpent: 0,
    };
    next.aspSpent = clampSpent(next.aspMax, v.aspSpent === undefined ? e.aspSpent : v.aspSpent);
    next.kapSpent = clampSpent(next.kapMax, v.kapSpent === undefined ? e.kapSpent : v.kapSpent);
    if (next.aspMax === e.aspMax && next.kapMax === e.kapMax && next.aspSpent === (e.aspSpent ?? 0) && next.kapSpent === (e.kapSpent ?? 0)) return false;
    Object.assign(e, next);
    this.emit({ type: "update", ids: [id] });
    return true;
  }

  // ------------------------------------------------------------ LeP
  setLep(id: string, lep: number): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(`${e.name}: LeP ${e.lep} → ${lep}`, "update", [id], () => (e.lep = Math.trunc(lep)));
  }
  adjustLep(id: string, delta: number): void {
    const e = this.get(id);
    if (e) this.setLep(id, e.lep + delta);
  }
  setLepMax(id: string, lepMax: number, refill = true): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(`${e.name}: LeP max ${lepMax}`, "update", [id], () => {
      e.lepMax = Math.trunc(lepMax);
      if (refill) e.lep = e.lepMax;
      e.needsManual = e.needsManual.filter((f) => f !== "lep");
    });
  }
  setIniBase(id: string, iniBase: number): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(`${e.name}: INI-Basis ${iniBase}`, "update", [id], () => {
      e.iniBase = Math.trunc(iniBase);
      e.needsManual = e.needsManual.filter((f) => f !== "ini");
    });
  }

  // ------------------------------------------------------------ states
  setState(id: string, state: StateId, level: number): void {
    const e = this.get(id);
    if (!e) return;
    const lv = clampLevel(level);
    this.mutate(`${e.name}: ${state} ${lv}`, "update", [id], () => {
      if (lv === 0) delete e.states[state];
      else e.states[state] = lv;
    });
  }
  /** Effective levels (stored + LeP-derived Schmerz). */
  levels(id: string) {
    const e = this.get(id);
    return e ? effectiveLevels(e.states, e.lep, e.lepMax, timedStateLevels(effectsOf(e))) : null;
  }
  /** Total roll penalty of a combatant (positive = harder). */
  statePenalty(id: string, ctx?: PenaltyContext): number {
    const lv = this.levels(id);
    return lv ? totalStatePenalty(lv, ctx) : 0;
  }
  incapacitatedBy(id: string): StateId[] {
    const lv = this.levels(id);
    return lv ? incapacitatedBy(lv) : [];
  }
  /** Dying (LeP <= 0), incapacitated by a Zustand, or by a Status (Bewusstlos, Handlungsunfähig). */
  isDown(id: string): boolean {
    const e = this.get(id);
    return !!e && (e.lep <= 0 || this.incapacitatedBy(id).length > 0 || incapacitatingStatus(effectsOf(e)).length > 0);
  }
  /** German reason why this combatant cannot defend with PA/VW, or null. */
  defenseBlock(id: string, kind: "PA" | "VW"): string | null {
    const e = this.get(id);
    if (!e) return null;
    return defenseBlockFor(effectsOf(e), effectiveLevels(e.states, e.lep, e.lepMax, timedStateLevels(effectsOf(e))), kind);
  }

  // ------------------------------------------------------------ timed effects
  effects(id: string): readonly Effect[] {
    const e = this.get(id);
    return e ? effectsOf(e) : [];
  }
  /**
   * Add an effect (one undo step, one log line). A Status already present is refreshed (duration/tick replaced)
   * instead of stacked; Zustände and free effects stack.
   */
  addEffect(id: string, n: NewEffect): Effect | null {
    const e = this.get(id);
    if (!e) return null;
    const eff = makeEffect(n);
    const dup = eff.kind === "status" ? effectsOf(e).find((x) => x.kind === "status" && x.key === eff.key) : undefined;
    const final = dup ? { ...eff, id: dup.id } : eff;
    const text = `${effectLabel(final)} bei ${e.name}${final.duration === null ? "" : ` (${durationText(final)})`}`;
    this.mutate(`${e.name}: ${effectLabel(final)}`, "effect", [id], () => {
      const list = effectsOf(e).filter((x) => x.id !== final.id);
      e.effects = [...list, final];
      return [dup ? `${text} erneuert` : `${text} beginnt`];
    });
    return final;
  }
  updateEffect(id: string, effectId: string, changes: Partial<Omit<Effect, "id" | "kind" | "key" | "tick">> & { tick?: Effect["tick"] | null }): void {
    const e = this.get(id);
    const old = e && effectsOf(e).find((x) => x.id === effectId);
    if (!e || !old) return;
    const next = makeEffect({ ...old, ...changes, tick: changes.tick === undefined ? old.tick ?? null : changes.tick }, old.id);
    this.mutate(`${e.name}: ${effectLabel(next)} geändert`, "effect", [id], () => {
      e.effects = effectsOf(e).map((x) => (x.id === effectId ? next : x));
      return [`${effectLabel(old)} bei ${e.name} → ${effectLabel(next)}, ${durationText(next)}`];
    });
  }
  removeEffect(id: string, effectId: string): void {
    const e = this.get(id);
    const old = e && effectsOf(e).find((x) => x.id === effectId);
    if (!e || !old) return;
    this.mutate(`${e.name}: ${effectLabel(old)} entfernt`, "effect", [id], () => {
      e.effects = effectsOf(e).filter((x) => x.id !== effectId);
      return [`${effectLabel(old)} bei ${e.name} entfernt`];
    });
  }

  // ------------------------------------------------------------ patches (engine results)
  /** Apply an engine result patch. One undo step. */
  applyPatch(patch: CombatPatch, label: string): void {
    const map: Record<string, CombatEntry> = {};
    for (const e of this.s.entries) map[e.id] = e;
    const next = applyPatch(map, patch);
    this.mutate(label, "update", patch.changes.map((c) => c.id), () => {
      this.s.entries = this.s.entries.map((e) => next[e.id] ?? e);
    });
  }

  /**
   * Trefferzonen tracking by hand. amount > 0: damage to that zone (also deducted from LeP); amount < 0: correction of the
   * zone counter only (SP, never below 0; LeP untouched). One undo step.
   */
  bookZoneDamage(id: string, zone: ZoneKey, amount: number): void {
    const e = this.get(id);
    const n = Math.trunc(amount);
    if (!e || !n) return;
    const label = n > 0 ? `${e.name}: ${n} SP auf ${ZONE_LABEL[zone]} gebucht` : `${e.name}: ${ZONE_LABEL[zone]} −${-n} SP korrigiert`;
    this.applyPatch({ changes: [{ id, ...(n > 0 ? { lepDelta: -n } : {}), zoneDamage: { [zone]: { sp: n, hits: 0, wounds: 0 } } }] }, label);
  }

  /** Trefferzonen tracking back to zero (the last-hit badge stays). One undo step. */
  resetZoneDamage(id: string): void {
    const e = this.get(id);
    if (!e || !e.zoneDamage) return;
    this.mutate(`${e.name}: Trefferzonen zurückgesetzt`, "update", [id], () => {
      delete e.zoneDamage;
    });
  }

  // ------------------------------------------------------------ initiative / rounds
  /**
   * Roll INI for everyone (the turn goes back to the first actor) or, with onlyMissing, only for those without a roll
   * (the turn stays where it is). `roller` injectable.
   */
  rollAllInitiative(roller: Roller = defaultRoller, onlyMissing = false): void {
    this.mutate("Initiative gewürfelt", "initiative", this.s.entries.map((e) => e.id), () => {
      for (const e of this.s.entries) if (!onlyMissing || e.iniRoll === null) e.iniRoll = rollInitiative(e.iniBase, roller).roll;
      if (!onlyMissing) this.s.currentId = this.order()[0]?.id ?? null;
    });
  }
  setInitiativeRoll(id: string, roll: number): void {
    const e = this.get(id);
    if (!e) return;
    this.mutate(`${e.name}: INI-Wurf ${roll}`, "initiative", [id], () => (e.iniRoll = roll));
  }
  /** Entries in acting order (see orderEntries). */
  order(): CombatEntry[] {
    return orderEntries(this.s.entries);
  }
  /** Id of the acting combatant, or null (nobody yet). */
  currentId(): string | null {
    return this.s.currentId !== null && this.get(this.s.currentId) ? this.s.currentId : null;
  }
  /** Advance to the next acting combatant; after the last one a new round starts. */
  nextTurn(roller: Roller = defaultRoller): void {
    const order = this.order();
    const n = order.length;
    if (!n) return;
    const idx = order.findIndex((e) => e.id === this.currentId());
    if (idx + 1 >= n) return this.nextRound(roller);
    const next = order[idx + 1];
    this.mutate("Nächster Zug", "turn", [next.id], () => {
      this.s.currentId = next.id;
      return this.startOfTurn(next, roller);
    });
  }
  /**
   * Start of a combatant's turn: its effect ticks (damage/healing per KR) are rolled and applied to LeP.
   * Returns log lines. (Durations run down at the round change, see nextRound.)
   */
  private startOfTurn(e: CombatEntry | undefined, roller: Roller): string[] {
    if (!e) return [];
    const { results, lepDelta } = rollTicks(effectsOf(e), e.lep, e.lepMax, roller);
    if (lepDelta) e.lep = applyPatch({ [e.id]: e }, tickPatch(e.id, lepDelta))[e.id].lep;
    return results.map((r) => describeTick(e.name, r));
  }
  /** New combat round: round + 1, defense counters reset, turn back to the first. */
  nextRound(roller: Roller = defaultRoller): void {
    this.mutate(`Runde ${this.s.round + 1}`, "round", [], () => {
      const msgs: string[] = [];
      this.s.round++;
      this.s.currentId = this.order()[0]?.id ?? null;
      for (const e of this.s.entries) {
        e.defensesUsed = 0;
        e.defensePenalty = 0;
        // round change: every timed effect loses one KR, expired ones are removed
        const { remaining, expired } = advanceDurations(effectsOf(e));
        e.effects = remaining;
        for (const x of expired) msgs.push(describeExpiry(e.name, x));
      }
      // the first combatant of the new round starts its turn (ticks of effects that are still active)
      msgs.push(...this.startOfTurn(this.order()[0], roller));
      return msgs;
    });
  }

  clear(): void {
    this.mutate("Kampf beendet", "clear", [], () => {
      this.s.entries = [];
      this.s.round = 1;
      this.s.currentId = null;
    });
  }
}

