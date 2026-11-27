// Derive the Trefferzonen body type, size, KO and zone armour from bestiary frontmatter. Pure, never throws.
import type { BodyType, SizeCat, ZoneRsMap } from "../engine/hitzones";

export interface BodyInfo {
  bodyType: BodyType;
  size: SizeCat;
  ko: number | null;
  zoneRs?: ZoneRsMap;
}

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function parseSize(v: unknown): SizeCat | null {
  const s = norm(v).replace(/ß/g, "ss");
  if (s === "winzig" || s === "klein" || s === "mittel" || s === "riesig") return s;
  if (s === "gross") return "gross";
  return null;
}

const BODY_ALIASES: Record<string, BodyType> = {
  humanoid: "humanoid",
  vierbeiner: "vierbeiner",
  vierbeinig: "vierbeiner",
  sechs: "sechsGliedmassen",
  sechsgliedmassen: "sechsGliedmassen",
  "sechs gliedmassen": "sechsGliedmassen",
  fangarme: "fangarme",
  tentakel: "fangarme",
  amorph: "amorph",
  koerper: "amorph",
  keine: "amorph",
};

export function parseBodyType(v: unknown): BodyType | null {
  const s = norm(v).replace(/ß/g, "ss").replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ü/g, "ue");
  return BODY_ALIASES[s] ?? null;
}

const toInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^\d+/);
  return m ? parseInt(m[0], 10) : null;
};

function tagList(fm: Record<string, unknown>): string[] {
  const t = fm.tags;
  const arr = Array.isArray(t) ? t : typeof t === "string" ? t.split(/[,\s]+/) : [];
  return arr.map((x) => norm(x).replace(/^#/, "")).filter(Boolean);
}

const QUAD_TAGS = ["raubtier", "nutztier", "haustier", "reittier", "wild", "huftier", "kleintier"];
const NON_QUAD_TAGS = ["vogel", "fisch", "insekt", "schwarm", "pflanze", "fluggetier", "meer", "wasser", "reptil"];

/**
 * Body type, in order: frontmatter `koerperbau` override; "Drache" in typus/tags -> sechs Gliedmaßen;
 * tag "tentakel" -> Fangarme; typus "nicht humanoid": land animals with a quadruped tag -> Vierbeiner, everything
 * else -> keine Zonen; otherwise (humanoid or no information) -> Humanoid.
 */
export function deriveBodyType(fm: Record<string, unknown>): BodyType {
  const override = parseBodyType(fm.koerperbau);
  if (override) return override;
  const typus = norm(fm.typus);
  const tags = tagList(fm);
  if (/drache/.test(typus) || tags.includes("drache")) return "sechsGliedmassen";
  if (tags.includes("tentakel")) return "fangarme";
  if (/nicht humanoid/.test(typus)) {
    if (tags.some((t) => QUAD_TAGS.includes(t)) && !tags.some((t) => NON_QUAD_TAGS.includes(t))) return "vierbeiner";
    return "amorph";
  }
  return "humanoid";
}

export function parseZoneRs(v: unknown): ZoneRsMap | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: ZoneRsMap = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = toInt(raw);
    if (n !== null) out[normKey(k)] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/** "Arme" -> "arme", "armL" stays "armL" (zone ids are camelCase), everything else lower case. */
function normKey(k: string): string {
  const t = k.trim();
  const ids = ["armL", "armR", "beinL", "beinR", "vorderbeine", "hinterbeine", "vordereGliedmassen", "mittlereGliedmassen", "hintereGliedmassen"];
  const hit = ids.find((i) => i.toLowerCase() === t.toLowerCase());
  if (hit) return hit;
  return t.toLowerCase().replace(/ß/g, "ss").replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ü/g, "ue");
}

export function deriveBody(fm: Record<string, unknown>): BodyInfo {
  const zoneRs = parseZoneRs(fm.rs_zonen);
  return {
    bodyType: deriveBodyType(fm),
    size: parseSize(fm.groessenkategorie) ?? "mittel",
    ko: toInt(fm.ko),
    ...(zoneRs ? { zoneRs } : {}),
  };
}
