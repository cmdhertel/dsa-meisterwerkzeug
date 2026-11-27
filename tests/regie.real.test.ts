import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { digestNote, gmSecret, parseKurzprofil, secretTasks } from "../src/regie/digest";

const vault = process.env.DSA_VAULT ? path.resolve(process.env.DSA_VAULT) : path.resolve(__dirname, "../../..");
const camp = path.join(vault, "Campaigns");
const have = fs.existsSync(camp);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const read = (rel: string) => fs.readFileSync(path.join(camp, rel), "utf8");

describe.skipIf(!have)("real vault: regie digest", () => {
  const files = have ? walk(camp) : [];

  it("digests every campaign note without throwing", () => {
    let readAloud = 0;
    let tasks = 0;
    let blocks = 0;
    let actions = 0;
    let facts = 0;
    let secrets = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const d = digestNote(text);
      const n = text.split(/\r?\n/).length;
      for (const t of d.tasks) expect(t.line).toBeLessThan(n);
      expect(d.links.length).toBe(d.linkPaths.length);
      if (d.readAloud.length) readAloud++;
      if (d.tasks.length) tasks++;
      if (d.blocks.length) blocks++;
      if (d.actions.length) actions++;
      if (d.facts.length) facts++;
      if (secretTasks(d).length) secrets++;
    }
    console.log(
      [
        "Regie-Digest (Campaigns):",
        `  Notizen gesamt      ${files.length}`,
        `  mit Vorlesetext     ${readAloud}`,
        `  mit Aufgaben        ${tasks}`,
        `  mit Geheimnis-Tasks ${secrets}`,
        `  mit Kampfblöcken    ${blocks}`,
        `  mit Inline-Aktionen ${actions}`,
        `  mit Fakten          ${facts}`,
      ].join("\n"),
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it("parses Kurzprofil and gmSecret of all NSC notes", () => {
    let nsc = 0;
    let kp = 0;
    let sec = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      if (!/^typ:\s*["']?nsc["']?\s*$/m.test(text.slice(0, 1500))) continue;
      nsc++;
      if (parseKurzprofil(text)) kp++;
      if (gmSecret(text)) sec++;
    }
    console.log(`NSC: ${nsc} Notizen, ${kp} mit Kurzprofil, ${sec} mit SL-Geheimnis`);
    expect(nsc).toBeGreaterThan(0);
  });
});
