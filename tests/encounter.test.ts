import { describe, expect, it } from "vitest";
import { fixedRoller } from "../src/engine/dice";
import type { Combatant, Weapon } from "../src/model";
import { CombatStore } from "../src/combat/store";
import { parseCreature } from "../src/bestiary/adapter";
import { CatalogEntry, creatureMeta, estimateEncounter, indexCatalog, lookupCreature, resolveEntries, resolveHelden, rollCounts } from "../src/encounter/build";
import { Unit, estimate, manualPartyUnit, rate, unitFromCombatant, DEFAULT_FALLBACK } from "../src/encounter/estimate";
import { parseEncounter, replaceBlockBody, serializeEncounter, toBlock } from "../src/encounter/parse";

const SAMPLE = `name: Hinterhalt am Fluss
helden: Die Nebelfurt
- 3x Achazstammeskrieger
- 1x Achazherrscher | LeP 45 | INI 14 | Name Häuptling Szzar
- 2x Wegelagerer | LeP 28 | INI 12 | RS 1 | AT 11 | PA 6 | TP 1W6+3`;

describe("parseEncounter", () => {
  it("parses the documented example", () => {
    const { spec, warnings } = parseEncounter(SAMPLE);
    expect(warnings).toEqual([]);
    expect(spec.name).toBe("Hinterhalt am Fluss");
    expect(spec.helden).toBe("Die Nebelfurt");
    expect(spec.entries).toEqual([
      { count: 3, creature: "Achazstammeskrieger" },
      { count: 1, creature: "Achazherrscher", lep: 45, ini: 14, name: "Häuptling Szzar" },
      { count: 2, creature: "Wegelagerer", lep: 28, ini: 12, rs: 1, at: 11, pa: 6, tp: "1W6+3" },
    ]);
  });
  it("accepts wiki links, the multiplication sign, dice counts and missing counts", () => {
    const { spec, warnings } = parseEncounter("- 2× [[Wolf]]\n- [[Bestiarium/Bär|Bär]]\n- 1W6x Achazstammeskrieger\n- 2d6+1 x Ork");
    expect(warnings).toEqual([]);
    expect(spec.entries).toEqual([
      { count: 2, creature: "Wolf" },
      { count: 1, creature: "Bestiarium/Bär" },
      { count: 1, countDice: "1W6", creature: "Achazstammeskrieger" },
      { count: 1, countDice: "2W6+1", creature: "Ork" },
    ]);
  });
  it("does not read a creature starting with X as a multiplier", () => {
    const { spec, warnings } = parseEncounter("- 2 Xorn\n- 3 xenon\n- 1 Xaver");
    expect(warnings).toEqual([]);
    expect(spec.entries).toEqual([
      { count: 2, creature: "Xorn" },
      { count: 3, creature: "xenon" },
      { count: 1, creature: "Xaver" },
    ]);
  });
  it("keeps the spaced and attached multiplier forms", () => {
    const { spec } = parseEncounter("- 2x Wolf\n- 2 x Wolf\n- 2× Wolf\n- 2 × Wolf\n- 2 X Wolf\n- 3 Wölfe");
    expect(spec.entries).toEqual([
      { count: 2, creature: "Wolf" },
      { count: 2, creature: "Wolf" },
      { count: 2, creature: "Wolf" },
      { count: 2, creature: "Wolf" },
      { count: 2, creature: "Wolf" },
      { count: 3, creature: "Wölfe" },
    ]);
  });
  it("keeps dice counts with a following creature name", () => {
    const { spec, warnings } = parseEncounter("- 1W6 Ratten\n- 1W3+1 Wölfe");
    expect(warnings).toEqual([]);
    expect(spec.entries).toEqual([
      { count: 1, countDice: "1W6", creature: "Ratten" },
      { count: 1, countDice: "1W3+1", creature: "Wölfe" },
    ]);
  });
  it("is case-insensitive for override keys and tolerates ':' and '='", () => {
    const { spec } = parseEncounter("- 1x X | lep: 10 | ini=11 | tp 2w6");
    expect(spec.entries[0]).toMatchObject({ lep: 10, ini: 11, tp: "2W6" });
  });
  it("reports unknown lines and bad values as warnings, never throws", () => {
    const { spec, warnings } = parseEncounter("foo bar\nfarbe: rot\n- 0x Nichts\n- 2x Wolf | LeP viel | XY 3 | TP kaputt | ???\n- ");
    expect(warnings.length).toBeGreaterThanOrEqual(6);
    expect(spec.entries).toHaveLength(1);
    expect(spec.entries[0]).toEqual({ count: 2, creature: "Wolf" });
    expect(spec.extra).toContain("foo bar");
  });
  it("round-trips", () => {
    const { spec } = parseEncounter(SAMPLE);
    const text = serializeEncounter(spec);
    expect(text).toBe(SAMPLE);
    expect(parseEncounter(text).spec).toEqual(spec);
  });
  it("round-trips dice counts, vw and unknown lines", () => {
    const src = "- 1W6x Ork | VW 5\n- 1x Eigener | LeP 10 | AT 9 | PA 4 | VW 3 | TP 1W6\nwas auch immer";
    const { spec } = parseEncounter(src);
    expect(serializeEncounter(spec)).toBe(src);
    expect(parseEncounter(serializeEncounter(spec)).spec).toEqual(spec);
  });
  it("toBlock fences the body", () => {
    expect(toBlock(parseEncounter("- 1x Wolf").spec)).toBe("```dsa-kampf\n- 1x Wolf\n```");
  });
});

