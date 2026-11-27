import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseCreature } from "../src/bestiary/adapter";
import { extractStatblockYaml, hasCombatStats, normalizeStatblock } from "../src/bestiary/statblock";

// optional: path to a real NSC note with a statblock (DSA_NPC_NOTE=/path/to/NSC.md npm test)
const npcNote = process.env.DSA_NPC_NOTE ? path.resolve(process.env.DSA_NPC_NOTE) : null;

describe("NSC statblock", () => {
  it("extracts the first statblock body", () => {
    const text = "---\ntyp: nsc\n---\n# X\n\n```statblock\nlayout: dsa5-layout\nname: X\nlep: 30\n```\nrest";
    expect(extractStatblockYaml(text)).toBe("layout: dsa5-layout\nname: X\nlep: 30\n");
    expect(extractStatblockYaml("```encounter\nx\n```")).toBeNull();
  });
  it("maps long German keys", () => {
    const sb = normalizeStatblock({ lebensenergie: 28, initiative: 13, ruestungsschutz: 0, ausweichen: 5 });
    expect(sb).toMatchObject({ lep: 28, ini: 13, rs: 0, vw: 5 });
    expect(parseCreature(sb, "p", "Die Krähe").combatant).toMatchObject({ lepMax: 28, iniBase: 13, rs: 0, vw: 5 });
  });
  it("an empty template block has no combat values", () => {
    expect(hasCombatStats(normalizeStatblock({ layout: "dsa5-layout", name: null }))).toBe(false);
  });
  it.skipIf(!npcNote || !fs.existsSync(npcNote))("real NSC note (DSA_NPC_NOTE)", () => {
    const file = npcNote!;
    const sb = normalizeStatblock(YAML.parse(extractStatblockYaml(fs.readFileSync(file, "utf8"))!));
    const r = parseCreature(sb, file, path.basename(file, ".md"));
    expect(r.status).toBe("ok");
    expect(r.combatant.lepMax).toBeGreaterThan(0);
    expect(r.combatant.iniBase).toBeGreaterThan(0);
  });
});
