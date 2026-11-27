import { describe, expect, it } from "vitest";
import { CombatState, CombatStore, migrateCurrentId, orderEntries, uniqueCombatName } from "../src/combat/store";
import { fixedRoller } from "../src/engine";
import { defenseBlockFor, makeEffect } from "../src/engine/effects";
import { effectiveLevels } from "../src/engine/states";
import { defenseBlock, heroInCombat } from "../src/cockpit/logic";
import { internalDraggable, viewApplyLayout } from "../src/cockpit/internalApi";
import type { Combatant } from "../src/model";

const mk = (name: string, kind: "hero" | "creature" = "creature", lepMax = 30): Combatant => ({
  name, kind, sourcePath: "", lepMax, iniBase: 10, rs: 0, vw: null, weapons: [], needsManual: [],
});

/** Store with A, B, C rolled to 15, 13, 11 (order A, B, C). */
function fight() {
  const s = new CombatStore();
  const a = s.addCombatant(mk("A"));
  const b = s.addCombatant(mk("B"));
  const c = s.addCombatant(mk("C"));
  s.setInitiativeRoll(a.id, 5);
  s.setInitiativeRoll(b.id, 3);
  s.setInitiativeRoll(c.id, 1);
  return { s, a, b, c };
}
const names = (s: CombatStore) => s.order().map((e) => e.name);

describe("combat turn: currentId", () => {
  it("next turn walks the order and wraps into the next round", () => {
    const { s } = fight();
    expect(s.currentId()).toBeNull();
    s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("A");
    s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("B");
    s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("C");
    expect(s.round).toBe(1);
    s.nextTurn(fixedRoller([]));
    expect(s.round).toBe(2);
    expect(s.get(s.currentId()!)?.name).toBe("A");
  });

  it("removing an earlier combatant keeps the turn with the same actor", () => {
    const { s, a } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("B");
    s.removeCombatant(a.id);
    expect(s.get(s.currentId()!)?.name).toBe("B");
  });

  it("removing a later combatant keeps the turn", () => {
    const { s, c } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    s.removeCombatant(c.id);
    expect(s.get(s.currentId()!)?.name).toBe("B");
    s.nextTurn(fixedRoller([]));
    expect(s.round).toBe(2);
  });

  it("removing the current combatant passes the turn to the one who took its place", () => {
    const { s, b } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    s.removeCombatant(b.id);
    expect(names(s)).toEqual(["A", "C"]);
    expect(s.get(s.currentId()!)?.name).toBe("C");
  });

  it("removing the current combatant when it was last clamps to the new last one", () => {
    const { s, c } = fight();
    for (let i = 0; i < 3; i++) s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("C");
    s.removeCombatant(c.id);
    expect(s.get(s.currentId()!)?.name).toBe("B");
  });

  it("removing the last remaining combatant clears the turn", () => {
    const s = new CombatStore();
    const a = s.addCombatant(mk("A"));
    s.setInitiativeRoll(a.id, 4);
    s.nextTurn(fixedRoller([]));
    s.removeCombatant(a.id);
    expect(s.currentId()).toBeNull();
    expect(s.entries.length).toBe(0);
  });

  it("adding a combatant does not move the turn and it acts last until it is rolled", () => {
    const { s } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    s.addCombatant(mk("D"));
    expect(s.get(s.currentId()!)?.name).toBe("B");
    expect(names(s)).toEqual(["A", "B", "C", "D"]);
  });

  it("changing an INI roll does not move the turn", () => {
    const { s, c } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    s.setInitiativeRoll(c.id, 20);
    expect(names(s)).toEqual(["C", "A", "B"]);
    expect(s.get(s.currentId()!)?.name).toBe("B");
    // B was last in the order before: the next turn wraps to round 2 and the new first actor C
    s.nextTurn(fixedRoller([]));
    expect(s.round).toBe(2);
    expect(s.get(s.currentId()!)?.name).toBe("C");
  });

  it("rolling only missing initiative keeps the turn (full roll resets it to the first)", () => {
    const s = new CombatStore();
    const a = s.addCombatant(mk("A"));
    const b = s.addCombatant(mk("B"));
    s.setInitiativeRoll(a.id, 9);
    s.setInitiativeRoll(b.id, 2);
    s.nextTurn(fixedRoller([]));
    s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("B");
    const c = s.addCombatant(mk("C"));
    s.rollAllInitiative(fixedRoller([6]), true);
    expect(c.iniRoll).toBe(6);
    expect(s.get(s.currentId()!)?.name).toBe("B");
    s.rollAllInitiative(fixedRoller([1, 1, 1]), false);
    expect(s.currentId()).toBe(s.order()[0].id);
  });

  it("nobody yet + onlyMissing roll leaves the turn unset", () => {
    const s = new CombatStore();
    s.addCombatant(mk("A"));
    s.rollAllInitiative(fixedRoller([4]), true);
    expect(s.currentId()).toBeNull();
  });

  it("nextRound puts the first of the order in charge and clear() resets", () => {
    const { s } = fight();
    s.nextRound(fixedRoller([]));
    expect(s.round).toBe(2);
    expect(s.get(s.currentId()!)?.name).toBe("A");
    s.clear();
    expect(s.currentId()).toBeNull();
    expect(s.round).toBe(1);
  });

  it("undo restores the previous actor (snapshots hold currentId)", () => {
    const { s } = fight();
    s.nextTurn(fixedRoller([]));
    s.nextTurn(fixedRoller([]));
    expect(s.get(s.currentId()!)?.name).toBe("B");
    expect(s.undo()).toBe(true);
    expect(s.get(s.currentId()!)?.name).toBe("A");
    expect(s.undo()).toBe(true);
    expect(s.currentId()).toBeNull();
  });
});

