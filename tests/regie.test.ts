import { describe, expect, it } from "vitest";
import { digestNote, gmSecret, parseKurzprofil, secretTasks, sectionBody, toggleTask } from "../src/regie/digest";
import { loadRegieText, mayWrite } from "../src/regie/state";
import { BLOCK_END, BLOCK_START, hasMitschrift, highlights, renderMitschrift, upsertMitschrift } from "../src/regie/journal";
import {
  activateScene,
  addEntry,
  endSession,
  formatClock,
  formatDuration,
  KIND_ICON,
  KIND_LABEL,
  newRun,
  normalizeRun,
  removeEntry,
  sceneElapsed,
  sessionElapsed,
  setSceneStatus,
  startSession,
  updateEntry,
} from "../src/regie/run";

const FM = `---\ntyp: szene\nkurz: ""\n---\n`;

const SZENE = `${FM}# Szene 6: Wahrheit

**Dauer:** ~40 Minuten
**Ort:** Dorfplatz
**Ziel:**

> [!abstract] Auf einen Blick
> **Ziel der Szene:** Praioshilf stellen
> **Einstieg:** Prozess am Mittag · **Ausgang/Übergang:** Flucht
> **Leer:**

## Vorlesetext
*Hinweis*
> Unter der Linde ist kein Platz mehr.
>
> „Volk von Trackenborn!“

## Ablauf
> [!vorlesen] Variante B
> Hufschlag im Morgengrauen.

> [!vorlesen]
> Zweiter Text

Probe: \`probe: Klettern -1\` und \`Gruppenprobe: Sinnesschärfe\` sowie \`zauber: Adlerauge\`, \`liturgie: Segen\`, \`sammelprobe: X\`, \`gruppensammelprobe: Y\`. Nichts: \`foo\`.
Siehe [[Brodo|der Ritter]] und ![[Praioshilf#Kurzprofil]] und [[Campaigns/X/Pedora.md]] und [[]] und ![[NSC-Name#Kurzprofil]] und ![[Struktur.base#Szenen]] und [[Brodo]].

## Hinweise in dieser Szene
- [ ] Der Steckbrief
  - [x] Zeuge Pedora
* [ ] 
+ [X] Plus-Aufgabe
> [!note] Box
> - [ ] In Callout

\`\`\`js
- [ ] in fence
[[nicht]] \`probe: no\`
\`\`\`

\`\`\`dsa-kampf
name: Wolfsrudel
- 2x Wolf
\`\`\`

\`\`\`encounter
creatures:
  - 3: Gardist
    amount: 1
\`\`\`

\`\`\`dsa-kampf
- 2x Gardist | LeP 3
- 4x Wolf | LeP 12
\`\`\`
`;

