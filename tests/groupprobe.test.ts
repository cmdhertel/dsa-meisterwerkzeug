import { describe, expect, it } from "vitest";
import { fixedRoller } from "../src/engine";
import {
  Participant,
  applySammelRound,
  groupLine,
  insertBelow,
  newSammel,
  restartSammel,
  rollParticipants,
  sammelLine,
  summarizeGroup,
} from "../src/groupprobe/logic";
import { SAMMEL_CRIT_MULTIPLIER, SAMMEL_TEILERFOLG_MIN_QS } from "../src/groupprobe/constants";
import { groupOutcomeTexts, isGroupProbeCode, parseGroupProbe, probeKey, requiredQsOf, sammelOutcomeTexts } from "../src/groupprobe/parse";
import { pruneSaved } from "../src/groupprobe/state";

const P = (id: string, fw: number, modifier = 0, attr = 12): Participant => ({ id, name: id, attrs: [attr, attr, attr], fw, modifier, statePenalty: 0 });

describe("rollParticipants / summarizeGroup", () => {
  it("rolls per participant with own FW and modifiers", () => {
    // Alrik: 10,10,10 vs 12 -> all ok, FW 8 -> QS 3 (rest 8 -> thresholds 7 => 3)
    // Thorwin: 20,5,5 with mod -2 (common) -> needs 20-10=10 > FW 4 -> fail
    const rolls = rollParticipants([P("Alrik", 8), P("Thorwin", 4)], -2, fixedRoller([10, 10, 10, 15, 5, 5]));
    expect(rolls[0].modifier).toBe(-2);
    // Alrik attr eff 10, dice 10 -> no points needed, rest 8 -> QS 3
    expect(rolls[0].result.qs).toBe(3);
    // Thorwin eff 10, die 15 -> needs 5 > FW 4
    expect(rolls[1].result.success).toBe(false);
    const s = summarizeGroup(rolls);
    expect(s.successes).toBe(1);
    expect(s.totalQs).toBe(3);
    expect(s.best?.name).toBe("Alrik");
    expect(s.worst?.name).toBe("Thorwin");
    expect(s.met).toBeNull();
  });

  it("individual modifier adds to the common one", () => {
    const rolls = rollParticipants([P("A", 0, 3)], 1, fixedRoller([14, 14, 14]));
    expect(rolls[0].modifier).toBe(4);
    expect(rolls[0].result.success).toBe(true); // 12+4=16 >= 14
  });

  it("checks required total and success count", () => {
    const rolls = rollParticipants([P("A", 8), P("B", 8)], 0, fixedRoller([1, 12, 12, 12, 12, 12]));
    const s = summarizeGroup(rolls, { qs: 6, successes: 2 });
    expect(s.successes).toBe(2);
    expect(s.metSuccesses).toBe(true);
    expect(s.metQs).toBe(s.totalQs >= 6);
    expect(summarizeGroup(rolls, { qs: 99 }).met).toBe(false);
  });

  it("counts Patzer and critical successes", () => {
    const rolls = rollParticipants([P("A", 5), P("B", 5)], 0, fixedRoller([1, 1, 9, 20, 20, 3]));
    const s = summarizeGroup(rolls);
    expect(s.criticalSuccesses).toBe(1);
    expect(s.patzer).toBe(1);
    expect(s.worst?.name).toBe("B");
  });

  it("handles empty input", () => {
    const s = summarizeGroup([]);
    expect(s.count).toBe(0);
    expect(s.best).toBeNull();
  });
});

