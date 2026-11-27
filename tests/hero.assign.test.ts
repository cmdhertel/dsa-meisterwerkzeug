import { describe, expect, it } from "vitest";
import { assignmentWarnings, autoCandidate, chooseDataFileName, findCandidates, ExistingHeroNote } from "../src/hero/assign";

const hero = { uid: "uid-thorwin-1234", name: "Thorwin Eichhaus" };
const n = (basename: string, uid?: string): ExistingHeroNote => ({ path: `H/${basename}.md`, basename, uid });
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_");

describe("findCandidates", () => {
  it("uid match is automatic and first", () => {
    const c = findCandidates(hero, [n("Gwyn"), n("Anderer Name", hero.uid), n("Thorwin Eichhaus")]);
    expect(c[0]).toMatchObject({ reason: "uid", auto: true });
    expect(c[0].note.basename).toBe("Anderer Name");
    expect(c.find((x) => x.reason === "name")?.auto).toBe(false);
    expect(c).toHaveLength(3);
  });
  it("name match is automatic without uid match", () => {
    const c = findCandidates(hero, [n("Gwyn"), n("thorwin eichhaus")]);
    expect(autoCandidate(c)).toMatchObject({ reason: "name" });
    expect(c.map((x) => x.reason)).toEqual(["name", "manual"]);
  });
  it("no match: all notes manual, none preselected", () => {
    const c = findCandidates(hero, [n("Gwyn"), n("Alrik")]);
    expect(autoCandidate(c)).toBeUndefined();
    expect(c.map((x) => x.note.basename)).toEqual(["Alrik", "Gwyn"]);
    expect(c.every((x) => x.reason === "manual")).toBe(true);
  });
});

describe("assignmentWarnings", () => {
  it("no warnings for a clean match", () => {
    expect(assignmentWarnings(hero, n("Thorwin Eichhaus", hero.uid))).toEqual([]);
    expect(assignmentWarnings(hero, n("Thorwin Eichhaus"))).toEqual([]);
  });
  it("manual assignment with name mismatch", () => {
    const w = assignmentWarnings(hero, n("Gwyn der Wanderer"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("Name in der Notiz: Gwyn der Wanderer – Name im Export: Thorwin Eichhaus");
  });
  it("note linked to another uid", () => {
    const w = assignmentWarnings(hero, n("Gwyn", "other-uid"));
    expect(w.some((x) => x.includes("bereits mit einem anderen Heldenschmiede-Helden verknüpft"))).toBe(true);
    expect(w.some((x) => x.startsWith("Name in der Notiz"))).toBe(true);
  });
  it("warns when another note already carries the export's uid", () => {
    const a = n("Thorwin Eichhaus", hero.uid);
    const w = assignmentWarnings(hero, n("Gwyn"), [a, n("Gwyn")]);
    expect(w.some((x) => x.includes("Thorwin Eichhaus") && x.includes("bereits mit diesem Export"))).toBe(true);
  });
});

describe("chooseDataFileName", () => {
  it("reuses the file with the same uid", () => {
    expect(chooseDataFileName(hero, "Gwyn", { "Alt.dsahero.json": hero.uid }, safe)).toBe("Alt.dsahero.json");
  });
  it("uses hero name when free (unchanged behaviour)", () => {
    expect(chooseDataFileName(hero, "Gwyn", {}, safe)).toBe("Thorwin Eichhaus.dsahero.json");
  });
  it("does not overwrite another hero's file", () => {
    expect(chooseDataFileName(hero, "Gwyn", { "Thorwin Eichhaus.dsahero.json": "x" }, safe)).toBe("Gwyn.dsahero.json");
    expect(
      chooseDataFileName(hero, "Gwyn", { "Thorwin Eichhaus.dsahero.json": "x", "Gwyn.dsahero.json": "y" }, safe),
    ).toBe("Gwyn (uid-thor).dsahero.json");
  });
});