describe("digestNote", () => {
  const d = digestNote(SZENE);
  it("title, sections, line offsets", () => {
    expect(d.title).toBe("Szene 6: Wahrheit");
    expect(d.sections.map((s) => s.heading)).toEqual(["Szene 6: Wahrheit", "Vorlesetext", "Ablauf", "Hinweise in dieser Szene"]);
    const lines = SZENE.split("\n");
    expect(lines[d.sections[0].line]).toBe("# Szene 6: Wahrheit");
    for (const t of d.tasks) expect(lines[t.line]).toContain(t.text);
  });
  it("facts", () => {
    expect(d.facts).toEqual([
      { label: "Dauer", value: "~40 Minuten" },
      { label: "Ort", value: "Dorfplatz" },
      { label: "Ziel der Szene", value: "Praioshilf stellen" },
      { label: "Einstieg", value: "Prozess am Mittag" },
      { label: "Ausgang/Übergang", value: "Flucht" },
    ]);
  });
  it("read aloud", () => {
    expect(d.readAloud.map((r) => r.title)).toEqual(["Vorlesetext", "Variante B", "Vorlesen"]);
    expect(d.readAloud[0].text).toContain("Unter der Linde");
    expect(d.readAloud[0].text).toContain("„Volk");
    expect(d.readAloud[0].text.startsWith(">")).toBe(false);
    expect(d.readAloud[1].text).toBe("Hufschlag im Morgengrauen.");
  });
  it("tasks incl. callouts, bullets, nesting; no fence, no empty", () => {
    expect(d.tasks.map((t) => [t.text, t.checked])).toEqual([
      ["Der Steckbrief", false],
      ["Zeuge Pedora", true],
      ["Plus-Aufgabe", true],
      ["In Callout", false],
    ]);
    expect(d.tasks[0].heading).toBe("Hinweise in dieser Szene");
    expect(secretTasks(d)).toHaveLength(4);
  });
  it("actions", () => {
    expect(d.actions.map((a) => a.kind)).toEqual(["probe", "gruppenprobe", "zauber", "liturgie", "sammelprobe", "gruppensammelprobe"]);
    expect(d.actions[0].raw).toBe("probe: Klettern -1");
  });
  it("links", () => {
    expect(d.links).toEqual(["Brodo", "Praioshilf", "Pedora"]);
    expect(d.linkPaths).toEqual(["Brodo", "Praioshilf", "Campaigns/X/Pedora.md"]);
  });
  it("blocks", () => {
    expect(d.blocks.map((b) => [b.kind, b.title])).toEqual([
      ["dsa-kampf", "Wolfsrudel"],
      ["encounter", "3x Gardist"],
      ["dsa-kampf", "2x Gardist, 4x Wolf"],
    ]);
    const lines = SZENE.split("\n");
    expect(lines[d.blocks[0].line]).toBe("```dsa-kampf");
    expect(d.blocks[0].source).toBe("name: Wolfsrudel\n- 2x Wolf");
  });
  it("fallback title Kampf", () => {
    expect(digestNote("```encounter\n```\n").blocks[0].title).toBe("Kampf");
  });
  it("CRLF gives same result", () => {
    const c = digestNote(SZENE.replace(/\n/g, "\r\n"));
    expect(c.tasks).toEqual(d.tasks);
    expect(c.readAloud).toEqual(d.readAloud);
    expect(c.blocks).toEqual(d.blocks);
    expect(c.facts).toEqual(d.facts);
  });
  it("session template shape", () => {
    const s = `---\ntyp: session\n---\n# Titel\n\n> [!abstract] Session-Cockpit\n> **Datum:** 2026-01-01 · **Session Nr.:** 3\n\n## Starker Einstieg\n*x*\n> \n\n## Geheimnisse & Hinweise\n- [ ] \n- [ ] Das Siegel\n\n> [!note]- Offene\n> \`\`\`dataview\n> TASK\n> \`\`\`\n\n## Wichtige NSC\n![[NSC-Name#Kurzprofil]]\n`;
    const x = digestNote(s);
    expect(x.facts).toEqual([
      { label: "Datum", value: "2026-01-01" },
      { label: "Session Nr.", value: "3" },
    ]);
    expect(x.readAloud).toEqual([]);
    expect(secretTasks(x).map((t) => t.text)).toEqual(["Das Siegel"]);
    expect(x.links).toEqual([]);
  });
  it("fight block inside callout", () => {
    const x = digestNote("> [!note]\n> ```dsa-kampf\n> - 2x Wolf\n> ```\n");
    expect(x.blocks).toHaveLength(1);
    expect(x.blocks[0].source).toBe("- 2x Wolf");
  });
  it("empty text", () => {
    const x = digestNote("");
    expect(x.title).toBe("");
    expect(x.tasks).toEqual([]);
  });
});

