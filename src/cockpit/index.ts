import type DsaMeisterwerkzeugPlugin from "../main";
import { addEnemyFlow, addHeroesFlow, loadFromNoteFlow } from "./actions";
import { Notice } from "obsidian";
import { COCKPIT_VIEW_TYPE, CockpitSession, CockpitView } from "./view";
import { registerEnergySync } from "./energy";
import { LAYOUT_LABEL, nextLayout, normalizeLayout, setCockpitLayout } from "./layout";


export async function openCockpit(plugin: DsaMeisterwerkzeugPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf = workspace.getLeavesOfType(COCKPIT_VIEW_TYPE)[0];
  if (!leaf) {
    const right = workspace.getRightLeaf(false);
    if (!right) return;
    await right.setViewState({ type: COCKPIT_VIEW_TYPE, active: true });
    leaf = right;
  }
  await workspace.revealLeaf(leaf);
}

/** Registers the Kampf-Cockpit view, ribbon icon and commands. */
export function registerCockpit(plugin: DsaMeisterwerkzeugPlugin): void {
  const session = new CockpitSession();
  registerEnergySync(plugin);
  // effect ticks / expiries -> cockpit log + short notice
  plugin.register(
    plugin.combat.on((ev) => {
      const msgs = ev.messages;
      if (!msgs?.length) return;
      for (const text of msgs) session.push({ time: Date.now(), text, outcome: "effect", applied: true });
      if (ev.type === "turn" || ev.type === "round") new Notice(msgs.slice(0, 6).join("\n") + (msgs.length > 6 ? `\n… (+${msgs.length - 6})` : ""), 6000);
    }),
  );
  plugin.registerView(COCKPIT_VIEW_TYPE, (leaf) => new CockpitView(leaf, plugin, session));
  plugin.addRibbonIcon("swords", "Kampf-Cockpit öffnen", () => void openCockpit(plugin));
  plugin.addCommand({ id: "open-cockpit", name: "Kampf-Cockpit öffnen", callback: () => void openCockpit(plugin) });
  plugin.addCommand({
    id: "cockpit-layout",
    name: "Kampf-Cockpit: Ansicht wechseln (Kompakt/Detail/Automatisch)",
    callback: () => {
      const next = nextLayout(normalizeLayout(plugin.settings.cockpitLayout));
      void setCockpitLayout(plugin, next);
      new Notice(`Kampf-Cockpit: ${LAYOUT_LABEL[next]}`);
    },
  });
  plugin.addCommand({ id: "cockpit-add-enemy", name: "Gegner hinzufügen", callback: () => void addEnemyFlow(plugin) });
  plugin.addCommand({ id: "cockpit-add-heroes", name: "Helden hinzufügen", callback: () => void addHeroesFlow(plugin) });
  plugin.addCommand({ id: "cockpit-load-note", name: "Kampf aus Notiz laden (encounter-Blöcke)", callback: () => void loadFromNoteFlow(plugin) });
}
