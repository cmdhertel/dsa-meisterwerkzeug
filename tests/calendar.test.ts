import { describe, expect, it, vi } from "vitest";
import { fixedRoller } from "../src/engine/dice";
import {
  addDays, diffDays, formatDate, fromDayNumber, holyDay, isValidDate, moonPhase, parseDate, seasonOf, toDayNumber, weekdayName, WEEKDAYS,
} from "../src/calendar/engine";
import { eventFromFrontmatter, indexByDay } from "../src/calendar/events";
import { applyRegen, rerollHero, rollRest, withManualValue } from "../src/calendar/rest";
import { describeWeather, rollWeather } from "../src/calendar/weather";
import { CalendarState, normalizeData, parseStored } from "../src/calendar/state";
import type { App } from "obsidian";
import { isKampagneTyp } from "../src/calendar/events";

describe("calendar engine", () => {
  it("parses and formats", () => {
    expect(formatDate(parseDate("12. Praios 1028 BF")!)).toBe("12. Praios 1028 BF");
    expect(parseDate("12. PRA 1028")).toEqual({ year: 1028, month: 0, day: 12 });
    expect(formatDate(parseDate("3. Namenloser Tag 1028 BF")!)).toBe("3. Namenloser Tag 1028 BF");
    expect(parseDate("30. Rahja 1000")).toEqual({ year: 1000, month: 11, day: 30 });
    expect(parseDate("31. Praios 1028")).toBeNull();
    expect(parseDate("6. Namenloser Tag 1028")).toBeNull();
    expect(parseDate("12. Foobar 1028")).toBeNull();
    expect(parseDate("12. Praios")).toBeNull();
    expect(parseDate("12. Praios", 1030)?.year).toBe(1030);
    expect(parseDate(undefined)).toBeNull();
  });
  it("day arithmetic across month and year borders", () => {
    const d = { year: 1028, month: 11, day: 30 };
    expect(addDays(d, 1)).toEqual({ year: 1028, month: 12, day: 1 });
    expect(addDays(d, 6)).toEqual({ year: 1029, month: 0, day: 1 });
    expect(addDays({ year: 1029, month: 0, day: 1 }, -1)).toEqual({ year: 1028, month: 12, day: 5 });
    expect(diffDays({ year: 1029, month: 0, day: 1 }, { year: 1028, month: 0, day: 1 })).toBe(365);
    for (const n of [0, 1, 359, 360, 364, 365, 100000]) expect(toDayNumber(fromDayNumber(n))).toBe(n);
    expect(isValidDate({ year: 1, month: 12, day: 5 })).toBe(true);
  });
  it("weekday cycles by 7 and moon by 28", () => {
    const d = { year: 1028, month: 3, day: 4 };
    expect(weekdayName(addDays(d, 7))).toBe(weekdayName(d));
    expect(weekdayName(addDays(d, 1))).toBe(WEEKDAYS[(WEEKDAYS.indexOf(weekdayName(d) as never) + 1) % 7]);
    expect(moonPhase(addDays(d, 28)).name).toBe(moonPhase(d).name);
    expect(new Set(Array.from({ length: 28 }, (_, i) => moonPhase(addDays(d, i)).name)).size).toBe(4);
  });
  it("season and holy days", () => {
    expect(seasonOf({ year: 1, month: 6, day: 1 })).toBe("Winter");
    expect(holyDay({ year: 1028, month: 0, day: 1 })).toContain("Praios");
    expect(holyDay({ year: 1028, month: 0, day: 2 })).toBeNull();
  });
});

describe("events", () => {
  it("reads ereignis notes and skips bad dates", () => {
    const e = eventFromFrontmatter("a.md", "A", { typ: "ereignis", datum_bf: "5. Rondra 1028 BF", kampagne: "[[Die Nebelfurt]]" });
    expect(e?.campaign).toBe("Die Nebelfurt");
    expect(e?.date).toEqual({ year: 1028, month: 1, day: 5 });
    expect(eventFromFrontmatter("b.md", "B", { typ: "ereignis", datum_bf: "irgendwann" })).toBeNull();
    expect(eventFromFrontmatter("c.md", "C", { typ: "nsc", datum_bf: "5. Rondra 1028" })).toBeNull();
    expect(eventFromFrontmatter("d.md", "D", { typ: "session", datum: "2026-10-17" })).toBeNull();
    expect(indexByDay([e!]).get(e!.day)).toHaveLength(1);
  });
});

describe("weather", () => {
  it("is deterministic with injected rng", () => {
    const w = rollWeather("mittelreich", "Winter", fixedRoller([1, 20, 19]));
    expect(w.temp).toBe(0);
    expect(w.snow).toBe(true);
    expect(w.wind).toBe(4);
    expect(w.sky).toBe(4);
    expect(w.description).toContain("Unwetter");
    expect(w.description).toContain("Schneetreiben");
    expect(w.hint).toContain("Fernkampf");
  });
  it("fog gives sight hint; desert stays dry and hot", () => {
    const fog = rollWeather("kueste", "Herbst", fixedRoller([3, 1, 11]));
    expect(fog.sky).toBe(2);
    expect(fog.hint).toContain("Sinnesschärfe (Sicht)");
    const d = rollWeather("wueste", "Sommer", fixedRoller([6, 1, 1]));
    expect(d.temp).toBe(7);
    expect(d.sky).toBe(0);
    expect(describeWeather(d).hint).toContain("Hitze");
  });
});

