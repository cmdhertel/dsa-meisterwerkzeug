import { normalizePath } from "obsidian";
import type { App } from "obsidian";

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
