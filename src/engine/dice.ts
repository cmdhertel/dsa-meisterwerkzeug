// Dice notation + injectable roller. Pure.

/** Returns an integer 1..sides. Inject a fixed sequence in tests. */
export type Roller = (sides: number) => number;

export const defaultRoller: Roller = (sides) => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    // rejection sampling to avoid modulo bias
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / sides) * sides;
    do c.getRandomValues(buf); while (buf[0] >= limit);
    return (buf[0] % sides) + 1;
  }
  return 1 + Math.floor(Math.random() * sides);
};

/** Roller that returns the given values in order (throws when exhausted). For tests and "enter the real roll" UIs. */
export function fixedRoller(values: number[]): Roller {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("fixedRoller exhausted");
    return values[i++];
  };
}

export interface DiceSpec {
  count: number;
  sides: number;
  /** constant added to the dice sum (may be negative) */
  bonus: number;
  /** normalized text, e.g. "1W6+4" */
  text: string;
}

export interface DiceRoll {
  spec: DiceSpec;
  rolls: number[];
  bonus: number;
  total: number;
}

const DICE_TERM = /^(\d*)[WwDd](\d+)$/;

/**
 * Parses "1W6+4", "2W6+2", "1W20", "13+1W6", "1W6-1", "W6", "7" (plain number = constant).
 * Accepts W/w/D/d and the en/em dash as minus. Throws on anything else.
 */
export function parseDice(input: string | number): DiceSpec {
  const src = String(input).trim().replace(/[–—−]/g, "-").replace(/\s+/g, "");
  if (!src) throw new Error("Empty dice expression");
  const terms = src.match(/[+-]?[^+-]+/g);
  if (!terms || terms.join("") !== src) throw new Error(`Invalid dice expression: ${input}`);
  let count = 0;
  let sides = 0;
  let bonus = 0;
  let diceTerms = 0;
  for (const raw of terms) {
    const sign = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    const m = body.match(DICE_TERM);
    if (m) {
      diceTerms++;
      if (sign < 0) throw new Error(`Negative dice term not supported: ${input}`);
      count = m[1] === "" ? 1 : parseInt(m[1], 10);
      sides = parseInt(m[2], 10);
    } else if (/^\d+$/.test(body)) {
      bonus += sign * parseInt(body, 10);
    } else {
      throw new Error(`Invalid dice expression: ${input}`);
    }
  }
  if (diceTerms > 1) throw new Error(`Only one dice term supported: ${input}`);
  if (diceTerms === 1 && (count < 1 || sides < 2)) throw new Error(`Invalid dice expression: ${input}`);
  const text = diceTerms === 0 ? String(bonus) : `${count}W${sides}${bonus > 0 ? "+" + bonus : bonus < 0 ? String(bonus) : ""}`;
  return { count, sides, bonus, text };
}

/** Like parseDice but returns null instead of throwing. */
export function tryParseDice(input: string | number | null | undefined): DiceSpec | null {
  if (input === null || input === undefined) return null;
  try {
    return parseDice(input);
  } catch {
    return null;
  }
}

export function rollDice(spec: DiceSpec | string, roller: Roller = defaultRoller): DiceRoll {
  const s = typeof spec === "string" ? parseDice(spec) : spec;
  const rolls: number[] = [];
  for (let i = 0; i < s.count; i++) rolls.push(roller(s.sides));
  const total = rolls.reduce((a, b) => a + b, 0) + s.bonus;
  return { spec: s, rolls, bonus: s.bonus, total };
}

export const d20 = (roller: Roller = defaultRoller): number => roller(20);
export const d6 = (roller: Roller = defaultRoller): number => roller(6);
