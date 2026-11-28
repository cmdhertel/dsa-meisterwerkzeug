import { normalizePath, requireApiVersion } from "obsidian";
import type { App, ButtonComponent } from "obsidian";

export { safeFileName } from "./fileName";

/** Creates a vault folder (and its parents) through the Vault API; existing folders are left alone. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = normalizePath(folder).split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (app.vault.getAbstractFileByPath(cur)) continue;
    await app.vault.createFolder(cur);
  }
}

/**
 * Reads a vault-relative text file. Returns null only if the file does not exist.
 * Read failures (locked, permissions, sync conflicts) are thrown, so callers never treat them as "missing".
 */
export async function readText(app: App, path: string): Promise<string | null> {
  if (!(await app.vault.adapter.exists(path))) return null;
  return app.vault.adapter.read(path);
}

/** Writes a vault file through the Vault API (creates missing parent folders, modifies existing files). */
export async function writeText(app: App, path: string, text: string): Promise<void> {
  const p = normalizePath(path);
  const dir = dirname(p);
  if (dir) await ensureFolder(app, dir);
  const file = app.vault.getFileByPath(p);
  if (file) await app.vault.modify(file, text);
  else await app.vault.create(p, text);
}

export const dirname = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Wraps an async callback for DOM listeners and other slots that expect a void return; rejections are logged. */
export function asyncHandler<A extends unknown[]>(fn: (...args: A) => Promise<unknown>): (...args: A) => void {
  return (...args) => {
    fn(...args).catch((e: unknown) => console.error("DSA Meisterwerkzeug:", e));
  };
}

/** Styles a button as destructive: setDestructive() on Obsidian 1.13+, the older warning style before. */
export function markDestructive(b: ButtonComponent): ButtonComponent {
  if (requireApiVersion("1.13.0")) return b.setDestructive();
  // Obsidian < 1.13 has no setDestructive(); mod-warning is the class the older setWarning() adds.
  b.buttonEl.addClass("mod-warning");
  return b;
}
