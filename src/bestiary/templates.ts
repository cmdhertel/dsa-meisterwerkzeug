// Template folder of the Obsidian core "Templates" plugin, read from its settings file.
// Pure (no obsidian imports) so it can be unit-tested. The settings file is a plain JSON file in the
// vault config folder; reading it uses only the public vault adapter, not the internal plugin API.

/** Returns the configured folder (without leading/trailing slashes), or null if the file has none or is invalid. */
export function parseTemplatesFolder(json: string): string | null {
  try {
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== "object") return null;
    const folder = (v as { folder?: unknown }).folder;
    if (typeof folder !== "string") return null;
    const clean = folder.trim().replace(/^\/+|\/+$/g, "");
    return clean || null;
  } catch {
    return null;
  }
}

/** True if `path` lies inside `folder` (a null folder matches nothing). */
export function isInFolder(path: string, folder: string | null): boolean {
  return folder !== null && path.startsWith(folder + "/");
}