describe("kurzprofil / gmSecret / sectionBody", () => {
  const NSC = `---\ntyp: nsc\n---\n# Ghul\n\n## Kurzprofil\n- **Auftreten:** Groß\n  und breit\n- **Stimme & Marotte:** Rau\n- **Will:** Gold\n- **Weiß:** Viel\n- **Zitat:**\n- **Funktion:** Boss\n\n## Geheimnis (nur SL)\nSie ist **böse**.\n\n### Detail\nMehr\n\n## Anderes\nx\n`;
  it("parses fields", () => {
    const k = parseKurzprofil(NSC)!;
    expect(k.auftreten).toBe("Groß und breit");
    expect(k.stimme).toBe("Rau");
    expect(k.will).toBe("Gold");
    expect(k.weiss).toBe("Viel");
    expect(k.zitat).toBe("");
    expect(k.extra).toEqual([{ label: "Funktion", value: "Boss" }]);
  });
  it("null cases", () => {
    expect(parseKurzprofil("# A\n")).toBeNull();
    expect(parseKurzprofil("## Kurzprofil\n- **Auftreten:**\n- **Will:**\n")).toBeNull();
  });
  it("gmSecret includes subsections, stops at same level", () => {
    expect(gmSecret(NSC)).toBe("Sie ist **böse**.\n\n### Detail\nMehr");
    expect(gmSecret("# A\n## Geheimnisse (nur SL)\n\n## B\nx")).toBeNull();
    expect(gmSecret("# A\n")).toBeNull();
  });
  it("sectionBody string and ignore fences", () => {
    expect(sectionBody("## A\nx\n```\n## B\n```\ny\n## C\nz", "a")).toBe("x\n```\n## B\n```\ny");
    expect(sectionBody("## A\nx", "Nope")).toBeNull();
  });
});

describe("toggleTask", () => {
  const T = "# H\n- [ ] eins\n- [ ] zwei\n  - [x] drei\n";
  it("toggles at line", () => {
    expect(toggleTask(T, 1, "eins", true)).toBe("# H\n- [x] eins\n- [ ] zwei\n  - [x] drei\n");
    expect(toggleTask(T, 3, "drei", false)).toBe("# H\n- [ ] eins\n- [ ] zwei\n  - [ ] drei\n");
  });
  it("finds moved line, null if ambiguous or missing", () => {
    expect(toggleTask(T, 9, "zwei", true)).toBe("# H\n- [ ] eins\n- [x] zwei\n  - [x] drei\n");
    expect(toggleTask("- [ ] a\n- [ ] a\n", 7, "a", true)).toBeNull();
    expect(toggleTask(T, 1, "nix", true)).toBeNull();
    expect(toggleTask(T, 0, "H", true)).toBeNull();
  });
  it("line with wrong text but unique elsewhere", () => {
    expect(toggleTask(T, 1, "zwei", true)).toContain("- [x] zwei");
  });
  it("CRLF, frontmatter, callout, fences preserved", () => {
    const t = "---\r\na: 1\r\n---\r\n> [!n]\r\n> - [ ] x\r\n```\r\n- [ ] y\r\n```\r\n";
    expect(toggleTask(t, 4, "x", true)).toBe(t.replace("[ ] x", "[x] x"));
    expect(toggleTask(t, 6, "y", true)).toBeNull();
  });
});

