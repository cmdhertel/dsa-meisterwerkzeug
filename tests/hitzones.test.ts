import { describe, expect, it } from "vitest";
import {
  evaluateWound, fixedRoller, resolveAttack, targetableZones, targetedModifier, woundEffectFor, woundEffectToApply, woundThreshold,
  zoneForRoll, zoneRsFor, zoneTable, applyPatch, normalizePatch, reassignZone, applyZoneDamage, zoneRollRanges, invertPatch,
} from "../src/engine";
import { CombatStore } from "../src/combat/store";
import { deriveBody, deriveBodyType } from "../src/bestiary/body";
import { parseCreature } from "../src/bestiary/adapter";
import { buildAttackParams, hitsText, zoneOverview, describeWound, describeZone, lastHitText, previewAttack, summarizeResult } from "../src/cockpit/logic";
import type { LastHit } from "../src/engine";
import type { Combatant } from "../src/model";

describe("zone tables (Kodex des Schwertes S. 227-229)", () => {
  it("humanoid mittel", () => {
    const z = (n: number) => zoneForRoll("humanoid", "mittel", n);
    expect([z(1), z(2), z(3), z(12), z(13), z(14), z(15), z(16), z(17), z(18), z(19), z(20)]).toEqual([
      "kopf", "kopf", "torso", "torso", "armL", "armR", "armL", "armR", "beinL", "beinR", "beinL", "beinR",
    ]);
  });
  it("humanoid klein / gross borders", () => {
    expect(zoneForRoll("humanoid", "klein", 6)).toBe("kopf");
    expect(zoneForRoll("humanoid", "klein", 7)).toBe("torso");
    expect(zoneForRoll("humanoid", "klein", 10)).toBe("torso");
    expect(zoneForRoll("humanoid", "klein", 11)).toBe("armL");
    expect(zoneForRoll("humanoid", "klein", 18)).toBe("armR");
    expect(zoneForRoll("humanoid", "klein", 19)).toBe("beinL");
    expect(zoneForRoll("humanoid", "gross", 2)).toBe("kopf");
    expect(zoneForRoll("humanoid", "gross", 6)).toBe("torso");
    expect(zoneForRoll("humanoid", "gross", 7)).toBe("armL");
    expect(zoneForRoll("humanoid", "gross", 16)).toBe("armR");
    expect(zoneForRoll("humanoid", "gross", 17)).toBe("beinL");
  });
  it("quadruped", () => {
    expect(zoneForRoll("vierbeiner", "klein", 4)).toBe("kopf");
    expect(zoneForRoll("vierbeiner", "klein", 12)).toBe("torso");
    expect(zoneForRoll("vierbeiner", "mittel", 10)).toBe("torso");
    expect(zoneForRoll("vierbeiner", "mittel", 11)).toBe("vorderbeine");
    expect(zoneForRoll("vierbeiner", "gross", 5)).toBe("kopf");
    expect(zoneForRoll("vierbeiner", "gross", 17)).toBe("hinterbeine");
  });
  it("six limbs, tentacles, amorph", () => {
    expect(zoneForRoll("sechsGliedmassen", "gross", 13)).toBe("vordereGliedmassen");
    expect(zoneForRoll("sechsGliedmassen", "gross", 20)).toBe("schwanz");
    expect(zoneForRoll("sechsGliedmassen", "riesig", 3)).toBe("torso");
    expect(zoneForRoll("sechsGliedmassen", "riesig", 15)).toBe("mittlereGliedmassen");
    expect(zoneForRoll("fangarme", "riesig", 7)).toBe("fangarme");
    expect(zoneForRoll("amorph", "mittel", 20)).toBe("koerper");
  });
  it("sizes without a column are clamped (assumption)", () => {
    expect(zoneForRoll("humanoid", "riesig", 3)).toBe("torso"); // gross: 3-6 torso
    expect(zoneForRoll("humanoid", "winzig", 6)).toBe("kopf"); // klein
    expect(zoneForRoll("sechsGliedmassen", "mittel", 13)).toBe("vordereGliedmassen");
  });
  it("table rows for docs", () => {
    expect(zoneTable("humanoid", "mittel")[0]).toEqual({ range: "1-2", label: "Kopf" });
    expect(zoneTable("amorph", "mittel")).toEqual([{ range: "1-20", label: "Körper" }]);
    expect(targetableZones("amorph")).toEqual([]);
  });
});

