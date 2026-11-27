// Kalender sidebar view.
import { ItemView, WorkspaceLeaf } from "obsidian";
import { listCampaigns } from "./campaigns";
import { defaultRoller } from "../engine/dice";
import type DsaMeisterwerkzeugPlugin from "../main";
import {
  AvDate, NAMENLOSE, addDays, daysInMonth, formatDate, holyDay, moonPhase, monthName, parseDate, sameDate, seasonOf, weekdayIndex, weekdayName,
} from "./engine";
import { CalEvent, eventFromFrontmatter, indexByDay } from "./events";
import { promptText } from "./prompt";
import { openRestModal } from "./restModal";
import { GLOBAL, calendarOf } from "./state";
import { ZONES, ZoneId, rollWeather } from "./weather";
import { toDayNumber } from "./engine";

export const CALENDAR_VIEW_TYPE = "dsa-calendar-view";
/** re-render delay after a state change (user action) */
const RENDER_DELAY_MS = 100;
/** re-render delay after a note's metadata changed: bursts of saves collapse into one rescan */
const METADATA_DELAY_MS = 400;

export async function askForDate(plugin: DsaMeisterwerkzeugPlugin): Promise<AvDate | null> {
  const cur = calendarOf(plugin).getDate();
  const text = await promptText(plugin.app, "Datum setzen", "12. Praios 1028 BF", formatDate(cur), (v) =>
    parseDate(v, cur.year) ? null : "Datum nicht erkannt (z. B. „12. Praios 1028 BF“).",
  );
  if (text === null) return null;
  const d = parseDate(text, cur.year);
  if (d) calendarOf(plugin).setDate(d);
  return d;
}

export class CalendarView extends ItemView {
  private shown: { year: number; month: number } | null = null;
  private selectedDay: number | null = null;
  private events = new Map<number, CalEvent[]>();
  private timer: number | null = null;
  private rescanPending = false;
  /** keyboard focus was on a day cell before the last render; put it back on the same day */
  private restoreFocus = false;

  constructor(leaf: WorkspaceLeaf, private plugin: DsaMeisterwerkzeugPlugin) {
    super(leaf);
  }
  getViewType() {
    return CALENDAR_VIEW_TYPE;
  }
  getDisplayText() {
    return "Aventurischer Kalender";
  }
  getIcon() {
    return "calendar-days";
  }