describe("Sammelprobe", () => {
  // all dice 12 vs attr 12, FW 8 -> rest 8 -> QS 3 per hero
  const rollOne = (fw: number, dice = [12, 12, 12]) => rollParticipants([P("A", fw)], 0, fixedRoller(dice));

  it("accumulates QS and succeeds at the target", () => {
    let s = newSammel({ target: 6, maxAttempts: 5 });
    s = applySammelRound(s, rollOne(8));
    expect(s).toMatchObject({ qs: 3, attempts: 1, status: "läuft" });
    s = applySammelRound(s, rollOne(8));
    expect(s).toMatchObject({ qs: 6, attempts: 2, status: "geschafft" });
    // finished: unchanged
    expect(applySammelRound(s, rollOne(8))).toBe(s);
  });

  it("defaults: target 10, 7 attempts", () => {
    const s = newSammel();
    expect(s.target).toBe(10);
    expect(s.maxAttempts).toBe(7);
    expect(s.status).toBe("läuft");
  });

  it("fails when attempts run out; Teilerfolg at >= threshold", () => {
    let s = newSammel({ target: 99, maxAttempts: 2 });
    s = applySammelRound(s, rollOne(8));
    s = applySammelRound(s, rollOne(8));
    expect(s.qs).toBe(6);
    expect(SAMMEL_TEILERFOLG_MIN_QS).toBe(6);
    expect(s).toMatchObject({ status: "gescheitert", teilerfolg: true });
    let f = newSammel({ target: 99, maxAttempts: 1 });
    f = applySammelRound(f, rollOne(8));
    expect(f).toMatchObject({ status: "gescheitert", teilerfolg: false });
  });

  it("failed rolls add nothing", () => {
    const s = applySammelRound(newSammel(), rollOne(0, [20, 12, 12]));
    expect(s.qs).toBe(0);
    expect(s.attempts).toBe(1);
  });

  it("critical success doubles the QS of that roll", () => {
    // 1,1,12 -> critical success, FW 8: rest 8 -> QS 3 -> doubled
    const rolls = rollOne(8, [1, 1, 12]);
    expect(rolls[0].result.critical).toBe("success");
    const s = applySammelRound(newSammel(), rolls);
    expect(s.qs).toBe(rolls[0].result.qs * SAMMEL_CRIT_MULTIPLIER);
  });

  it("Patzer resets the QS and ends the Sammelprobe", () => {
    let s = applySammelRound(newSammel(), rollOne(8));
    expect(s.qs).toBe(3);
    s = applySammelRound(s, rollOne(8, [20, 20, 5]));
    expect(s.qs).toBe(0);
    expect(s).toMatchObject({ status: "gescheitert", patzer: true });
    const r = restartSammel(s);
    expect(r).toMatchObject({ qs: 0, attempts: 0, status: "läuft", target: s.target });
  });

  it("Gruppensammelprobe: sums the QS of all participants per interval", () => {
    const rolls = rollParticipants([P("A", 8), P("B", 8)], 0, fixedRoller([12, 12, 12, 12, 12, 12]));
    const s = applySammelRound(newSammel(), rolls);
    expect(s.qs).toBe(6);
    expect(s.rounds[0].lines).toEqual(["A QS 3", "B QS 3"]);
  });

  it("a Patzer of one participant ruins the shared pool", () => {
    const rolls = rollParticipants([P("A", 8), P("B", 8)], 0, fixedRoller([12, 12, 12, 20, 20, 1]));
    expect(applySammelRound(newSammel(), rolls).qs).toBe(0);
  });
});

describe("result lines", () => {
  it("formats a group line", () => {
    const rolls = rollParticipants([P("Alrik", 5), P("Ilma", 0)], 2, fixedRoller([10, 10, 10, 19, 19, 19]));
    const s = summarizeGroup(rolls);
    const line = groupLine("Sinnesschärfe", 2, rolls, s);
    expect(line).toBe(`> Gruppenprobe Sinnesschärfe +2: Alrik QS ${rolls[0].result.qs}, Ilma misslungen → ${s.totalQs} QS`);
  });

  it("formats a Sammel line", () => {
    let st = newSammel({ interval: "1 Stunde" });
    st = applySammelRound(st, rollParticipants([P("Alrik", 8)], 0, fixedRoller([12, 12, 12])));
    expect(sammelLine("Fährtensuchen", -1, "sammel", st)).toBe("> Sammelprobe Fährtensuchen -1, Versuch 1/7 (1 Stunde): Alrik QS 3 → 3/10 QS (läuft)");
  });

  it("inserts below the button line and replaces an earlier result", () => {
    const text = "a\nText `gruppenprobe: Sinnesschärfe` hier\nb";
    const l1 = "> Gruppenprobe Sinnesschärfe: A QS 1 → 1 QS";
    const once = insertBelow(text, "gruppenprobe: Sinnesschärfe", l1) as string;
    expect(once.split("\n")).toEqual(["a", "Text `gruppenprobe: Sinnesschärfe` hier", l1, "b"]);
    const twice = insertBelow(once, "gruppenprobe: Sinnesschärfe", "> Gruppenprobe Sinnesschärfe: A QS 2 → 2 QS") as string;
    expect(twice.split("\n")).toHaveLength(4);
    expect(twice).toContain("A QS 2");
    expect(insertBelow(text, "nicht da", l1)).toBeNull();
  });
});

