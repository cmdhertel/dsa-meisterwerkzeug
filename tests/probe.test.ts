import { describe, expect, it } from "vitest";
import { fixedRoller } from "../src/engine";
import { findTalent, formatModifier, parseProbe, splitSegments, unlockedOutcomes } from "../src/probe/parse";
import { bestRun, campaignsOf, findCombatEntry, linkTarget, orderHeroes, runCheck } from "../src/probe/logic";

describe("parseProbe", () => {
  it("parses talent, modifier and outcomes", () => {
    const r = parseProbe("probe: Sinnesschärfe +2 | QS3: drei | QS2: Schritte | Misslungen: Nichts.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.talent.name).toBe("Sinnesschärfe");
    expect(r.spec.modifier).toBe(2);
    expect(r.spec.outcomes.map((o) => o.label)).toEqual(["QS2", "QS3"]);
    expect(r.spec.failure).toEqual(["Nichts."]);
  });
  it("accepts negative, unicode minus and no modifier", () => {
    for (const [s, m] of [["probe:Klettern -1", -1], ["probe: Klettern −2", -2], ["PROBE: klettern", 0], ["probe: Klettern+3", 3]] as const) {
      const r = parseProbe(s);
      expect(r.ok && r.spec.modifier).toBe(m);
    }
  });
  it("matches & / und and spacing", () => {
    for (const n of ["Sagen & Legenden", "sagen und legenden", "SAGEN&LEGENDEN", "Götter und Kulte", "gotter & kulte"]) expect(findTalent(n).ok).toBe(true);
    const r = findTalent("Sagen und Legenden");
    expect(r.ok && r.talent.name).toBe("Sagen & Legenden");
  });
  it("accepts unambiguous prefixes, rejects ambiguous and unknown", () => {
    expect(findTalent("Sinnes").ok).toBe(true);
    expect(findTalent("Heilkunde").ok).toBe(false);
    const u = parseProbe("probe: Quatsch +1");
    expect(u.ok).toBe(false);
    if (!u.ok) expect(u.error).toContain("Unbekanntes Talent");
  });
  it("Erfolg counts as QS1; unknown sections are errors", () => {
    const r = parseProbe("probe: Klettern | Erfolg: oben");
    expect(r.ok && r.spec.outcomes[0].level).toBe(1);
    expect(parseProbe("probe: Klettern | Foo: x").ok).toBe(false);
  });
  it("does not split wiki-link pipes", () => {
    expect(splitSegments("a | b [[X|y]] | c")).toEqual(["a ", " b [[X|y]] ", " c"]);
    const r = parseProbe("probe: Klettern | QS1: siehe [[Bob|Bobby]] | QS2: mehr");
    expect(r.ok && r.spec.outcomes.map((o) => o.text)).toEqual(["siehe [[Bob|Bobby]]", "mehr"]);
  });
  it("rejects non-probe text", () => {
    expect(parseProbe("würfel: 1d6").ok).toBe(false);
    expect(formatModifier(2)).toBe("+2");
    expect(formatModifier(-1)).toBe("-1");
    expect(formatModifier(0)).toBe("");
  });
});

describe("unlockedOutcomes", () => {
  const spec = parseProbe("probe: Klettern | Erfolg: e | QS2: b | QS4: d | Misslungen: f");
  if (!spec.ok) throw new Error("x");
  const { outcomes, failure } = spec.spec;
  it("unlocks up to the reached QS", () => {
    const u = unlockedOutcomes(outcomes, failure, true, 3);
    expect(u.shown.map((x) => x.text)).toEqual(["e", "b"]);
    expect(u.hidden.map((x) => x.text)).toEqual(["d"]);
    expect(unlockedOutcomes(outcomes, failure, true, 6).hidden).toEqual([]);
  });
  it("failure shows only failure texts", () => {
    const u = unlockedOutcomes(outcomes, failure, false, 0);
    expect(u.shown.map((x) => x.text)).toEqual(["f"]);
    expect(u.hidden).toEqual([]);
  });
});

describe("runCheck", () => {
  const subj = { name: "A", attrs: [12, 12, 12] as [number, number, number], fw: 6, statePenalty: 0 };
  it("rolls with modifier and state penalty", () => {
    const r = runCheck({ ...subj, statePenalty: 1 }, 3, fixedRoller([14, 14, 14]));
    expect(r.result.attrEffective).toEqual([14, 14, 14]);
    expect(r.result.success).toBe(true);
    expect(r.result.remaining).toBe(6);
  });
  it("FW 0 fails on overshoot", () => {
    expect(runCheck({ ...subj, fw: 0 }, 0, fixedRoller([13, 5, 5])).result.success).toBe(false);
  });
  it("bestRun", () => {
    const a = runCheck(subj, 0, fixedRoller([5, 5, 5]));
    const b = runCheck({ ...subj, name: "B", fw: 0 }, 0, fixedRoller([19, 19, 19]));
    expect(bestRun([b, a])).toBe(a);
    expect(bestRun([])).toBeNull();
  });
});

describe("hero ordering", () => {
  const hs = [
    { uid: "1", name: "Zora", campaigns: ["Die Nebelfurt"] },
    { uid: "2", name: "Alrik", campaigns: ["Wüstenwind"] },
    { uid: "3", name: "Bela", campaigns: ["Die Nebelfurt"] },
  ];
  it("campaign first, last chosen first", () => {
    expect(orderHeroes(hs, ["die nebelfurt"], null).primary.map((h) => h.uid)).toEqual(["3", "1"]);
    expect(orderHeroes(hs, ["Die Nebelfurt"], "1").primary.map((h) => h.uid)).toEqual(["1", "3"]);
    expect(orderHeroes(hs, ["Die Nebelfurt"], null).others.map((h) => h.uid)).toEqual(["2"]);
  });
  it("falls back to all when no campaign or no match", () => {
    expect(orderHeroes(hs, [], null).primary.map((h) => h.uid)).toEqual(["2", "3", "1"]);
    expect(orderHeroes(hs, ["Nirgendwo"], null).others).toEqual([]);
  });
  it("link helpers", () => {
    expect(linkTarget('[[Die Nebelfurt]]')).toBe("Die Nebelfurt");
    expect(linkTarget("[[Kampagnen/Die Nebelfurt|X]]")).toBe("Die Nebelfurt");
    expect(campaignsOf(["[[A]]", "[[B]]"])).toEqual(["A", "B"]);
    expect(campaignsOf(undefined)).toEqual([]);
  });
  it("combat entry lookup", () => {
    const es = [
      { id: "c1", kind: "creature", name: "Alrik", sourcePath: "x" },
      { id: "c2", kind: "hero", name: "Alrik", sourcePath: "Assets/Alrik.md" },
    ];
    expect(findCombatEntry(es, { name: "Alrik", callName: "Alrik" })?.id).toBe("c2");
    expect(findCombatEntry(es, { name: "Q", callName: "Q", notePath: "Assets/Alrik.md" })?.id).toBe("c2");
    expect(findCombatEntry(es, { name: "Zed", callName: "Zed" })).toBeNull();
  });
});