describe("targeted attacks", () => {
  it("book values", () => {
    expect(targetedModifier("kopf")).toBe(-10);
    expect(targetedModifier("torso")).toBe(-4);
    expect(targetedModifier("armL")).toBe(-8);
    expect(targetedModifier("beinR")).toBe(-8);
  });
  it("SF halves, Ueberrascht lowers by 2, halve first then +2 (book example: -8 -> -4 -> -2)", () => {
    expect(targetedModifier("armR", { sf: true })).toBe(-4);
    expect(targetedModifier("armR", { surprised: true })).toBe(-6);
    expect(targetedModifier("armR", { sf: true, surprised: true })).toBe(-2);
    expect(targetedModifier("kopf", { sf: true })).toBe(-5);
    expect(targetedModifier("torso", { sf: true, surprised: true })).toBe(0);
    expect(targetedModifier("torso", { surprised: true })).toBe(-2);
  });
  it("never positive; amorph body cannot be targeted", () => {
    expect(targetedModifier("torso", { sf: true, surprised: true })).toBeLessThanOrEqual(0);
    expect(targetedModifier("koerper", { surprised: true })).toBe(0);
  });
});

describe("zone armour", () => {
  it("uses the zone value (exact id, then group), otherwise the general RS", () => {
    expect(zoneRsFor("kopf", { kopf: 4 }, 2)).toEqual({ rs: 4, source: "zone" });
    expect(zoneRsFor("armL", { arme: 1 }, 2)).toEqual({ rs: 1, source: "zone" });
    expect(zoneRsFor("armL", { armL: 3, arme: 1 }, 2)).toEqual({ rs: 3, source: "zone" });
    expect(zoneRsFor("torso", { kopf: 4 }, 2)).toEqual({ rs: 2, source: "gesamt" });
    expect(zoneRsFor("torso", undefined, 5)).toEqual({ rs: 5, source: "gesamt" });
  });
});

describe("wounds", () => {
  it("Wundschwelle = half KO rounded up", () => {
    expect(woundThreshold(11)).toBe(6);
    expect(woundThreshold(12)).toBe(6);
    expect(woundThreshold(1)).toBe(1);
  });
  it("book example: KO 11, 12 SP in the head -> x2, Betaeubung", () => {
    const w = evaluateWound("kopf", 12, 11);
    expect(w).toMatchObject({ threshold: 6, multiple: 2, resistPenalty: 2, resist: "Handlungsfähigkeit bewahren" });
    expect(w?.effect.kind).toBe("betaeubung");
  });
  it("below the threshold, no KO, zero SP -> no wound", () => {
    expect(evaluateWound("kopf", 5, 11)).toBeNull();
    expect(evaluateWound("kopf", 12, null)).toBeNull();
    expect(evaluateWound("kopf", 0, 11)).toBeNull();
  });
  it("effects per zone", () => {
    expect(woundEffectFor("torso")?.effect.kind).toBe("zusatzSP");
    expect(woundEffectFor("armR")).toMatchObject({ resist: "Störungen ignorieren" });
    expect(woundEffectFor("beinL")?.effect.kind).toBe("liegend");
    expect(woundEffectFor("hinterbeine")?.effect.kind).toBe("liegend");
    expect(woundEffectFor("schwanz")).toBeNull();
    expect(woundEffectFor("koerper")).toBeNull();
  });
  it("one-click apply targets: Kopf -> Betaeubung I, Bein -> Liegend, others none", () => {
    expect(woundEffectToApply(evaluateWound("kopf", 6, 11)!)).toEqual({ kind: "zustand", key: "betaeubung", level: 1 });
    expect(woundEffectToApply(evaluateWound("beinL", 6, 11)!)).toEqual({ kind: "status", key: "liegend" });
    expect(woundEffectToApply(evaluateWound("torso", 6, 11)!)).toBeNull();
    expect(woundEffectToApply(evaluateWound("armL", 6, 11)!)).toBeNull();
  });
});

const params = (over: Record<string, unknown> = {}) => ({
  kind: "nahkampf" as const,
  attacker: { id: "a", value: 14, tp: "1W6+4" },
  defender: { id: "d", defense: null, rs: 2 },
  ...over,
});