describe("replaceBlockBody", () => {
  const doc = "# Titel\n\n```dsa-kampf\n- 1x Wolf\n```\n\nText";
  it("replaces only the block body", () => {
    expect(replaceBlockBody(doc, 2, 4, "- 2x Bär")).toBe("# Titel\n\n```dsa-kampf\n- 2x Bär\n```\n\nText");
  });
  it("refuses when the lines are not a dsa-kampf fence", () => {
    expect(replaceBlockBody(doc, 0, 4, "x")).toBeNull();
    expect(replaceBlockBody(doc, 2, 3, "x")).toBeNull();
    expect(replaceBlockBody(doc, 2, 99, "x")).toBeNull();
  });
});

// ---------------------------------------------------------------- resolution

const wolfFm = { name: "Wolf", lep: 30, ini: "12+1W6", rs: 1, vw: 6, aktionen: "2", anzahl: "1W6 oder 2W6", typus: "Tier, nicht humanoid", tags: ["monster", "tier"], attacks: [{ name: "Biss", desc: "**AT** 12 **PA** 0 **TP** 1W6+2 **RW** kurz" }] };
const varFm = { name: "Dämon", lep: "variabel", ini: "variabel", rs: 3, vw: 5, attacks: [{ name: "Klaue", desc: "**AT** 14 **PA** 6 **TP** 2W6" }] };

function cat(basename: string, fm: Record<string, unknown>): CatalogEntry {
  const r = parseCreature(fm, `30 - Bestiarium/${basename}.md`, basename);
  const meta = creatureMeta(fm);
  return { path: `30 - Bestiarium/${basename}.md`, basename, name: r.combatant.name, combatant: r.combatant, status: r.status, problems: r.problems, ...meta };
}
const index = indexCatalog([cat("Wolf", wolfFm), cat("Dämon", varFm)]);

describe("duplicate creature names", () => {
  it("the first catalog entry wins for the same name (build, load and builder share this rule)", () => {
    const first = cat("Wolf", { ...wolfFm, lep: 10 });
    const second = cat("Wolf", { ...wolfFm, lep: 99 });
    const idx = indexCatalog([first, second]);
    expect(lookupCreature(idx, "wolf")).toBe(first);
    expect(lookupCreature(idx, "WOLF")).toBe(first);
  });
});

describe("creatureMeta", () => {
  it("reads anzahl, typus, tags and numeric aktionen", () => {
    expect(creatureMeta(wolfFm)).toEqual({ anzahl: "1W6 oder 2W6", typus: "Tier, nicht humanoid", tags: ["monster", "tier"], actions: 2 });
    expect(creatureMeta({ aktionen: "variabel" }).actions).toBeNull();
    expect(creatureMeta(undefined).tags).toEqual([]);
  });
});

