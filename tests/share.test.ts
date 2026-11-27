import { describe, expect, it } from "vitest";
import { CombatStore, CombatState, orderEntries } from "../src/combat/store";
import type { Combatant } from "../src/model";
import { buildAventurischTree, toHtml, toRoman } from "../src/share/aventurisch";
import { SHARE_DEFAULTS, buildPlayerView, conditionWord, optionsFromSettings, parseBlockOptions } from "../src/share/viewModel";

/** State whose acting combatant is the one at position `i` of the acting order (-1 = nobody). */
const at = (st: CombatState, i: number): CombatState => ({ ...st, currentId: orderEntries(st.entries)[i]?.id ?? null });

const mk =(name: string, kind: "hero" | "creature", lepMax = 40, iniBase = 10): Combatant => ({ name, kind, sourcePath: "", lepMax, iniBase, rs: 0, vw: null, weapons: [], needsManual: [] });
const opts = optionsFromSettings(SHARE_DEFAULTS);

function fight() {
  const s = new CombatStore();
  const hero = s.addCombatant(mk("Thorwin", "hero", 30, 12));
  const ork = s.addCombatant(mk("Ork", "creature", 40, 11));
  const wolf = s.addCombatant(mk("Wolf", "creature", 20, 9));
  s.setInitiativeRoll(hero.id, 4); // 16
  s.setInitiativeRoll(ork.id, 3); // 14
  s.setInitiativeRoll(wolf.id, 2); // 11
  return { s, hero, ork, wolf };
}

describe("conditionWord", () => {
  it("thresholds", () => {
    expect(conditionWord(40, 40, false)).toBe("unverletzt");
    expect(conditionWord(31, 40, false)).toBe("unverletzt");
    expect(conditionWord(30, 40, false)).toBe("angeschlagen");
    expect(conditionWord(21, 40, false)).toBe("angeschlagen");
    expect(conditionWord(20, 40, false)).toBe("verletzt");
    expect(conditionWord(11, 40, false)).toBe("verletzt");
    expect(conditionWord(10, 40, false)).toBe("schwer verletzt");
    expect(conditionWord(1, 40, false)).toBe("schwer verletzt");
    expect(conditionWord(0, 40, false)).toBe("am Boden");
    expect(conditionWord(-3, 40, false)).toBe("am Boden");
    expect(conditionWord(30, 40, true)).toBe("am Boden");
  });
});

describe("parseBlockOptions", () => {
  it("overrides valid keys, ignores junk", () => {
    const o = parseBlockOptions("gegner-lep: Exakt\ngegner-namen: aus\nini: an\nquatsch: 1\ngegner-lep: nix", opts);
    expect(o).toEqual({ enemyLep: "exakt", enemyNames: false, enemyIni: true, style: "schlicht" });
    expect(parseBlockOptions("", opts)).toEqual(opts);
  });
});

