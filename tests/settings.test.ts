import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, folderPath, normalizeSettingPath, resolveSettings } from "../src/settingsData";

describe("normalizeSettingPath", () => {
  it("drops leading and trailing slashes", () => {
    expect(normalizeSettingPath("Bestiarium/", "X")).toBe("Bestiarium");
    expect(normalizeSettingPath("/DSA/Helden//", "X")).toBe("DSA/Helden");
  });

  it("unifies backslashes and collapses repeated slashes", () => {
    expect(normalizeSettingPath("DSA\\Helden\\\\_Daten", "X")).toBe("DSA/Helden/_Daten");
    expect(normalizeSettingPath("DSA//Regeln///Zauber", "X")).toBe("DSA/Regeln/Zauber");
  });

  it("trims whitespace around the path", () => {
    expect(normalizeSettingPath("  DSA/Kampagnen  ", "X")).toBe("DSA/Kampagnen");
  });

  it("keeps spaces and dots inside names", () => {
    expect(normalizeSettingPath("30 - Bestiarium/Sub.Ordner", "X")).toBe("30 - Bestiarium/Sub.Ordner");
  });

  it("returns the fallback for blank or slash-only input", () => {
    expect(normalizeSettingPath("", "DSA/Bestiarium")).toBe("DSA/Bestiarium");
    expect(normalizeSettingPath("   ", "DSA/Bestiarium")).toBe("DSA/Bestiarium");
    expect(normalizeSettingPath("/", "DSA/Bestiarium")).toBe("DSA/Bestiarium");
    expect(normalizeSettingPath("", "")).toBe("");
  });
});

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
