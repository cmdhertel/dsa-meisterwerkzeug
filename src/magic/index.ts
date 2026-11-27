import { MarkdownRenderChild } from "obsidian";
import type DsaMeisterwerkzeugPlugin from "../main";
import { CastDialogOptions, CastModal } from "./dialog";
import { magicEditorExtension } from "./editor";
import { isMagicCode } from "./parse";
import { mountMagic } from "./view";

export { resolveCast, canAfford, fullCost, COST_FACTOR_SUCCESS, COST_FACTOR_FAILURE, COST_FACTOR_CRITICAL_SUCCESS, COST_FACTOR_PATZER } from "./resolve";
export type { CastInput, CastResult } from "./resolve";
export { parseSpellNote, findSpell, substituteQs } from "./spells";
export type { SpellDef, SpellKind } from "./spells";
export { casterFromHero, casterFromCreature, parseSpellList } from "./casters";
export type { Caster, KnownSpell } from "./casters";
export { CastModal } from "./dialog";
export type { CastDialogOptions } from "./dialog";

/** Open the cast dialog, e.g. from the cockpit: openCastDialog(plugin, { creaturePath, spell: "Ignifaxius" }). */
export function openCastDialog(plugin: DsaMeisterwerkzeugPlugin, opts: CastDialogOptions = {}): void {
  new CastModal(plugin, opts).open();
}

export function registerMagic(plugin: DsaMeisterwerkzeugPlugin): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    for (const code of Array.from(el.querySelectorAll("code"))) {
      if (code.parentElement?.tagName === "PRE") continue;
      const raw = code.textContent ?? "";
      if (!isMagicCode(raw)) continue;
      ctx.addChild(new MarkdownRenderChild(code));
      code.replaceWith(mountMagic(plugin, raw));
    }
  });
  plugin.registerEditorExtension(magicEditorExtension(plugin));
  plugin.addCommand({ id: "zauber-wirken", name: "Zauber wirken", callback: () => openCastDialog(plugin, { kind: "zauber" }) });
  plugin.addCommand({ id: "liturgie-wirken", name: "Liturgie wirken", callback: () => openCastDialog(plugin, { kind: "liturgie" }) });
}