describe("run reducers", () => {
  it("immutability and clocks", () => {
    const r0 = newRun("S.md");
    const snap = JSON.stringify(r0);
    const r1 = activateScene(r0, "a.md", "Alpha", 1000);
    expect(JSON.stringify(r0)).toBe(snap);
    expect(r1.startedAt).toBe(1000);
    expect(r1.activeScene).toBe("a.md");
    expect(r1.journal.map((e) => e.kind)).toEqual(["start", "szene"]);
    expect(r1.journal[1].text).toBe("Szene: Alpha");
    expect(activateScene(r1, "a.md", "Alpha", 2000)).toBe(r1);
    const snap1 = JSON.stringify(r1);
    const r2 = activateScene(r1, "b.md", "Beta", 61000);
    expect(JSON.stringify(r1)).toBe(snap1);
    expect(r2.scenes["a.md"]).toEqual({ status: "gespielt", ms: 60000, since: null });
    expect(r2.scenes["b.md"]).toEqual({ status: "läuft", ms: 0, since: 61000 });
    expect(sceneElapsed(r2, "b.md", 91000)).toBe(30000);
    expect(sceneElapsed(r2, "a.md", 99999)).toBe(60000);
    expect(sceneElapsed(r2, "zzz", 1)).toBe(0);
    const r3 = endSession(r2, 121000);
    expect(r3.endedAt).toBe(121000);
    expect(r3.activeScene).toBeNull();
    expect(r3.scenes["b.md"]).toEqual({ status: "gespielt", ms: 60000, since: null });
    expect(r3.journal[r3.journal.length - 1].kind).toBe("ende");
    expect(r3.journal[r3.journal.length - 1].text).toContain("0:02");
    expect(sessionElapsed(r3, 999999)).toBe(120000);
    expect(sessionElapsed(r0, 5)).toBe(0);
    expect(sessionElapsed(r2, 11000)).toBe(10000);
  });
  it("startSession logs once and resumes", () => {
    const a = startSession(newRun("S"), 5);
    const b = startSession(endSession(a, 10), 20);
    expect(b.startedAt).toBe(5);
    expect(b.endedAt).toBeNull();
    expect(b.journal.filter((e) => e.kind === "start")).toHaveLength(1);
  });
  it("setSceneStatus", () => {
    let r = activateScene(newRun("S"), "a", "A", 0);
    r = setSceneStatus(r, "a", "offen", 5000);
    expect(r.activeScene).toBeNull();
    expect(r.scenes.a).toEqual({ status: "offen", ms: 5000, since: null });
    r = setSceneStatus(r, "zz", "gespielt", 1);
    expect(r.scenes.zz.status).toBe("gespielt");
  });
  it("setSceneStatus läuft stops the clock of the previously active scene", () => {
    const r1 = activateScene(newRun("S"), "a", "A", 0);
    const r2 = setSceneStatus(r1, "b", "läuft", 60000);
    expect(r2.activeScene).toBe("b");
    expect(r2.scenes.a).toEqual({ status: "gespielt", ms: 60000, since: null });
    expect(r2.scenes.b).toEqual({ status: "läuft", ms: 0, since: 60000 });
    expect(sceneElapsed(r2, "a", 90000)).toBe(60000);
    expect(sceneElapsed(r2, "b", 90000)).toBe(30000);
    // Setting the already active scene to "läuft" again keeps its accumulated time and restarts only its own clock.
    const r3 = setSceneStatus(r2, "b", "läuft", 90000);
    expect(r3.scenes.b).toEqual({ status: "läuft", ms: 30000, since: 90000 });
    expect(r3.scenes.a.status).toBe("gespielt");
  });
  it("entries", () => {
    const r0 = newRun("S");
    expect(addEntry(r0, { kind: "notiz", text: "  " }, 1).journal).toHaveLength(0);
    let r = addEntry(r0, { kind: "notiz", text: " Hallo ", sceneTitle: "A" }, 1000);
    r = addEntry(r, { kind: "probe", text: "x" }, 1000);
    r = addEntry(r, { kind: "probe", text: "y" }, 1000, "fixed");
    expect(new Set(r.journal.map((e) => e.id)).size).toBe(3);
    expect(r.journal[0]).toMatchObject({ text: "Hallo", scene: "A", t: 1000 });
    expect(r0.journal).toHaveLength(0);
    const u = updateEntry(r, "fixed", { text: "z", kind: "kampf" });
    expect(u.journal[2]).toMatchObject({ text: "z", kind: "kampf" });
    expect(r.journal[2].text).toBe("y");
    expect(removeEntry(u, "fixed").journal).toHaveLength(2);
    expect(r.journal).toHaveLength(3);
  });
  it("caps journal at 2000", () => {
    let r = newRun("S");
    for (let i = 0; i < 2005; i++) r = addEntry(r, { kind: "notiz", text: "n" + i }, i);
    expect(r.journal).toHaveLength(2000);
    expect(r.journal[0].text).toBe("n5");
    expect(new Set(r.journal.map((e) => e.id)).size).toBe(2000);
  });
  it("normalizeRun is tolerant", () => {
    expect(normalizeRun(null, "S")).toEqual(newRun("S"));
    expect(normalizeRun("x", "S")).toEqual(newRun("S"));
    const r = normalizeRun(
      { startedAt: 5, scenes: { a: { status: "läuft", ms: "x", since: 3 }, b: 7 }, activeScene: "a", journal: [{ t: 1, kind: "bogus", text: "k" }, 3, { t: "x" }] },
      "S",
    );
    expect(r.startedAt).toBe(5);
    expect(r.scenes.a).toEqual({ status: "läuft", ms: 0, since: 3 });
    expect(r.scenes.b).toBeUndefined();
    expect(r.activeScene).toBe("a");
    expect(r.journal).toHaveLength(1);
    expect(r.journal[0].kind).toBe("notiz");
    const rt: unknown = JSON.parse(JSON.stringify(r));
    expect(normalizeRun(rt, "S")).toEqual(r);
  });
  it("formatting and tables", () => {
    expect(formatDuration(7 * 60000)).toBe("0:07");
    expect(formatDuration(83 * 60000)).toBe("1:23");
    expect(formatClock(65000)).toBe("01:05");
    expect(formatClock(3661000)).toBe("1:01:01");
    expect(Object.keys(KIND_LABEL).sort()).toEqual(Object.keys(KIND_ICON).sort());
  });
});

