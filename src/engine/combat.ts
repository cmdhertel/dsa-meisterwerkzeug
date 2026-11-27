import {
  DEFAULT_DEFENSE_MODE,
  DEFENSE_STEP,
  DefenseMode,
  HALVE_ROUNDING,
  PATZER_FALLBACK_SP,
  RANGED_DEFENSE_MOD,
  UNCONFIRMED_CRIT_HALVES_DEFENSE,
} from "./constants";
import { DiceRoll, Roller, defaultRoller, rollDice } from "./dice";
import { WoundResult, ZoneHit, ZoneKey, ZoneParams, evaluateWound, hitTally, rollZone, targetableZones, zoneRsFor } from "./hitzones";
import { CombatPatch, normalizePatch } from "./patch";
import { PatzerEntry, PatzerTable, lookupPatzer } from "./patzer";
import type { Modifier } from "./types";

const sum = (m: Modifier[]) => m.reduce((s, x) => s + x.value, 0);

// ---------------------------------------------------------------- single d20 check

export interface CheckResult {
  /** value before modifiers */
  base: number;
  modifiers: Modifier[];
  /** positive number = harder */
  statePenalty: number;
  /** extra, not in `modifiers` (defense counter etc.), positive = harder */
  extraPenalties: Modifier[];
  /** final target value used for the roll (after halving, if any) */
  value: number;
  /** value before a critical-hit halving */
  valueBeforeHalving: number;
  halved: boolean;
  roll: number;
  success: boolean;
  /** natural 1 = "crit" candidate, natural 20 = "patzer" candidate */
  natural: "crit" | "patzer" | null;
  confirmRoll: number | null;
  /** crit/patzer confirmed */
  confirmed: boolean;
}

export interface CheckParams {
  base: number;
  modifiers?: Modifier[];
  statePenalty?: number;
  /** positive = harder, e.g. the defense counter */
  extraPenalties?: Modifier[];
  halve?: boolean;
}

export function computeValue(p: CheckParams): { value: number; valueBeforeHalving: number } {
  const total = p.base + sum(p.modifiers ?? []) - (p.statePenalty ?? 0) - sum(p.extraPenalties ?? []);
  const halved = p.halve ? (HALVE_ROUNDING === "ceil" ? Math.ceil(total / 2) : Math.floor(total / 2)) : total;
  return { value: halved, valueBeforeHalving: total };
}

/**
 * One W20 check vs. a value. 1 -> confirmation roll (crit confirmed if confirmation roll <= value);
 * 20 -> confirmation roll (Patzer confirmed if confirmation roll > value, i.e. the confirmation FAILS).
 * 1 always succeeds, 20 always fails.
 */
export function rollCheck(p: CheckParams, roller: Roller = defaultRoller): CheckResult {
  const { value, valueBeforeHalving } = computeValue(p);
  const roll = roller(20);
  const natural = roll === 1 ? "crit" : roll === 20 ? "patzer" : null;
  let confirmRoll: number | null = null;
  let confirmed = false;
  if (natural) {
    confirmRoll = roller(20);
    confirmed = natural === "crit" ? confirmRoll <= value : confirmRoll > value;
  }
  const success = roll === 1 || (roll !== 20 && roll <= value);
  return {
    base: p.base,
    modifiers: p.modifiers ?? [],
    statePenalty: p.statePenalty ?? 0,
    extraPenalties: p.extraPenalties ?? [],
    value,
    valueBeforeHalving,
    halved: !!p.halve,
    roll,
    success,
    natural,
    confirmRoll,
    confirmed,
  };
}

// ---------------------------------------------------------------- defense counter

/** Cumulative penalty of the next defense, given how many were already used this round. */
export function defensePenaltyFor(defensesUsed: number, mode: DefenseMode = DEFAULT_DEFENSE_MODE): number {
  return mode === "cumulative" ? defensesUsed * DEFENSE_STEP : 0;
}

export function canDefendAgain(defensesUsed: number, mode: DefenseMode = DEFAULT_DEFENSE_MODE): boolean {
  return mode !== "single" || defensesUsed < 1;
}

// ---------------------------------------------------------------- attack resolution

export type AttackKind = "nahkampf" | "fernkampf";
export type RangedDefenseKind = "schuss" | "wurf";

