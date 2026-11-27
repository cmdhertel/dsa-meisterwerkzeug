// Cockpit layout mode (Kompakt / Detail / Automatisch): pure helpers + refresh of open views.
import type { App } from "obsidian";
import { viewApplyLayout } from "./internalApi";
import type DsaMeisterwerkzeugPlugin from "../main";

export const COCKPIT_VIEW_TYPE = "dsa-kampf-cockpit";

export type CockpitLayout = "auto" | "kompakt" | "detail";
export type ResolvedLayout = "kompakt" | "detail";

/** "Automatisch": views narrower than this (px) use the compact layout. */
export const COMPACT_BELOW_PX = 520;
/** Detail layout: from this width the roll log moves beside the list and cards flow in columns. */
export const WIDE_FROM_PX = 900;

export const LAYOUT_LABEL: Record<CockpitLayout, string> = { auto: "Automatisch", kompakt: "Kompakt", detail: "Detail" };
export const LAYOUT_ORDER: CockpitLayout[] = ["auto", "kompakt", "detail"];

export const normalizeLayout = (v: unknown): CockpitLayout => (v === "kompakt" || v === "detail" || v === "auto" ? v : "auto");

/** Concrete layout for a setting and the view width (width 0 = not measured yet, treated as wide). */
export function resolveLayout(layout: CockpitLayout, width: number): ResolvedLayout {
  if (layout === "kompakt" || layout === "detail") return layout;
  return width > 0 && width < COMPACT_BELOW_PX ? "kompakt" : "detail";
}

export const nextLayout = (l: CockpitLayout): CockpitLayout => LAYOUT_ORDER[(LAYOUT_ORDER.indexOf(l) + 1) % LAYOUT_ORDER.length];

export const isWide = (width: number): boolean => width >= WIDE_FROM_PX;

/** Tell all open cockpit views to re-read the layout setting. */
export function refreshCockpitLayouts(app: App): void {
  for (const leaf of app.workspace.getLeavesOfType(COCKPIT_VIEW_TYPE)) viewApplyLayout(leaf.view)?.();
}

/** Persist the cockpit layout and update all open cockpit views. */
export async function setCockpitLayout(plugin: DsaMeisterwerkzeugPlugin, layout: CockpitLayout): Promise<void> {
  plugin.settings.cockpitLayout = layout;
  refreshCockpitLayouts(plugin.app);
  await plugin.persist();
}
