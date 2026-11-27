// Sitzungsregie: launches the existing table tools (probe, spell, group probe, fight) from digest actions.
import { Notice } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import type { Combatant } from "../model";
import { addCreature } from "../cockpit/actions";
import { matchCreatureName, parseEncounterBlocks } from "../cockpit/logic";
import { buildCatalog, resolveParty } from "../encounter/service";
import { loadEncounter } from "../encounter/load";
import { parseEncounter } from "../encounter/parse";
import { GroupProbeModal } from "../groupprobe/view";
import { parseGroupProbe } from "../groupprobe/parse";
import { openCastDialog } from "../magic";
import { parseMagic } from "../magic/parse";
import { ProbeModal } from "../probe/command";
import { parseProbe } from "../probe/parse";
import type { BlockRef, InlineAction } from "./types";

/** Opens the matching dialog for an inline action; `sourcePath` orders the heroes (campaign first). */
export function runAction(plugin: DsaMeisterwerkzeugPlugin, a: Pick<InlineAction, "kind" | "raw">, sourcePath: string): void {
  try {
    if (a.kind === "probe") {
      const p = parseProbe(a.raw);
      if (!p.ok) return void new Notice(p.error);
      new ProbeModal(plugin, { talent: p.spec.talent.name, modifier: p.spec.modifier, sourcePath }).open();
    } else if (a.kind === "zauber" || a.kind === "liturgie") {
      const m = parseMagic(a.raw);
      if (!m.ok) return void new Notice(m.error);
      openCastDialog(plugin, { kind: m.spec.kind, spell: m.spec.name, modifier: m.spec.modifier, casterName: m.spec.hero ?? undefined });
    } else {
      const g = parseGroupProbe(a.raw);
      if (!g.ok) return void new Notice(g.error);
      new GroupProbeModal(plugin, g.spec, sourcePath, a.raw).open();
    }
  } catch (e) {
    console.error("Sitzungsregie: Aktion fehlgeschlagen", e);
    new Notice("Aktion konnte nicht gestartet werden.");
  }
}

/** Loads a fight block (`dsa-kampf` or legacy `encounter`) into the cockpit. */
export async function runBlock(plugin: DsaMeisterwerkzeugPlugin, b: BlockRef): Promise<void> {
  try {
    if (b.kind === "dsa-kampf") {
      const spec = parseEncounter(b.source).spec;
      const party = resolveParty(plugin, spec.helden);
      await loadEncounter(plugin, spec, buildCatalog(plugin), { withHeroes: party.heroNames.length > 0 });
      return;
    }
    const list = parseEncounterBlocks("```encounter\n" + b.source + "\n```");
    if (!list.length) return void new Notice("Keine Kreaturen im Block.");
    const known = plugin.bestiary.all().filter((r) => r.status !== "nostats").map((r) => r.combatant);
    let total = 0;
    for (const item of list) {
      const c = matchCreatureName(item.name, known);
      if (c) total += await addCreature(plugin, c, item.amount, item.hp);
      else {
        const stub: Combatant = { name: item.name, kind: "creature", sourcePath: "", lepMax: item.hp ?? null, iniBase: null, rs: 0, vw: null, weapons: [], needsManual: [] };
        total += await addCreature(plugin, stub, item.amount);
      }
    }
    new Notice(`${total} Kämpfer geladen.`);
  } catch (e) {
    console.error("Sitzungsregie: Kampf laden fehlgeschlagen", e);
    new Notice("Kampf konnte nicht geladen werden.");
  }
}
