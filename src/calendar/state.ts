// Calendar state: stored in its own file (calendar.json) in the plugin folder, because
// plugin.persist() rewrites data.json with only settings + combat.
import type { App } from "obsidian";
import { AvDate, addDays, isValidDate, toDayNumber } from "./engine";
import { DEFAULT_ZONE, Weather, ZONES, ZoneId } from "./weather";

export const GLOBAL = "*";
export const DEFAULT_DATE: AvDate = { year: 1028, month: 0, day: 1 };

export interface CampaignCal {
  date?: AvDate;
  zone?: ZoneId;
}
export interface CalendarData {
  /** last selected campaign ("*" = global default) */
  active: string;
  campaigns: Record<string, CampaignCal>;
  /** campaign -> day number -> rolled weather */
  weather: Record<string, Record<string, Weather>>;
}

export const emptyData = (): CalendarData => ({ active: GLOBAL, campaigns: {}, weather: {} });

export function normalizeData(raw: unknown): CalendarData {
  const out = emptyData();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<CalendarData>;
  if (typeof r.active === "string") out.active = r.active;
  if (r.campaigns && typeof r.campaigns === "object") {
    for (const [k, v] of Object.entries(r.campaigns)) {
      const c: CampaignCal = {};
      if (v?.date && isValidDate(v.date)) c.date = { year: v.date.year, month: v.date.month, day: v.date.day };
      if (v?.zone && ZONES.some((z) => z.id === v.zone)) c.zone = v.zone;
      out.campaigns[k] = c;
    }
  }
  if (r.weather && typeof r.weather === "object") out.weather = r.weather as CalendarData["weather"];
  return out;
}

export class CalendarState {
  data: CalendarData = emptyData();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private app: App, private path: string) {}

  async load(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.path)) this.data = normalizeData(JSON.parse(await this.app.vault.adapter.read(this.path)));
    } catch {
      this.data = emptyData();
    }
    this.listeners.forEach((f) => f());
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.listeners.forEach((f) => f());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      await this.app.vault.adapter.write(this.path, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error("Kalender: Speichern fehlgeschlagen", e);
    }
  }

  get active(): string {
    return this.data.active;
  }
  setActive(c: string): void {
    this.data.active = c || GLOBAL;
    this.changed();
  }

  /** date of a campaign; falls back to the global default, then DEFAULT_DATE */
  getDate(campaign = this.active): AvDate {
    return this.data.campaigns[campaign]?.date ?? this.data.campaigns[GLOBAL]?.date ?? DEFAULT_DATE;
  }
  setDate(d: AvDate, campaign = this.active): void {
    this.data.campaigns[campaign] = { ...this.data.campaigns[campaign], date: { ...d } };
    this.changed();
  }
  advance(days: number, campaign = this.active): AvDate {
    const d = addDays(this.getDate(campaign), days);
    this.setDate(d, campaign);
    return d;
  }

  getZone(campaign = this.active): ZoneId {
    return this.data.campaigns[campaign]?.zone ?? this.data.campaigns[GLOBAL]?.zone ?? DEFAULT_ZONE;
  }
  setZone(z: ZoneId, campaign = this.active): void {
    this.data.campaigns[campaign] = { ...this.data.campaigns[campaign], zone: z };
    this.changed();
  }

  getWeather(d: AvDate, campaign = this.active): Weather | undefined {
    return this.data.weather[campaign]?.[String(toDayNumber(d))];
  }
  setWeather(d: AvDate, w: Weather, campaign = this.active): void {
    (this.data.weather[campaign] ??= {})[String(toDayNumber(d))] = w;
    this.changed();
  }
}

const REGISTRY = new WeakMap<object, CalendarState>();
export const setCalendar = (plugin: object, s: CalendarState): void => void REGISTRY.set(plugin, s);
/** The calendar state of the plugin (created by registerCalendar). */
export function calendarOf(plugin: object): CalendarState {
  const s = REGISTRY.get(plugin);
  if (!s) throw new Error("Kalender nicht initialisiert");
  return s;
}