describe("rest", () => {
  it("caps at max, never negative, never below current", () => {
    expect(applyRegen(10, 12, 6, 0)).toEqual({ gain: 2, after: 12 });
    expect(applyRegen(10, 30, 1, -2)).toEqual({ gain: 0, after: 10 });
    expect(applyRegen(10, 30, 4, 1)).toEqual({ gain: 5, after: 15 });
    expect(applyRegen(0, 0, 6, 0)).toEqual({ gain: 0, after: 0 });
  });
  it("rolls per pool, skipping missing ones", () => {
    const r = rollRest(
      [{ id: "1", name: "A", lep: { current: 10, max: 30 }, asp: { current: 5, max: 20 }, kap: { current: 0, max: 0 }, mod: 1 }],
      1,
      fixedRoller([3, 6]),
    );
    expect(r[0].lep).toMatchObject({ roll: 3, mod: 2, gain: 5, after: 15 });
    expect(r[0].asp).toMatchObject({ roll: 6, after: 13 });
    expect(r[0].kap.active).toBe(false);
    expect(withManualValue(r[0].lep, 99).after).toBe(30);
    expect(withManualValue(r[0].lep, 12).gain).toBe(2);
  });
});

describe("state", () => {
  it("normalizes garbage", () => {
    const d = normalizeData({ active: "X", campaigns: { X: { date: { year: 1, month: 99, day: 1 }, zone: "nope" } } });
    expect(d.campaigns.X).toEqual({});
    expect(normalizeData(null).active).toBe("*");
  });
});

describe("corrupt calendar.json (#4)", () => {
  const fakeApp = (files: Record<string, string>) => {
    const store = { ...files };
    const write = vi.fn(async (path: string, text: string) => {
      store[path] = text;
    });
    const adapter = {
      exists: async (p: string) => p in store,
      read: async (p: string) => store[p],
      write,
    };
    return { app: { vault: { adapter } } as unknown as App, store, write };
  };
  const PATH = "plugins/x/calendar.json";

  it("parseStored distinguishes missing, valid and corrupt content", () => {
    expect(parseStored(null)).toEqual({ data: normalizeData(null), failed: false });
    expect(parseStored('{"active":"X","campaigns":{},"weather":{}}').data.active).toBe("X");
    expect(parseStored("{\"active\": \"X\"").failed).toBe(true);
  });

  it("does not overwrite a corrupt file: keeps a .bak, reports, and flush refuses to write", async () => {
    const broken = '{"active": "Flu';
    const { app, store, write } = fakeApp({ [PATH]: broken });
    const onLoadFailed = vi.fn();
    const st = new CalendarState(app, PATH, { onLoadFailed });
    await st.load();
    expect(st.loadFailed).toBe(true);
    expect(onLoadFailed).toHaveBeenCalledTimes(1);
    expect(store[`${PATH}.bak`]).toBe(broken);
    st.setActive("Nebelfurt");
    await st.flush();
    expect(write).not.toHaveBeenCalledWith(PATH, expect.anything());
    expect(store[PATH]).toBe(broken);
  });

  it("writes only after a real change", async () => {
    const { app, write } = fakeApp({});
    const st = new CalendarState(app, PATH);
    await st.load();
    await st.flush();
    expect(write).not.toHaveBeenCalled();
    st.setActive("Nebelfurt");
    await st.flush();
    expect(write).toHaveBeenCalledTimes(1);
    await st.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("rest: re-roll one hero (#18)", () => {
  const hero = (id: string, mod = 0) => ({
    id,
    name: id,
    mod,
    lep: { current: 5, max: 20 },
    asp: { current: 0, max: 0 },
    kap: { current: 0, max: 0 },
  });
  it("re-rolls only the changed hero and keeps other manual corrections", () => {
    const heroes = [hero("a"), hero("b", 1), hero("c")];
    let n = 0;
    const roller = () => (n++ % 6) + 1;
    const first = rollRest(heroes, 0, roller);
    const edited = { ...first[0], lep: { ...first[0].lep, after: 12 } };
    const results = [edited, first[1], first[2]];
    const next = rerollHero(heroes, results, 1, 0, () => 6);
    expect(next[0]).toBe(edited);
    expect(next[2]).toBe(first[2]);
    expect(next[1]).not.toBe(first[1]);
    expect(next[1].lep.roll).toBe(6);
    expect(next[1].lep.mod).toBe(1);
  });
});

describe("kampagne links and typ (#41, #30)", () => {
  it("campaign links are reduced to the note name, like in the probe", () => {
    const e = eventFromFrontmatter("a.md", "A", { typ: "ereignis", datum_bf: "5. Rondra 1028 BF", kampagne: "[[Kampagnen/Die Nebelfurt.md|x]]" });
    expect(e?.campaign).toBe("Die Nebelfurt");
  });
  it("typ kampagne is case and whitespace tolerant", () => {
    expect(isKampagneTyp(" Kampagne ")).toBe(true);
    expect(isKampagneTyp("kampagne")).toBe(true);
    expect(isKampagneTyp(undefined)).toBe(false);
  });
});
