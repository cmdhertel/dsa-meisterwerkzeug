// Timed effects (Zustände with level, Status, free text) on a combatant. Pure: no Obsidian, no store.
import {
  EINGEENGT_BY_REACH, EINGEENGT_DEFAULT_REACH, INCAPACITATED_CAN_DEFEND, Reach, ROMAN_LEVEL, STATUS_DEFS, STATUS_IDS, StatusId,
} from "./effectConstants";
import { Roller, defaultRoller, rollDice, tryParseDice } from "./dice";
import type { CombatPatch } from "./patch";
import { STATE_IDS, STATE_LABELS, StateId, StateLevels, clampLevel } from "./states";
import type { Modifier } from "./types";

export type EffectKind = "zustand" | "status" | "frei";

/** Per-round tick: damage (SP, ignores RS) or healing (LeP, capped at LeP max), in dice notation ("1W6", "1W3+1", "2"). */
export interface EffectTick {
  dice: string;
  mode: "damage" | "heal";
}
/** Custom modifiers of a free-text effect (negative = harder). */
export interface EffectMods {
  at?: number;
  pa?: number;
  vw?: number;
}

export interface Effect {
  id: string;
  kind: EffectKind;
  /** StateId for "zustand", StatusId for "status", null for "frei" */
  key: StateId | StatusId | null;
  /** display name; for "frei" the free text, otherwise the label */
  name: string;
  /** Zustand: 1..4; Status/free: 1 (unused) */
  level: number;
  /** remaining Kampfrunden; null = unbegrenzt */
  duration: number | null;
  /** where it comes from ("Feuerball", "Giftpfeil") - shown to the GM only */
  source?: string;
  /** GM-only note, never shown to players */
  gmNote?: string;
  tick?: EffectTick;
  mods?: EffectMods;
  /** not shown on the player screen */
  secret?: boolean;
}

/** tick: undefined = preset default (status), null = explicitly none */
export type NewEffect = Partial<Omit<Effect, "id" | "kind" | "key" | "tick">> & { kind: EffectKind; key?: StateId | StatusId | null; tick?: EffectTick | null };

let effCounter = 0;
export const newEffectId = (): string => `e${Date.now().toString(36)}${(effCounter++).toString(36)}`;

export const isStateKey = (k: unknown): k is StateId => (STATE_IDS as string[]).includes(k as string);
export const isStatusKey = (k: unknown): k is StatusId => (STATUS_IDS as string[]).includes(k as string);

/** Build a complete Effect from partial input (name/level/tick defaults from the presets). */
export function makeEffect(n: NewEffect, id: string = newEffectId()): Effect {
  const kind = n.kind;
  const key = n.key ?? null;
  let name = (n.name ?? "").trim();
  let level = n.level ?? 1;
  let tick: EffectTick | null | undefined = n.tick;
  if (kind === "zustand" && isStateKey(key)) {
    level = Math.max(1, clampLevel(level));
    name = STATE_LABELS[key];
  } else if (kind === "status" && isStatusKey(key)) {
    level = 1;
    name = STATUS_DEFS[key].label;
    if (tick === undefined) tick = STATUS_DEFS[key].tick ?? null;
  } else {
    level = 1;
  }
  const e: Effect = {
    id,
    kind,
    key: kind === "frei" ? null : key,
    name: name || "Effekt",
    level,
    duration: n.duration === undefined || n.duration === null ? null : Math.max(1, Math.trunc(n.duration)),
  };
  if (n.source?.trim()) e.source = n.source.trim();
  if (n.gmNote?.trim()) e.gmNote = n.gmNote.trim();
  if (tick && tryParseDice(tick.dice)) e.tick = { dice: tick.dice.trim(), mode: tick.mode === "heal" ? "heal" : "damage" };
  if (n.mods && (n.mods.at || n.mods.pa || n.mods.vw)) e.mods = { ...n.mods };
  if (n.secret) e.secret = true;
  return e;
}

/** Defensive migration of persisted data: drops garbage, fills defaults. */
export function normalizeEffects(raw: unknown): Effect[] {
  if (!Array.isArray(raw)) return [];
  const out: Effect[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Partial<Effect>;
    const kind: EffectKind = o.kind === "zustand" || o.kind === "status" ? o.kind : "frei";
    const key = kind === "zustand" ? (isStateKey(o.key) ? o.key : null) : kind === "status" ? (isStatusKey(o.key) ? o.key : null) : null;
    if (kind !== "frei" && key === null) continue;
    const e = makeEffect(
      { kind, key, name: typeof o.name === "string" ? o.name : "", level: typeof o.level === "number" ? o.level : 1, duration: typeof o.duration === "number" ? o.duration : null, source: o.source, gmNote: o.gmNote, tick: o.tick ?? null, mods: o.mods, secret: o.secret },
      typeof o.id === "string" && o.id ? o.id : newEffectId(),
    );
    out.push(e);
  }
  return out;
}

export const effectsOf = (x: { effects?: readonly Effect[] | null }): readonly Effect[] => x.effects ?? [];

// ---------------------------------------------------------------- display

/** "Furcht II", "Liegend", free text. */
export function effectLabel(e: Pick<Effect, "kind" | "key" | "name" | "level">): string {
  if (e.kind === "zustand") return `${e.name} ${ROMAN_LEVEL[clampLevel(e.level)] || ""}`.trim();
  return e.name;
}
export const durationText = (e: Pick<Effect, "duration">): string => (e.duration === null ? "∞" : `${e.duration} KR`);

// ---------------------------------------------------------------- Zustände from effects