describe("journal", () => {
  const off = 120; // UTC+2
  const base = Date.UTC(2026, 0, 1, 18, 14); // 20:14 local
  const build = () => {
    let r = activateScene(newRun("S.md"), "sz/a.md", "Alpha", base);
    r = addEntry(r, { kind: "probe", text: "Thorwin: Klettern −1\ngelungen", sceneTitle: "Alpha" }, base + 60000);
    r = addEntry(r, { kind: "entscheidung", text: "Brodo laufen lassen", sceneTitle: "Alpha" }, base + 120000);
    r = addEntry(r, { kind: "zitat", text: "Nie wieder", sceneTitle: "Alpha" }, base + 130000);
    r = activateScene(r, "sz/b.md", "Beta", base + 600000);
    r = addEntry(r, { kind: "kampf", text: "Wölfe", sceneTitle: "Beta" }, base + 700000);
    r = addEntry(r, { kind: "geheimnis", text: "Siegel", sceneTitle: "Beta" }, base + 710000);
    return endSession(r, base + 3_600_000 * 3 + 720000);
  };
  it("renders", () => {
    const md = renderMitschrift(build(), { timeZoneOffsetMinutes: off, avDate: "12. Praios 1028 BF", sceneTitles: { "sz/a.md": "Alpha" } });
    expect(md.startsWith("## Mitschrift\n*Automatisch")).toBe(true);
    expect(md).toContain("**Dauer:** 3:12 · **Szenen:** 2 · **Proben:** 1 · **Kämpfe:** 1 · **Enthüllt:** 1 · **Aventurisch:** 12. Praios 1028 BF");
    expect(md).toContain("### Höhepunkte");
    expect(md).toContain("- **Entscheidungen:** Brodo laufen lassen");
    expect(md).toContain("- **Zitate:** „Nie wieder“");
    expect(md).toContain("- **Enthüllte Geheimnisse:** Siegel");
    expect(md).not.toContain("Neue Fäden");
    expect(md).toContain("#### Auftakt");
    expect(md).toContain("- 20:14 · Start · Session begonnen");
    expect(md).toContain("#### Alpha (10:00)".replace("10:00", "0:10"));
    expect(md).toContain("- 20:15 · Probe · Thorwin: Klettern −1 / gelungen");
    expect(md).not.toContain("· Szene ·");
    expect(md).toContain("#### Beta");
    expect(md.indexOf("#### Alpha")).toBeLessThan(md.indexOf("#### Beta"));
  });
  it("empty run", () => {
    const md = renderMitschrift(newRun("S"), { timeZoneOffsetMinutes: 0 });
    expect(md).not.toContain("**Dauer");
    expect(md).not.toContain("Höhepunkte");
    expect(md).toContain("### Verlauf");
  });
  it("highlights", () => {
    const h = highlights(build());
    expect(h.entscheidungen).toEqual(["Brodo laufen lassen"]);
    expect(h.zitate).toEqual(["Nie wieder"]);
    expect(h.geheimnisse).toEqual(["Siegel"]);
    expect(h.faeden).toEqual([]);
    expect(h.beute).toEqual([]);
  });
  const blk = "## Mitschrift\nx\n";
  it("upsert: before 'Nach der Session', idempotent", () => {
    const note = "# S\ntext\n\n## Nach der Session\n- a\n";
    const once = upsertMitschrift(note, blk);
    expect(once).toBe(`# S\ntext\n\n${BLOCK_START}\n## Mitschrift\nx\n${BLOCK_END}\n\n## Nach der Session\n- a\n`);
    expect(upsertMitschrift(once, blk)).toBe(once);
    const changed = upsertMitschrift(once, "## Mitschrift\ny\n");
    expect(changed).toBe(once.replace("\nx\n", "\ny\n"));
    expect(hasMitschrift(once)).toBe(true);
    expect(hasMitschrift(note)).toBe(false);
  });
  it("upsert: appends, case-insensitive heading level", () => {
    expect(upsertMitschrift("# S\ntext", blk)).toBe(`# S\ntext\n\n${BLOCK_START}\n## Mitschrift\nx\n${BLOCK_END}\n`);
    expect(upsertMitschrift("# S\ntext\n", blk)).toBe(`# S\ntext\n\n${BLOCK_START}\n## Mitschrift\nx\n${BLOCK_END}\n`);
    expect(upsertMitschrift("a\n### nach der session\nb", blk)).toContain(`${BLOCK_END}\n\n### nach der session`);
    expect(upsertMitschrift("", blk)).toBe(`${BLOCK_START}\n## Mitschrift\nx\n${BLOCK_END}\n`);
  });
  it("upsert: CRLF preserved", () => {
    const note = "# S\r\n\r\n## Nach der Session\r\n- a\r\n";
    const once = upsertMitschrift(note, blk);
    expect(once.replace(/\r\n/g, "")).not.toContain("\n");
    expect(upsertMitschrift(once, blk)).toBe(once);
    expect(once.startsWith("# S\r\n\r\n%%")).toBe(true);
  });
  it("upsert: text outside region untouched", () => {
    const note = `pre\n${BLOCK_START}\nold\n${BLOCK_END}\npost  \n`;
    expect(upsertMitschrift(note, blk)).toBe(`pre\n${BLOCK_START}\n## Mitschrift\nx\n${BLOCK_END}\npost  \n`);
  });
  it("upsert: corrupt start without end deletes nothing", () => {
    const note = `# S\n${BLOCK_START}\nuser text\n\n## Nach der Session\n- a\n`;
    const out = upsertMitschrift(note, blk);
    expect(out.startsWith(note)).toBe(true);
    expect(out.endsWith(`${BLOCK_END}\n`)).toBe(true);
    expect(upsertMitschrift(out, blk)).toBe(out);
    expect(hasMitschrift(note)).toBe(false);
  });
});

describe("regie.json load guard (#5)", () => {
  it("a missing file is a fresh start", () => {
    const r = loadRegieText(null);
    expect(r).toEqual({ ok: true, data: { version: 1, lastSession: null, runs: {} } });
  });
  it("valid JSON object loads", () => {
    const r = loadRegieText(JSON.stringify({ version: 1, lastSession: "S.md", runs: { "S.md": newRun("S.md") } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.lastSession).toBe("S.md");
  });
  it("broken JSON is reported as failed, never as empty data", () => {
    expect(loadRegieText("{ nicht json")).toEqual({ ok: false });
    expect(loadRegieText("")).toEqual({ ok: false });
  });
  it("non-object JSON counts as broken", () => {
    expect(loadRegieText("null")).toEqual({ ok: false });
    expect(loadRegieText("[]")).toEqual({ ok: false });
    expect(loadRegieText("42")).toEqual({ ok: false });
  });
  it("writing is refused after a failed load", () => {
    expect(mayWrite(true)).toBe(false);
    expect(mayWrite(false)).toBe(true);
  });
});
