import type { SpendCategory, SwitchState } from './model';
import { isOre, type Ore } from './money';

/*
 * The budget gate. Deterministic, framework-free and fail-closed: this is the logic n8n runs in
 * front of every action that costs money (see docs/ARCHITECTURE.md, "Budgetspärren").
 *
 * Protocol for one spend request:
 *   1. evaluateSpend()       – read switch + ledger totals; deny early if it cannot fit.
 *   2. insert reservation    – write an ACTIVE ledger row holding the worst-case cost.
 *   3. verifyReservation()   – re-read totals INCLUDING every row written so far; if the
 *                              holds exceed the limit, release the row and abort.
 *   4. perform the call      – with hard caps (max_tokens, lifetime ad budgets).
 *   5. settle                – replace the hold with the actual cost (never above the hold).
 *
 * Step 3 is what makes concurrent requests safe without locks: of any set of requests that
 * all pass verification, the last one to verify saw every other one's reservation.
 */

export type LedgerStatus = 'ACTIVE' | 'SETTLED' | 'RELEASED';

export interface LedgerEntry {
  readonly id: string;
  readonly weekId: string;
  readonly agentId: string;
  readonly category: SpendCategory;
  readonly status: LedgerStatus;
  /** Worst-case amount held when the request was let through. */
  readonly reservedOre: Ore;
  /** Spend so far (running campaigns) or the final cost (settled). */
  readonly actualOre: Ore;
}

export interface LedgerTotals {
  readonly limitOre: Ore;
  /** Money actually spent: settled rows plus what running campaigns have consumed. */
  readonly settledOre: Ore;
  /** The unspent part of active holds. */
  readonly reservedOre: Ore;
}

export interface SpendRequest {
  readonly agentId: string;
  readonly category: SpendCategory;
  /** Worst-case cost of the action, integer öre. */
  readonly maxCostOre: Ore;
}

export type DenyReason =
  'STATE_UNAVAILABLE' | 'SYSTEM_LOCKED' | 'INVALID_REQUEST' | 'BUDGET_EXCEEDED';

export type GateDecision =
  | { readonly allowed: true; readonly remainingAfterOre: Ore }
  | { readonly allowed: false; readonly reason: DenyReason; readonly remainingOre: Ore };

export type BudgetSeverity = 'normal' | 'warning' | 'critical';

export function ledgerTotals(
  entries: Iterable<LedgerEntry>,
  weekId: string,
  limitOre: Ore,
): LedgerTotals {
  let settledOre = 0;
  let reservedOre = 0;
  for (const entry of entries) {
    if (entry.weekId !== weekId) continue;
    if (entry.status === 'SETTLED') {
      settledOre += entry.actualOre;
    } else if (entry.status === 'ACTIVE') {
      settledOre += entry.actualOre;
      reservedOre += Math.max(0, entry.reservedOre - entry.actualOre);
    }
  }
  return { limitOre, settledOre, reservedOre };
}

export function remainingOre(totals: LedgerTotals): Ore {
  return totals.limitOre - totals.settledOre - totals.reservedOre;
}

/** settled + reserved as basis points of the limit (10 000 = the hard limit). */
export function utilizationBp(totals: LedgerTotals): number {
  if (totals.limitOre <= 0) return 10_000;
  return Math.round(((totals.settledOre + totals.reservedOre) * 10_000) / totals.limitOre);
}

export function budgetSeverity(totals: LedgerTotals, warnAtBp: number): BudgetSeverity {
  const used = utilizationBp(totals);
  if (remainingOre(totals) <= 0 || used >= 9_500) return 'critical';
  return used >= warnAtBp ? 'warning' : 'normal';
}

function isUsable(totals: LedgerTotals): boolean {
  return [totals.limitOre, totals.settledOre, totals.reservedOre].every(
    (value) => isOre(value) && value >= 0,
  );
}

function deny(reason: DenyReason, totals: LedgerTotals | null | undefined): GateDecision {
  const remaining = totals && isUsable(totals) ? Math.max(0, remainingOre(totals)) : 0;
  return { allowed: false, reason, remainingOre: remaining };
}

/** Step 1 – before a reservation exists. Anything unknown or malformed denies. */
export function evaluateSpend(
  state: SwitchState | null | undefined,
  totals: LedgerTotals | null | undefined,
  request: SpendRequest,
): GateDecision {
  if (!state || !totals || !isUsable(totals)) return deny('STATE_UNAVAILABLE', totals);
  if (state !== 'ARMED') return deny('SYSTEM_LOCKED', totals);
  if (!isOre(request.maxCostOre) || request.maxCostOre <= 0) return deny('INVALID_REQUEST', totals);
  const remaining = remainingOre(totals);
  if (request.maxCostOre > remaining) return deny('BUDGET_EXCEEDED', totals);
  return { allowed: true, remainingAfterOre: remaining - request.maxCostOre };
}

/** Step 3 – after the caller's own reservation is written; `totals` must include it. */
export function verifyReservation(
  state: SwitchState | null | undefined,
  totals: LedgerTotals | null | undefined,
): GateDecision {
  if (!state || !totals || !isUsable(totals)) return deny('STATE_UNAVAILABLE', totals);
  if (state !== 'ARMED') return deny('SYSTEM_LOCKED', totals);
  const remaining = remainingOre(totals);
  if (remaining < 0) return deny('BUDGET_EXCEEDED', totals);
  return { allowed: true, remainingAfterOre: remaining };
}

/**
 * How far a settled cost went past its reservation. Anything above zero means an estimate was
 * wrong; Sentinel locks the system and raises a critical alert.
 */
export function overrunOre(reservedOre: Ore, actualOre: Ore): Ore {
  return Math.max(0, actualOre - reservedOre);
}
