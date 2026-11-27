import { describe, expect, it } from "vitest";
import { fixedRoller, resolveAttack } from "../src/engine";
import { CombatStore } from "../src/combat/store";
import type { Combatant } from "../src/model";
import {
  buildAttackParams, defenseOptions, describeCheck, describeDamage, manualDefenseDelta, matchCreatureName, needsStatsPrompt,
  parseDragPayload, parseEncounterBlocks, previewAttack, summarizeResult, validateAttackInput,
} from "../src/cockpit/logic";

const creature = (over: Partial<Combatant> = {}): Combatant => ({
  name: "Ork", kind: "creature", sourcePath: "30 - Bestiarium/Ork.md", lepMax: 30, iniBase: 12, rs: 2, vw: 5,
  weapons: [{ name: "Säbel", kind: "melee", at: 12, pa: 8, fk: null, tp: "1W6+4", tpNote: "", rw: "mittel", rwRanges: null, lz: null, raw: "", partial: false }],
  needsManual: [], ...over,
});

describe("encounter blocks", () => {
  it("parses 'amount: name' items", () => {
    const md = "text\n```encounter\nname: Example\ncreatures:\n - 3: Goblin\n - 1: Orc\n```\nmore";
    expect(parseEncounterBlocks(md)).toEqual([{ name: "Goblin", amount: 3 }, { name: "Orc", amount: 1 }]);
  });
  it("parses name items with amount/hp keys, also encounter-table", () => {
    const md = "```encounter-table\nname: X\ncreatures:\n  - Die Krähe\n    amount: 1\n    hp: 28\n  - Schläger (Beschützer)\n    amount: 2\n    hp: 35\n```";
    expect(parseEncounterBlocks(md)).toEqual([
      { name: "Die Krähe", amount: 1, hp: 28 },
      { name: "Schläger (Beschützer)", amount: 2, hp: 35 },
    ]);
  });
  it("ignores other blocks and players", () => {
    const md = "```js\ncreatures:\n - 2: X\n```\n```encounter\nplayers:\n  - Held\ncreatures:\n  - Wolf\n```";
    expect(parseEncounterBlocks(md)).toEqual([{ name: "Wolf", amount: 1 }]);
  });
  it("matches names", () => {
    const c = [{ name: "Goblin" }, { name: "Goblinschamane" }];
    expect(matchCreatureName("goblin", c)?.name).toBe("Goblin");
    expect(matchCreatureName("Orc", c)).toBeNull();
    expect(matchCreatureName("schamane", c)?.name).toBe("Goblinschamane");
  });
});

describe("drag payload", () => {
  it("decodes obsidian:// uris", () => {
    expect(parseDragPayload("obsidian://open?vault=Vademecum&file=30%20-%20Bestiarium%2FOrk")).toBe("30 - Bestiarium/Ork");
  });
  it("handles wikilinks, plain paths, uri lists", () => {
    expect(parseDragPayload("[[Ork]]")).toBe("Ork");
    expect(parseDragPayload("[[Ork|Der Ork]]")).toBe("Ork");
    expect(parseDragPayload("30 - Bestiarium/Ork.md")).toBe("30 - Bestiarium/Ork.md");
    expect(parseDragPayload("# c\nobsidian://open?file=A%2FB")).toBe("A/B");
    expect(parseDragPayload("https://example.com")).toBeNull();
    expect(parseDragPayload("")).toBeNull();
  });
});

