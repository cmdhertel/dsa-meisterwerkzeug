import type DsaMeisterwerkzeugPlugin from "../main";
import { registerEncounterBlock } from "./card";
import { openEncounterBuilder } from "./modal";

/** Begegnungsbaukasten: `dsa-kampf` code block, builder modal and command. */
export function registerEncounter(plugin: DsaMeisterwerkzeugPlugin): void {
  registerEncounterBlock(plugin);
  plugin.addCommand({ id: "encounter-build", name: "Begegnung bauen", callback: () => openEncounterBuilder(plugin) });
}

export { openEncounterBuilder };
