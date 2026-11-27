// Pure file-name helpers (no Obsidian imports, so they can be unit-tested).

/**
 * Strip characters that are invalid in file names. Leading dots are removed as well:
 * a name like ".foo" would create a hidden note that Obsidian does not list.
 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  return cleaned || "Held";
}