describe("resolveEntries", () => {
  it("applies overrides to bestiary creatures and the display name", () => {
    const { spec } = parseEncounter("- 2x wolf | LeP 40 | RS 0 | Name Fenris");
    const [r] = resolveEntries(spec, index);
    expect(r.adhoc).toBe(false);
    expect(r.displayName).toBe("Fenris");
    expect(r.combatant).toMatchObject({ name: "Fenris", lepMax: 40, iniBase: 12, rs: 0, kind: "creature" });
    expect(r.count).toBe(2);
    expect(r.actions).toBe(2);
  });
  it("flags variabel creatures until overridden", () => {
    const [a] = resolveEntries(parseEncounter("- 1x Dämon").spec, index);
    expect(a.combatant.needsManual).toEqual(["lep", "ini"]);
    expect(a.warnings.join(" ")).toMatch(/variabel/);
    const [b] = resolveEntries(parseEncounter("- 1x Dämon | LeP 80 | INI 15").spec, index);
    expect(b.combatant.needsManual).toEqual([]);
    expect(b.combatant.lepMax).toBe(80);
    expect(b.warnings).toEqual([]);
  });
  it("builds ad-hoc enemies from overrides and flags missing values", () => {
    const [r] = resolveEntries(parseEncounter("- 2x Wegelagerer | LeP 28 | INI 12 | RS 1 | AT 11 | PA 6 | TP 1W6+3 | VW 4\n- 1x Räuber").spec, index);
    expect(r.adhoc).toBe(true);
    expect(r.combatant.weapons[0]).toMatchObject({ at: 11, pa: 6, tp: "1W6+3" });
    expect(r.combatant.vw).toBe(4);
    const [, r2] = resolveEntries(parseEncounter("- 2x Wegelagerer\n- 1x Räuber").spec, index);
    expect(r2.warnings[0]).toMatch(/Es fehlen: LeP, INI, AT, TP, RS/);
  });
  it("ignores AT/PA/TP overrides on bestiary creatures with a warning", () => {
    const [r] = resolveEntries(parseEncounter("- 1x Wolf | AT 20").spec, index);
    expect(r.combatant.weapons[0].at).toBe(12);
    expect(r.warnings.join(" ")).toMatch(/ignoriert/);
  });
  it("uses rolled dice counts, otherwise the expected value", () => {
    const { spec } = parseEncounter("- 1W6x Wolf\n- 2x Dämon\n- 2W6x Wolf");
    const counts = rollCounts(spec, fixedRoller([4, 2, 5]));
    expect(counts).toEqual({ 0: 4, 2: 7 });
    const rolled = resolveEntries(spec, index, counts);
    expect(rolled.map((r) => r.count)).toEqual([4, 2, 7]);
    expect(rolled[0].countIsGuess).toBe(false);
    const guess = resolveEntries(spec, index);
    expect(guess.map((r) => r.count)).toEqual([4, 2, 7]); // round(3.5)=4, round(7)=7
    expect(guess[0].countIsGuess).toBe(true);
  });
});

describe("entries -> combatants (CombatStore)", () => {
  it("adds named copies with suffixes and overrides, without prompts for complete entries", () => {
    const { spec } = parseEncounter("- 3x Wolf | LeP 40 | Name Fenris\n- 1x Dämon | LeP 80 | INI 15");
    const store = new CombatStore();
    for (const r of resolveEntries(spec, index)) for (let i = 0; i < r.count; i++) store.addCombatant(r.combatant);
    expect(store.entries.map((e) => e.name)).toEqual(["Fenris", "Fenris 2", "Fenris 3", "Dämon"]);
    expect(store.entries[0]).toMatchObject({ lepMax: 40, lep: 40, iniBase: 12 });
    expect(store.entries[3]).toMatchObject({ lepMax: 80, iniBase: 15, needsManual: [] });
  });
});

describe("resolveHelden", () => {
  const heroes = [
    { name: "Thorwin Eichhaus", callName: "Thorwin", campaign: "Die Nebelfurt" },
    { name: "Ilma", campaign: "Die Nebelfurt" },
    { name: "Tarik", campaign: "Wüstenwind" },
  ];
  it("resolves a campaign", () => expect(resolveHelden("die nebelfurt", heroes)).toEqual({ names: ["Thorwin Eichhaus", "Ilma"], unresolved: [] }));
  it("resolves names, call names and reports unknown ones", () =>
    expect(resolveHelden("Thorwin, Tarik, Niemand, Ilma", heroes)).toEqual({ names: ["Thorwin Eichhaus", "Tarik", "Ilma"], unresolved: ["Niemand"] }));
  it("empty -> nothing", () => expect(resolveHelden(undefined, heroes)).toEqual({ names: [], unresolved: [] }));
});