  async onOpen() {
    this.contentEl.addClass("dsa-cal");
    this.register(calendarOf(this.plugin).on(() => this.schedule()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.schedule(true)));
    this.scanEvents();
    this.render();
  }
  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  private schedule(rescan = false) {
    this.rescanPending ||= rescan;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.rescanPending) {
        this.rescanPending = false;
        this.scanEvents();
      }
      this.render();
    }, rescan ? METADATA_DELAY_MS : RENDER_DELAY_MS);
  }

  private scanEvents() {
    const all: CalEvent[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined;
      if (!fm) continue;
      const e = eventFromFrontmatter(f.path, f.basename, fm);
      if (e) all.push(e);
    }
    const c = calendarOf(this.plugin).active;
    this.events = indexByDay(c === GLOBAL ? all : all.filter((e) => !e.campaign || e.campaign === c));
    this.allEvents = all;
  }
  private allEvents: CalEvent[] = [];

  private campaigns(): string[] {
    return listCampaigns(this.plugin);
  }

  private render() {
    const cal = calendarOf(this.plugin);
    const el = this.contentEl;
    el.empty();
    const focusDay = this.restoreFocus;
    this.restoreFocus = false;
    const today = cal.getDate();
    if (!this.shown) this.shown = { year: today.year, month: today.month };

    // header: campaign + zone
    const head = el.createDiv({ cls: "dsa-cal-head" });
    const camp = head.createEl("select", { cls: "dropdown" });
    camp.createEl("option", { text: "Globaler Standard", value: GLOBAL });
    for (const c of this.campaigns()) camp.createEl("option", { text: c, value: c });
    camp.value = cal.active;
    camp.onchange = () => {
      cal.setActive(camp.value);
      this.shown = null;
      this.scanEvents();
    };
    const zone = head.createEl("select", { cls: "dropdown", attr: { title: "Klimazone" } });
    for (const z of ZONES) zone.createEl("option", { text: z.label, value: z.id });
    zone.value = cal.getZone();
    zone.onchange = () => cal.setZone(zone.value as ZoneId);

    // today
    const t = el.createDiv({ cls: "dsa-cal-today" });
    t.createDiv({ cls: "dsa-cal-date", text: formatDate(today) });
    const phase = moonPhase(today);
    const info = [weekdayName(today), `${phase.name} (${phase.alt})`, seasonOf(today)];
    t.createDiv({ cls: "dsa-cal-info", text: info.join(" · ") });
    const holy = holyDay(today);
    if (holy) t.createDiv({ cls: "dsa-cal-holy", text: holy });

    // weather
    const wBox = el.createDiv({ cls: "dsa-cal-weather" });
    const w = cal.getWeather(today);
    if (w) {
      wBox.createDiv({ cls: "dsa-cal-weather-line", text: w.description });
      if (w.hint) wBox.createDiv({ cls: "dsa-cal-weather-hint", text: w.hint });
    } else wBox.createDiv({ cls: "dsa-cal-weather-line dsa-cal-muted", text: "Wetter noch nicht gewürfelt." });
    const wb = wBox.createEl("button", { text: w ? "Wetter neu würfeln" : "Wetter würfeln" });
    wb.onclick = () => cal.setWeather(today, rollWeather(cal.getZone(), seasonOf(today), defaultRoller));

    // buttons
    const btns = el.createDiv({ cls: "dsa-cal-buttons" });
    const mk = (label: string, fn: () => void) => (btns.createEl("button", { text: label }).onclick = fn);
    mk("−1 Tag", () => cal.advance(-1));
    mk("+1 Tag", () => cal.advance(1));
    mk("+1 Woche", () => cal.advance(7));
    mk("Datum setzen", () => void askForDate(this.plugin));
    mk("Rast", () => openRestModal(this.plugin));

    // month grid
    const s = this.shown;
    const nav = el.createDiv({ cls: "dsa-cal-nav" });
    const step = (n: number) => {
      let m = s.month + n;
      let y = s.year;
      if (m > NAMENLOSE) (m = 0), y++;
      else if (m < 0) (m = NAMENLOSE), y--;
      this.shown = { year: y, month: m };
      this.selectedDay = null;
      this.render();
    };
    nav.createEl("button", { text: "‹", attr: { "aria-label": "Vorheriger Monat" } }).onclick = () => step(-1);
    nav.createSpan({ text: `${monthName(s.month)} ${s.year} BF`, cls: "dsa-cal-nav-title" });
    nav.createEl("button", { text: "›", attr: { "aria-label": "Nächster Monat" } }).onclick = () => step(1);
    nav.createEl("button", { text: "Heute" }).onclick = () => {
      this.shown = { year: today.year, month: today.month };
      this.render();
    };

    const grid = el.createDiv({ cls: "dsa-cal-grid" });
    for (const wd of ["Wi", "Er", "Ma", "Pr", "Ro", "Fe", "Wa"]) grid.createDiv({ cls: "dsa-cal-wd", text: wd });
    const n = daysInMonth(s.month);
    const first: AvDate = { year: s.year, month: s.month, day: 1 };
    for (let i = 0; i < weekdayIndex(first); i++) grid.createDiv({ cls: "dsa-cal-cell dsa-cal-empty" });
    for (let day = 1; day <= n; day++) {
      const d: AvDate = { year: s.year, month: s.month, day };
      const dn = toDayNumber(d);
      const cell = grid.createEl("button", { cls: "dsa-cal-cell", text: String(day), attr: { type: "button", "aria-label": formatDate(d) } });
      if (sameDate(d, today)) {
        cell.addClass("is-today");
        cell.setAttr("aria-current", "date");
      }
      if (this.selectedDay === dn) cell.addClass("is-selected");
      cell.setAttr("aria-pressed", String(this.selectedDay === dn));
      if (holyDay(d)) cell.addClass("is-holy");
      const evs = this.events.get(dn);
      if (evs?.length) {
        cell.addClass("has-events");
        cell.title = evs.map((e) => e.title).join("\n");
      }
      if (focusDay && this.selectedDay === dn) cell.focus();
      cell.onclick = () => {
        this.selectedDay = dn;
        this.restoreFocus = true;
        this.render();
      };
      cell.oncontextmenu = (ev) => {
        ev.preventDefault();
        cal.setDate(d);
      };
    }
    el.createDiv({ cls: "dsa-cal-muted dsa-cal-tip", text: "Tag antippen für Notizen. Rechtsklick setzt einen Tag direkt als aktuelles Datum." });

    // selected day
    if (this.selectedDay !== null) {
      const d = addDays({ year: 1, month: 0, day: 1 }, this.selectedDay);
      const box = el.createDiv({ cls: "dsa-cal-day" });
      box.createEl("h4", { text: `${formatDate(d)} (${weekdayName(d)})` });
      const h = holyDay(d);
      if (h) box.createDiv({ cls: "dsa-cal-holy", text: h });
      // touch-friendly alternative to the right-click on a day
      box.createEl("button", { text: "Als heutiges Datum setzen" }).onclick = () => cal.setDate(d);
      const evs = this.events.get(this.selectedDay) ?? [];
      if (!evs.length) box.createDiv({ cls: "dsa-cal-muted", text: "Keine Notizen an diesem Tag." });
      for (const e of evs) {
        const a = box.createEl("a", { text: `${e.title} (${e.typ})`, cls: "dsa-cal-link" });
        a.onclick = () => void this.app.workspace.openLinkText(e.path, "", false);
      }
      const wd = cal.getWeather(d);
      if (wd) box.createDiv({ cls: "dsa-cal-weather-hint", text: `Wetter: ${wd.description}` });
    }
  }
}
