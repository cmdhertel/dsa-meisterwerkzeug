// Pure helper (no Obsidian imports) for turning loosely typed frontmatter / JSON values into text.

/** Text form of a value: strings as-is, numbers/booleans via String, lists comma-joined, objects as JSON, null/undefined as "". */
export function valueText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v)) return v.map(valueText).join(",");
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}
