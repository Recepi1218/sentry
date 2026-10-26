import { isoWeekAt, type IsoWeek } from './iso-week';
import type { Ore } from './money';

/*
 * The weekly limit grows with profit – but only on the operator's say-so. Every Monday
 * Sentinel looks at the newest week whose orders are past the right of withdrawal, and
 * proposes reinvesting a share of that week's realised profit. A raise is only ever a
 * proposal; a loss lowers the limit straight away, since lowering can never cost money.
 */

export interface GrowthPolicy {
  /** The floor the limit returns to after losses. */
  readonly baseLimitOre: Ore;
  /** The limit is never proposed above this. */
  readonly ceilingOre: Ore;
  /** Share of realised profit added to the limit, in basis points (5000 = 50 %). */
  readonly shareBp: number;
  /** Days before an order's profit counts as realised (ångerrätt). */
  readonly settleDays: number;
}

export const DEFAULT_GROWTH_POLICY: GrowthPolicy = {
  baseLimitOre: 150_000,
  ceilingOre: 500_000,
  shareBp: 5_000,
  settleDays: 14,
};

export type LimitChange =
  | { readonly kind: 'RAISE'; readonly limitOre: Ore }
  | { readonly kind: 'LOWER'; readonly limitOre: Ore }
  | { readonly kind: 'KEEP'; readonly limitOre: Ore };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The newest ISO week that ended at least `settleDays` before `now`: every order in it is
 * past the refund window. Two hours of slack absorb a daylight-saving shift in the window.
 */
export function settledWeekAt(now: number, settleDays: number): IsoWeek {
  const cutoff = now - settleDays * DAY_MS + 2 * HOUR_MS;
  let week = isoWeekAt(now);
  while (week.endsAt > cutoff) week = isoWeekAt(week.startsAt - 1);
  return week;
}

/**
 * Profit raises the limit by its share, in whole kronor, up to the ceiling. A loss lowers it
 * by the full loss, never below the base. A limit already above the ceiling is left alone.
 */
export function nextWeeklyLimit(
  currentLimitOre: Ore,
  realisedProfitOre: Ore,
  policy: GrowthPolicy,
): LimitChange {
  if (realisedProfitOre > 0 && currentLimitOre < policy.ceilingOre) {
    const stepOre = Math.floor((realisedProfitOre * policy.shareBp) / 10_000 / 100) * 100;
    const limitOre = Math.min(policy.ceilingOre, currentLimitOre + stepOre);
    if (limitOre > currentLimitOre) return { kind: 'RAISE', limitOre };
  }
  if (realisedProfitOre < 0 && currentLimitOre > policy.baseLimitOre) {
    return {
      kind: 'LOWER',
      limitOre: Math.max(policy.baseLimitOre, currentLimitOre + realisedProfitOre),
    };
  }
  return { kind: 'KEEP', limitOre: currentLimitOre };
}