/** Summed levels of all timed Zustand effects (to be added to the stored levels). */
export function timedStateLevels(effects: readonly Effect[]): StateLevels {
  const out: StateLevels = {};
  for (const e of effects) if (e.kind === "zustand" && isStateKey(e.key)) out[e.key] = (out[e.key] ?? 0) + e.level;
  return out;
}

// ---------------------------------------------------------------- Status modifiers

export const activeStatusIds = (effects: readonly Effect[]): StatusId[] => {
  const ids = new Set<StatusId>();
  for (const e of effects) if (e.kind === "status" && isStatusKey(e.key)) ids.add(e.key);
  return [...ids];
};

export interface ModifierContext {
  /** reach of the weapon used (for Eingeengt); default Eingeengt reach if unknown */
  reach?: Reach | null;
}

/** "kurz"/"mittel"/"lang" from the vault's reach text (may be "mittel", "Mittel/Lang", ranged "5/10/20" ...). */
export function reachFromText(rw: string | null | undefined): Reach | null {
  const t = (rw ?? "").toLowerCase();
  if (t.includes("lang")) return "lang";
  if (t.includes("mittel")) return "mittel";
  if (t.includes("kurz")) return "kurz";
  return null;
}

/**
 * Own-roll modifiers from Status effects and free-text modifiers, itemised ("Status Liegend" −4).
 * role: "at" = attack, "pa" = parry, "vw" = dodge.
 */
export function statusModifiers(effects: readonly Effect[], role: "at" | "pa" | "vw", ctx: ModifierContext = {}): Modifier[] {
  const out: Modifier[] = [];
  for (const id of activeStatusIds(effects)) {
    const d = STATUS_DEFS[id];
    let v = d[role];
    if (id === "eingeengt" && role !== "vw") v = EINGEENGT_BY_REACH[ctx.reach ?? EINGEENGT_DEFAULT_REACH][role];
    if (v) out.push({ label: `Status ${d.label}`, value: v });
  }
  for (const e of effects) {
    const v = e.mods?.[role];
    if (v) out.push({ label: `Effekt ${e.name}`, value: v });
  }
  return out;
}

/** Status ids that make the holder handlungsunfähig. */
export const incapacitatingStatus = (effects: readonly Effect[]): StatusId[] => activeStatusIds(effects).filter((id) => STATUS_DEFS[id].incapacitated);

/**
 * Reason (German) why the holder cannot defend with this defense kind, or null.
 * `incapacitatedByState`: already incapacitated by a Zustand/LeP (see INCAPACITATED_CAN_DEFEND).
 */
export function defenseBlockedReason(effects: readonly Effect[], kind: "PA" | "VW", incapacitatedByState = false): string | null {
  for (const id of activeStatusIds(effects)) {
    const d = STATUS_DEFS[id];
    if (kind === "PA" && d.noParry) return `${d.label}: kann nicht parieren`;
    if (kind === "VW" && d.noDodge) return `${d.label}: kann nicht ausweichen`;
  }
  if (incapacitatedByState && !INCAPACITATED_CAN_DEFEND) return "handlungsunfähig: kann nicht verteidigen";
  return null;
}

/** GM notes for the active statuses (rule reminders). */
export const statusNotes = (effects: readonly Effect[]): string[] => activeStatusIds(effects).map((id) => `${STATUS_DEFS[id].label}: ${STATUS_DEFS[id].note}`);

// ---------------------------------------------------------------- ticks and expiry

export interface TickResult {
  effectId: string;
  name: string;
  mode: "damage" | "heal";
  dice: string;
  rolls: number[];
  /** rolled total */
  rolled: number;
  /** LeP actually changed (negative = damage; heal capped at LeP max) */
  lepDelta: number;
}

/** Roll the per-round ticks of all effects (list order). Heal is capped at the missing LeP. Pure. */
export function rollTicks(effects: readonly Effect[], lep: number, lepMax: number, roller: Roller = defaultRoller): { results: TickResult[]; lepDelta: number } {
  const results: TickResult[] = [];
  let cur = lep;
  for (const e of effects) {
    if (!e.tick) continue;
    const r = rollDice(e.tick.dice, roller);
    const rolled = Math.max(0, r.total);
    let delta = 0;
    if (e.tick.mode === "damage") delta = -rolled;
    else delta = Math.max(0, Math.min(rolled, lepMax - cur));
    cur += delta;
    results.push({ effectId: e.id, name: effectLabel(e), mode: e.tick.mode, dice: r.spec.text, rolls: r.rolls, rolled, lepDelta: delta });
  }
  return { results, lepDelta: results.reduce((s, r) => s + r.lepDelta, 0) };
}

/** Patch (for the engine's applyPatch/invertPatch) of a tick roll. */
export const tickPatch = (id: string, lepDelta: number): CombatPatch => ({ changes: lepDelta ? [{ id, lepDelta }] : [] });

export function describeTick(who: string, t: TickResult): string {
  return t.mode === "damage" ? `${who}: ${t.name} ${t.dice} → ${t.rolled} SP` : `${who}: ${t.name} ${t.dice} → +${t.lepDelta} LeP`;
}

/** Round change: every timed effect loses one KR; effects reaching 0 are removed. Unlimited effects stay. Pure. */
export function advanceDurations(effects: readonly Effect[]): { remaining: Effect[]; expired: Effect[] } {
  const remaining: Effect[] = [];
  const expired: Effect[] = [];
  for (const e of effects) {
    if (e.duration === null) remaining.push(e);
    else if (e.duration - 1 <= 0) expired.push(e);
    else remaining.push({ ...e, duration: e.duration - 1 });
  }
  return { remaining, expired };
}
export const describeExpiry = (who: string, e: Effect): string => `${effectLabel(e)} bei ${who} endet`;