describe("attack setup", () => {
  const mk = () => {
    const s = new CombatStore();
    const a = s.addCombatant(creature({ name: "Angreifer" }));
    const d = s.addCombatant(creature({ name: "Verteidiger" }));
    return { s, a, d };
  };
  const input = (a: any, d: any) => ({
    kind: "nahkampf" as const, attacker: a, defender: d, value: 12, tp: "1W6+4", atMod: 0, tpMod: 0, rangedMod: 0,
    defense: { kind: "PA" as const, value: 8 }, defenseMod: 0,
  });

  it("offers PA by default for melee, VW for ranged", () => {
    const { d } = mk();
    expect(defenseOptions(d, "nahkampf").defaultId).toBe("pa0");
    expect(defenseOptions(d, "fernkampf").defaultId).toBe("vw");
    expect(defenseOptions({ ...d, weapons: [], vw: null }, "nahkampf").defaultId).toBe("none");
  });

  it("builds params with state penalties and counters, resolves and applies as one undo step", () => {
    const { s, a, d } = mk();
    s.setLep(a.id, 14); // below 1/2 of 30 -> Schmerz II
    s.applyPatch({ changes: [{ id: d.id, defensesDelta: 2, defensePenaltyDelta: 6 }] }, "x");
    const p = buildAttackParams({ ...input(s.get(a.id), s.get(d.id)), atMod: -2, tpMod: 1 });
    expect(p.attacker.statePenalty).toBe(2);
    expect(p.attacker.modifiers).toEqual([{ label: "Freier Modifikator (AT)", value: -2 }]);
    expect(p.defender.defensePenalty).toBe(6);
    const r = resolveAttack(p, fixedRoller([5, 12, 3]));
    expect(r.outcome).toBe("hit");
    // PA 8 - 6 counter = 2, rolled 12 fails; damage 3+4+1 = 8 - RS 2 = 6
    expect(r.damage?.dealt).toBe(6);
    const before = s.undoLabel;
    s.applyPatch(r.patch, "Angriff");
    const dd = s.get(d.id)!;
    expect(dd.lep).toBe(24);
    expect(dd.defensesUsed).toBe(3);
    expect(dd.defensePenalty).toBe(9);
    s.undo();
    expect(s.get(d.id)!.lep).toBe(30);
    expect(s.get(d.id)!.defensePenalty).toBe(6);
    expect(s.undoLabel).toBe(before);
  });

  it("itemises the preview", () => {
    const { s, a, d } = mk();
    s.setLep(a.id, 14);
    const pv = previewAttack({ ...input(s.get(a.id), s.get(d.id)), atMod: 1 });
    expect(pv.attack.value).toBe(11); // 12 +1 -2 Schmerz II
    expect(pv.attack.lines.map((l) => l.label)).toEqual(["AT", "Freier Modifikator (AT)", "Schmerz II"]);
    expect(pv.defense?.value).toBe(8);
    const none = previewAttack({ ...input(s.get(a.id), s.get(d.id)), defense: null });
    expect(none.defense).toBeNull();
  });

  it("ranged: ranged mod only for fernkampf, defense gets -4", () => {
    const { s, a, d } = mk();
    const base = { ...input(s.get(a.id), s.get(d.id)), kind: "fernkampf" as const, rangedMod: -2, rangedType: "schuss" as const, defense: { kind: "VW" as const, value: 8 } };
    const pv = previewAttack(base);
    expect(pv.attack.value).toBe(10);
    expect(pv.defense?.value).toBe(4);
  });

  it("validates manual input", () => {
    expect(validateAttackInput({ value: NaN, tp: "1W6", defense: null })).toMatch(/AT/);
    expect(validateAttackInput({ value: 10, tp: "Haltegriff", defense: null })).toMatch(/TP/);
    expect(validateAttackInput({ value: 10, tp: "1W6+2", defense: { kind: "PA", value: 5 } })).toBeNull();
  });

  it("manual defense count follows the mode", () => {
    expect(manualDefenseDelta({ defenseMode: "cumulative" })).toEqual({ defensesDelta: 1, defensePenaltyDelta: 3 });
    expect(manualDefenseDelta({ defenseMode: "single" })).toEqual({ defensesDelta: 1, defensePenaltyDelta: 0 });
  });

  it("describes results", () => {
    const { s, a, d } = mk();
    const r = resolveAttack(buildAttackParams(input(s.get(a.id), s.get(d.id))), fixedRoller([1, 5, 7, 3]));
    expect(describeCheck(r.attack)).toContain("kritischer Erfolg bestätigt");
    expect(describeDamage(r)).toContain("×2");
    expect(summarizeResult(r, "A", "D", "Säbel")).toContain("SP");
  });

  it("flags creatures needing a stats prompt", () => {
    expect(needsStatsPrompt(creature())).toBe(false);
    expect(needsStatsPrompt(creature({ lepMax: null, needsManual: ["lep"] }))).toBe(true);
    expect(needsStatsPrompt(creature({ iniBase: null }))).toBe(true);
  });
});

describe("energy tracking and current LeP", () => {
  it("spendEnergy accumulates and is undoable", () => {
    const s = new CombatStore();
    const e = s.addCombatant(creature());
    s.spendEnergy(e.id, "AsP", 4);
    s.spendEnergy(e.id, "AsP", 3);
    s.spendEnergy(e.id, "KaP", 2);
    expect([e.aspSpent, e.kapSpent]).toEqual([7, 2]);
    s.undo();
    expect(s.get(e.id)?.kapSpent).toBe(0);
    s.undo();
    expect(s.get(e.id)?.aspSpent).toBe(4);
  });
  it("starts with lepCurrent (clamped to max) when given", () => {
    const s = new CombatStore();
    expect(s.addCombatant(creature({ lepCurrent: 12 })).lep).toBe(12);
    expect(s.addCombatant(creature({ name: "B", lepCurrent: 99 })).lep).toBe(30);
    expect(s.addCombatant(creature({ name: "C" })).lep).toBe(30);
  });
});

import { clampSpent, energyCurrent, energyMax, energyPct, hasEnergy, spentForCurrent } from "../src/combat/energy";
import { COMPACT_BELOW_PX, WIDE_FROM_PX, isWide, nextLayout, normalizeLayout, resolveLayout } from "../src/cockpit/layout";
import { creatureEnergyFromFm, heroEnergyFromFm } from "../src/cockpit/energy";
import { migrateEntry } from "../src/combat/store";

