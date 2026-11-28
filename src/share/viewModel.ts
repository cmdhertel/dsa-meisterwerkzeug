// Pure mapping: combat state + share options -> what the players may see. No Obsidian imports.
import type { CombatEntry, CombatState } from "../combat/store";
import { effectLabel, effectsOf, incapacitatingStatus, timedStateLevels } from "../engine/effects";
import { STATE_IDS, STATE_LABELS, effectiveLevels, incapacitatedBy, isDying } from "../engine/states";
import { sortInitiative } from "../engine/initiative";

export type EnemyLepMode = "wort" | "balken" | "exakt" | "aus";
export const ENEMY_LEP_MODES: EnemyLepMode[] = ["wort", "balken", "exakt", "aus"];

export type ShareStyle = "schlicht" | "aventurisch";
export const SHARE_STYLES: ShareStyle[] = ["schlicht", "aventurisch"];
export const SHARE_STYLE_LABELS: Record<ShareStyle, string> = { schlicht: "Schlicht", aventurisch: "Aventurisch (Pergament)" };

export interface ShareSettings {
  /** display style of the player view */
  shareStyle: ShareStyle;
  /** how enemy LeP is shown on the player screen */
  shareEnemyLep: EnemyLepMode;
  /** show real enemy names (off: "Gegner 1", "Gegner 2" ...) */
  shareEnemyNames: boolean;
  /** show the INI values of enemies */
  shareEnemyIni: boolean;
}
export const SHARE_DEFAULTS: ShareSettings = { shareStyle: "schlicht", shareEnemyLep: "wort", shareEnemyNames: true, shareEnemyIni: false };

export interface ShareOptions {
  enemyLep: EnemyLepMode;
  enemyNames: boolean;
  enemyIni: boolean;
  style: ShareStyle;
}
export const optionsFromSettings = (s: ShareSettings): ShareOptions => ({
  style: (SHARE_STYLES as string[]).includes(s.shareStyle) ? s.shareStyle : "schlicht",
  enemyLep: s.shareEnemyLep, enemyNames: s.shareEnemyNames, enemyIni: s.shareEnemyIni,
});