describe("buildPlayerView", () => {
  it("empty state", () => {
    expect(buildPlayerView(new CombatStore().state, opts).empty).toBe(true);
  });

  it("order, turn highlight, next marker, INI visibility", () => {
    const { s } = fight();
    const v = buildPlayerView(at(s.state, 0), opts);
    expect(v.rows.map((r) => r.name)).toEqual(s.order().map((e) => e.name));
    expect(v.rows.map((r) => [r.current, r.next])).toEqual([[true, false], [false, true], [false, false]]);
    expect(v.rows[0].ini).toBe("INI 16");
    expect(v.rows[1].ini).toBeNull();
    expect(buildPlayerView(s.state, { ...opts, enemyIni: true }).rows[1].ini).toBe("INI 14");
  });

  it("no one acting yet: first is next", () => {
    const { s } = fight();
    const st = at(s.state, -1);
    const v = buildPlayerView(st, opts);
    expect(v.rows.some((r) => r.current)).toBe(false);
    expect(v.rows[0].next).toBe(true);
  });

  it("heroes show numbers and Schmerz, enemies show the word", () => {
    const { s, hero, ork } = fight();
    s.setLep(hero.id, 10);
    s.setLep(ork.id, 15);
    const v = buildPlayerView(s.state, opts);
    const h = v.rows.find((r) => r.isHero)!;
    expect(h.lepText).toBe("10 / 30");
    expect(h.schmerz).toBeGreaterThan(0);
    const o = v.rows.find((r) => r.name === "Ork")!;
    expect(o.word).toBe("verletzt");
    expect(o.lepText).toBeNull();
    expect(o.barPct).toBeNull();
    expect(o.schmerz).toBe(0);
  });

  it("enemy LeP modes", () => {
    const { s } = fight();
    const get = (m: "wort" | "balken" | "exakt" | "aus") => buildPlayerView(s.state, { ...opts, enemyLep: m }).rows.find((r) => r.name === "Ork")!;
    expect(get("balken")).toMatchObject({ word: null, lepText: null, barPct: 100 });
    expect(get("exakt")).toMatchObject({ word: null, lepText: "40 / 40", barPct: 100 });
    expect(get("aus")).toMatchObject({ word: null, lepText: null, barPct: null });
  });

  it("states: visible chips for enemies, no LeP-derived Schmerz", () => {
    const { s, ork } = fight();
    s.setState(ork.id, "furcht", 2);
    s.setLep(ork.id, 3);
    const o = buildPlayerView(s.state, opts).rows.find((r) => r.name === "Ork")!;
    expect(o.states).toEqual([{ label: "Furcht", level: 2 }]);
    expect(o.word).toBe("am Boden"); // Schmerz IV from LeP <= 5 => incapacitated
    expect(o.down).toBe(true);
  });

  it("name masking: stable Gegner N in store order, heroes keep names", () => {
    const { s } = fight();
    const v = buildPlayerView(s.state, { ...opts, enemyNames: false });
    expect(v.rows.map((r) => r.name)).toEqual(["Thorwin", "Gegner 1", "Gegner 2"]);
    s.setInitiativeRoll(s.entries[2].id, 6); // Wolf now acts before Ork: numbering unchanged
    const v2 = buildPlayerView(s.state, { ...opts, enemyNames: false });
    expect(v2.rows.map((r) => r.name)).toEqual(["Thorwin", "Gegner 2", "Gegner 1"]);
  });

  it("hidden combatants are omitted and do not leave numbering gaps", () => {
    const { s, ork } = fight();
    s.patchEntry(ork.id, "verborgen", { hidden: true });
    const v = buildPlayerView(s.state, { ...opts, enemyNames: false });
    expect(v.rows.map((r) => r.name)).toEqual(["Thorwin", "Gegner 1"]);
  });

  it("hidden combatant acting shows a neutral placeholder; next skips hidden", () => {
    const { s, ork, wolf } = fight();
    s.patchEntry(ork.id, "verborgen", { hidden: true });
    let v = buildPlayerView(at(s.state, 0), opts);
    expect(v.rows.map((r) => r.name)).toEqual(["Thorwin", "Wolf"]);
    expect(v.rows.some((r) => r.next)).toBe(false); // next (Ork) is hidden: nobody marked
    v = buildPlayerView(at(s.state, 1), opts);
    expect(v.rows.map((r) => r.name)).toEqual(["Thorwin", "…", "Wolf"]);
    const ph = v.rows[1];
    expect(ph).toMatchObject({ placeholder: true, current: true, ini: null, word: null, lepText: null, states: [] });
    expect(v.rows[2].next).toBe(true);
    expect(JSON.stringify(ph)).not.toContain("Ork");
    expect(wolf.hidden).toBeUndefined();
  });

  it("hidden flag is undoable", () => {
    const { s, ork } = fight();
    s.patchEntry(ork.id, "verborgen", { hidden: true });
    expect(s.get(ork.id)!.hidden).toBe(true);
    s.undo();
    expect(s.get(ork.id)!.hidden).toBeFalsy();
  });
});

describe("Stil (schlicht | aventurisch)", () => {
  it("defaults to schlicht, parses from block (case-insensitive) and from settings", () => {
    expect(opts.style).toBe("schlicht");
    expect(parseBlockOptions("stil: Aventurisch", opts).style).toBe("aventurisch");
    expect(parseBlockOptions("stil: aventurisch\nstil: unsinn", opts).style).toBe("aventurisch");
    expect(parseBlockOptions("stil: aventurisch", { ...opts, style: "aventurisch" }).style).toBe("aventurisch");
    expect(parseBlockOptions("stil: schlicht", { ...opts, style: "aventurisch" }).style).toBe("schlicht");
    expect(optionsFromSettings({ ...SHARE_DEFAULTS, shareStyle: "aventurisch" }).style).toBe("aventurisch");
    expect(optionsFromSettings({ ...SHARE_DEFAULTS, shareStyle: "quatsch" as never }).style).toBe("schlicht");
  });
});