describe("resolveAttack with zones", () => {
  it("without zones: nothing changes (no zone, no wound, no extra roll)", () => {
    const r = resolveAttack(params(), fixedRoller([10, 3]));
    expect(r.zone).toBeUndefined();
    expect(r.wound).toBeUndefined();
    expect(r.damage?.dealt).toBe(5); // 3+4-2
    expect(r.patch.changes).toEqual([{ id: "d", lepDelta: -5 }]);
    expect(r.allRolls).toEqual([10, 3]);
  });
  it("rolls the zone after an undefended hit, before the damage; uses zone RS", () => {
    const r = resolveAttack(params({ zones: { bodyType: "humanoid", size: "mittel", ko: 12, zoneRs: { kopf: 0 } } }), fixedRoller([10, 2, 6]));
    expect(r.zone).toMatchObject({ zone: "kopf", roll: 2, targeted: false, rs: 0, rsSource: "zone" });
    expect(r.damage?.dealt).toBe(10); // 6+4-0
    expect(r.wound?.effect.kind).toBe("betaeubung");
    expect(r.wound?.multiple).toBe(1);
    expect(r.allRolls).toEqual([10, 2, 6]);
    expect(r.patch.changes[0]).toEqual({ id: "d", lepDelta: -10, lastHit: { zone: "kopf", sp: 10, wound: true }, zoneDamage: { kopf: { sp: 10, hits: 1, wounds: 1 } } });
  });
  it("falls back to the general RS without zone armour", () => {
    const r = resolveAttack(params({ zones: { bodyType: "humanoid", size: "mittel", ko: 12 } }), fixedRoller([10, 5, 3]));
    expect(r.zone).toMatchObject({ zone: "torso", rs: 2, rsSource: "gesamt" });
    expect(r.damage?.dealt).toBe(5);
    expect(r.wound).toBeNull(); // 5 < 6
  });
  it("targeted: no zone roll", () => {
    const r = resolveAttack(params({ zones: { bodyType: "humanoid", size: "mittel", ko: 12, targeted: "beinL" } }), fixedRoller([10, 6]));
    expect(r.zone).toMatchObject({ zone: "beinL", roll: null, targeted: true });
    expect(r.allRolls).toEqual([10, 6]);
    expect(r.wound?.effect.kind).toBe("liegend");
  });
  it("no zone when the attack misses or is defended", () => {
    expect(resolveAttack(params({ zones: { bodyType: "humanoid", size: "mittel" } }), fixedRoller([19])).zone).toBeUndefined();
    const def = resolveAttack(params({ defender: { id: "d", defense: { kind: "PA", value: 18 }, rs: 2 }, zones: { bodyType: "humanoid", size: "mittel" } }), fixedRoller([10, 5]));
    expect(def.outcome).toBe("defended");
    expect(def.zone).toBeUndefined();
  });
  it("zero damage still remembers the zone", () => {
    const r = resolveAttack(params({ attacker: { id: "a", value: 14, tp: "1W6" }, zones: { bodyType: "humanoid", size: "mittel", zoneRs: { torso: 9 } } }), fixedRoller([10, 5, 2]));
    expect(r.damage?.dealt).toBe(0);
    expect(r.patch.changes).toEqual([{ id: "d", lastHit: { zone: "torso", sp: 0, wound: false }, zoneDamage: { torso: { sp: 0, hits: 1, wounds: 0 } } }]);
  });
});

describe("patch lastHit", () => {
  it("is kept by normalizePatch and applied by applyPatch", () => {
    const p = normalizePatch({ changes: [{ id: "x", lepDelta: -2 }, { id: "x", lastHit: { zone: "kopf", sp: 2, wound: false } }] });
    expect(p.changes).toEqual([{ id: "x", lepDelta: -2, lastHit: { zone: "kopf", sp: 2, wound: false } }]);
    const out = applyPatch<{ lep: number; defensesUsed: number; defensePenalty: number; lastHit?: LastHit }>({ x: { lep: 10, defensesUsed: 0, defensePenalty: 0 } }, p);
    expect(out.x.lep).toBe(8);
    expect(out.x.lastHit?.zone).toBe("kopf");
  });
});

