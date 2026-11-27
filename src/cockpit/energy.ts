// AsP/KaP of combatants: capture from the source note when they join, keep hero values in sync with the note.
import type DsaMeisterwerkzeugPlugin from "../main";
import type { CombatEntry } from "../combat/store";
import { EnergyKind, spentForCurrent } from "../combat/energy";
import { KEY_ASP_CURRENT, KEY_KAP_CURRENT, energyNumber } from "../magic/casters";

export interface NoteEnergy {
  aspMax: number;
  kapMax: number;
  /** heroes only: max - AsP_aktuell/KaP_aktuell (undefined for creatures) */
  aspSpent?: number;
  kapSpent?: number;
}

type Fm = Record<string, unknown>;

/** Hero note frontmatter: max = AsP/KaP, current = AsP_aktuell/KaP_aktuell (missing = full). `heroAspMax` is the imported hero's fallback. */
export function heroEnergyFromFm(fm: Fm, heroAspMax?: number): NoteEnergy {
  const aspMax = Math.max(0, energyNumber(fm["AsP"]) ?? heroAspMax ?? 0);
  const kapMax = Math.max(0, energyNumber(fm["KaP"]) ?? 0);
  return {
    aspMax,
    kapMax,
    aspSpent: spentForCurrent(aspMax, energyNumber(fm[KEY_ASP_CURRENT]) ?? aspMax),
    kapSpent: spentForCurrent(kapMax, energyNumber(fm[KEY_KAP_CURRENT]) ?? kapMax),
  };
}

/** Bestiary frontmatter: asp / kap. */
export function creatureEnergyFromFm(fm: Fm): NoteEnergy {
  return { aspMax: Math.max(0, energyNumber(fm["asp"]) ?? 0), kapMax: Math.max(0, energyNumber(fm["kap"]) ?? 0) };
}

const noteKey = (kind: EnergyKind) => (kind === "AsP" ? KEY_ASP_CURRENT : KEY_KAP_CURRENT);

/** Capture / refresh one combatant from its note. Heroes always follow the note; creatures only fill what is missing. */
export function syncEntryEnergy(plugin: DsaMeisterwerkzeugPlugin, e: CombatEntry): void {
  if (!e.sourcePath) return;
  const fm = (e.kind === "hero" ? plugin.app.metadataCache.getCache(e.sourcePath)?.frontmatter : plugin.bestiary.frontmatterByPath(e.sourcePath)) as Fm | undefined;
  if (!fm) return;
  if (e.kind === "hero") {
    plugin.combat.syncEnergy(e.id, heroEnergyFromFm(fm, plugin.heroes.getByPath(e.sourcePath)?.asp.max));
  } else if (e.aspMax === undefined || e.kapMax === undefined) {
    plugin.combat.syncEnergy(e.id, creatureEnergyFromFm(fm));
  }
}

/** Write the combatant's current value back to its hero note (no-op for creatures / manual heroes). */
export async function writeHeroEnergy(plugin: DsaMeisterwerkzeugPlugin, id: string, kind: EnergyKind): Promise<void> {
  const e = plugin.combat.get(id);
  const en = e && plugin.combat.energy(id, kind);
  if (!e || !en || e.kind !== "hero" || !e.sourcePath) return;
  const file = plugin.app.vault.getFileByPath(e.sourcePath);
  if (!file) return;
  await plugin.app.fileManager.processFrontMatter(file, (fm: Fm) => {
    fm[noteKey(kind)] = en.cur;
  });
}

/** GM adjusts AsP/KaP by hand: store (undoable, clamped) + note for heroes. */
export function adjustEnergy(plugin: DsaMeisterwerkzeugPlugin, id: string, kind: EnergyKind, cur: number): void {
  if (!plugin.combat.setEnergyCurrent(id, kind, cur)) return;
  void writeHeroEnergy(plugin, id, kind);
}

export function registerEnergySync(plugin: DsaMeisterwerkzeugPlugin): void {
  const syncAll = (skip: string[] = []) => {
    for (const e of plugin.combat.entries) if (!skip.includes(e.id)) syncEntryEnergy(plugin, e);
  };
  plugin.register(
    plugin.combat.on((ev) => {
      if (ev.type === "add" || ev.type === "load") syncAll();
      else if (ev.type === "undo") {
        // the undone step's value is the truth for its heroes (write it to the note); everything else follows the notes
        for (const id of ev.energyIds ?? []) {
          void writeHeroEnergy(plugin, id, "AsP");
          void writeHeroEnergy(plugin, id, "KaP");
        }
        syncAll(ev.energyIds ?? []);
      }
    }),
  );
  const { metadataCache } = plugin.app;
  plugin.registerEvent(
    metadataCache.on("changed", (file) => {
      for (const e of plugin.combat.entries) if (e.kind === "hero" && e.sourcePath === file.path) syncEntryEnergy(plugin, e);
    }),
  );
  plugin.registerEvent(metadataCache.on("resolved", () => syncAll()));
  plugin.app.workspace.onLayoutReady(() => syncAll());
}
