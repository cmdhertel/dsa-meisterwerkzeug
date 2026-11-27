// The only place where the cockpit touches Obsidian internals that are NOT part of the public API.
// Each accessor checks at runtime that the member exists and returns undefined otherwise, so a future Obsidian
// release that renames or removes one of them degrades the feature (no drag from the explorer, no layout refresh)
// instead of throwing. Callers must handle undefined. Pure: no imports besides types.
import type { App, TFile } from "obsidian";

/** Shape of `app.dragManager.draggable` as far as the cockpit reads it (internal, unverified). */
export interface InternalDraggable {
  file?: TFile;
  files?: TFile[];
}

/**
 * Obsidian's internal drag manager (`app.dragManager`), used to find the files of an explorer drag.
 * Undefined when the member is missing; the drop then falls back to the text payload.
 */
export function internalDraggable(app: App): InternalDraggable | undefined {
  const dm = (app as unknown as { dragManager?: unknown }).dragManager;
  if (!dm || typeof dm !== "object") return undefined;
  const d = (dm as { draggable?: unknown }).draggable;
  return d && typeof d === "object" ? (d as InternalDraggable) : undefined;
}

/**
 * `applyLayout()` of a cockpit view (our own method, reached through the leaf). Returns a bound caller, or undefined
 * when the view does not expose it (e.g. the leaf holds another view type or the view is closing).
 */
export function viewApplyLayout(view: unknown): (() => void) | undefined {
  if (!view || typeof view !== "object") return undefined;
  const fn = (view as { applyLayout?: unknown }).applyLayout;
  return typeof fn === "function" ? () => (fn as () => void).call(view) : undefined;
}
