import { describe, expect, it, vi } from "vitest";
import { TableBus, TableEvent } from "../src/bus";
import { probeAllEventText, probeEventText, signedModifier, ProbeRun } from "../src/probe/logic";
import { castEventText } from "../src/magic/resolve";
import { groupEventText } from "../src/groupprobe/logic";
import { restEventText } from "../src/calendar/rest";

describe("TableBus", () => {
  const ev: TableEvent = { type: "note", text: "x" };
  it("delivers to listeners and supports off", () => {
    const bus = new TableBus();
    const fn = vi.fn();
    const off = bus.on(fn);
    bus.emit(ev);
    off();
    bus.emit(ev);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(ev);
  });
  it("a throwing listener does not break others", () => {
    const bus = new TableBus();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = vi.fn();
    bus.on(() => {
      throw new Error("boom");
    });
    bus.on(ok);
    expect(() => bus.emit(ev)).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe("probeEventText", () => {
  it("formats outcomes and modifiers", () => {
    expect(signedModifier(0)).toBe("");
    expect(signedModifier(-1)).toBe("−1");
    expect(signedModifier(2)).toBe("+2");
    expect(probeEventText("Thorwin", "Klettern", -1, true, 2, null)).toBe("Thorwin: Klettern −1 gelungen, QS 2");
    expect(probeEventText("Godhard", "Sinnesschärfe", 0, false, 0, null)).toBe("Godhard: Sinnesschärfe misslungen");
    expect(probeEventText("Gwyn", "Klettern", 0, true, 4, "success")).toBe("Gwyn: Klettern kritischer Erfolg, QS 4");
    expect(probeEventText("Gwyn", "Klettern", 0, false, 0, "patzer")).toBe("Gwyn: Klettern Patzer");
  });
  it("summarizes all heroes in one line", () => {
    const run = (name: string, success: boolean, qs: number): ProbeRun => ({ subject: { name, attrs: [10, 10, 10], fw: 0, statePenalty: 0 }, result: { success, qs, critical: null } as ProbeRun["result"] });
    expect(probeAllEventText("Sinnesschärfe", 0, [run("Thorwin", true, 2), run("Godhard", false, 0), run("Gwyn", true, 1)])).toBe(
      "Alle Helden: Sinnesschärfe — Thorwin QS 2, Godhard misslungen, Gwyn QS 1",
    );
  });
});

describe("castEventText", () => {
  const base = { input: { name: "Armatrutz", kind: "zauber" as const }, success: true, qs: 3, critical: null, costPaid: 4, energy: "AsP" as const };
  it("formats spells and liturgies", () => {
    expect(castEventText("Thorwin", base as never)).toBe("Thorwin wirkt Armatrutz: gelungen, QS 3, 4 AsP");
    expect(castEventText("Thorwin", { ...base, success: false, qs: 0, costPaid: 2 } as never)).toBe("Thorwin wirkt Armatrutz: misslungen, 2 AsP");
    expect(castEventText("Godhard", { ...base, input: { name: "Heilsegen", kind: "liturgie" }, qs: 2, energy: "KaP" } as never)).toBe("Godhard wirkt Heilsegen: gelungen, QS 2, 4 KaP");
  });
  it("omits unknown cost", () => {
    expect(castEventText("Thorwin", { ...base, costPaid: null } as never)).toBe("Thorwin wirkt Armatrutz: gelungen, QS 3");
  });
});

describe("groupEventText", () => {
  it("strips the blockquote marker and emphasis", () => {
    expect(groupEventText("> Gruppenprobe Sinnesschärfe +2: Alrik QS 2 → 2 QS")).toBe("Gruppenprobe Sinnesschärfe +2: Alrik QS 2 → 2 QS");
    expect(groupEventText("> Sammelprobe **Fährtensuchen**: A QS 2 → 2/10 QS (läuft)")).toBe("Sammelprobe Fährtensuchen: A QS 2 → 2/10 QS (läuft)");
  });
});

describe("restEventText", () => {
  const pool = (before: number, after: number, active = true) => ({ active, roll: 0, mod: 0, gain: after - before, before, after, max: 30 });
  it("lists gains per hero", () => {
    const heroes = [
      { id: "a", name: "Thorwin", lep: pool(10, 14), asp: pool(5, 10), kap: pool(0, 0, false) },
      { id: "b", name: "Godhard", lep: pool(10, 13), asp: pool(0, 0, false), kap: pool(0, 0, false) },
    ];
    expect(restEventText(heroes, 1)).toBe("Rast (Nachtruhe): Thorwin +4 LeP, +5 AsP; Godhard +3 LeP");
    expect(restEventText(heroes, 3)).toMatch(/^Rast \(3 Tage\): /);
  });
});