// ---------------------------------------------------------------- estimate

const weapon = (at: number, tp: string, pa: number | null = null): Weapon => ({ name: "W", kind: "melee", at, pa, fk: null, tp, tpNote: "", rw: "", rwRanges: null, lz: null, raw: "", partial: false });
const fighter = (name: string, o: Partial<Combatant>): Combatant => ({ name, kind: "creature", sourcePath: "", lepMax: 30, iniBase: 10, rs: 0, vw: null, weapons: [], needsManual: [], ...o });
const unit = (o: Partial<Unit>): Unit => ({ name: "u", count: 1, lep: 30, actions: 1, at: 12, tpAvg: 7.5, defense: 8, rs: 2, ...o });

describe("estimate (hand computed)", () => {
  it("1 hero vs 1 enemy", () => {
    // heroes -> enemy: 0.6 * (1-6/20)=0.7 -> 0.42 * (7.5-1) = 2.73 ; enemy -> hero: 0.5 * 0.6 = 0.3 * (5.5-2) = 1.05
    const e = estimate([unit({ lep: 30, at: 12, tpAvg: 7.5, defense: 8, rs: 2 })], [unit({ lep: 20, at: 10, tpAvg: 5.5, defense: 6, rs: 1 })]);
    expect(e.heroes.damagePerRound).toBeCloseTo(2.73, 5);
    expect(e.enemies.damagePerRound).toBeCloseTo(1.05, 5);
    expect(e.roundsToDropEnemies).toBeCloseTo(20 / 2.73, 5);
    expect(e.roundsToDropHeroes).toBeCloseTo(30 / 1.05, 5);
    expect(e.ratio).toBeCloseTo(30 / 1.05 / (20 / 2.73), 5);
    expect(e.rating).toBe("ausgeglichen"); // ratio ~3.9
  });
  it("outnumbering lowers the defense by 3*(m-1)/2 on average", () => {
    // 3 enemies (at 10, tp 5, rs 0, def 10) vs 1 hero (def 10, rs 0, lep 30): m=3 -> penalty 3 -> def 7 -> notDef 0.65
    // per enemy 0.5*0.65*5 = 1.625 ; total 4.875
    const hero = unit({ defense: 10, rs: 0, lep: 30, at: 10, tpAvg: 5 });
    const foes = unit({ count: 3, at: 10, tpAvg: 5, defense: 10, rs: 0, lep: 10 });
    const e = estimate([hero], [foes]);
    expect(e.enemies.damagePerRound).toBeCloseTo(4.875, 5);
    // hero -> foes: nDef=3, m = 1/3 -> max(1, ..)=1, no penalty: 0.5 * (1-10/20) * 5 = 1.25
    expect(e.heroes.damagePerRound).toBeCloseTo(1.25, 5);
  });
  it("actions multiply attacks and count as attacks on the same defender", () => {
    // enemy with 2 actions vs 1 hero: m=2 -> penalty 1.5 ; hero def 8 -> 6.5 -> notDef 0.675 ; hit 12/20 = .6 ; dmg 7.5-0 ; 2 * .6 * .675 * 7.5
    const e = estimate([unit({ defense: 8, rs: 0 })], [unit({ actions: 2, at: 12, tpAvg: 7.5, rs: 0 })]);
    expect(e.enemies.damagePerRound).toBeCloseTo(2 * 0.6 * 0.675 * 7.5, 5);
  });
  it("clamps the hit chance and the damage", () => {
    const hi = estimate([unit({ at: 30, tpAvg: 10, rs: 0, defense: 0 })], [unit({ rs: 0, defense: 0, lep: 19 })]);
    expect(hi.heroes.damagePerRound).toBeCloseTo(0.95 * 10, 5);
    const lo = estimate([unit({ at: 0, tpAvg: 10 })], [unit({ defense: 0, rs: 0 })]);
    expect(lo.heroes.damagePerRound).toBeCloseTo(0.05 * 10, 5);
    const armor = estimate([unit({ tpAvg: 3 })], [unit({ rs: 5 })]);
    expect(armor.heroes.damagePerRound).toBe(0);
    expect(armor.roundsToDropEnemies).toBe(Infinity);
  });
  it("ratings at the thresholds and degenerate sides", () => {
    expect(rate(4)).toBe("leicht");
    expect(rate(3.99)).toBe("ausgeglichen");
    expect(rate(2.5)).toBe("ausgeglichen");
    expect(rate(1.5)).toBe("fordernd");
    expect(rate(1)).toBe("gefährlich");
    expect(rate(0.99)).toBe("tödlich");
    expect(rate(null)).toBe("unbestimmt");
    const harmless = estimate([unit({})], [unit({ at: 12, tpAvg: 1, rs: 0 })]);
    expect(harmless.rating).toBe("leicht");
    const helpless = estimate([unit({ tpAvg: 0 })], [unit({})]);
    expect(helpless.ratio).toBe(0);
    expect(helpless.rating).toBe("tödlich");
    expect(estimate([unit({ tpAvg: 0 })], [unit({ tpAvg: 0 })]).rating).toBe("unbestimmt");
  });
});

