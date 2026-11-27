import { describe, expect, it } from "vitest";
import { safeFileName } from "../src/fileName";

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
