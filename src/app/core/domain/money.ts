/**
 * All money in Sentry is an integer number of öre (1 kr = 100 öre).
 * Floats never touch a budget comparison: 0.1 + 0.2 !== 0.3 is not a risk we take
 * on a hard spending limit.
 */
export type Ore = number;

export const ORE_PER_KRONA = 100;

export function isOre(value: unknown): value is Ore {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertOre(value: number, label: string): asserts value is Ore {
  if (!isOre(value)) {
    throw new RangeError(`${label} måste vara ett heltal i öre, fick ${value}`);
  }
}

/** Converts kronor to öre, rounding half away from zero to the nearest öre. */
export function oreFromKronor(kronor: number): Ore {
  return Math.sign(kronor) * Math.round(Math.abs(kronor) * ORE_PER_KRONA);
}

/**
 * Rounds a fractional öre amount UP. Used for cost estimates and reservations,
 * where rounding down could let a request slip past the hard limit.
 */
export function ceilOre(value: number): Ore {
  return Math.ceil(value - 1e-9);
}

export function sumOre(values: Iterable<Ore>): Ore {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Share of `part` in `whole` as basis points (1 % = 100 bp), or null when undefined. */
export function basisPoints(part: Ore, whole: Ore): number | null {
  return whole === 0 ? null : Math.round((part * 10_000) / whole);
}
