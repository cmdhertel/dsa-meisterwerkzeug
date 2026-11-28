import { describe, expect, it } from "vitest";
import {
  advanceDurations, defenseBlockedReason, effectiveLevels, fixedRoller, makeEffect, normalizeEffects, rollTicks, statusModifiers,
  timedStateLevels, totalStatePenalty, effectLabel,
} from "../src/engine";
import { CombatStore } from "../src/combat/store";
import type { Combatant } from "../src/model";
import { buildAttackParams, effectInfo, previewAttack } from "../src/cockpit/logic";
import { SHARE_DEFAULTS, buildPlayerView, optionsFromSettings } from "../src/share/viewModel";

const mk = (name: string, kind: "hero" | "creature" = "creature", lepMax = 30): Combatant => ({
  name, kind, sourcePath: "", lepMax, iniBase: 10, rs: 0, vw: 5,
  weapons: [{ name: "Säbel", kind: "melee", at: 12, pa: 8, fk: null, tp: "1W6+4", tpNote: "", rw: "mittel", rwRanges: null, lz: null, raw: "", partial: false }],
  needsManual: [],
});

describe("Zustände aus Effekten", () => {
  it("summiert gespeicherte, zeitliche und LeP-Schmerz-Stufen und deckelt bei -5", () => {
    const fx = [makeEffect({ kind: "zustand", key: "furcht", level: 2 }), makeEffect({ kind: "zustand", key: "belastung", level: 1 })];
    const lv = effectiveLevels({ furcht: 1, schmerz: 1 }, 20, 40, timedStateLevels(fx)); // LeP-Schmerz II + 1 manuell
    expect(lv.furcht).toBe(3);
    expect(lv.belastung).toBe(1);
    expect(lv.schmerz).toBe(3);
    expect(totalStatePenalty(lv)).toBe(5);
    expect(totalStatePenalty({ furcht: 4, schmerz: 4 } as never)).toBe(5);
  });
});

describe("Status", () => {
  it("Liegend und Eingeengt nach Reichweite", () => {
    const l = [makeEffect({ kind: "status", key: "liegend" })];
    expect(statusModifiers(l, "at")).toEqual([{ label: "Status Liegend", value: -4 }]);
    expect(statusModifiers(l, "pa")[0].value).toBe(-2);
    const e = [makeEffect({ kind: "status", key: "eingeengt" })];
    expect(statusModifiers(e, "at", { reach: "kurz" })).toEqual([]);
    expect(statusModifiers(e, "at", { reach: "lang" })[0].value).toBe(-8);
    expect(statusModifiers(e, "pa", { reach: "mittel" })[0].value).toBe(-4);
  });
  it("Verteidigung blockiert", () => {
    expect(defenseBlockedReason([makeEffect({ kind: "status", key: "bewusstlos" })], "PA")).toContain("Bewusstlos");
    expect(defenseBlockedReason([makeEffect({ kind: "status", key: "fixiert" })], "VW")).toContain("Fixiert");
    expect(defenseBlockedReason([makeEffect({ kind: "status", key: "fixiert" })], "PA")).toBeNull();
  });
});

describe("Ticks und Ablauf", () => {
  it("würfelt Schaden und Heilung (Heilung bis LeP-Max)", () => {
    const fx = [
      makeEffect({ kind: "frei", name: "Gift", tick: { dice: "1W3", mode: "damage" } }),
      makeEffect({ kind: "frei", name: "Regeneration", tick: { dice: "1W6", mode: "heal" } }),
    ];
    const r = rollTicks(fx, 28, 30, fixedRoller([2, 6]));
    expect(r.results.map((x) => x.lepDelta)).toEqual([-2, 4]); // 26 -> heal capped at 30
    expect(r.lepDelta).toBe(2);
  });
  it("Dauer sinkt, 0 läuft ab, unbegrenzt bleibt", () => {
    const a = makeEffect({ kind: "zustand", key: "furcht", level: 2, duration: 1 });
    const b = makeEffect({ kind: "status", key: "liegend", duration: 3 });
    const c = makeEffect({ kind: "status", key: "blind" });
    const r = advanceDurations([a, b, c]);
    expect(r.expired.map((x) => x.id)).toEqual([a.id]);
    expect(r.remaining.map((x) => x.duration)).toEqual([2, null]);
  });
});

describe("Migration", () => {
  it("normalizeEffects verwirft Müll, füllt Defaults", () => {
    const r = normalizeEffects([null, { kind: "status", key: "nope" }, { kind: "zustand", key: "furcht", level: 9 }, { kind: "frei", name: "X" }]);
    expect(r).toHaveLength(2);
    expect(r[0].level).toBe(4);
    expect(effectLabel(r[0])).toBe("Furcht IV");
    expect(r[1].duration).toBeNull();
  });
  it("load() ergänzt effects bei altem Stand", () => {
    const s = new CombatStore();
    s.addCombatant(mk("Ork"));
    const old = JSON.parse(JSON.stringify(s.state)) as { entries: Record<string, unknown>[] };
    for (const e of old.entries) delete e.effects;
    const t = new CombatStore();
    t.load(old);
    expect(t.entries[0].effects).toEqual([]);
  });
});

