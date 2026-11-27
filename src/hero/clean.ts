// Strip third-party user/group identifiers from a Heldenschmiede export before storing it in the vault.

const DROP_KEY = /^(readerUids|writerUids|roles|groupUid|groupUids|dbId|sourceGroupUid|sourceGroupName)(UpdatedAt)?$/;

export function cleanHeroJson<T>(input: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (DROP_KEY.test(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}
