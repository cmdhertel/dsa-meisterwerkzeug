import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseCreature } from "../src/bestiary/adapter";
import { extractStatblockYaml, hasCombatStats, normalizeStatblock } from "../src/bestiary/statblock";

const vault = path.resolve(__dirname, "../../..");
const npcDir = path.join(vault, "Campaigns/Die Nebelfurt/03. Non Player Characters");

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
  const file = path.join(npcDir, "Brodo Hagen.md");
  it.skipIf(!fs.existsSync(file))("real note: Brodo Hagen", () => {
    const sb = normalizeStatblock(YAML.parse(extractStatblockYaml(fs.readFileSync(file, "utf8"))!));
    const r = parseCreature(sb, file, "Brodo Hagen");
    expect(r.status).toBe("ok");
    expect(r.combatant).toMatchObject({ lepMax: 40, iniBase: 13, rs: 3, vw: 5 });
    expect(r.combatant.weapons.length).toBeGreaterThan(2);
  });
});
