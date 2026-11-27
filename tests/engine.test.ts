import { describe, expect, it } from "vitest";
import {
  applyPatch, effectiveLevels, fixedRoller, invertPatch, isIncapacitated, parseDice, qsFromPoints, resolveAttack,
  rollDice, rollInitiative, rollTalentCheck, schmerzFromLep, sortInitiative, totalStatePenalty, defensePenaltyFor,
  PATZER_TABLES, lookupPatzer, reachAtMod,
} from "../src/engine";

describe("dice", () => {
  it("parses notations", () => {
    expect(parseDice("1W6+4")).toMatchObject({ count: 1, sides: 6, bonus: 4, text: "1W6+4" });
    expect(parseDice("2W6+2")).toMatchObject({ count: 2, sides: 6, bonus: 2 });
    expect(parseDice("1W20")).toMatchObject({ count: 1, sides: 20, bonus: 0 });
    expect(parseDice("13+1W6")).toMatchObject({ count: 1, sides: 6, bonus: 13, text: "1W6+13" });
    expect(parseDice("1w6–1")).toMatchObject({ bonus: -1 });
    expect(parseDice("W6")).toMatchObject({ count: 1 });
    expect(parseDice("7")).toMatchObject({ count: 0, bonus: 7 });
    expect(() => parseDice("Haltegriff")).toThrow();
    expect(() => parseDice("1W6+1W4")).toThrow();
  });
  it("rolls with injected roller", () => {
    const r = rollDice("2W6+2", fixedRoller([3, 5]));
    expect(r.rolls).toEqual([3, 5]);
    expect(r.total).toBe(10);
  });
});