export interface AttackerParams {
  id?: string;
  /** AT (melee) or FK (ranged) */
  value: number;
  modifiers?: Modifier[];
  statePenalty?: number;
  /** weapon damage dice, e.g. "1W6+4" */
  tp: string;
  tpModifiers?: Modifier[];
}

export interface DefenderParams {
  id?: string;
  /** PA (melee) or Ausweichen/VW. Pass null if the target cannot or does not defend. */
  defense: { kind: "PA" | "VW"; value: number } | null;
  modifiers?: Modifier[];
  statePenalty?: number;
  /** defenses already used this combat round */
  defensesUsed?: number;
  /** cumulative penalty already accumulated this round; if omitted it is derived from defensesUsed */
  defensePenalty?: number;
  defenseMode?: DefenseMode;
  rs: number;
  /** defender's weapon damage dice, used only for a defense Patzer with self damage (default 1W6 = unarmed) */
  weaponTp?: string;
}

export interface AttackParams {
  kind: AttackKind;
  attacker: AttackerParams;
  defender: DefenderParams;
  /** ranged attack category, for the -4 / -2 defense modifier (Schusswaffe / Wurfwaffe) */
  rangedType?: RangedDefenseKind;
  /** "tabelle" (default): roll 2W6 on the Patzer table; "sp": fixed 1W6+2 SP fallback */
  patzerMode?: "tabelle" | "sp";
  /** Trefferzonen (optional rule); absent = classic combat, nothing changes */
  zones?: ZoneParams;
}

export type AttackOutcome = "patzer" | "miss" | "defended" | "hit";

export interface DamageDetail {
  tpRoll: DiceRoll;
  tpModifiers: Modifier[];
  /** TP incl. modifiers, before doubling */
  tpSubtotal: number;
  doubled: boolean;
  tpTotal: number;
  rs: number;
  /** damage actually dealt = max(0, tpTotal - rs) */
  dealt: number;
}

export interface PatzerResult {
  table: PatzerTable | "sp";
  /** 2W6 roll (null in "sp" mode) */
  roll: DiceRoll | null;
  entry: PatzerEntry | null;
  /** rolled self damage (weapon TP, doubled for entry.selfDamage === 2) already included in `patch` */
  selfDamage: { tpRoll: DiceRoll; total: number } | null;
  /** fixed fallback damage (mode "sp") */
  fallbackSP: { roll: DiceRoll; total: number } | null;
}

export interface DefenseDetail {
  kind: "PA" | "VW";
  possible: boolean;
  /** reason when not possible */
  reason?: "single" | "value-zero" | "none";
  check: CheckResult | null;
  /** defense counter penalty included in the roll */
  counterPenalty: number;
  /** passierschlag allowed (confirmed critical melee defense) */
  passierschlag: boolean;
  /** penalty added to the defender's counter by this defense */
  counterIncrement: number;
}

export interface AttackResult {
  kind: AttackKind;
  attackerId?: string;
  defenderId?: string;
  attack: CheckResult;
  /** attack critical hit confirmed (defense halved, damage doubled) */
  criticalHit: boolean;
  defense: DefenseDetail | null;
  damage: DamageDetail | null;
  patzer: PatzerResult | null;
  /** Trefferzonen only: the zone of an undefended hit */
  zone?: ZoneHit;
  /** Trefferzonen only: wound effect suggestion (never applied by the engine) */
  wound?: WoundResult | null;
  outcome: AttackOutcome;
  /** apply to the combat state; use invertPatch() to undo */
  patch: CombatPatch;
  /** every die rolled, in order, for display */
  allRolls: number[];
}

export function rollDamage(
  tp: string,
  tpModifiers: Modifier[],
  rs: number,
  doubled: boolean,
  roller: Roller = defaultRoller,
): DamageDetail {
  const tpRoll = rollDice(tp, roller);
  const tpSubtotal = tpRoll.total + sum(tpModifiers);
  const tpTotal = doubled ? tpSubtotal * 2 : tpSubtotal;
  return { tpRoll, tpModifiers, tpSubtotal, doubled, tpTotal, rs, dealt: Math.max(0, tpTotal - rs) };
}

