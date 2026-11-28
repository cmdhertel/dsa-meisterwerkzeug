import { describe, expect, it } from "vitest";
import { safeFileName } from "../src/fileName";
import { valueText } from "../src/valueText";

describe("safeFileName", () => {
  it("keeps ordinary names", () => {
    expect(safeFileName("Alrik")).toBe("Alrik");
    expect(safeFileName("Dr. Foo")).toBe("Dr. Foo");
  });
  it("strips leading dots so the note is not hidden", () => {
    expect(safeFileName(".hidden")).toBe("hidden");
    expect(safeFileName("..secret")).toBe("secret");
    expect(safeFileName(" .x ")).toBe("x");
  });
  it("replaces invalid characters", () => {
    expect(safeFileName("a/b:c")).toBe("a b c");
  });
  it("falls back when nothing is left", () => {
    expect(safeFileName("...")).toBe("Held");
    expect(safeFileName("   ")).toBe("Held");
  });
});

describe("valueText", () => {
  it("keeps strings and stringifies scalars", () => {
    expect(valueText("Ork")).toBe("Ork");
    expect(valueText(3)).toBe("3");
    expect(valueText(false)).toBe("false");
  });
  it("maps null/undefined to an empty string", () => {
    expect(valueText(null)).toBe("");
    expect(valueText(undefined)).toBe("");
  });
  it("joins lists like String() and writes objects as JSON instead of [object Object]", () => {
    expect(valueText(["a", 2, ["b"]])).toBe("a,2,b");
    expect(valueText({ a: 1 })).toBe('{"a":1}');
  });
});