describe("initiative", () => {
  it("rolls and sorts with tie-breaks", () => {
    expect(rollInitiative(13, fixedRoller([4]))).toEqual({ base: 13, roll: 4, total: 17 });
    const sorted = sortInitiative([
      { id: "a", base: 10, roll: 6 }, // 16
      { id: "b", base: 12, roll: 4 }, // 16, higher base
      { id: "c", base: 9, roll: 3 }, // 12
      { id: "d", base: 14, roll: 5 }, // 19
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["d", "b", "a", "c"]);
  });
});

describe("states", () => {
  it("derives Schmerz from LeP", () => {
    expect(schmerzFromLep(40, 40)).toBe(0);
    expect(schmerzFromLep(30, 40)).toBe(1); // exactly 3/4
    expect(schmerzFromLep(31, 40)).toBe(0);
    expect(schmerzFromLep(20, 40)).toBe(2);
    expect(schmerzFromLep(10, 40)).toBe(3);
    expect(schmerzFromLep(5, 40)).toBe(4);
    expect(schmerzFromLep(6, 40)).toBe(3);
  });
  it("sums penalties and caps levels", () => {
    const lv = effectiveLevels({ furcht: 2, betaeubung: 1, paralyse: 1 }, 20, 40); // schmerz II
    expect(totalStatePenalty(lv)).toBe(5); // 6 capped at -5
    expect(totalStatePenalty(lv, { movement: false })).toBe(2 + 1 + 2);
    expect(effectiveLevels({ schmerz: 3 }, 5, 40).schmerz).toBe(4);
    expect(isIncapacitated(effectiveLevels({}, 5, 40))).toBe(true);
    expect(isIncapacitated(effectiveLevels({ entrueckung: 4 }, 40, 40))).toBe(false);
  });
  it("Entrückung depends on god", () => {
    const lv = effectiveLevels({ entrueckung: 2 }, 40, 40);
    expect(totalStatePenalty(lv, { godPleasing: true })).toBe(-1);
    expect(totalStatePenalty(lv, { godPleasing: false })).toBe(2);
  });
});

describe("talent check", () => {
  it("compensates with FW and computes QS", () => {
    // attrs 12/12/12, dice 10/14/12 -> needs 0+2+0, FW 8 -> 6 left -> QS 2
    const r = rollTalentCheck({ attrs: [12, 12, 12], fw: 8 }, fixedRoller([10, 14, 12]));
    expect(r).toMatchObject({ fwUsed: 2, remaining: 6, success: true, qs: 2, critical: null });
  });
  it("applies modifier and state penalty to attributes", () => {
    const r = rollTalentCheck({ attrs: [12, 12, 12], fw: 3, modifiers: [{ label: "x", value: -2 }], statePenalty: 1 }, fixedRoller([12, 12, 12]));
    expect(r.attrEffective).toEqual([9, 9, 9]);
    expect(r.needed).toEqual([3, 3, 3]);
    expect(r.success).toBe(false);
    expect(r.qs).toBe(0);
  });
  it("QS table", () => {
    expect([0, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 20].map(qsFromPoints)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
  it("critical success / Patzer by count", () => {
    expect(rollTalentCheck({ attrs: [5, 5, 5], fw: 0 }, fixedRoller([1, 1, 20])).critical).toBe("success");
    const p = rollTalentCheck({ attrs: [20, 20, 20], fw: 10 }, fixedRoller([20, 20, 3]));
    expect(p.critical).toBe("patzer");
    expect(p.success).toBe(false);
  });
});

describe("defense counter", () => {
  it("is cumulative -3 per defense", () => {
    expect([0, 1, 2, 3].map((n) => defensePenaltyFor(n))).toEqual([0, 3, 6, 9]);
    expect(defensePenaltyFor(3, "unlimited")).toBe(0);
  });
});

const base = {
  kind: "nahkampf" as const,
  attacker: { id: "A", value: 12, tp: "1W6+4" },
  defender: { id: "D", defense: { kind: "PA" as const, value: 8 }, rs: 2 },
};

describe("attack resolution", () => {
  it("hit: damage = TP - RS, patch lowers LeP and raises defense counter", () => {
    // AT 10 (hit), PA 15 (fail), TP 3 -> 7 - 2 = 5
    const r = resolveAttack(base, fixedRoller([10, 15, 3]));
    expect(r.outcome).toBe("hit");
    expect(r.damage).toMatchObject({ tpSubtotal: 7, dealt: 5, doubled: false });
    expect(r.patch.changes).toEqual([{ id: "D", lepDelta: -5, defensesDelta: 1, defensePenaltyDelta: 3 }]);
    const state = { D: { lep: 20, defensesUsed: 0, defensePenalty: 0 } };
    const after = applyPatch(state, r.patch);
    expect(after.D).toEqual({ lep: 15, defensesUsed: 1, defensePenalty: 3 });
    expect(applyPatch(after, invertPatch(r.patch))).toEqual(state);
    expect(r.allRolls).toEqual([10, 15, 3]);
  });
  it("defended: no damage", () => {
    const r = resolveAttack(base, fixedRoller([10, 8]));
    expect(r.outcome).toBe("defended");
    expect(r.damage).toBeNull();
    expect(r.patch.changes[0].lepDelta).toBeUndefined();
  });
  it("damage never negative", () => {
    const r = resolveAttack({ ...base, defender: { ...base.defender, rs: 9 } }, fixedRoller([10, 15, 1]));
    expect(r.damage?.dealt).toBe(0);
  });
  it("defense counter lowers the defense value", () => {
    const r = resolveAttack({ ...base, defender: { ...base.defender, defensesUsed: 2 } }, fixedRoller([10, 3, 1]));
    expect(r.defense?.check?.value).toBe(2); // 8 - 6
    expect(r.defense?.check?.success).toBe(false); // 3 > 2
  });
  it("state penalties lower AT", () => {
    const r = resolveAttack({ ...base, attacker: { ...base.attacker, statePenalty: 3 } }, fixedRoller([10, 1]));
    expect(r.attack.value).toBe(9);
    expect(r.outcome).toBe("miss");
  });
  it("confirmed critical halves defense and doubles damage", () => {
    // AT 1, confirm 5 (<=12) ; PA 8 halved = 4, roll 7 fails ; TP 3+4=7 doubled 14 - 2 = 12
    const r = resolveAttack(base, fixedRoller([1, 5, 7, 3]));
    expect(r.criticalHit).toBe(true);
    expect(r.defense?.check?.value).toBe(4);
    expect(r.damage).toMatchObject({ doubled: true, tpTotal: 14, dealt: 12 });
  });
  it("unconfirmed critical halves the defense but does not double damage (vault rule)", () => {
    const r = resolveAttack(base, fixedRoller([1, 15, 9, 3]));
    expect(r.criticalHit).toBe(false);
    expect(r.defense?.check?.value).toBe(4);
    expect(r.damage?.doubled).toBe(false);
  });
  it("Patzer: 20 + failed confirmation -> 2W6 table, no defense, no damage", () => {
    const r = resolveAttack(base, fixedRoller([20, 15, 4, 5])); // 2W6 = 9 -> Fuß verdreht
    expect(r.outcome).toBe("patzer");
    expect(r.patzer?.entry?.name).toBe("Fuß verdreht");
    expect(r.defense).toBeNull();
    expect(r.damage).toBeNull();
  });
  it("Patzer with self damage hurts the attacker", () => {
    const r = resolveAttack(base, fixedRoller([20, 15, 6, 6, 3])); // 12 -> doubled TP (3+4)*2 = 14
    expect(r.patzer?.entry?.roll).toBe(12);
    expect(r.patch.changes).toEqual([{ id: "A", lepDelta: -14 }]);
  });
  it("20 with successful confirmation is a plain miss", () => {
    const r = resolveAttack(base, fixedRoller([20, 5]));
    expect(r.outcome).toBe("miss");
    expect(r.patzer).toBeNull();
  });
  it("ranged defense carries the -4 / -2 modifier", () => {
    const r = resolveAttack({ ...base, kind: "fernkampf", rangedType: "schuss", defender: { ...base.defender, defense: { kind: "VW", value: 8 } } }, fixedRoller([10, 5, 2]));
    expect(r.defense?.check?.value).toBe(4);
  });
  it("single mode: second defense impossible; value <= 0: impossible", () => {
    const r = resolveAttack({ ...base, defender: { ...base.defender, defenseMode: "single", defensesUsed: 1 } }, fixedRoller([10, 3]));
    expect(r.defense).toMatchObject({ possible: false, reason: "single" });
    expect(r.outcome).toBe("hit");
    const z = resolveAttack({ ...base, defender: { ...base.defender, defensesUsed: 3 } }, fixedRoller([10, 3]));
    expect(z.defense).toMatchObject({ possible: false, reason: "value-zero" });
  });
});

describe("tables", () => {
  it("every table has 2..12", () => {
    for (const t of Object.values(PATZER_TABLES)) expect(t.map((e) => e.roll)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(lookupPatzer("fernkampf", 10).name).toBe("Zu konzentriert");
  });
  it("reach table", () => {
    expect(reachAtMod("kurz", "lang")).toBe(-4);
    expect(reachAtMod("mittel", "lang")).toBe(-2);
    expect(reachAtMod("lang", "kurz")).toBe(0);
  });
});