describe("unitFromCombatant", () => {
  it("picks the weapon with the best expected damage and the best defense", () => {
    // 12 -> .6 * 3.5 = 2.1 ; 10 -> .5 * 9 = 4.5 -> second
    const c = fighter("X", { weapons: [weapon(12, "1W6", 5), weapon(10, "2W6+2", 7)], vw: 6, rs: 2 });
    const { unit: u, guessed } = unitFromCombatant(c, 2);
    expect(u).toMatchObject({ count: 2, at: 10, tpAvg: 9, defense: 7, rs: 2, lep: 30, actions: 1 });
    expect(guessed).toEqual([]);
  });
  it("falls back and says so", () => {
    const { unit: u, guessed } = unitFromCombatant(fighter("Held", { lepMax: null, rs: null }), 1);
    expect(u).toMatchObject({ at: 12, tpAvg: 7.5, defense: 7, rs: 2, lep: 30 });
    expect(guessed).toHaveLength(5);
    expect(guessed.join(" ")).toContain("AT unbekannt, Standardwert 12");
  });
  it("uses a ranged weapon's FK and a partial weapon's known half", () => {
    const bow: Weapon = { ...weapon(0, "1W6+3"), kind: "ranged", at: null, fk: 14 };
    expect(unitFromCombatant(fighter("B", { weapons: [bow], vw: 5 }), 1).unit).toMatchObject({ at: 14, tpAvg: 6.5 });
    const partial: Weapon = { ...weapon(9, "x"), tp: null, partial: true };
    const r = unitFromCombatant(fighter("P", { weapons: [partial], vw: 5 }), 1);
    expect(r.unit).toMatchObject({ at: 9, tpAvg: 7.5 });
    expect(r.guessed).toEqual(["P: TP unbekannt, Standardwert 1W6+4"]);
  });
});

describe("estimateEncounter", () => {
  it("runs end to end with a manual party and lists guesses", () => {
    const { spec } = parseEncounter("- 2x Wolf\n- 1x Eigener | LeP 10");
    const e = estimateEncounter(resolveEntries(spec, index), { kind: "manual", count: 4, lep: 30 });
    expect(e.heroes.count).toBe(4);
    expect(e.enemies.count).toBe(3);
    expect(e.enemies.lep).toBe(2 * 30 + 10);
    expect(e.guessed.some((g) => g.startsWith("Helden: keine Heldendaten"))).toBe(true);
    expect(e.guessed.some((g) => g.startsWith("Eigener: AT unbekannt"))).toBe(true);
    // wolf has 2 actions
    expect(e.enemies.actionsPerRound).toBe(2 * 2 + 1);
    expect(Number.isFinite(e.ratio ?? NaN)).toBe(true);
  });
  it("uses imported heroes when given", () => {
    const hero = fighter("Held", { kind: "hero", lepMax: 35, rs: 1, vw: 7, weapons: [weapon(13, "1W6+4", 8)] });
    const e = estimateEncounter(resolveEntries(parseEncounter("- 1x Wolf").spec, index), { kind: "heroes", combatants: [hero] });
    expect(e.heroes.lep).toBe(35);
    expect(e.guessed).toEqual([]);
  });
  it("manualPartyUnit mentions the defaults used", () => {
    expect(manualPartyUnit(4, 31).guessed[0]).toContain(`AT ${DEFAULT_FALLBACK.at}`);
  });
});
