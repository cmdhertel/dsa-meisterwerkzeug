import type { App } from "obsidian";

/** Vault-relative path helpers using the adapter (works with non-markdown files and on mobile). */
export async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = folder.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.adapter.mkdir(cur);
  }
}

export async function readText(app: App, path: string): Promise<string | null> {
  try {
    if (!(await app.vault.adapter.exists(path))) return null;
    return await app.vault.adapter.read(path);
  } catch {
    return null;
  }
}

export async function writeText(app: App, path: string, text: string): Promise<void> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (dir) await ensureFolder(app, dir);
  await app.vault.adapter.write(path, text);
}

export const dirname = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Strip characters that are invalid in file names. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Held";
}
