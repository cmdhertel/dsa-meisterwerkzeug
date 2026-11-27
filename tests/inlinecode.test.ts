import { describe, expect, it } from "vitest";
import { groupEventText } from "../src/groupprobe/logic";
import { inlineCodeSpans } from "../src/probe/parse";

describe("inline code spans (no lookbehind)", () => {
  it("finds single-backtick code", () => {
    expect(inlineCodeSpans("a `probe: X` b")).toEqual([{ code: "probe: X", from: 2, to: 12 }]);
    expect(inlineCodeSpans("`a` `b`").map((s) => s.code)).toEqual(["a", "b"]);
  });

  it("ignores double-backtick code", () => {
    expect(inlineCodeSpans("``x``")).toEqual([]);
    expect(inlineCodeSpans("``probe: x``")).toEqual([]);
  });

  it("ignores a single backtick next to a backtick", () => {
    expect(inlineCodeSpans("`a``b`")).toEqual([]);
  });

  it("matches exactly like the former lookbehind regex", () => {
    const old = /(?<!`)`([^`\n]+)`(?!`)/g;
    const samples = ["a `x` b", "``x``", "``` `x` ```", "`a``b`", "`a` `b`", "x`y`z", "`` `x` ``", "`a`b`c`", "``a` b`", "`", "``", "` `", "`x", "x`", "`x``"];
    for (const line of samples) {
      const expected: { code: string; from: number; to: number }[] = [];
      let m: RegExpExecArray | null;
      old.lastIndex = 0;
      while ((m = old.exec(line))) expected.push({ code: m[1], from: m.index, to: m.index + m[0].length });
      expect(inlineCodeSpans(line), line).toEqual(expected);
    }
  });

  it("offsets cover the backticks", () => {
    const line = "x`y`z";
    const [s] = inlineCodeSpans(line);
    expect(line.slice(s.from, s.to)).toBe("`y`");
  });
});

describe("groupEventText emphasis stripping", () => {
  it("drops quote marker and emphasis", () => {
    expect(groupEventText("> **Gruppenprobe** *Sinnesschärfe*: __QS__ 2")).toBe("Gruppenprobe Sinnesschärfe: QS 2");
  });

  it("keeps underscores between word characters", () => {
    expect(groupEventText("> Talent snake_case _kursiv_")).toBe("Talent snake_case kursiv");
  });
});
