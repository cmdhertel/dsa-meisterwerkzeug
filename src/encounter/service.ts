// Obsidian glue shared by the card and the builder: catalog, hero side, evaluation.
import type DsaMeisterwerkzeugPlugin from "../main";
import { campaignOf } from "../cockpit/actions";
import { heroToCombatant } from "../hero/model";
import type { Estimate } from "./estimate";
import {
  CatalogEntry, CatalogIndex, HeroSide, ResolvedEntry, creatureMeta, defaultManualSide, estimateEncounter, indexCatalog, resolveEntries, resolveHelden,
} from "./build";
import type { EncounterSpec } from "./parse";

export function buildCatalog(plugin: DsaMeisterwerkzeugPlugin): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const f of plugin.bestiary.files()) {
    const r = plugin.bestiary.parseFile(f);
    const fm = plugin.bestiary.frontmatter(f);
    out.push({ path: f.path, basename: f.basename, name: r.combatant.name, combatant: r.combatant, status: r.status, problems: r.problems, ...creatureMeta(fm) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export interface PartyInfo {
  side: HeroSide;
  /** one-line description for the UI */
  label: string;
  /** hero names that will be loaded with "Helden mit laden" (empty if none resolved) */
  heroNames: string[];
  unresolved: string[];
}

export function heroRefs(plugin: DsaMeisterwerkzeugPlugin) {
  return plugin.heroes.all().map((h) => ({ name: h.name, callName: h.callName, campaign: campaignOf(plugin, h.notePath) }));
}

/** Party for an encounter: heroes named by `helden`, else the manual fallback. */
export function resolveParty(plugin: DsaMeisterwerkzeugPlugin, helden: string | undefined, manual?: { count: number; lep: number }): PartyInfo {
  const { names, unresolved } = resolveHelden(helden, heroRefs(plugin));
  const heroes = names.map((n) => plugin.heroes.getByName(n)).filter((h): h is NonNullable<typeof h> => !!h);
  if (heroes.length) {
    return { side: { kind: "heroes", combatants: heroes.map(heroToCombatant) }, label: `${heroes.length} Helden: ${heroes.map((h) => h.name).join(", ")}`, heroNames: heroes.map((h) => h.name), unresolved };
  }
  const side: HeroSide = manual ? { kind: "manual", ...manual } : defaultManualSide();
  const m = side as { count: number; lep: number };
  const why = helden ? "keine Helden gefunden" : "keine Helden angegeben";
  return { side, label: `${why}, Annahme: ${m.count} Helden mit je ${m.lep} LeP`, heroNames: [], unresolved };
}

export interface Evaluation {
  index: CatalogIndex;
  resolved: ResolvedEntry[];
  party: PartyInfo;
  estimate: Estimate;
}

export function evaluate(plugin: DsaMeisterwerkzeugPlugin, spec: EncounterSpec, catalog: CatalogEntry[], counts?: Record<number, number>, manual?: { count: number; lep: number }): Evaluation {
  const index = indexCatalog(catalog);
  const resolved = resolveEntries(spec, index, counts);
  const party = resolveParty(plugin, spec.helden, manual);
  return { index, resolved, party, estimate: estimateEncounter(resolved, party.side) };
}
