// "Ins Cockpit laden": enemies (and optionally heroes) -> CombatStore via the existing add flows.
import { Modal, Notice, Setting } from "obsidian";
import { addCreature, heroCombatant } from "../cockpit/actions";
import { openCockpit } from "../cockpit";
import type DsaMeisterwerkzeugPlugin from "../main";
import { CatalogEntry, resolveEntries, rollCounts, indexCatalog } from "./build";
import type { EncounterSpec } from "./parse";
import { resolveParty } from "./service";

type Choice = "add" | "replace" | "cancel";

function askExisting(plugin: DsaMeisterwerkzeugPlugin, n: number): Promise<Choice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (c: Choice, m: Modal) => {
      done = true;
      resolve(c);
      m.close();
    };
    class M extends Modal {
      onOpen() {
        this.titleEl.setText("Kampf-Cockpit ist nicht leer");
        this.contentEl.createEl("p", { text: `Im Cockpit stehen schon ${n} Kämpfer. Begegnung hinzufügen oder den Kampf ersetzen?` });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("hinzufügen").setCta().onClick(() => finish("add", this)))
          .addButton((b) => b.setButtonText("ersetzen").setWarning().onClick(() => finish("replace", this)))
          .addButton((b) => b.setButtonText("abbrechen").onClick(() => finish("cancel", this)));
      }
      onClose() {
        this.contentEl.empty();
        if (!done) resolve("cancel");
      }
    }
    new M(plugin.app).open();
  });
}

export interface LoadOptions {
  withHeroes: boolean;
  /** dice counts already rolled in the UI (index -> number); missing dice entries are rolled now */
  counts?: Record<number, number>;
}

export async function loadEncounter(plugin: DsaMeisterwerkzeugPlugin, spec: EncounterSpec, catalog: CatalogEntry[], opts: LoadOptions): Promise<boolean> {
  if (!spec.entries.length) {
    new Notice("Die Begegnung hat keine Gegner.");
    return false;
  }
  if (plugin.combat.entries.length) {
    const c = await askExisting(plugin, plugin.combat.entries.length);
    if (c === "cancel") return false;
    if (c === "replace") plugin.combat.clear();
  }
  const counts = { ...rollCounts(spec), ...(opts.counts ?? {}) };
  const resolved = resolveEntries(spec, indexCatalog(catalog), counts);
  let enemies = 0;
  for (const r of resolved) enemies += await addCreature(plugin, r.combatant, r.count);

  let heroes = 0;
  if (opts.withHeroes) {
    const party = resolveParty(plugin, spec.helden);
    const inCombat = new Set(plugin.combat.entries.filter((e) => e.kind === "hero").map((e) => e.name));
    for (const n of party.heroNames) {
      const h = plugin.heroes.getByName(n);
      if (!h || inCombat.has(h.name)) continue;
      plugin.combat.addCombatant(heroCombatant(plugin, h));
      heroes++;
    }
  }
  const diced = resolved.filter((r) => r.entry.countDice).map((r) => `${r.count}× ${r.displayName}`);
  new Notice(`${enemies} Gegner` + (heroes ? ` und ${heroes} Helden` : "") + " ins Cockpit geladen." + (diced.length ? ` Gewürfelt: ${diced.join(", ")}.` : ""));
  await openCockpit(plugin);
  return true;
}
