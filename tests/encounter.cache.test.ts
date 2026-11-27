import { describe, expect, it } from "vitest";
import { singleSlotCache } from "../src/encounter/cache";

describe("singleSlotCache", () => {
  it("builds once per key and rebuilds when the key changes", () => {
    const cached = singleSlotCache<number[]>();
    let builds = 0;
    const make = () => {
      builds++;
      return [builds];
    };
    const a = cached("rev1|Bestiarium", make);
    expect(cached("rev1|Bestiarium", make)).toBe(a);
    expect(builds).toBe(1);
    const b = cached("rev2|Bestiarium", make);
    expect(b).not.toBe(a);
    expect(builds).toBe(2);
    expect(cached("rev2|Bestiarium", make)).toBe(b);
    expect(builds).toBe(2);
  });
});