describe("bestiary body derivation", () => {
  it("humanoid by default and by typus", () => {
    expect(deriveBodyType({})).toBe("humanoid");
    expect(deriveBodyType({ typus: "Kulturschaffende, humanoid (Mensch)" })).toBe("humanoid");
  });
  it("animals, dragons, tentacles, others", () => {
    expect(deriveBodyType({ typus: "Tier, nicht humanoid", tags: ["monster", "tier", "raubtier", "wild"] })).toBe("vierbeiner");
    expect(deriveBodyType({ typus: "Tier, nicht humanoid", tags: ["tier", "vogel", "wild"] })).toBe("amorph");
    expect(deriveBodyType({ typus: "Drache, nicht humanoid" })).toBe("sechsGliedmassen");
    expect(deriveBodyType({ typus: "Tier, nicht humanoid", tags: ["tier", "meer", "tentakel"] })).toBe("fangarme");
    expect(deriveBodyType({ typus: "Elementarwesen" })).toBe("humanoid");
  });
  it("override key wins", () => {
    expect(deriveBodyType({ typus: "Tier, nicht humanoid", tags: ["raubtier"], koerperbau: "humanoid" })).toBe("humanoid");
    expect(deriveBodyType({ koerperbau: "Sechs Gliedmaßen" })).toBe("sechsGliedmassen");
    expect(deriveBodyType({ typus: "Drache, nicht humanoid", koerperbau: "quatsch" })).toBe("sechsGliedmassen"); // unknown value ignored
    expect(deriveBodyType({ koerperbau: "vierbeiner" })).toBe("vierbeiner");
  });
  it("size, KO and rs_zonen", () => {
    expect(deriveBody({ groessenkategorie: "groß", ko: 12, rs_zonen: { Kopf: 4, Arme: "1", x: "y" } })).toEqual({
      bodyType: "humanoid", size: "gross", ko: 12, zoneRs: { kopf: 4, arme: 1 },
    });
    expect(deriveBody({}).size).toBe("mittel");
    expect(deriveBody({ ko: "–" }).ko).toBeNull();
  });
  it("parseCreature carries the data", () => {
    const r = parseCreature({ lep: 20, ini: "13+1W6", rs: 1, vw: 7, ko: 12, groessenkategorie: "mittel", typus: "Tier, nicht humanoid", tags: ["raubtier"], attacks: [] }, "x.md", "Wolf");
    expect(r.combatant).toMatchObject({ bodyType: "vierbeiner", size: "mittel", ko: 12 });
  });
});

const creature = (over: Partial<Combatant> = {}): Combatant => ({
  name: "Ork", kind: "creature", sourcePath: "x.md", lepMax: 30, iniBase: 12, rs: 2, vw: 5, weapons: [], needsManual: [], ...over,
});

