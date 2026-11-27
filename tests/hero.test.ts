import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CombatStore } from "../src/combat/store";
import { fixedRoller } from "../src/engine";
import { applyBlock, BLOCK_END, BLOCK_START, renderSpielwerte } from "../src/hero/block";
import { cleanHeroJson } from "../src/hero/clean";
import { diffHeroes, frontmatterValues } from "../src/hero/diff";
import { TALENT_BY_KEY } from "../src/hero/keys";
import { addStubs, collectKeys, emptyMapping, parseMapping, serializeMapping } from "../src/hero/mapping";
import { heroToCombatant, parseHero, talentValue, validateHeroJson, HeroJson } from "../src/hero/model";

const file = process.env.DSA_HERO_JSON ? path.resolve(process.env.DSA_HERO_JSON) : path.resolve(__dirname, "../../../thorwin.dsahero.json");
const have = fs.existsSync(file);
const load = () => JSON.parse(fs.readFileSync(file, "utf8")) as HeroJson;

describe("key table", () => {
  it("has 59 talents with confirmed keys", () => {
    expect(TALENT_BY_KEY.length).toBe(59);
    expect(TALENT_BY_KEY[35].name).toBe("Magiekunde");
    expect(TALENT_BY_KEY[39].name).toBe("Sagen & Legenden");
  });
});

describe.skipIf(!have)("thorwin import (read-only)", () => {
  it("validates and parses", () => {
    const j = load();
    expect(validateHeroJson(j)).toBeNull();
    const h = parseHero(j);
    expect(h.uid).toBe("00000000-0000-4000-8000-000000000000");
    expect(h.ini).toBe(10);
    expect(h.aw).toBe(5);
    expect(h.gs).toBe(7);
    expect(h.lep.max).toBe(23);
    expect(h.asp.max).toBe(37);
    expect(h.schip.max).toBe(3);
    expect(h.sk).toBe(1);
    expect(h.zk).toBe(0);
    expect(h.weapons.length).toBe(2);
    expect(talentValue(h, "Magiekunde")).toBeGreaterThanOrEqual(0);
    const fm = frontmatterValues(h);
    expect(fm.LeP).toBe(23);
    expect(fm.heldenschmiede_uid).toBe(h.uid);
  });
  it("never fails on unknown keys and yields stubs", () => {
    const j = load();
    const h = parseHero(j, emptyMapping());
    expect(heroToCombatant(h).name).toBe(h.name);
    const stubs = addStubs(emptyMapping(), collectKeys(j.character as Record<string, unknown>));
    expect(stubs.added.length).toBeGreaterThan(0);
  });
  it("clean strips ids", () => {
    const s = JSON.stringify(cleanHeroJson(load()));
    for (const k of ["readerUids", "writerUids", "groupUid", "dbId"]) expect(s).not.toContain(`"${k}"`);
    expect(s).toContain("00000000-0000-4000-8000-000000000000");
  });
  it("diff against itself is empty; block renders", () => {
    const h = parseHero(load());
    expect(diffHeroes(h, h)).toEqual([]);
    expect(diffHeroes(null, h).length).toBeGreaterThan(0);
    expect(renderSpielwerte(h)).toContain(BLOCK_START);
  });
});

describe("mapping stubs", () => {
  it("never overwrite existing entries", () => {
    const m = parseMapping(JSON.stringify({ zauber: { "5": { name: "Ignifaxius" } } }))!;
    const r = addStubs(m, { ...collectKeys({}), zauber: [5, 6] });
    expect((r.mapping.zauber as Record<string, { name: string }>)["5"].name).toBe("Ignifaxius");
    expect(Object.keys(r.mapping.zauber)).toContain("6");
    expect(parseMapping(serializeMapping(r.mapping))).not.toBeNull();
  });
  it("invalid JSON -> null", () => expect(parseMapping("{oops")).toBeNull());
});

describe("applyBlock", () => {
  const block = `${BLOCK_START}\n## Spielwerte\nNEU\n${BLOCK_END}`;
  it("replaces only between markers", () => {
    const doc = `intro\n${BLOCK_START}\nALT\n${BLOCK_END}\noutro\n`;
    const out = applyBlock(doc, block);
    expect(out.startsWith("intro\n")).toBe(true);
    expect(out.endsWith("outro\n")).toBe(true);
    expect(out).toContain("NEU");
    expect(out).not.toContain("ALT");
  });
  it("appends when absent and keeps content", () => {
    const out = applyBlock("hello\n", block);
    expect(out.startsWith("hello\n")).toBe(true);
    expect(out).toContain("NEU");
  });
});

describe("CombatStore", () => {
  const c = (name: string) => ({ name, kind: "creature" as const, sourcePath: "", lepMax: 10, iniBase: 8, rs: 1, vw: 4, weapons: [], needsManual: [] });
  it("adds with numbering, undoes, advances rounds", () => {
    const s = new CombatStore();
    const a = s.addCombatant(c("Wolf"));
    const b = s.addCombatant(c("Wolf"));
    expect(b.name).toBe("Wolf 2");
    s.setLep(a.id, 3);
    expect(s.get(a.id)!.lep).toBe(3);
    s.undo();
    expect(s.get(a.id)!.lep).toBe(10);
    s.rollAllInitiative(fixedRoller([2, 5]));
    expect(s.order()[0].id).toBe(b.id);
    s.get(a.id)!.defensesUsed = 2;
    s.nextRound();
    expect(s.round).toBe(2);
    expect(s.get(a.id)!.defensesUsed).toBe(0);
  });
  it("persisted state round-trips", () => {
    const s = new CombatStore();
    s.addCombatant(c("Ork"));
    const t = new CombatStore();
    t.load(JSON.parse(JSON.stringify(s.state)));
    expect(t.entries.length).toBe(1);
  });
});
