import { describe, expect, it } from "vitest";
import { FightTracker } from "../src/regie/fight";
import { renderMitschrift } from "../src/regie/journal";
import { activateScene, addEntry, newRun, startSession } from "../src/regie/run";
import { normalizeRegieData, renameInData } from "../src/regie/state";
import {
  actionLabel, applyPrefix, combatEndText, combatStartText, compareScenes, groupNames, imageTarget, journalStats, linkList,
  meaningfulBody, naturalCompare, nextScenePath, parseSceneLabel, stripFrontmatterAndH1,
} from "../src/regie/text";

const running = (p = "s.md") => startSession(newRun(p), 1000);

describe("scene labels and order", () => {
  it("parses prefixes", () => {
    expect(parseSceneLabel("Szene 03 - Der Eid")).toEqual({ number: "3", label: "Der Eid" });
    expect(parseSceneLabel("Szene 0: Lotsen")).toEqual({ number: "0", label: "Lotsen" });
    expect(parseSceneLabel("Ankunft")).toEqual({ number: null, label: "Ankunft" });
    expect(parseSceneLabel("Szene 4 -").label).toBe("Szene 4 -");
  });
  it("sorts naturally and by position", () => {
    expect(naturalCompare("Szene 2", "Szene 10")).toBeLessThan(0);
    expect(compareScenes({ position: 2, name: "b" }, { position: 1, name: "z" })).toBeGreaterThan(0);
    expect(compareScenes({ position: null, name: "a" }, { position: 9, name: "z" })).toBeGreaterThan(0);
    expect(compareScenes({ position: null, name: "Szene 2" }, { position: null, name: "Szene 10" })).toBeLessThan(0);
  });
  it("finds the next unplayed scene", () => {
    const order = ["a", "b", "c"];
    let r = running();
    expect(nextScenePath(order, r)).toBe("a");
    r = activateScene(r, "a", "A", 2000);
    expect(nextScenePath(order, r)).toBe("b");
    r = activateScene(r, "c", "C", 3000);
    expect(nextScenePath(order, r)).toBeNull();
  });
});

describe("text helpers", () => {
  it("drops template placeholders", () => {
    expect(meaningfulBody("*Hinweis*\n- \n> \n![[x.base]]")).toBeNull();
    expect(meaningfulBody("*Hinweis*\nEcht")).toBe("Echt");
    expect(meaningfulBody(null)).toBeNull();
  });
  it("strips frontmatter and H1", () => {
    expect(stripFrontmatterAndH1("---\na: 1\n---\n\n# Titel\n\nText")).toBe("Text");
    expect(stripFrontmatterAndH1("---\r\na: 1\r\n---\r\nText")).toBe("Text");
  });
  it("handles links and images", () => {
    expect(linkList(["[[A|x]]", [["[[B#h]]"]], "C"])).toEqual(["A", "B", "C"]);
    expect(imageTarget("[[a.png|x]]")).toBe("a.png");
    expect(imageTarget("path/a.png")).toBe("path/a.png");
    expect(imageTarget(["[[a.png]] ### n"])).toBe("a.png");
    expect(imageTarget(5)).toBeNull();
  });
  it("labels actions", () => {
    expect(actionLabel({ kind: "probe", raw: "probe: Klettern -1" })).toBe("Klettern −1");
    expect(actionLabel({ kind: "zauber", raw: "zauber: Ignifaxius +2 @Thorwin" })).toBe("Ignifaxius +2 (Thorwin)");
  });
  it("applies capture prefixes", () => {
    expect(applyPrefix("!Wir gehen", "notiz")).toEqual({ kind: "entscheidung", text: "Wir gehen" });
    expect(applyPrefix("$ 5 Dukaten", "notiz")).toEqual({ kind: "beute", text: "5 Dukaten" });
    expect(applyPrefix("plain", "faden")).toEqual({ kind: "faden", text: "plain" });
  });
  it("summarises combat", () => {
    expect(groupNames(["Wolf", "Wolf 2", "Gardist"])).toBe("2× Wolf, Gardist");
    expect(combatStartText(["Wolf"])).toBe("Kampf begonnen: Wolf");
    expect(combatEndText(1, [])).toBe("Kampf beendet nach 1 Kampfrunde");
    expect(combatEndText(3, ["Wolf", "Wolf 2"])).toBe("Kampf beendet nach 3 Kampfrunden; gefallen: 2× Wolf");
  });
});

describe("state data", () => {
  it("normalizes garbage", () => {
    expect(normalizeRegieData(null).runs).toEqual({});
    expect(normalizeRegieData({ lastSession: 3, runs: { "s.md": 5 } }).runs["s.md"].journal).toEqual([]);
  });
  it("renames runs and scenes", () => {
    let r = activateScene(running("s.md"), "sc.md", "T", 2000);
    const data = { version: 1 as const, lastSession: "s.md", runs: { "s.md": r } };
    const a = renameInData(data, "s.md", "n.md");
    expect(a.lastSession).toBe("n.md");
    expect(a.runs["n.md"].sessionPath).toBe("n.md");
    const b = renameInData(data, "sc.md", "sc2.md");
    expect(b.runs["s.md"].activeScene).toBe("sc2.md");
    expect(Object.keys(b.runs["s.md"].scenes)).toEqual(["sc2.md"]);
  });
});

describe("journal stats", () => {
  it("does not count 'Kampf beendet' as a fight", () => {
    let r = activateScene(running(), "sc.md", "T", 2000);
    r = addEntry(r, { kind: "kampf", text: "Kampf begonnen: Wolf" }, 3000);
    r = addEntry(r, { kind: "kampf", text: "Kampf beendet nach 2 Kampfrunden" }, 4000);
    r = addEntry(r, { kind: "probe", text: "Klettern" }, 5000);
    r = addEntry(r, { kind: "geheimnis", text: "x" }, 6000);
    expect(journalStats(r)).toEqual({ proben: 1, kaempfe: 1, enthuellt: 1 });
    expect(renderMitschrift(r, {})).toBeTypeOf("string");
  });
});

describe("FightTracker", () => {
  const wolf = (down = false) => ({ name: "Wolf", creature: true, down });
  const hero = { name: "Thorwin", creature: false, down: false };
  it("starts only with creatures and ends on clear", () => {
    const t = new FightTracker();
    expect(t.update([hero], 1)).toBeNull();
    expect(t.inFight).toBe(false);
    expect(t.update([hero, wolf(), { ...wolf(), name: "Wolf 2" }], 1)).toBeNull();
    expect(t.inFight).toBe(true);
    expect(t.startText()).toBe("Kampf begonnen: 2× Wolf");
    t.update([hero, wolf(true), { ...wolf(), name: "Wolf 2" }], 3);
    expect(t.update([], 3)).toBe("Kampf beendet nach 3 Kampfrunden; gefallen: Wolf");
    expect(t.inFight).toBe(false);
    expect(t.update([], 1)).toBeNull();
  });
});
