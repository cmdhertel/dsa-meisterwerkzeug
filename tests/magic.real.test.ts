import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isFullySpell, parseSpellNote } from "../src/magic/spells";

const vault = path.resolve(__dirname, "../../..");
const dirs: [string, "zauber" | "liturgie"][] = [
  [path.join(vault, "20 - Regeln/Zauber"), "zauber"],
  [path.join(vault, "20 - Regeln/Liturgien"), "liturgie"],
];
const have = dirs.every(([d]) => fs.existsSync(d));

describe.skipIf(!have)("real spell notes", () => {
  it("parses all notes, reports full ones", () => {
    let total = 0;
    let full = 0;
    const bad: string[] = [];
    for (const [dir, kind] of dirs) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
        total++;
        const s = parseSpellNote(fs.readFileSync(path.join(dir, f), "utf8"), f, f.replace(/\.md$/, ""), kind);
        if (!s) {
          bad.push(f + " (no Probe)");
          continue;
        }
        if (isFullySpell(s)) full++;
        else bad.push(`${f}: kosten=${s.kostenText}`);
      }
    }
    console.log(`Zauber/Liturgien: ${full}/${total} vollständig. Unvollständig:\n${bad.join("\n")}`);
    expect(total).toBeGreaterThan(0);
    expect(total - bad.filter((b) => b.includes("no Probe")).length).toBe(total);
  });
});