/** Resolve a full attack: AT roll -> (defense roll) -> damage -> Patzer. Pure; returns a patch. */
export function resolveAttack(p: AttackParams, roller: Roller = defaultRoller): AttackResult {
  const rolls: number[] = [];
  const rec: Roller = (s) => {
    const v = roller(s);
    rolls.push(v);
    return v;
  };
  const patch: CombatPatch = { changes: [] };
  const attackerId = p.attacker.id;
  const defenderId = p.defender.id;

  const attack = rollCheck(
    { base: p.attacker.value, modifiers: p.attacker.modifiers, statePenalty: p.attacker.statePenalty },
    rec,
  );
  const criticalHit = attack.natural === "crit" && attack.confirmed;

  const result: AttackResult = {
    kind: p.kind,
    attackerId,
    defenderId,
    attack,
    criticalHit,
    defense: null,
    damage: null,
    patzer: null,
    outcome: "miss",
    patch,
    allRolls: rolls,
  };

  // --- Patzer (20 + failed confirmation)
  if (attack.natural === "patzer") {
    if (attack.confirmed) {
      result.outcome = "patzer";
      result.patzer = rollPatzer(p.kind, p.attacker.tp, p.attacker.tpModifiers ?? [], p.patzerMode ?? "tabelle", rec);
      const dmg = result.patzer.selfDamage?.total ?? result.patzer.fallbackSP?.total ?? 0;
      if (attackerId && dmg) patch.changes.push({ id: attackerId, lepDelta: -dmg });
    }
    result.patch = normalizePatch(patch);
    return result;
  }
  if (!attack.success) {
    result.patch = normalizePatch(patch);
    return result;
  }

  // --- defense
  const halve = criticalHit || (UNCONFIRMED_CRIT_HALVES_DEFENSE && attack.natural === "crit");
  let defended = false;
  const d = p.defender;
  const mode = d.defenseMode ?? DEFAULT_DEFENSE_MODE;
  const used = d.defensesUsed ?? 0;
  if (d.defense) {
    const detail: DefenseDetail = {
      kind: d.defense.kind,
      possible: true,
      check: null,
      counterPenalty: 0,
      passierschlag: false,
      counterIncrement: 0,
    };
    result.defense = detail;
    const counter = d.defensePenalty ?? defensePenaltyFor(used, mode);
    detail.counterPenalty = counter;
    const mods: Modifier[] = [...(d.modifiers ?? [])];
    if (p.kind === "fernkampf" && p.rangedType) {
      mods.push({ label: p.rangedType === "schuss" ? "Schusswaffenangriff" : "Wurfwaffenangriff", value: RANGED_DEFENSE_MOD[p.rangedType] });
    }
    const extra: Modifier[] = counter ? [{ label: "Verteidigungen in dieser KR", value: counter }] : [];
    const probe = computeValue({ base: d.defense.value, modifiers: mods, statePenalty: d.statePenalty, extraPenalties: extra, halve });
    if (!canDefendAgain(used, mode)) {
      detail.possible = false;
      detail.reason = "single";
    } else if (probe.value <= 0) {
      detail.possible = false;
      detail.reason = "value-zero";
    } else {
      const check = rollCheck(
        { base: d.defense.value, modifiers: mods, statePenalty: d.statePenalty, extraPenalties: extra, halve },
        rec,
      );
      detail.check = check;
      defended = check.success;
      if (mode === "cumulative") {
        detail.counterIncrement = DEFENSE_STEP;
        // Fernkampf.md: critical defense vs. ranged: confirmed -> next defense not harder; unconfirmed -> only 2 instead of 3
        if (p.kind === "fernkampf" && check.natural === "crit") detail.counterIncrement = check.confirmed ? 0 : DEFENSE_STEP - 1;
      }
      if (p.kind === "nahkampf" && check.natural === "crit" && check.confirmed) detail.passierschlag = true;
      if (defenderId && mode !== "unlimited") {
        patch.changes.push({ id: defenderId, defensesDelta: 1, defensePenaltyDelta: detail.counterIncrement });
      }
      // defense Patzer: roll the table; self damage (entries 11/12) uses the defender's weapon TP (unarmed: 1W6)
      if (check.natural === "patzer" && check.confirmed) {
        result.patzer = rollPatzer("verteidigung", d.weaponTp ?? "1W6", [], p.patzerMode ?? "tabelle", rec);
        const dmg = result.patzer.selfDamage?.total ?? result.patzer.fallbackSP?.total ?? 0;
        if (defenderId && dmg) patch.changes.push({ id: defenderId, lepDelta: -dmg });
      }
    }
  }

  if (defended) {
    result.outcome = "defended";
    result.patch = normalizePatch(patch);
    return result;
  }

  // --- damage
  const zoneHit = p.zones ? rollZone(p.zones, d.rs, rec) : undefined;
  const dmg = rollDamage(p.attacker.tp, p.attacker.tpModifiers ?? [], zoneHit ? zoneHit.rs : d.rs, criticalHit, rec);
  result.damage = dmg;
  result.outcome = "hit";
  if (zoneHit && p.zones) {
    result.zone = zoneHit;
    result.wound = evaluateWound(zoneHit.zone, dmg.dealt, p.zones.ko);
  }
  if (defenderId && (dmg.dealt || zoneHit)) {
    patch.changes.push({
      id: defenderId,
      ...(dmg.dealt ? { lepDelta: -dmg.dealt } : {}),
      ...(zoneHit ? { lastHit: { zone: zoneHit.zone, sp: dmg.dealt, wound: !!result.wound }, zoneDamage: hitTally(zoneHit.zone, dmg.dealt, !!result.wound) } : {}),
    });
  }
  result.patch = normalizePatch(patch);
  return result;
}

