// Pure AsP/KaP arithmetic for combatants: current = max - spent, always clamped to 0..max.
export type EnergyKind = "AsP" | "KaP";

const int = (n: unknown): number => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? v : 0;
};

/** Valid maximum (undefined / NaN / negative = 0 = no such energy). */
export const energyMax = (max: unknown): number => Math.max(0, int(max));
export const hasEnergy = (max: unknown): boolean => energyMax(max) > 0;
/** Spent points clamped to 0..max. */
export const clampSpent = (max: unknown, spent: unknown): number => Math.min(energyMax(max), Math.max(0, int(spent)));
/** Current value = max - spent (clamped). */
export const energyCurrent = (max: unknown, spent: unknown): number => energyMax(max) - clampSpent(max, spent);
/** The `spent` value that yields the wanted current value (clamped to 0..max). */
export const spentForCurrent = (max: unknown, current: unknown): number => energyMax(max) - Math.min(energyMax(max), Math.max(0, int(current)));
/** Share of the bar that is filled, 0..100. */
export const energyPct = (max: unknown, spent: unknown): number => (hasEnergy(max) ? (energyCurrent(max, spent) / energyMax(max)) * 100 : 0);
