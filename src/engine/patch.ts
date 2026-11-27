import { LastHit, ZoneDamage, applyZoneDamage, mergeZoneDamage, negateZoneDamage } from "./hitzones";

// Patches: results never mutate state, they return a patch the caller applies (and can invert for undo).

export interface CombatantDelta {
  id: string;
  /** added to LeP (negative = damage) */
  lepDelta?: number;
  /** added to the number of defenses used this round */
  defensesDelta?: number;
  /** added to the cumulative defense penalty (positive number = harder) */
  defensePenaltyDelta?: number;
  /** replaces the remembered last hit (Trefferzonen); not inverted by invertPatch (undo restores a snapshot) */
  lastHit?: LastHit;
  /** Trefferzonen: DELTA of the per-zone damage tracking (added; stored values never drop below 0) */
  zoneDamage?: ZoneDamage;
}

export interface CombatPatch {
  changes: CombatantDelta[];
}

export interface PatchableCombatant {
  lep: number;
  defensesUsed: number;
  defensePenalty: number;
  lastHit?: LastHit;
  zoneDamage?: ZoneDamage;
}

export const emptyPatch = (): CombatPatch => ({ changes: [] });

/** Merge deltas of the same id; drop all-zero deltas. */
export function normalizePatch(p: CombatPatch): CombatPatch {
  const m = new Map<string, CombatantDelta>();
  for (const c of p.changes) {
    const cur = m.get(c.id) ?? { id: c.id, lepDelta: 0, defensesDelta: 0, defensePenaltyDelta: 0 };
    cur.lepDelta = (cur.lepDelta ?? 0) + (c.lepDelta ?? 0);
    cur.defensesDelta = (cur.defensesDelta ?? 0) + (c.defensesDelta ?? 0);
    cur.defensePenaltyDelta = (cur.defensePenaltyDelta ?? 0) + (c.defensePenaltyDelta ?? 0);
    if (c.lastHit) cur.lastHit = c.lastHit;
    if (c.zoneDamage) cur.zoneDamage = mergeZoneDamage(cur.zoneDamage, c.zoneDamage);
    m.set(c.id, cur);
  }
  const changes: CombatantDelta[] = [];
  for (const c of m.values()) {
    const out: CombatantDelta = { id: c.id };
    if (c.lepDelta) out.lepDelta = c.lepDelta;
    if (c.defensesDelta) out.defensesDelta = c.defensesDelta;
    if (c.defensePenaltyDelta) out.defensePenaltyDelta = c.defensePenaltyDelta;
    if (c.lastHit) out.lastHit = c.lastHit;
    if (c.zoneDamage && Object.keys(c.zoneDamage).length) out.zoneDamage = c.zoneDamage;
    if (Object.keys(out).length > 1) changes.push(out);
  }
  return { changes };
}

export function invertPatch(p: CombatPatch): CombatPatch {
  return {
    changes: p.changes.map((c) => ({
      id: c.id,
      ...(c.lepDelta ? { lepDelta: -c.lepDelta } : {}),
      ...(c.defensesDelta ? { defensesDelta: -c.defensesDelta } : {}),
      ...(c.defensePenaltyDelta ? { defensePenaltyDelta: -c.defensePenaltyDelta } : {}),
      ...(c.zoneDamage ? { zoneDamage: negateZoneDamage(c.zoneDamage) } : {}),
    })),
  };
}

/** Pure: returns a new map; ids not present in `state` are ignored. */
export function applyPatch<T extends PatchableCombatant>(state: Record<string, T>, patch: CombatPatch): Record<string, T> {
  const next: Record<string, T> = { ...state };
  for (const c of patch.changes) {
    const cur = next[c.id];
    if (!cur) continue;
    next[c.id] = {
      ...cur,
      lep: cur.lep + (c.lepDelta ?? 0),
      defensesUsed: cur.defensesUsed + (c.defensesDelta ?? 0),
      defensePenalty: cur.defensePenalty + (c.defensePenaltyDelta ?? 0),
      ...(c.lastHit ? { lastHit: c.lastHit } : {}),
      ...(c.zoneDamage ? { zoneDamage: applyZoneDamage(cur.zoneDamage, c.zoneDamage) } : {}),
    };
  }
  return next;
}
