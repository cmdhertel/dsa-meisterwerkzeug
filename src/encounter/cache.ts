// Single-slot memo: keeps the last result for a key and rebuilds only when the key changes.
// Pure (no obsidian imports) so it can be unit-tested.
export function singleSlotCache<T>(): (key: string, build: () => T) => T {
  let slot: { key: string; value: T } | null = null;
  return (key, build) => {
    if (slot && slot.key === key) return slot.value;
    const value = build();
    slot = { key, value };
    return value;
  };
}
