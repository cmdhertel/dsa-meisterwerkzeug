import { describe, expect, it } from "vitest";
import { isInFolder, parseTemplatesFolder } from "../src/bestiary/templates";

describe("parseTemplatesFolder", () => {
  it("reads the folder of the core Templates plugin settings", () => {
    expect(parseTemplatesFolder('{"folder":"Vorlagen","dateFormat":"YYYY"}')).toBe("Vorlagen");
    expect(parseTemplatesFolder('{"folder":"/Templates/"}')).toBe("Templates");
  });
  it("returns null without a usable folder", () => {
    expect(parseTemplatesFolder("{}")).toBeNull();
    expect(parseTemplatesFolder('{"folder":""}')).toBeNull();
    expect(parseTemplatesFolder('{"folder":42}')).toBeNull();
    expect(parseTemplatesFolder("null")).toBeNull();
    expect(parseTemplatesFolder("kein json")).toBeNull();
  });
});

describe("isInFolder", () => {
  it("matches notes inside the folder only", () => {
    expect(isInFolder("Vorlagen/SC.md", "Vorlagen")).toBe(true);
    expect(isInFolder("Vorlagen Alt/SC.md", "Vorlagen")).toBe(false);
    expect(isInFolder("Templates/SC.md", "Vorlagen")).toBe(false);
  });
  it("matches nothing without a folder", () => {
    expect(isInFolder("Templates/SC.md", null)).toBe(false);
  });
});