describe("cockpit helpers", () => {
  const mk = () => {
    const store = new CombatStore();
    const a = store.addCombatant(creature({ name: "Angreifer" }));
    const d = store.addCombatant(creature({ name: "Ziel", ko: 12, bodyType: "humanoid", size: "mittel", zoneRs: { kopf: 0 } }));
    return { store, a, d };
  };
  const input = (a: ReturnType<typeof mk>["a"], d: ReturnType<typeof mk>["d"], hz?: { targeted: "kopf" | null; sf: boolean }) => ({
    kind: "nahkampf" as const, attacker: a, defender: d, value: 12, tp: "1W6+4", atMod: 0, tpMod: 0, rangedMod: 0, defense: null, defenseMod: 0, ...(hz ? { hitZones: hz } : {}),
  });
  it("store keeps body data; setting off adds nothing", () => {
    const { a, d } = mk();
    expect(d).toMatchObject({ ko: 12, bodyType: "humanoid", zoneRs: { kopf: 0 } });
    expect(buildAttackParams(input(a, d)).zones).toBeUndefined();
    expect(previewAttack(input(a, d)).attack.value).toBe(12);
  });
  it("targeted attack lowers the AT in the preview and passes zone params", () => {
    const { a, d } = mk();
    const p = buildAttackParams(input(a, d, { targeted: "kopf", sf: false }));
    expect(p.zones).toMatchObject({ bodyType: "humanoid", size: "mittel", ko: 12, targeted: "kopf" });
    expect(previewAttack(input(a, d, { targeted: "kopf", sf: false })).attack.value).toBe(2);
    expect(previewAttack(input(a, d, { targeted: "kopf", sf: true })).attack.value).toBe(7);
  });
  it("Ueberrascht target lowers the penalty", () => {
    const { store, a, d } = mk();
    store.addEffect(d.id, { kind: "status", key: "ueberrascht" });
    expect(previewAttack(input(a, store.get(d.id)!, { targeted: "kopf", sf: true })).attack.value).toBe(9); // -5 +2 = -3
  });
  it("entries without body data default to humanoid / mittel", () => {
    const { a } = mk();
    const store = new CombatStore();
    const plain = store.addCombatant(creature({ name: "Alt" }));
    expect(buildAttackParams(input(a, plain, { targeted: null, sf: false })).zones).toMatchObject({ bodyType: "humanoid", size: "mittel", ko: null });
  });
  it("texts", () => {
    const r = resolveAttack(params({ zones: { bodyType: "humanoid", size: "mittel", ko: 12, zoneRs: { kopf: 0 } } }), fixedRoller([10, 1, 6]));
    expect(describeZone(r)).toBe("Getroffen: Kopf (W20 1), Zonen-RS 0");
    expect(describeWound(r.wound!)).toContain("Wundschwelle 6");
    expect(summarizeResult(r, "A", "B", "Säbel")).toContain("(Kopf, Wundeffekt: Betäubung I)");
    expect(lastHitText({ zone: "kopf", sp: 10, wound: true })).toBe("Kopf · 10 SP ⚠");
  });
  it("store.applyPatch writes lastHit and undo restores it", () => {
    const { store, a, d } = mk();
    const r = resolveAttack({ ...buildAttackParams(input(a, d)), zones: { bodyType: "humanoid", size: "mittel", ko: 12, targeted: "torso" } }, fixedRoller([1, 3, 1]));
    store.applyPatch(r.patch, "x");
    expect(store.get(d.id)?.lastHit?.zone).toBe("torso");
    store.undo();
    expect(store.get(d.id)?.lastHit).toBeUndefined();
  });
});

describe("manuell festgelegte Zone", () => {
  const zp = { bodyType: "humanoid" as const, size: "mittel" as const, ko: 12 };
  it("forced zone: no W20 roll, not 'targeted', no penalty (engine takes none)", () => {
    const r = resolveAttack(params({ zones: { ...zp, forced: "armR" } }), fixedRoller([10, 6]));
    expect(r.zone).toMatchObject({ zone: "armR", roll: null, targeted: false, manual: true });
    expect(r.allRolls).toEqual([10, 6]);
    expect(r.wound?.effect.kind).toBe("waffeFallen");
  });
  it("invalid forced zone falls back to rolling", () => {
    const r = resolveAttack(params({ zones: { bodyType: "amorph" as const, size: "mittel" as const, forced: "kopf" } }), fixedRoller([10, 5, 3]));
    expect(r.zone).toMatchObject({ zone: "koerper", roll: 5 });
  });
  it("buildAttackParams: fixed zone adds no modifier line, aimed zone does", () => {
    const store = new CombatStore();
    const a = store.addCombatant({ name: "A", kind: "creature", sourcePath: "", lepMax: 30, iniBase: 10, rs: 0, vw: 5, weapons: [], needsManual: [] });
    const d = store.addCombatant({ name: "Z", kind: "creature", sourcePath: "", lepMax: 30, iniBase: 10, rs: 0, vw: 5, weapons: [], needsManual: [], ko: 12 });
    const base = { kind: "nahkampf" as const, attacker: a, defender: d, value: 12, tp: "1W6", atMod: 0, tpMod: 0, rangedMod: 0, defense: null, defenseMod: 0 };
    const fixed = { ...base, hitZones: { targeted: null, sf: false, fixed: "kopf" as const } };
    expect(previewAttack(fixed).attack.value).toBe(12);
    expect(buildAttackParams(fixed).zones).toMatchObject({ forced: "kopf", targeted: null });
    expect(previewAttack({ ...base, hitZones: { targeted: "kopf" as const, sf: false } }).attack.value).toBe(2);
  });
});

