// Table-driven weather generator. Pure; RNG injected (Roller from the engine).
import type { Roller } from "../engine/dice";
import type { Season } from "./engine";

export type ZoneId = "mittelreich" | "norden" | "sueden" | "wueste" | "gebirge" | "kueste";
export const ZONES: { id: ZoneId; label: string }[] = [
  { id: "mittelreich", label: "Mittelreich / gemäßigt" },
  { id: "norden", label: "Norden / kalt" },
  { id: "sueden", label: "Süden / heiß" },
  { id: "wueste", label: "Wüste" },
  { id: "gebirge", label: "Gebirge" },
  { id: "kueste", label: "Küste" },
];
export const DEFAULT_ZONE: ZoneId = "mittelreich";

export const TEMP_BANDS = ["eisig", "frostig", "kalt", "kühl", "mild", "warm", "heiß", "glühend"] as const;
export const WINDS = ["windstill", "leichter Wind", "mäßiger Wind", "starker Wind", "Sturm"] as const;
export const SKIES = ["klar", "bewölkt", "Nebel", "Regen", "Starkregen"] as const;

const SEASON_IDX: Record<Season, number> = { Frühling: 0, Sommer: 1, Herbst: 2, Winter: 3 };

/** base temperature band index per season [Frühling, Sommer, Herbst, Winter] */
const BASE_TEMP: Record<ZoneId, number[]> = {
  mittelreich: [3, 5, 3, 1],
  norden: [2, 3, 2, 0],
  sueden: [5, 6, 5, 4],
  wueste: [5, 7, 5, 3],
  gebirge: [2, 3, 2, 0],
  kueste: [3, 4, 3, 2],
};

/** wind bonus added to the d20 roll */
const WIND_MOD: Record<ZoneId, number> = { mittelreich: 0, norden: 1, sueden: 0, wueste: 0, gebirge: 3, kueste: 3 };

/** weights over SKIES (sum 20) per season [Frühling, Sommer, Herbst, Winter] */
const SKY_WEIGHTS: Record<ZoneId, number[][]> = {
  mittelreich: [[5, 6, 2, 5, 2], [8, 6, 0, 4, 2], [4, 6, 4, 4, 2], [3, 7, 3, 4, 3]],
  norden: [[4, 6, 3, 5, 2], [6, 6, 2, 4, 2], [3, 6, 4, 5, 2], [3, 6, 3, 5, 3]],
  sueden: [[9, 6, 1, 3, 1], [12, 5, 0, 2, 1], [8, 6, 1, 3, 2], [7, 6, 2, 4, 1]],
  wueste: [[16, 3, 0, 1, 0], [18, 2, 0, 0, 0], [16, 3, 0, 1, 0], [15, 4, 0, 1, 0]],
  gebirge: [[4, 6, 4, 4, 2], [6, 6, 3, 3, 2], [3, 6, 5, 4, 2], [3, 5, 4, 5, 3]],
  kueste: [[4, 6, 3, 5, 2], [6, 6, 2, 4, 2], [3, 6, 3, 5, 3], [3, 6, 3, 5, 3]],
};

export interface Weather {
  zone: ZoneId;
  /** index into TEMP_BANDS */
  temp: number;
  /** index into WINDS */
  wind: number;
  /** index into SKIES */
  sky: number;
  /** true when precipitation falls as snow (temp frostig or colder) */
  snow: boolean;
  description: string;
  /** short generic rules hint, may be empty */
  hint: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function pickWeighted(weights: number[], roll: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (roll <= acc) return i;
  }
  return weights.length - 1;
}

function windIndex(roll: number, mod: number): number {
  const v = roll + mod;
  if (v <= 4) return 0;
  if (v <= 10) return 1;
  if (v <= 16) return 2;
  if (v <= 19) return 3;
  return 4;
}

/** Builds description + hint from the indices. Pure helper, also used when re-rendering stored weather. */
export function describeWeather(w: Pick<Weather, "temp" | "wind" | "sky" | "snow">): { description: string; hint: string } {
  const skyBase = SKIES[w.sky];
  let sky: string = skyBase;
  if (w.snow && skyBase === "Regen") sky = "Schneefall";
  if (w.snow && skyBase === "Starkregen") sky = "dichtes Schneetreiben";
  const storm = w.wind === 4;
  const parts = [`${capital(TEMP_BANDS[w.temp])}, ${sky}`, WINDS[w.wind]];
  let description = parts.join(", ") + ".";
  if (storm && (skyBase === "Starkregen")) description = `Unwetter: ${description}`;

  const hints: string[] = [];
  if (skyBase === "Nebel") hints.push("Nebel: Sicht stark eingeschränkt, Sinnesschärfe (Sicht) und Fernkampf erschwert.");
  if (skyBase === "Starkregen") hints.push(w.snow ? "Schneetreiben: Sicht schlecht, Fernkampf und Sinnesschärfe (Sicht) erschwert, Reisetempo sinkt." : "Starkregen: Sicht schlecht, Fernkampf und Sinnesschärfe (Sicht) erschwert, Feuer schwer zu entzünden.");
  else if (skyBase === "Regen" && !w.snow) hints.push("Regen: Fernkampf leicht erschwert, Spuren verwischen.");
  if (storm) hints.push("Sturm: Fernkampf stark erschwert, Reiten und Überfahrten gefährlich.");
  else if (w.wind === 3) hints.push("Starker Wind: Fernkampf erschwert.");
  if (w.temp >= 6) hints.push("Hitze: erhöhter Wasserbedarf, Anstrengung kann Erschöpfung nach sich ziehen.");
  if (w.temp <= 1) hints.push("Kälte: ohne passende Kleidung und Rast droht Erschöpfung/Unterkühlung.");
  return { description, hint: hints.join(" ") };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Roll weather: d6 temperature variation, d20 wind, d20 sky. */
export function rollWeather(zone: ZoneId, season: Season, roller: Roller): Weather {
  const si = SEASON_IDX[season];
  const tRoll = roller(6);
  const temp = clamp(BASE_TEMP[zone][si] + (tRoll === 1 ? -1 : tRoll === 6 ? 1 : 0), 0, TEMP_BANDS.length - 1);
  const wind = windIndex(roller(20), WIND_MOD[zone]);
  const sky = pickWeighted(SKY_WEIGHTS[zone][si], roller(20));
  const snow = temp <= 1;
  return { zone, temp, wind, sky, snow, ...describeWeather({ temp, wind, sky, snow }) };
}
