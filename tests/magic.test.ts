import { describe, expect, it } from "vitest";
import { fixedRoller } from "../src/engine/dice";
import { casterFromCreature, parseSpellList } from "../src/magic/casters";
import { parseMagic } from "../src/magic/parse";
import { canAfford, fullCost, resolveCast } from "../src/magic/resolve";
import { findSpell, parseCostBasis, parseSpellNote, substituteQs } from "../src/magic/spells";

const IGNI = `---
tags: [regel, zauber]
---

# Ignifaxius

- **Merkmal:** Elementar
- **Probe:** MU/KL/CH (mod. SK)
- **Zauberdauer:** 2 Aktionen
- **AsP-Kosten:** 8 AsP
- **Reichweite:** 16 Schritt
- **Wirkungsdauer:** QS×3 Min
- **Zielkategorie:** alle

**Wirkung:** Feuerstrahl. 2W6 + QS×2 TP.

Regelwiki: x
`;

describe("spell note parser", () => {
  it("parses fields", () => {
    const s = parseSpellNote(IGNI, "x/Ignifaxius.md", "Ignifaxius")!;
    expect(s).toMatchObject({ name: "Ignifaxius", kind: "zauber", probe: ["MU", "KL", "CH"], kostenBasis: 8, modifizierbar: "SK", zauberdauer: "2 Aktionen", reichweite: "16 Schritt", zielkategorie: "alle", merkmal: "Elementar" });
    expect(s.wirkung).toBe("Feuerstrahl. 2W6 + QS×2 TP.");
  });
  it("cost variants", () => {
    expect(parseCostBasis("4 / 8 / 16 AsP (je nach Stufe)")).toBeNull();
    expect(parseCostBasis("mind. 4 AsP + 2 AsP je 5 Min")).toBe(4);
    expect(parseCostBasis("4 KaP")).toBe(4);
  });
  it("liturgy by KaP cost and no probe -> null", () => {
    const l = parseSpellNote("# B\n- **Probe:** MU/KL/IN\n- **KaP-Kosten:** 4 KaP (nicht modifizierbar)\n", "p", "B")!;
    expect(l.kind).toBe("liturgie");
    expect(l.nichtModifizierbar).toBe(true);
    expect(parseSpellNote("# nix", "p", "n")).toBeNull();
  });
  it("find by prefix and parenthesis", () => {
    const s = parseSpellNote(IGNI, "p", "Ignifaxius")!;
    expect(findSpell([s], "ignifax")).toBe(s);
    expect(findSpell([s], "Ignifaxius (Feuer)")).toBe(s);
    expect(findSpell([s], "Armatrutz")).toBeNull();
  });
  it("QS substitution", () => {
    expect(substituteQs("QS×3 Min", 3)).toBe("9 (QS×3) Min");
    expect(substituteQs("QS KR", 4)).toBe("4 KR");
    expect(substituteQs("ab QS 2 Bonus", 3)).toBe("ab QS 2 Bonus");
    expect(substituteQs("QS×3 Min", 0)).toBe("QS×3 Min");
  });
});

describe("inline code", () => {
  it("parses modifier and hero", () => {
    expect(parseMagic("zauber: Ignifaxius +2 @Thorwin")).toEqual({ ok: true, spec: { kind: "zauber", name: "Ignifaxius", modifier: 2, hero: "Thorwin" } });
    expect(parseMagic("liturgie: Blendstrahl -1")).toEqual({ ok: true, spec: { kind: "liturgie", name: "Blendstrahl", modifier: -1, hero: null } });
    expect(parseMagic("Zauber: Blick in die Gedanken")).toMatchObject({ ok: true, spec: { name: "Blick in die Gedanken", modifier: 0 } });
    expect(parseMagic("zauber:").ok).toBe(false);
  });
});

describe("creature / hero lists", () => {
  it("splits spell strings", () => {
    expect(parseSpellList("Ignifaxius 11, Armatrutz 10", "zauber")).toEqual([
      { name: "Ignifaxius", kind: "zauber", fw: 11 },
      { name: "Armatrutz", kind: "zauber", fw: 10 },
    ]);
    expect(parseSpellList("Segnungen (Eidsegen, Reisesegen) 12, Blendstrahl 12", "liturgie").map((x) => x.name)).toEqual(["Segnungen (Eidsegen, Reisesegen)", "Blendstrahl"]);
  });
  it("creature caster", () => {
    const c = casterFromCreature({ mu: 12, kl: 14, in: 14, ch: 12, asp: "32", kap: "–", zauber: "Ignifaxius 11" }, "p", "Gildenmagier");
    expect(c.attrs.KL).toBe(14);
    expect(c.asp).toBe(32);
    expect(c.kap).toBeNull();
    expect(c.known[0]).toMatchObject({ name: "Ignifaxius", fw: 11 });
  });
});

const base = { name: "Ignifaxius", kind: "zauber" as const, attrs: [12, 12, 12] as [number, number, number], fw: 10, modifier: 0, costBasis: 8 };

describe("resolveCast", () => {
  const spell = parseSpellNote(IGNI, "p", "Ignifaxius")!;
  it("success: full cost, QS, effect text", () => {
    const r = resolveCast({ ...base, spell }, fixedRoller([10, 12, 15])); // needed 3 -> remaining 7 -> QS3
    expect(r.success).toBe(true);
    expect(r.qs).toBe(3);
    expect(r.costFull).toBe(8);
    expect(r.costPaid).toBe(8);
    expect(r.wirkungsdauer).toBe("9 (QS×3) Min");
    expect(r.wirkung).toContain("6 (QS×2) TP");
  });
  it("failure pays half, rounded up", () => {
    const r = resolveCast({ ...base, costBasis: 7, spell }, fixedRoller([20, 18, 14])); // needed 8+6+2=16 > 10
    expect(r.success).toBe(false);
    expect(r.qs).toBe(0);
    expect(r.costPaid).toBe(4);
    expect(r.wirkung).toContain("QS×2");
  });
  it("critical success halves", () => {
    const r = resolveCast({ ...base }, fixedRoller([1, 1, 20]));
    expect(r.critical).toBe("success");
    expect(r.costPaid).toBe(4);
  });
  it("patzer fails", () => {
    const r = resolveCast({ ...base }, fixedRoller([20, 20, 1]));
    expect(r.critical).toBe("patzer");
    expect(r.success).toBe(false);
    expect(r.costPaid).toBe(4);
  });
  it("resistance and modifier lower the attributes", () => {
    const r = resolveCast({ ...base, modifier: 2, resistance: 3, resistanceLabel: "SK" }, fixedRoller([11, 11, 11]));
    expect(r.check.attrEffective).toEqual([11, 11, 11]);
    expect(r.check.fwUsed).toBe(0);
  });
  it("cost multiplier and unknown cost", () => {
    expect(resolveCast({ ...base, costMultiplier: 0.75 }, fixedRoller([5, 5, 5])).costPaid).toBe(6);
    expect(resolveCast({ ...base, costBasis: null }, fixedRoller([5, 5, 5])).costPaid).toBeNull();
    expect(fullCost(5, 0.5)).toBe(3);
    expect(canAfford(3, 4)).toBe(false);
    expect(canAfford(null, 4)).toBe(true);
  });
  it("liturgy uses KaP", () => {
    expect(resolveCast({ ...base, kind: "liturgie" }, fixedRoller([5, 5, 5])).energy).toBe("KaP");
  });
});