describe("reassignZone", () => {
  const zones = { bodyType: "humanoid" as const, size: "mittel" as const, ko: 12, zoneRs: { kopf: 0, torso: 3 } };
  const base = () => resolveAttack(params({ zones }), fixedRoller([10, 5, 6, 2]));
  it("uses the identical dice: only RS, damage, wound, patch change", () => {
    const r0 = base(); // torso (W20 5), TP 6+4, torso RS 3 -> 7
    expect(r0.zone?.zone).toBe("torso");
    expect(r0.damage?.dealt).toBe(7);
    const p = params({ zones });
    const r1 = reassignZone(r0, p as never, "kopf");
    expect(r1.allRolls).toEqual(r0.allRolls);
    expect(r1.damage?.tpRoll).toEqual(r0.damage?.tpRoll);
    expect(r1.damage).toMatchObject({ tpTotal: 10, rs: 0, dealt: 10 });
    expect(r1.zone).toMatchObject({ zone: "kopf", roll: null, manual: true, fromRoll: 5, rs: 0, rsSource: "zone" });
    expect(r1.wound?.effect.kind).toBe("betaeubung");
    expect(r1.patch.changes).toEqual([{ id: "d", lepDelta: -10, lastHit: { zone: "kopf", sp: 10, wound: true }, zoneDamage: { kopf: { sp: 10, hits: 1, wounds: 1 } } }]);
    expect(r0.zone?.zone).toBe("torso"); // input untouched
  });
  it("keeps other patch parts (defense counter) and handles damage dropping to 0", () => {
    const p = params({ defender: { id: "d", defense: { kind: "PA", value: 3 }, rs: 2 }, zones: { ...zones, zoneRs: { arme: 20 } } });
    const r0 = resolveAttack(p, fixedRoller([10, 15, 5, 5, 3]));
    expect(r0.outcome).toBe("hit");
    expect(r0.patch.changes[0].defensesDelta).toBe(1);
    const r1 = reassignZone(r0, p as never, "armL");
    expect(r1.damage?.dealt).toBe(0);
    expect(r1.patch.changes[0]).toMatchObject({ id: "d", defensesDelta: 1, lastHit: { zone: "armL", sp: 0, wound: false } });
    expect(r1.patch.changes[0].lepDelta).toBeUndefined();
    const back = reassignZone(r1, p as never, "torso");
    expect(back.damage?.dealt).toBe(r0.damage?.dealt);
    expect(back.patch.changes[0].lepDelta).toBe(r0.patch.changes[0].lepDelta);
  });
  it("ignores misses, invalid zones and missing zone params", () => {
    const miss = resolveAttack(params({ zones }), fixedRoller([19]));
    expect(reassignZone(miss, params({ zones }) as never, "kopf")).toBe(miss);
    const r0 = base();
    expect(reassignZone(r0, params({ zones }) as never, "vorderbeine")).toBe(r0);
    expect(reassignZone(r0, params() as never, "kopf")).toBe(r0);
  });
});

