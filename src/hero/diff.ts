// Human-readable change list between two heroes (previously imported vs new). Pure.
import { TALENTS } from "../data/talents.generated";
import { ATTR_KEYS } from "../engine/types";
import { Hero, weaponValues } from "./model";
import { valueText } from "../valueText";

export interface HeroFlat {
  /** simple values: attributes, derived values */
  scalars: Map<string, number>;
  talents: Map<string, number>;
  spells: Map<string, number>;
  weapons: Map<string, string>;
}

export function flatten(h: Hero): HeroFlat {
  const scalars = new Map<string, number>();
  for (const k of ATTR_KEYS) scalars.set(k, h.attributes[k]);
  scalars.set("LeP", h.lep.max);
  scalars.set("AsP", h.asp.max);
  scalars.set("Schip", h.schip.max);
  scalars.set("INI", h.ini);
  scalars.set("AW", h.aw);
  scalars.set("SK", h.sk);
  scalars.set("ZK", h.zk);
  scalars.set("GS", h.gs);
  scalars.set("Wundschwelle", h.wundschwelle);
  const talents = new Map<string, number>();
  for (const t of TALENTS) talents.set(t.name, h.talents[t.name] ?? 0);
  for (const u of h.unknownTalents) talents.set(`Talent #${u.key}`, u.value);
  const spells = new Map(h.spells.map((s) => [s.label, s.value] as [string, number]));
  const weapons = new Map<string, string>();
  for (const w of h.weapons) {
    const v = weaponValues(h, w);
    weapons.set(`${w.category === "ranged" ? "Fernkampf" : "Nahkampf"}: ${w.label}`, `AT/FK ${v.kind === "ranged" ? v.fk : v.at ?? "–"}, PA ${v.pa ?? "–"}, TP ${v.tp ?? "–"}`);
  }
  return { scalars, talents, spells, weapons };
}

/** `prev` = null for a first import. */
export function diffHeroes(prev: Hero | null, next: Hero): string[] {
  const n = flatten(next);
  const out: string[] = [];
  if (!prev) {
    const t = [...n.talents.values()].filter((v) => v > 0).length;
    out.push(`Erstimport: ${t} Talente, ${n.spells.size} Zauber, ${n.weapons.size} Waffen`);
    return out;
  }
  const p = flatten(prev);
  for (const [k, v] of n.scalars) if (p.scalars.get(k) !== v) out.push(`${k} ${p.scalars.get(k) ?? "–"} → ${v}`);
  for (const [k, v] of n.talents) {
    const old = p.talents.get(k) ?? 0;
    if (old !== v) out.push(`${k} ${old} → ${v}`);
  }
  for (const [k, v] of n.spells) {
    if (!p.spells.has(k)) out.push(`neu: ${k} (ZfW ${v})`);
    else if (p.spells.get(k) !== v) out.push(`${k} ${p.spells.get(k)} → ${v}`);
  }
  for (const k of p.spells.keys()) if (!n.spells.has(k)) out.push(`entfernt: ${k}`);
  for (const [k, v] of n.weapons) {
    if (!p.weapons.has(k)) out.push(`neu: ${k} (${v})`);
    else if (p.weapons.get(k) !== v) out.push(`${k}: ${p.weapons.get(k)} → ${v}`);
  }
  for (const k of p.weapons.keys()) if (!n.weapons.has(k)) out.push(`entfernt: ${k}`);
  return out;
}

/** Frontmatter keys written by the import, from a hero. */
export function frontmatterValues(h: Hero): Record<string, string | number> {
  const fm: Record<string, string | number> = {};
  for (const k of ATTR_KEYS) fm[k] = h.attributes[k];
  fm.LeP = h.lep.max;
  fm.AsP = h.asp.max;
  fm.INI = h.ini;
  fm.AW = h.aw;
  fm.SK = h.sk;
  fm.ZK = h.zk;
  fm.GS = h.gs;
  fm.Schip = h.schip.max;
  fm.heldenschmiede_uid = h.uid;
  return fm;
}

/** Diff of frontmatter: existing note values vs. values the import would write. */
export function diffFrontmatter(existing: Record<string, unknown> | null, next: Record<string, string | number>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    const old = existing?.[k];
    const empty = old === undefined || old === null || old === "";
    if (empty) out.push(`Frontmatter ${k}: (leer) → ${v}`);
    else if (valueText(old) !== valueText(v)) out.push(`Frontmatter ${k}: ${valueText(old)} → ${v}`);
  }
  return out;
}