describe("Store", () => {
  const setup = () => {
    const s = new CombatStore();
    const a = s.addCombatant(mk("Held", "hero"));
    const w = s.addCombatant(mk("Wolf"));
    s.setInitiativeRoll(a.id, 6);
    s.setInitiativeRoll(w.id, 1);
    return { s, a, w };
  };
  it("Status-Duplikat erneuert, Zustand stapelt", () => {
    const { s, w } = setup();
    s.addEffect(w.id, { kind: "status", key: "liegend", duration: 2 });
    s.addEffect(w.id, { kind: "status", key: "liegend", duration: 5 });
    expect(s.get(w.id)!.effects).toHaveLength(1);
    expect(s.get(w.id)!.effects[0].duration).toBe(5);
    s.addEffect(w.id, { kind: "zustand", key: "furcht", level: 1 });
    s.addEffect(w.id, { kind: "zustand", key: "furcht", level: 1 });
    expect(s.levels(w.id)!.furcht).toBe(2);
  });
  it("Tick beim Zugbeginn, Ablauf beim Rundenwechsel, rückgängig machbar", () => {
    const { s, w } = setup();
    s.addEffect(w.id, { kind: "zustand", key: "furcht", level: 2, duration: 1 });
    s.addEffect(w.id, { kind: "frei", name: "Gift", duration: 5, tick: { dice: "1W3", mode: "damage" } });
    const msgs: string[] = [];
    s.on((ev) => msgs.push(...(ev.messages ?? [])));
    s.nextTurn(fixedRoller([])); // Held (no ticks)
    s.nextTurn(fixedRoller([2])); // Wolf is now current -> Gift ticks
    expect(s.get(w.id)!.lep).toBe(28);
    expect(msgs.join("|")).toContain("Gift");
    s.undo();
    expect(s.get(w.id)!.lep).toBe(30);
    s.nextTurn(fixedRoller([2]));
    expect(s.get(w.id)!.lep).toBe(28);
    msgs.length = 0;
    s.nextRound(fixedRoller([3])); // hero first: no tick; furcht expires
    expect(msgs.some((m) => m.includes("Furcht II bei Wolf endet"))).toBe(true);
    expect(s.get(w.id)!.effects.map((e) => e.name)).toEqual(["Gift"]);
    expect(s.get(w.id)!.effects[0].duration).toBe(4);
    s.undo();
    expect(s.get(w.id)!.effects).toHaveLength(2);
    expect(s.round).toBe(1);
  });
});

describe("Cockpit-Auflösung", () => {
  it("Status-Modifikatoren fließen in Angriff und Vorschau, Bewusstlos blockiert Verteidigung", () => {
    const s = new CombatStore();
    const a = s.addCombatant(mk("A"));
    const d = s.addCombatant(mk("D"));
    s.addEffect(a.id, { kind: "status", key: "liegend" });
    s.addEffect(d.id, { kind: "status", key: "bewusstlos" });
    const input = {
      kind: "nahkampf" as const, attacker: s.get(a.id)!, defender: s.get(d.id)!, value: 12, tp: "1W6+4", atMod: 0, tpMod: 0, rangedMod: 0,
      defense: { kind: "PA" as const, value: 8 }, defenseMod: 0,
    };
    const p = buildAttackParams(input);
    expect(p.attacker.modifiers?.some((m) => m.label === "Status Liegend" && m.value === -4)).toBe(true);
    expect(p.defender.defense).toBeNull();
    expect(effectInfo(input).defenseBlocked).toBeTruthy();
    expect(previewAttack(input)).toBeTruthy();
  });
});

describe("Spieleransicht", () => {
  it("zeigt Effektnamen, aber nicht geheime, verborgene oder Notizen", () => {
    const s = new CombatStore();
    const a = s.addCombatant(mk("Held", "hero"));
    const w = s.addCombatant(mk("Wolf"));
    const h = s.addCombatant(mk("Geist"));
    s.setInitiativeRoll(a.id, 1);
    s.addEffect(w.id, { kind: "zustand", key: "furcht", level: 2, source: "Zauber", gmNote: "geheim" });
    s.addEffect(w.id, { kind: "frei", name: "Falle", secret: true });
    s.addEffect(h.id, { kind: "status", key: "liegend" });
    s.patchEntry(h.id, "x", { hidden: true });
    const v = buildPlayerView(s.state, optionsFromSettings(SHARE_DEFAULTS));
    const json = JSON.stringify(v);
    const wolf = v.rows.find((r) => r.name.includes("Wolf") || r.name.startsWith("Gegner"))!;
    expect(wolf.effects).toEqual(["Furcht II"]);
    expect(json).not.toContain("geheim");
    expect(json).not.toContain("Falle");
    expect(json).not.toContain("Zauber");
    expect(v.rows.every((r) => r.name !== "Geist")).toBe(true);
  });
});
