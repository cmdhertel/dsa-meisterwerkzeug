import { describe, expect, it } from "vitest";
import { insertBelow, nthLineWithCode } from "../src/groupprobe/logic";
import { parseAttrValue, parseGroupProbe } from "../src/groupprobe/parse";

const RAW = "gruppenprobe: Sinnesschärfe";
const RESULT_A = "> Gruppenprobe Sinnesschärfe: A QS 2 → 2 QS";
const RESULT_B = "> Gruppenprobe Sinnesschärfe: B QS 3 → 3 QS";

describe("insertBelow with a known source line", () => {
  const text = ["# Notiz", "", `Erste: \`${RAW}\``, "Text", `Zweite: \`${RAW}\``, "Ende"].join("\n");

  it("inserts under the probe at the given line, not under the first copy", () => {
    const out = insertBelow(text, RAW, RESULT_B, 4)!.split("\n");
    expect(out.indexOf(RESULT_B)).toBe(out.findIndex((l) => l.startsWith("Zweite")) + 1);
    expect(out.includes(RESULT_B) && out[2].startsWith("Erste")).toBe(true);
    expect(out[3]).toBe("Text");
  });

  it("falls back to the first copy when no line is known", () => {
    const out = insertBelow(text, RAW, RESULT_A)!.split("\n");
    expect(out[3]).toBe(RESULT_A);
  });

  it("falls back to the first copy when the given line does not contain the code", () => {
    const out = insertBelow(text, RAW, RESULT_A, 0)!.split("\n");
    expect(out[3]).toBe(RESULT_A);
  });

  it("replaces an existing result of the same kind below the chosen probe", () => {
    const once = insertBelow(text, RAW, RESULT_B, 4)!;
    const twice = insertBelow(once, RAW, "> Gruppenprobe Sinnesschärfe: B QS 5 → 5 QS", 4)!.split("\n");
    expect(twice.filter((l) => l.startsWith("> Gruppenprobe")).length).toBe(1);
    expect(twice).toContain("> Gruppenprobe Sinnesschärfe: B QS 5 → 5 QS");
  });
});

describe("nthLineWithCode", () => {
  const section = ["Erste `gruppenprobe: X`", "Mitte", `Zweite \`gruppenprobe: X\` und \`gruppenprobe: X\``];

  it("finds the n-th occurrence (0-based), counting several on one line", () => {
    expect(nthLineWithCode(section.join("\n"), "gruppenprobe: X", 0)).toBe(0);
    expect(nthLineWithCode(section.join("\n"), "gruppenprobe: X", 1)).toBe(2);
    expect(nthLineWithCode(section.join("\n"), "gruppenprobe: X", 2)).toBe(2);
    expect(nthLineWithCode(section.join("\n"), "gruppenprobe: X", 3)).toBeNull();
  });
});

describe("parseAttrValue", () => {
  it("accepts whole numbers", () => {
    expect(parseAttrValue("12")).toBe(12);
    expect(parseAttrValue(" 0 ")).toBe(0);
  });

  it("rejects empty and garbage input (no silent default)", () => {
    expect(parseAttrValue("")).toBeNull();
    expect(parseAttrValue("   ")).toBeNull();
    expect(parseAttrValue("abc")).toBeNull();
    expect(parseAttrValue("1.5")).toBeNull();
    expect(parseAttrValue("-3")).toBeNull();
  });
});

describe("group probe parser warnings", () => {
  it("no warnings for a clean gruppenprobe", () => {
    const r = parseGroupProbe("gruppenprobe: Sinnesschärfe | ab 3 QS: Gut | sonst: Schlecht");
    expect(r.ok && r.spec.warnings).toEqual([]);
  });

  it("warns that Sammel outcome keys are ignored for a gruppenprobe", () => {
    const r = parseGroupProbe("gruppenprobe: Sinnesschärfe | geschafft: Ja");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.warnings.length).toBe(1);
  });

  it("warns that Gruppen outcome keys are ignored for a sammelprobe", () => {
    const r = parseGroupProbe("sammelprobe: Sinnesschärfe | ab 3 QS: Gut | sonst: Schlecht");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.warnings.length).toBe(2);
  });

  it("warns about empty outcome texts", () => {
    const r = parseGroupProbe("gruppenprobe: Sinnesschärfe | ab 3 QS:  | sonst: ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec.warnings.length).toBe(2);
  });

  it("unknown sections are still a parse error", () => {
    expect(parseGroupProbe("gruppenprobe: Sinnesschärfe | quatsch: x").ok).toBe(false);
  });
});