/** Parse the optional `key: value` lines of a dsa-kampf-spieler block; unknown or invalid lines are ignored. */
export function parseBlockOptions(source: string, base: ShareOptions): ShareOptions {
  const out = { ...base };
  for (const line of source.split(/\r?\n/)) {
    const m = /^\s*([\wäöüÄÖÜß-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].toLowerCase();
    if (key === "gegner-lep" && (ENEMY_LEP_MODES as string[]).includes(val)) out.enemyLep = val as EnemyLepMode;
    else if (key === "gegner-namen" && (val === "an" || val === "aus")) out.enemyNames = val === "an";
    else if (key === "stil" && (SHARE_STYLES as string[]).includes(val)) out.style = val as ShareStyle;
    else if (key === "ini" && (val === "an" || val === "aus")) out.enemyIni = val === "an";
  }
  return out;
}

export type ConditionWord = "unverletzt" | "angeschlagen" | "verletzt" | "schwer verletzt" | "am Boden";

/** Condition word from the LeP fraction; 0 LeP or incapacitated = "am Boden". */
export function conditionWord(lep: number, lepMax: number, incapacitated: boolean): ConditionWord {
  if (incapacitated || lep <= 0) return "am Boden";
  if (lepMax <= 0) return "unverletzt";
  const f = lep / lepMax;
  if (f <= 0.25) return "schwer verletzt";
  if (f <= 0.5) return "verletzt";
  if (f <= 0.75) return "angeschlagen";
  return "unverletzt";
}

export interface PlayerStateChip {
  label: string;
  level: number;
}
export interface PlayerRow {
  key: string;
  /** true = neutral "…" placeholder for a hidden combatant that is acting */
  placeholder: boolean;
  name: string;
  isHero: boolean;
  current: boolean;
  next: boolean;
  down: boolean;
  /** e.g. "INI 14"; null = not shown */
  ini: string | null;
  /** LeP bar fill 0..100; null = no bar */
  barPct: number | null;
  /** "23 / 30" (only heroes and enemy mode "exakt") */
  lepText: string | null;
  /** condition word (enemies in mode "wort") */
  word: ConditionWord | null;
  /** Schmerz level (heroes only; enemies' pain would leak their LeP) */
  schmerz: number;
  states: PlayerStateChip[];
  /** names of visible timed effects ("Furcht II", "Liegend"); no source, notes, duration or secret effects */
  effects: string[];
}
export interface PlayerView {
  empty: boolean;
  round: number;
  rows: PlayerRow[];
}

type Entry = Readonly<CombatEntry>;

function orderOf(entries: readonly Entry[]): Entry[] {
  const rolled = entries.filter((e) => e.iniRoll !== null);
  const rest = entries.filter((e) => e.iniRoll === null);
  const byId = new Map(entries.map((e) => [e.id, e]));
  return [...sortInitiative(rolled.map((e) => ({ id: e.id, base: e.iniBase, roll: e.iniRoll as number }))).map((x) => byId.get(x.id) as Entry), ...rest];
}

export function buildPlayerView(state: Pick<CombatState, "round" | "currentId" | "entries">, opts: ShareOptions): PlayerView {
  const entries = state.entries as readonly Entry[];
  if (!entries.length) return { empty: true, round: state.round, rows: [] };

  // stable "Gegner N" numbering: store order, visible enemies only (a gap would reveal a hidden one)
  const enemyNo = new Map<string, number>();
  let n = 0;
  for (const e of entries) if (e.kind !== "hero" && !e.hidden) enemyNo.set(e.id, ++n);

  const order = orderOf(entries);
  const idx = order.findIndex((e) => e.id === state.currentId);
  const cur = order[idx];
  const nxt = idx >= 0 ? order[idx + 1] : order[0];
  const rows: PlayerRow[] = [];

  for (const e of order) {
    const isHero = e.kind === "hero";
    const current = cur?.id === e.id;
    if (e.hidden && !isHero) {
      if (current) rows.push({ key: `ph-${e.id}`, placeholder: true, name: "…", isHero: false, current: true, next: false, down: false, ini: null, barPct: null, lepText: null, word: null, schmerz: 0, states: [], effects: [] });
      continue;
    }
    const fx = effectsOf(e);
    const levels = effectiveLevels(e.states, e.lep, e.lepMax, timedStateLevels(fx));
    const down = isDying(e.lep) || incapacitatedBy(levels).length > 0 || incapacitatingStatus(fx).length > 0;
    const pct = e.lepMax > 0 ? Math.max(0, Math.min(100, (e.lep / e.lepMax) * 100)) : 0;
    const chips: PlayerStateChip[] = [];
    for (const id of STATE_IDS) {
      if (id === "schmerz") continue;
      const lv = e.states[id] ?? 0;
      if (lv > 0) chips.push({ label: STATE_LABELS[id], level: lv });
    }
    const showIni = isHero || opts.enemyIni;
    const row: PlayerRow = {
      key: e.id,
      placeholder: false,
      name: isHero || opts.enemyNames ? e.name : `Gegner ${enemyNo.get(e.id)}`,
      isHero,
      current,
      next: !current && nxt?.id === e.id,
      down,
      ini: showIni ? (e.iniRoll === null ? "INI –" : `INI ${e.iniBase + e.iniRoll}`) : null,
      barPct: null,
      lepText: null,
      word: null,
      schmerz: isHero ? levels.schmerz : 0,
      states: chips,
      effects: e.hidden ? [] : fx.filter((x) => !x.secret).map((x) => effectLabel(x)),
    };
    if (isHero) {
      row.barPct = pct;
      row.lepText = `${e.lep} / ${e.lepMax}`;
    } else if (opts.enemyLep === "wort") row.word = conditionWord(e.lep, e.lepMax, down);
    else if (opts.enemyLep === "balken") row.barPct = pct;
    else if (opts.enemyLep === "exakt") {
      row.barPct = pct;
      row.lepText = `${e.lep} / ${e.lepMax}`;
    }
    rows.push(row);
  }
  return { empty: false, round: state.round, rows };
}
