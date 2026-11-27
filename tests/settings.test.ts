import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, folderPath, resolveSettings } from "../src/settingsData";

describe("resolveSettings", () => {
  it("fresh install gets the neutral defaults", () => {
    const s = resolveSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.spellFolder).toBe("DSA/Regeln/Zauber");
    expect(s.heroTemplate).toBe("");
  });

  it("settings saved by 0.1.0 keep the formerly hard-coded paths for new keys", () => {
    const s = resolveSettings({ bestiaryFolder: "Monster" });
    expect(s.bestiaryFolder).toBe("Monster");
    expect(s.spellFolder).toBe("20 - Regeln/Zauber");
    expect(s.liturgyFolder).toBe("20 - Regeln/Liturgien");
    expect(s.campaignsFolder).toBe("Campaigns");
    expect(s.heroTemplate).toBe("Templates/SC.md");
    expect(s.hitZones).toBe(false);
  });

  it("explicitly saved values always win", () => {
    const s = resolveSettings({ spellFolder: "Regeln/Magie", heroTemplate: "" });
    expect(s.spellFolder).toBe("Regeln/Magie");
    expect(s.heroTemplate).toBe("");
  });
});

describe("folderPath", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(folderPath(" DSA/Kampagnen// ")).toBe("DSA/Kampagnen");
  });
});