describe("parseGroupProbe", () => {
  it("parses a Gruppenprobe with texts", () => {
    const r = parseGroupProbe("gruppenprobe: Sinnesschärfe +2 | ab 6 QS: Alles gesehen | ab 3 QS: Etwas | sonst: Nichts | mind. 2 Erfolge: Zwei Späher");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.kind).toBe("gruppe");
    expect(r.spec.talent.name).toBe("Sinnesschärfe");
    expect(r.spec.modifier).toBe(2);
    expect(r.spec.qsTexts.map((q) => q.min)).toEqual([3, 6]);
    expect(requiredQsOf(r.spec)).toBe(3);
    expect(groupOutcomeTexts(r.spec, 7, 2).map((t) => t.text)).toEqual(["Alles gesehen", "Zwei Späher"]);
    expect(groupOutcomeTexts(r.spec, 4, 1).map((t) => t.text)).toEqual(["Etwas"]);
    expect(groupOutcomeTexts(r.spec, 1, 1).map((t) => t.text)).toEqual(["Nichts"]);
  });

  it("parses a Sammelprobe", () => {
    const r = parseGroupProbe("sammelprobe: Fährtensuchen -1 | Ziel 12 | Versuche 4 | Intervall 1 Stunde | geschafft: Gefunden");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec).toMatchObject({ kind: "sammel", modifier: -1, target: 12, maxAttempts: 4, interval: "1 Stunde" });
    expect(sammelOutcomeTexts(r.spec, "geschafft", false).map((t) => t.text)).toEqual(["Gefunden"]);
    expect(sammelOutcomeTexts(r.spec, "läuft", false)).toEqual([]);
  });

  it("uses defaults and parses Gruppensammelprobe", () => {
    const r = parseGroupProbe("gruppensammelprobe: Klettern | Ziel 10 | Versuche 5");
    expect(r.ok && r.spec.kind).toBe("gruppensammel");
    const d = parseGroupProbe("sammelprobe: Klettern");
    expect(d.ok && d.spec.target).toBe(10);
    expect(d.ok && d.spec.maxAttempts).toBe(7);
  });

  it("reports errors", () => {
    expect(parseGroupProbe("gruppenprobe: Gibtsnicht").ok).toBe(false);
    expect(parseGroupProbe("gruppenprobe: Klettern | Quatsch").ok).toBe(false);
    expect(parseGroupProbe("gruppenprobe: Klettern | Versuche 3").ok).toBe(false);
    expect(parseGroupProbe("probe: Klettern").ok).toBe(false);
  });

  it("recognises prefixes only", () => {
    expect(isGroupProbeCode("sammelprobe: x")).toBe(true);
    expect(isGroupProbeCode("probe: x")).toBe(false);
  });

  it("builds a stable key", () => {
    expect(probeKey("a.md", " sammelprobe:  Klettern ")).toBe("a.md::sammelprobe: Klettern");
  });
});

describe("pruneSaved", () => {
  it("keeps the newest entries", () => {
    const mk = (u: number) => ({ state: newSammel(), selected: [], mods: {}, common: 0, manual: [], updated: u });
    const out = pruneSaved({ a: mk(1), b: mk(3), c: mk(2) }, 2);
    expect(Object.keys(out).sort()).toEqual(["b", "c"]);
  });
});