/**
 * Roll the Patzer consequence. For attacks the self-damage entries (11/12) roll the attacker's weapon TP
 * (no RS applied: the vault does not say; doubled for 12).
 */
export function rollPatzer(
  kind: AttackKind | "verteidigung",
  tp: string,
  tpModifiers: Modifier[],
  mode: "tabelle" | "sp",
  roller: Roller = defaultRoller,
): PatzerResult {
  if (mode === "sp") {
    const roll = rollDice(PATZER_FALLBACK_SP, roller);
    return { table: "sp", roll: null, entry: null, selfDamage: null, fallbackSP: { roll, total: roll.total } };
  }
  const table: PatzerTable = kind === "verteidigung" ? "verteidigung" : kind;
  const roll = rollDice("2W6", roller);
  const entry = lookupPatzer(table, roll.total);
  let selfDamage: PatzerResult["selfDamage"] = null;
  if (entry.selfDamage) {
    const tpRoll = rollDice(tp, roller);
    const base = tpRoll.total + sum(tpModifiers);
    selfDamage = { tpRoll, total: base * entry.selfDamage };
  }
  return { table, roll, entry, selfDamage, fallbackSP: null };
}

/**
 * Trefferzonen: move an undefended hit to another zone WITHOUT re-rolling. The attack, defense and damage dice stay;
 * zone RS, damage after RS, wound check, last-hit badge and zone tracking are recomputed and the patch is rebuilt.
 * Pure. Returns `result` unchanged when there is nothing to change (no zone hit, zone not valid for the body type,
 * or `p.zones` missing). `p` must be the params that produced `result`.
 */
export function reassignZone(result: AttackResult, p: AttackParams, zone: ZoneKey): AttackResult {
  const z = p.zones;
  const old = result.zone;
  const dmg = result.damage;
  if (result.outcome !== "hit" || !z || !old || !dmg) return result;
  if (!targetableZones(z.bodyType).includes(zone)) return result;
  const { rs, source } = zoneRsFor(zone, z.zoneRs, p.defender.rs);
  const dealt = Math.max(0, dmg.tpTotal - rs);
  const damage: DamageDetail = { ...dmg, rs, dealt };
  const wound = evaluateWound(zone, dealt, z.ko);
  const newZone: ZoneHit = {
    zone, roll: null, targeted: false, manual: true, rs, rsSource: source,
    fromRoll: old.roll ?? old.fromRoll ?? null,
  };
  const id = p.defender.id;
  let changes = result.patch.changes;
  if (id) {
    const cur = changes.find((c) => c.id === id);
    const { lastHit: _l, zoneDamage: _z, ...rest } = cur ?? { id };
    changes = [
      ...changes.filter((c) => c.id !== id),
      { ...rest, id, lepDelta: (rest.lepDelta ?? 0) + dmg.dealt - dealt, lastHit: { zone, sp: dealt, wound: !!wound }, zoneDamage: hitTally(zone, dealt, !!wound) },
    ];
  }
  return { ...result, zone: newZone, damage, wound, patch: normalizePatch({ changes }) };
}