describe("zone damage tracking", () => {
  it("accumulates through patches, clamps at 0, inverts", () => {
    const st = { x: { lep: 30, defensesUsed: 0, defensePenalty: 0 } } as Record<string, { lep: number; defensesUsed: number; defensePenalty: number; zoneDamage?: import("../src/engine").ZoneDamage }>;
    const hit = (sp: number, w: boolean) => ({ changes: [{ id: "x", lepDelta: -sp, zoneDamage: { kopf: { sp, hits: 1, wounds: w ? 1 : 0 } } }] });
    let s = applyPatch(st, hit(5, false));
    s = applyPatch(s, hit(8, true));
    expect(s.x.zoneDamage).toEqual({ kopf: { sp: 13, hits: 2, wounds: 1 } });
    s = applyPatch(s, { changes: [{ id: "x", zoneDamage: { kopf: { sp: -99, hits: 0, wounds: 0 } } }] });
    expect(s.x.zoneDamage).toEqual({ kopf: { sp: 0, hits: 2, wounds: 1 } });
    const inv = invertPatch(hit(5, false));
    expect(inv.changes[0].zoneDamage).toEqual({ kopf: { sp: -5, hits: -1, wounds: -0 } });
    expect(applyZoneDamage(undefined, { torso: { sp: -3, hits: 0, wounds: 0 } })).toEqual({});
  });
  it("normalizePatch merges zone deltas of the same id", () => {
    const p = normalizePatch({ changes: [{ id: "x", zoneDamage: { kopf: { sp: 2, hits: 1, wounds: 0 } } }, { id: "x", zoneDamage: { kopf: { sp: 3, hits: 1, wounds: 1 } } }] });
    expect(p.changes).toEqual([{ id: "x", zoneDamage: { kopf: { sp: 5, hits: 2, wounds: 1 } } }]);
  });
  it("roll ranges per body type", () => {
    const m = zoneRollRanges("humanoid", "mittel");
    expect(m.map((x) => `${x.zone}:${x.range}`)).toEqual(["kopf:1-2", "torso:3-12", "armL:13-16 ungerade", "armR:13-16 gerade", "beinL:17-20 ungerade", "beinR:17-20 gerade"]);
    expect(zoneRollRanges("amorph", "mittel")).toEqual([]);
    expect(zoneRollRanges("vierbeiner", "gross")[3]).toEqual({ zone: "hinterbeine", range: "17-20" });
  });
  const mkStore = () => {
    const s = new CombatStore();
    const e = s.addCombatant({ name: "Ziel", kind: "creature", sourcePath: "", lepMax: 30, iniBase: 10, rs: 1, vw: 5, weapons: [], needsManual: [], ko: 12 });
    return { s, id: e.id };
  };
  it("store: attack patch writes zoneDamage, undo restores it", () => {
    const { s, id } = mkStore();
    const r = resolveAttack({ kind: "nahkampf", attacker: { id: "a", value: 14, tp: "1W6+4" }, defender: { id, defense: null, rs: 1 }, zones: { bodyType: "humanoid", size: "mittel", ko: 12 } }, fixedRoller([10, 2, 6]));
    s.applyPatch(r.patch, "Angriff");
    expect(s.get(id)?.zoneDamage).toEqual({ kopf: { sp: 9, hits: 1, wounds: 1 } });
    expect(s.get(id)?.lep).toBe(21);
    s.undo();
    expect(s.get(id)?.zoneDamage).toBeUndefined();
    expect(s.get(id)?.lep).toBe(30);
  });
  it("store: manual booking and reset are single undo steps", () => {
    const { s, id } = mkStore();
    s.bookZoneDamage(id, "torso", 6);
    expect(s.get(id)?.zoneDamage).toEqual({ torso: { sp: 6, hits: 0, wounds: 0 } });
    expect(s.get(id)?.lep).toBe(24);
    s.bookZoneDamage(id, "torso", -2);
    expect(s.get(id)?.zoneDamage?.torso?.sp).toBe(4);
    expect(s.get(id)?.lep).toBe(24); // correction only
    expect(s.undoLabel).toContain("korrigiert");
    s.resetZoneDamage(id);
    expect(s.get(id)?.zoneDamage).toBeUndefined();
    expect(s.undoLabel).toBe("Ziel: Trefferzonen zurückgesetzt");
    s.undo();
    expect(s.get(id)?.zoneDamage?.torso?.sp).toBe(4);
    s.undo();
    s.undo();
    expect(s.get(id)?.zoneDamage).toBeUndefined();
    expect(s.get(id)?.lep).toBe(30);
  });
  it("old saves without the field load; broken values are sanitised", () => {
    const { s, id } = mkStore();
    s.bookZoneDamage(id, "kopf", 3);
    const data = JSON.parse(JSON.stringify(s.state));
    const t = new CombatStore();
    t.load(data);
    expect(t.get(id)?.zoneDamage).toEqual({ kopf: { sp: 3, hits: 0, wounds: 0 } });
    delete data.entries[0].zoneDamage;
    t.load(data);
    expect(t.get(id)?.zoneDamage).toBeUndefined();
    data.entries[0].zoneDamage = { kopf: { sp: "x", hits: -2 }, bad: 5 };
    t.load(data);
    expect(t.get(id)?.zoneDamage?.kopf).toEqual({ sp: 0, hits: 0, wounds: 0 });
  });
  it("zoneOverview", () => {
    const { s, id } = mkStore();
    s.bookZoneDamage(id, "kopf", 4);
    const ov = zoneOverview(s.get(id)!);
    expect(ov.threshold).toBe(6);
    expect(ov.rows[0]).toMatchObject({ zone: "kopf", range: "1-2", rs: 1, rsSource: "gesamt", sp: 4, hitsText: "0" });
    expect(hitsText(3, 1)).toBe("3 · 1 Wunde");
    expect(hitsText(3, 2)).toBe("3 · 2 Wunden");
    expect(zoneOverview({ ...s.get(id)!, ko: null, bodyType: "amorph" })).toMatchObject({ threshold: null, rows: [] });
  });
});
