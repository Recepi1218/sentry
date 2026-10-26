import { createRng, randomInt } from '../mock/rng';
import {
  budgetSeverity,
  evaluateSpend,
  ledgerTotals,
  overrunOre,
  remainingOre,
  verifyReservation,
  type LedgerEntry,
  type LedgerTotals,
} from './budget-gate';

const WEEK = '2026-W44';

const totals = (limitOre: number, settledOre: number, reservedOre = 0): LedgerTotals => ({
  limitOre,
  settledOre,
  reservedOre,
});

const request = (maxCostOre: number) => ({
  agentId: 'T1-01',
  category: 'AI_TOKENS' as const,
  maxCostOre,
});

describe('evaluateSpend', () => {
  it('fails closed when the switch state or the ledger is unknown', () => {
    expect(evaluateSpend(null, totals(1000, 0), request(1))).toMatchObject({
      allowed: false,
      reason: 'STATE_UNAVAILABLE',
    });
    expect(evaluateSpend('ARMED', null, request(1))).toMatchObject({
      allowed: false,
      reason: 'STATE_UNAVAILABLE',
    });
    expect(evaluateSpend('ARMED', totals(1000, Number.NaN), request(1))).toMatchObject({
      allowed: false,
      reason: 'STATE_UNAVAILABLE',
    });
  });

  it('denies everything while the system is locked', () => {
    expect(evaluateSpend('LOCKED', totals(100_000, 0), request(1))).toMatchObject({
      allowed: false,
      reason: 'SYSTEM_LOCKED',
    });
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a malformed amount (%s)',
    (amount) => {
      expect(evaluateSpend('ARMED', totals(1000, 0), request(amount))).toMatchObject({
        allowed: false,
        reason: 'INVALID_REQUEST',
      });
    },
  );

  it('allows a request that lands exactly on the limit, but not one öre more', () => {
    const t = totals(150_000, 99_000, 1_000);
    expect(evaluateSpend('ARMED', t, request(50_000))).toEqual({
      allowed: true,
      remainingAfterOre: 0,
    });
    expect(evaluateSpend('ARMED', t, request(50_001))).toEqual({
      allowed: false,
      reason: 'BUDGET_EXCEEDED',
      remainingOre: 50_000,
    });
  });
});

describe('ledgerTotals', () => {
  const entry = (patch: Partial<LedgerEntry>): LedgerEntry => ({
    id: 'r',
    weekId: WEEK,
    agentId: 'T1-01',
    category: 'AI_TOKENS',
    status: 'ACTIVE',
    reservedOre: 0,
    actualOre: 0,
    ...patch,
  });

  it('counts settled costs, the unspent part of active holds, and ignores released rows and other weeks', () => {
    const result = ledgerTotals(
      [
        entry({ status: 'SETTLED', reservedOre: 500, actualOre: 320 }),
        entry({ status: 'ACTIVE', reservedOre: 400 }),
        entry({ status: 'ACTIVE', category: 'ADS', reservedOre: 30_000, actualOre: 12_000 }),
        entry({ status: 'RELEASED', reservedOre: 9_999 }),
        entry({ status: 'SETTLED', weekId: '2026-W43', actualOre: 77_777 }),
      ],
      WEEK,
      150_000,
    );
    expect(result).toEqual({ limitOre: 150_000, settledOre: 12_320, reservedOre: 18_400 });
  });

  it('keeps a campaign that overspent its hold fully counted', () => {
    const result = ledgerTotals(
      [entry({ category: 'ADS', reservedOre: 1_000, actualOre: 1_200 })],
      WEEK,
      5_000,
    );
    expect(result.settledOre + result.reservedOre).toBe(1_200);
  });
});

describe('budgetSeverity', () => {
  it('escalates at the warning threshold and at 95 %', () => {
    expect(budgetSeverity(totals(10_000, 7_999), 8_000)).toBe('normal');
    expect(budgetSeverity(totals(10_000, 8_000), 8_000)).toBe('warning');
    expect(budgetSeverity(totals(10_000, 9_000, 500), 8_000)).toBe('critical');
  });
});

describe('overrunOre', () => {
  it('reports only spend above the reservation', () => {
    expect(overrunOre(1_000, 999)).toBe(0);
    expect(overrunOre(1_000, 1_250)).toBe(250);
  });
});

/*
 * The gate protocol under concurrency. Each request runs precheck → insert → verify
 * (→ release on denial) against one shared ledger. We enumerate EVERY interleaving of the
 * requests' steps and check that the money let through never exceeds the limit.
 */
describe('gate protocol under concurrent requests', () => {
  type Phase = 'precheck' | 'insert' | 'verify' | 'release' | 'done';

  interface Run {
    readonly id: string;
    readonly amount: number;
    phase: Phase;
    allowed: boolean;
  }

  function step(run: Run, ledger: LedgerEntry[], limit: number): void {
    const read = () => ledgerTotals(ledger, WEEK, limit);
    switch (run.phase) {
      case 'precheck':
        run.phase = evaluateSpend('ARMED', read(), request(run.amount)).allowed ? 'insert' : 'done';
        return;
      case 'insert':
        ledger.push({
          id: run.id,
          weekId: WEEK,
          agentId: run.id,
          category: 'AI_TOKENS',
          status: 'ACTIVE',
          reservedOre: run.amount,
          actualOre: 0,
        });
        run.phase = 'verify';
        return;
      case 'verify':
        if (verifyReservation('ARMED', read()).allowed) {
          run.allowed = true;
          run.phase = 'done';
        } else {
          run.phase = 'release';
        }
        return;
      case 'release': {
        const index = ledger.findIndex((row) => row.id === run.id);
        const row = ledger[index];
        if (row) ledger[index] = { ...row, status: 'RELEASED' };
        run.phase = 'done';
        return;
      }
      case 'done':
        return;
    }
  }

  /** Depth-first over all schedules; calls `check` with the outcome of each complete one. */
  function everySchedule(
    amounts: readonly number[],
    limit: number,
    seed: readonly LedgerEntry[],
    check: (approved: number[]) => void,
  ): number {
    let schedules = 0;
    const explore = (runs: Run[], ledger: LedgerEntry[]) => {
      const pending = runs.filter((run) => run.phase !== 'done');
      if (pending.length === 0) {
        schedules += 1;
        check(runs.filter((run) => run.allowed).map((run) => run.amount));
        return;
      }
      for (const next of pending) {
        const runsCopy = runs.map((run) => ({ ...run }));
        const ledgerCopy = ledger.map((row) => ({ ...row }));
        const target = runsCopy.find((run) => run.id === next.id);
        if (target) step(target, ledgerCopy, limit);
        explore(runsCopy, ledgerCopy);
      }
    };
    explore(
      amounts.map((amount, index) => ({
        id: `req-${index}`,
        amount,
        phase: 'precheck',
        allowed: false,
      })),
      [...seed],
    );
    return schedules;
  }

  const alreadySpent: LedgerEntry = {
    id: 'seed',
    weekId: WEEK,
    agentId: 'T2-10',
    category: 'AI_TOKENS',
    status: 'SETTLED',
    reservedOre: 600,
    actualOre: 600,
  };

  it('never lets competing requests push spend past the limit, in any interleaving', () => {
    const limit = 1_000;
    const schedules = everySchedule([300, 250, 200], limit, [alreadySpent], (approved) => {
      expect(alreadySpent.actualOre + approved.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(
        limit,
      );
    });
    expect(schedules).toBeGreaterThan(1_000);
  });

  it('lets every request through when they all fit, in any interleaving', () => {
    everySchedule([100, 120, 150], 1_000, [alreadySpent], (approved) => {
      expect(approved).toHaveLength(3);
    });
  });

  it('holds the invariant through a long random sequence of reserve, settle and release', () => {
    const rng = createRng(20261026);
    const limit = 150_000;
    const ledger: LedgerEntry[] = [];
    let approvedCount = 0;
    let deniedCount = 0;

    for (let i = 0; i < 5_000; i++) {
      const active = ledger.filter((row) => row.status === 'ACTIVE');
      const roll = rng();
      if (roll < 0.6 || active.length === 0) {
        const amount = randomInt(rng, 1, 9_000);
        if (!evaluateSpend('ARMED', ledgerTotals(ledger, WEEK, limit), request(amount)).allowed) {
          deniedCount += 1;
          continue;
        }
        ledger.push({
          id: `r-${i}`,
          weekId: WEEK,
          agentId: 'T1-01',
          category: 'AI_TOKENS',
          status: 'ACTIVE',
          reservedOre: amount,
          actualOre: 0,
        });
        if (verifyReservation('ARMED', ledgerTotals(ledger, WEEK, limit)).allowed) {
          approvedCount += 1;
        } else {
          ledger[ledger.length - 1] = { ...ledger[ledger.length - 1]!, status: 'RELEASED' };
        }
      } else {
        const row = active[randomInt(rng, 0, active.length - 1)]!;
        const index = ledger.indexOf(row);
        ledger[index] =
          roll < 0.9
            ? { ...row, status: 'SETTLED', actualOre: randomInt(rng, 0, row.reservedOre) }
            : { ...row, status: 'RELEASED' };
      }
      const t = ledgerTotals(ledger, WEEK, limit);
      expect(t.settledOre + t.reservedOre).toBeLessThanOrEqual(limit);
      expect(remainingOre(t)).toBeGreaterThanOrEqual(0);
    }

    expect(approvedCount).toBeGreaterThan(50);
    expect(deniedCount).toBeGreaterThan(50);
  });
});