describe("combat turn: persistence and migration", () => {
  it("persists currentId without the undo history", async () => {
    const saved: CombatState[] = [];
    const s = new CombatStore(async (st) => {
      saved.push(st);
    });
    const a = s.addCombatant(mk("A"));
    s.setInitiativeRoll(a.id, 3);
    s.nextTurn(fixedRoller([]));
    await s.flush();
    const last = saved[saved.length - 1];
    expect(last.history).toEqual([]);
    expect(last.currentId).toBe(a.id);
    expect(s.state.history.length).toBeGreaterThan(0);
    expect("turnIndex" in last).toBe(false);
  });

  it("loads a legacy turnIndex save and maps it to the id at that position of the order", () => {
    const { s } = fight();
    s.nextTurn(fixedRoller([])); s.nextTurn(fixedRoller([]));
    const current = JSON.parse(JSON.stringify(s.state)) as CombatState & { turnIndex?: number };
    const legacy = { ...current, turnIndex: 1 } as Partial<CombatState> & { turnIndex: number };
    delete legacy.currentId;
    delete legacy.history;
    const loaded = new CombatStore();
    loaded.load(legacy);
    expect(loaded.get(loaded.currentId()!)?.name).toBe("B");
    expect("turnIndex" in loaded.state).toBe(false);
    expect(loaded.state.currentId).toBe(current.entries.find((e) => e.name === "B")!.id);
  });

  it("legacy turnIndex -1 and out-of-range values become nobody", () => {
    const { s } = fight();
    const base = JSON.parse(JSON.stringify(s.state)) as Record<string, unknown>;
    delete base.currentId;
    for (const turnIndex of [-1, 99]) {
      const l = new CombatStore();
      l.load({ ...base, turnIndex });
      expect(l.currentId()).toBeNull();
    }
  });

  it("migrateCurrentId prefers currentId and drops unknown ids", () => {
    const entries = [{ id: "x", iniBase: 1, iniRoll: 1 }, { id: "y", iniBase: 9, iniRoll: 1 }];
    expect(migrateCurrentId({ currentId: "x", turnIndex: 1 }, entries)).toBe("x");
    expect(migrateCurrentId({ currentId: "gone" }, entries)).toBeNull();
    expect(migrateCurrentId({ turnIndex: 0 }, entries)).toBe("y");
    expect(migrateCurrentId({}, entries)).toBeNull();
  });

  it("load tolerates garbage", () => {
    const s = new CombatStore();
    s.load(null);
    expect(s.currentId()).toBeNull();
    s.load({ version: 1, entries: "nope" });
    expect(s.entries.length).toBe(0);
  });

  it("orderEntries puts unrolled entries last in list order", () => {
    const o = orderEntries([
      { id: "a", iniBase: 5, iniRoll: null },
      { id: "b", iniBase: 5, iniRoll: 2 },
      { id: "c", iniBase: 9, iniRoll: 2 },
    ]);
    expect(o.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });
});

describe("unique combatant names", () => {
  it("uses the lowest free number suffix", () => {
    expect(uniqueCombatName("Wolf", [])).toBe("Wolf");
    expect(uniqueCombatName("Wolf", ["Wolf"])).toBe("Wolf 2");
    expect(uniqueCombatName("Wolf", ["Wolf", "Wolf 2", "Wolf 3"])).toBe("Wolf 4");
    expect(uniqueCombatName("Wolf", ["Wolf", "Wolf 3"])).toBe("Wolf 2");
    expect(uniqueCombatName("Wolf", ["Wolfhund"])).toBe("Wolf");
  });

  it("reuses the gap after remove + add", () => {
    const s = new CombatStore();
    const w1 = s.addCombatant(mk("Wolf"));
    const w2 = s.addCombatant(mk("Wolf"));
    s.addCombatant(mk("Wolf"));
    expect(s.entries.map((e) => e.name)).toEqual(["Wolf", "Wolf 2", "Wolf 3"]);
    s.removeCombatant(w2.id);
    expect(s.addCombatant(mk("Wolf")).name).toBe("Wolf 2");
    s.removeCombatant(w1.id);
    expect(s.addCombatant(mk("Wolf")).name).toBe("Wolf");
  });

  it("explicit name option is numbered the same way", () => {
    const s = new CombatStore();
    s.addCombatant(mk("Ork"), { name: "Anführer" });
    expect(s.addCombatant(mk("Ork"), { name: "Anführer" }).name).toBe("Anführer 2");
  });
});

describe("defense block (one implementation)", () => {
  it("status blocks the matching defense only", () => {
    const lv = effectiveLevels({}, 30, 30);
    expect(defenseBlockFor([makeEffect({ kind: "status", key: "fixiert" })], lv, "VW")).toContain("Fixiert");
    expect(defenseBlockFor([makeEffect({ kind: "status", key: "fixiert" })], lv, "PA")).toBeNull();
    expect(defenseBlockFor([makeEffect({ kind: "status", key: "bewusstlos" })], lv, "PA")).toContain("Bewusstlos");
  });

  it("LeP <= 0 (Schmerz IV from LeP) counts as incapacitated", () => {
    const lv = effectiveLevels({}, 0, 30);
    expect(defenseBlockFor([], lv, "PA")).toBe("handlungsunfähig: kann nicht verteidigen");
    expect(defenseBlockFor([], effectiveLevels({}, 20, 30), "PA")).toBeNull();
  });

  it("store and cockpit logic agree at LeP 0", () => {
    const s = new CombatStore();
    const e = s.addCombatant(mk("Ork"));
    s.setLep(e.id, 0);
    expect(s.defenseBlock(e.id, "PA")).toBe(defenseBlock(s.get(e.id)!, "PA"));
    expect(s.defenseBlock(e.id, "PA")).not.toBeNull();
  });
});

describe("heroes already in the fight", () => {
  it("matches by note path, and by name when the hero has no note", () => {
    const s = new CombatStore();
    const h = s.addCombatant({ ...mk("Held", "hero", 40), sourcePath: "Helden/Held.md" });
    expect(heroInCombat(s.entries, { name: "Held", notePath: "Helden/Held.md" })).toBe(true);
    expect(heroInCombat(s.entries, { name: "Anderer", notePath: "Helden/Anderer.md" })).toBe(false);
    // same name, different note: a different hero
    expect(heroInCombat(s.entries, { name: "Held", notePath: "Helden/Zwilling.md" })).toBe(false);
    expect(heroInCombat(s.entries, { name: "Held" })).toBe(true);
    s.removeCombatant(h.id);
    expect(heroInCombat(s.entries, { name: "Held", notePath: "Helden/Held.md" })).toBe(false);
  });
  it("creatures never count as heroes", () => {
    const s = new CombatStore();
    s.addCombatant({ ...mk("Ork"), sourcePath: "Bestiarium/Ork.md" });
    expect(heroInCombat(s.entries, { name: "Ork", notePath: "Bestiarium/Ork.md" })).toBe(false);
  });
});

describe("internal Obsidian API accessors", () => {
  it("return undefined when the internals are missing", () => {
    expect(internalDraggable({} as never)).toBeUndefined();
    expect(internalDraggable({ dragManager: null } as never)).toBeUndefined();
    expect(internalDraggable({ dragManager: {} } as never)).toBeUndefined();
    expect(viewApplyLayout(null)).toBeUndefined();
    expect(viewApplyLayout({})).toBeUndefined();
  });
  it("return the dragged files and a bound applyLayout when present", () => {
    const file = { path: "Gegner/Ork.md" } as never;
    expect(internalDraggable({ dragManager: { draggable: { file } } } as never)?.file).toBe(file);
    let calls = 0;
    const view = { n: 1, applyLayout() { calls += this.n; } };
    viewApplyLayout(view)?.();
    expect(calls).toBe(1);
  });
});
