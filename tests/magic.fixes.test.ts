import { describe, expect, it } from "vitest";
import { parseMagic, parseMemoryFile } from "../src/magic/parse";
import { parseSpellNote } from "../src/magic/spells";

describe("zauber code modifier", () => {
  it("accepts a typographic minus and an en dash like probe does", () => {
    expect(parseMagic("zauber: Ignifaxius +2")).toMatchObject({ ok: true, spec: { modifier: 2 } });
    expect(parseMagic("zauber: Ignifaxius -2")).toMatchObject({ ok: true, spec: { modifier: -2 } });
    expect(parseMagic("zauber: Ignifaxius −2")).toMatchObject({ ok: true, spec: { modifier: -2 } });
    expect(parseMagic("zauber: Ignifaxius –2")).toMatchObject({ ok: true, spec: { modifier: -2, name: "Ignifaxius" } });
  });
});

describe("spell probe fallback", () => {
  it("unreadable Probe line keeps MU/KL/IN and is flagged", () => {
    const s = parseSpellNote("# Test\n- **Probe:** irgendwas\n", "x", "Test")!;
    expect(s.probe).toEqual(["MU", "KL", "IN"]);
    expect(s.probeFallback).toBe(true);
  });

  it("readable Probe line is not flagged", () => {
    const s = parseSpellNote("# Test\n- **Probe:** KL/IN/CH\n", "x", "Test")!;
    expect(s.probe).toEqual(["KL", "IN", "CH"]);
    expect(s.probeFallback).toBe(false);
  });
});

describe("zauber-eigenschaften.json content", () => {
  it("valid object is loaded", () => {
    expect(parseMemoryFile('{"ignifaxius":{"probe":["MU","KL","IN"],"kosten":4}}')).toEqual({ ignifaxius: { probe: ["MU", "KL", "IN"], kosten: 4 } });
  });

  it("blank file means empty memory", () => {
    expect(parseMemoryFile("")).toEqual({});
    expect(parseMemoryFile("  \n")).toEqual({});
  });

  it("broken JSON is null (never overwritten)", () => {
    expect(parseMemoryFile('{"ignifaxius":{"probe":["MU"')).toBeNull();
    expect(parseMemoryFile("{oops}")).toBeNull();
  });

  it("non-object JSON is null", () => {
    expect(parseMemoryFile("[]")).toBeNull();
    expect(parseMemoryFile("null")).toBeNull();
    expect(parseMemoryFile("42")).toBeNull();
  });
});