describe("AsP/KaP arithmetic", () => {
  it("current = max - spent, clamped", () => {
    expect(energyCurrent(20, 5)).toBe(15);
    expect(energyCurrent(20, 99)).toBe(0);
    expect(energyCurrent(20, -3)).toBe(20);
    expect(clampSpent(10, 12)).toBe(10);
    expect(spentForCurrent(20, 25)).toBe(0);
    expect(spentForCurrent(20, -4)).toBe(20);
    expect(spentForCurrent(20, 7)).toBe(13);
    expect(energyCurrent(undefined, 3)).toBe(0);
    expect(energyMax(NaN)).toBe(0);
    expect(hasEnergy(0)).toBe(false);
    expect(hasEnergy(undefined)).toBe(false);
    expect(hasEnergy(8)).toBe(true);
    expect(energyPct(20, 5)).toBe(75);
    expect(energyPct(0, 0)).toBe(0);
  });
  it("migrates old saves: max stays undefined, spent defaults to 0", () => {
    const old = migrateEntry({ id: "a", name: "Ork", lep: 5, lepMax: 30 });
    expect(old.aspMax).toBeUndefined();
    expect(old.kapMax).toBeUndefined();
    expect(old.aspSpent).toBe(0);
    expect(migrateEntry({ id: "b", aspMax: 12, aspSpent: 4 }).aspMax).toBe(12);
  });
  it("reads hero and creature note frontmatter", () => {
    expect(heroEnergyFromFm({ AsP: 30, AsP_aktuell: 22, KaP: 10 })).toEqual({ aspMax: 30, kapMax: 10, aspSpent: 8, kapSpent: 0 });
    expect(heroEnergyFromFm({ AsP_aktuell: 3 }, 12)).toMatchObject({ aspMax: 12, aspSpent: 9, kapMax: 0 });
    expect(heroEnergyFromFm({ AsP: 10, AsP_aktuell: 99 }).aspSpent).toBe(0);
    expect(creatureEnergyFromFm({ asp: "25", kap: 0 })).toEqual({ aspMax: 25, kapMax: 0 });
    expect(creatureEnergyFromFm({})).toEqual({ aspMax: 0, kapMax: 0 });
  });
  it("store: setEnergyCurrent clamps, undoes and syncEnergy is silent", () => {
    const s = new CombatStore();
    const e = s.addCombatant(creature());
    expect(s.energy(e.id, "AsP")).toBeNull();
    expect(s.syncEnergy(e.id, { aspMax: 20 })).toBe(true);
    expect(s.syncEnergy(e.id, { aspMax: 20 })).toBe(false);
    expect(s.energy(e.id, "AsP")).toEqual({ cur: 20, max: 20 });
    expect(s.energy(e.id, "KaP")).toBeNull();
    const undoDepth = s.state.history.length;
    s.setEnergyCurrent(e.id, "AsP", 50);
    expect(s.energy(e.id, "AsP")?.cur).toBe(20);
    s.setEnergyCurrent(e.id, "AsP", 6);
    expect(s.energy(e.id, "AsP")?.cur).toBe(6);
    s.spendEnergy(e.id, "AsP", 100);
    expect(s.energy(e.id, "AsP")?.cur).toBe(0);
    s.undo();
    expect(s.energy(e.id, "AsP")?.cur).toBe(6);
    s.undo();
    expect(s.energy(e.id, "AsP")?.cur).toBe(20);
    s.undo();
    expect(s.energy(e.id, "AsP")?.cur).toBe(20);
    expect(s.state.history.length).toBe(undoDepth);
  });
  it("undo event carries the ids of manual energy changes", () => {
    const s = new CombatStore();
    const e = s.addCombatant(creature());
    s.syncEnergy(e.id, { aspMax: 10 });
    s.setEnergyCurrent(e.id, "AsP", 3);
    let ids: string[] | undefined;
    s.on((ev) => ev.type === "undo" && (ids = ev.energyIds));
    s.undo();
    expect(ids).toEqual([e.id]);
  });
});

describe("cockpit layout", () => {
  it("resolves auto by width, fixed modes ignore it", () => {
    expect(resolveLayout("auto", COMPACT_BELOW_PX - 1)).toBe("kompakt");
    expect(resolveLayout("auto", COMPACT_BELOW_PX)).toBe("detail");
    expect(resolveLayout("auto", 0)).toBe("detail");
    expect(resolveLayout("kompakt", 2000)).toBe("kompakt");
    expect(resolveLayout("detail", 300)).toBe("detail");
    expect(isWide(WIDE_FROM_PX)).toBe(true);
    expect(isWide(WIDE_FROM_PX - 1)).toBe(false);
  });
  it("normalizes and cycles", () => {
    expect(normalizeLayout("quatsch")).toBe("auto");
    expect(normalizeLayout(undefined)).toBe("auto");
    expect(normalizeLayout("detail")).toBe("detail");
    expect(nextLayout("auto")).toBe("kompakt");
    expect(nextLayout("kompakt")).toBe("detail");
    expect(nextLayout("detail")).toBe("auto");
  });
});
