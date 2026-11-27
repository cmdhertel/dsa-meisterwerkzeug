import { describe, expect, it } from "vitest";
import { addStubs, collectKeys, parseMapping, serializeMapping } from "../src/hero/mapping";

describe("parseMapping string entries", () => {
  it("accepts a bare string as { name }", () => {
    const m = parseMapping(JSON.stringify({ zauber: { "534": "Feuerball" } }));
    expect(m?.zauber["534"]).toEqual({ name: "Feuerball" });
  });
  it("gives weapons and armor their full shape", () => {
    const m = parseMapping(JSON.stringify({ waffenNahkampf: { "1": "Dolch" }, ruestung: { "2": "Kettenhemd" } }));
    expect(m?.waffenNahkampf["1"]).toMatchObject({ name: "Dolch", kampftechnik: "", tp: "", atMod: 0 });
    expect(m?.ruestung["2"]).toEqual({ name: "Kettenhemd", rs: 0, be: 0 });
  });
  it("ignores values that are neither string nor object", () => {
    const m = parseMapping(JSON.stringify({ zauber: { "1": 5, "2": null } }));
    expect(m?.zauber).toEqual({});
  });
});

describe("string entries survive the import round trip", () => {
  it("a hand-written name is not replaced by a stub", () => {
    const m = parseMapping(JSON.stringify({ zauber: { "534": "Feuerball" } }))!;
    const r = addStubs(m, { ...collectKeys({}), zauber: [534, 535] });
    expect(r.added).toEqual(["zauber/535"]);
    expect(r.mapping.zauber["534"]).toEqual({ name: "Feuerball" });
  });
  it("serialization keeps the name", () => {
    const m = parseMapping(JSON.stringify({ sprachen: { "7": "Garethi" } }))!;
    const again = parseMapping(serializeMapping(addStubs(m, collectKeys({})).mapping))!;
    expect(again.sprachen["7"]).toEqual({ name: "Garethi" });
  });
});
