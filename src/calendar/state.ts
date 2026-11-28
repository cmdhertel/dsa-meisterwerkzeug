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
  if (r.weather && typeof r.weather === "object") out.weather = r.weather;
  return out;
}

/** Parses the stored file content. `failed` = the file exists but is not valid JSON (never overwrite it). */
export function parseStored(text: string | null): { data: CalendarData; failed: boolean } {
  if (text === null) return { data: emptyData(), failed: false };
  try {
    return { data: normalizeData(JSON.parse(text)), failed: false };
  } catch {
    return { data: emptyData(), failed: true };
  }
}

export interface CalendarStateOptions {
  /** Called once when the stored file could not be loaded (the UI shows a Notice). */
  onLoadFailed?: () => void;
}

export class CalendarState {
  data: CalendarData = emptyData();
  /** the stored file is unreadable or corrupt: writing would destroy it */
  loadFailed = false;
  /** in-memory data differs from the stored file */
  private dirty = false;
  private listeners = new Set<() => void>();
  private timer: number | null = null;

  constructor(private app: App, private path: string, private opts: CalendarStateOptions = {}) {}

  async load(): Promise<void> {
    let raw: string | null = null;
    let readOk = true;
    try {
      if (await this.app.vault.adapter.exists(this.path)) raw = await this.app.vault.adapter.read(this.path);
    } catch (e) {
      readOk = false;
      console.error("Kalender: Lesen fehlgeschlagen", e);
    }
    const parsed = readOk ? parseStored(raw) : { data: emptyData(), failed: true };
    this.data = parsed.data;
    if (parsed.failed) {
      this.loadFailed = true;
      if (raw !== null) {
        // keep the broken file for the GM to recover by hand
        try {
          await this.app.vault.adapter.write(`${this.path}.bak`, raw);
        } catch (e) {
          console.error("Kalender: Sicherungskopie fehlgeschlagen", e);
        }
      }
      this.opts.onLoadFailed?.();
    }
    this.listeners.forEach((f) => f());
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.dirty = true;
    this.listeners.forEach((f) => f());
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 300);
  }

  async flush(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.loadFailed || !this.dirty) return;
    this.dirty = false;
    try {
      await this.app.vault.adapter.write(this.path, JSON.stringify(this.data, null, 2));
    } catch (e) {
      this.dirty = true;
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