describe("toRoman", () => {
  it("converts", () => {
    expect([1, 3, 4, 9, 14, 40, 49, 1994].map(toRoman)).toEqual(["I", "III", "IV", "IX", "XIV", "XL", "XLIX", "MCMXCIV"]);
    expect(toRoman(0)).toBe("0");
    expect(toRoman(-2)).toBe("0");
    expect(toRoman(NaN)).toBe("0");
  });
});

describe("aventurisch renderer", () => {
  const html = (st: Parameters<typeof buildPlayerView>[0], o = opts) => toHtml(buildAventurischTree(buildPlayerView(st, o)));

  it("empty state is atmospheric", () => {
    expect(html(new CombatStore().state)).toContain("Die Waffen ruhen");
  });

  it("round in Roman numerals, current seal, next tag, hero/foe classes", () => {
    const { s } = fight();
    const out = html({ ...at(s.state, 0), round: 3 });
    expect(out).toContain('aria-label="Kampfrunde 3"');
    expect(out).toMatch(/dsa-psa-dropcap">I<\/span><span class="dsa-psa-roman">II</);
    expect(out).toContain("dsa-psa-seal");
    expect(out).toContain("als Nächstes");
    expect(out).toContain("is-hero");
    expect(out).toContain("is-foe");
  });

  it("enemies: word ribbon, no numbers; heroes keep numbers", () => {
    const { s, hero, ork } = fight();
    s.setLep(hero.id, 10);
    s.setLep(ork.id, 15);
    const out = html(s.state);
    expect(out).toContain("10 / 30");
    expect(out).toContain("verletzt");
    expect(out).not.toContain("15 / 40");
    expect(out).not.toContain("40 / 40");
    expect(out).not.toMatch(/INI 14|INI 11/);
  });

  it("enemy LeP numbers never appear unless mode exakt; masked names stay masked", () => {
    const { s } = fight();
    for (const m of ["wort", "balken", "aus"] as const) expect(html(s.state, { ...opts, enemyLep: m })).not.toMatch(/\b40 \/ 40|20 \/ 20/);
    expect(html(s.state, { ...opts, enemyNames: false })).not.toMatch(/Ork|Wolf/);
  });

  it("hidden combatants and secret effects do not leak", () => {
    const { s, ork, wolf } = fight();
    s.patchEntry(ork.id, "verborgen", { hidden: true });
    const out = html(at(s.state, 1));
    expect(out).not.toContain("Ork");
    expect(out).toContain("Wolf");
    expect(out).toContain("dsa-psa-banner is-foe is-current is-hidden");
    expect(out).not.toMatch(/\/ 40/); // Ork's LeP max
    const v = buildPlayerView(at(s.state, 0), opts);
    expect(JSON.stringify(buildAventurischTree(v))).not.toContain("Ork");
  });

  it("secret effects are not rendered, public ones are", () => {
    const { s, wolf } = fight();
    s.addEffect(wolf.id, { kind: "frei", name: "Geheimer Fluch", secret: true, gmNote: "Notiz-Geheimnis", source: "Quelle-Geheimnis" });
    s.addEffect(wolf.id, { kind: "frei", name: "Brennend", gmNote: "Notiz-Geheimnis" });
    const out = html(s.state);
    expect(out).toContain("Brennend");
    expect(out).not.toContain("Geheimer Fluch");
    expect(out).not.toContain("Geheimnis");
  });

  it("down combatants get the skull and class", () => {
    const { s, ork } = fight();
    s.setLep(ork.id, 0);
    const out = html(s.state);
    expect(out).toContain("☠");
    expect(out).toContain("is-down");
    expect(out).toContain("am Boden");
  });

  it("escapes names", () => {
    const s = new CombatStore();
    s.addCombatant(mk("<b>Held</b>", "hero"));
    const out = html(s.state);
    expect(out).not.toContain("<b>Held");
    expect(out).toContain("&lt;b&gt;Held");
  });
});
