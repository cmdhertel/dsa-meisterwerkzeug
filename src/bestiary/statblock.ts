// NSC notes keep their values in a ```statblock code block in the body (not in the frontmatter like the bestiary).
// Pure helpers: find that block and map it to the bestiary's frontmatter keys. No obsidian imports.

const BLOCK_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*statblock[ \t]*\r?\n([\s\S]*?)^[ \t]*\1[ \t]*$/m;

/** YAML body of the first `statblock` code block, or null. */
export function extractStatblockYaml(text: string): string | null {
  const m = text.match(BLOCK_RE);
  return m ? m[2] : null;
}

/** Long German keys some notes use -> the short keys parseCreature reads. Only fills keys that are missing. */
const ALIASES: Record<string, string> = {
  lebensenergie: "lep",
  initiative: "ini",
  ruestungsschutz: "rs",
  rüstungsschutz: "rs",
  ausweichen: "vw",
  verteidigung: "vw",
  konstitution: "ko",
  astralenergie: "asp",
  karmaenergie: "kap",
};

export function normalizeStatblock(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const [long, short] of Object.entries(ALIASES)) if (out[short] === undefined && out[long] !== undefined) out[short] = out[long];
  return out;
}

/** true if the block carries combat values (an empty template block does not). */
export const hasCombatStats = (sb: Record<string, unknown> | null): boolean => !!sb && ["lep", "ini", "attacks", "rs", "vw"].some((k) => sb[k] !== undefined && sb[k] !== null && sb[k] !== "");

/** Note types whose statblock is offered as an opponent. */
export const NPC_TYPES = new Set(["nsc", "fraktion"]);
