import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { parseCreature, parseWeapon } from "../src/bestiary/adapter";

const vault = process.env.DSA_VAULT ? path.resolve(process.env.DSA_VAULT) : path.resolve(__dirname, "../../..");
const dir = path.join(vault, "30 - Bestiarium");
const have = fs.existsSync(dir);

function frontmatter(text: string): Record<string, unknown> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try {
    return YAML.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("weapon parsing", () => {
  it("melee", () => {
    expect(parseWeapon("Rimkur", "**AT** 12 **PA** 5 **TP** 1W6+5 **RW** mittel")).toMatchObject({ kind: "melee", at: 12, pa: 5, tp: "1W6+5", rw: "mittel", partial: false });
  });
  it("ranged", () => {
    expect(parseWeapon("Wurfspeer", "**FK** 13 **TP** 2W6+2 **RW** 5/10/20")).toMatchObject({ kind: "ranged", fk: 13, tp: "2W6+2", rwRanges: [5, 10, 20] });
    expect(parseWeapon("Bogen", "**FK** 14 **LZ** 2 **TP** 1W6+4 **RW** 10/20/40")).toMatchObject({ lz: 2, fk: 14 });
  });
  it("non-dice TP is partial, not a failure", () => {
    const w = parseWeapon("Griff", "**AT** 10 **TP** Haltegriff **RW** kurz");
    expect(w.tp).toBeNull();
    expect(w.tpNote).toBe("Haltegriff");
    expect(w.partial).toBe(true);
    expect(parseWeapon("x", "**AT** 12 **TP** 1W6+3 (+Gift)* **RW** kurz")).toMatchObject({ tp: "1W6+3", tpNote: "(+Gift)*" });
  });
  it("variabel is 'needs manual input'", () => {
    const r = parseCreature({ lep: "variabel", ini: "variabel", attacks: [] }, "x.md", "X");
    expect(r.status).toBe("manual");
    expect(r.combatant.needsManual).toEqual(["lep", "ini"]);
  });
  it("never throws on junk", () => {
    expect(parseCreature(null, "x.md", "X").status).toBe("nostats");
    expect(() => parseCreature({ lep: {}, ini: [], attacks: [1, null, "x"] } as never, "x.md", "X")).not.toThrow();
  });
});

describe.skipIf(!have)("real bestiary (all notes)", () => {
  it("parses every file and reports", () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const buckets: Record<string, string[]> = { ok: [], partial: [], manual: [], nostats: [] };
    const details: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const r = parseCreature(frontmatter(text), `30 - Bestiarium/${f}`, f.replace(/\.md$/, ""));
      buckets[r.status].push(f);
      if (r.status !== "ok") details.push(`${r.status.padEnd(7)} ${f}: ${r.problems.join("; ")}`);
    }
    const summary = `files=${files.length} ok=${buckets.ok.length} partial=${buckets.partial.length} manual=${buckets.manual.length} nostats=${buckets.nostats.length}`;
    console.log(`\nBESTIARY REPORT\n${summary}\n${details.join("\n")}`);
    expect(files.length).toBeGreaterThanOrEqual(199);
    expect(buckets.ok.length + buckets.partial.length + buckets.manual.length + buckets.nostats.length).toBe(files.length);
    expect(buckets.manual.length).toBeGreaterThanOrEqual(24);
  });
});
