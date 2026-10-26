import { SentryApiError } from '../api/sentry-api';
import { parseSnapshot } from '../api/snapshot-parser';
import { remainingOre } from '../domain/budget-gate';
import { DashboardSnapshotSchema } from '../domain/model';
import { SentrySimulation } from './simulation';

const START = Date.parse('2026-10-26T17:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function run(
  simulation: SentrySimulation,
  from: number,
  ms: number,
  onTick?: (now: number) => void,
): number {
  let now = from;
  for (const end = from + ms; now < end;) {
    now += SECOND;
    simulation.tick(now);
    onTick?.(now);
  }
  return now;
}

function arm(simulation: SentrySimulation, now: number) {
  const { revision } = simulation.snapshot(now).control;
  return simulation.setMasterSwitch(
    { action: 'ARM', expectedRevision: revision, reason: 'Test' },
    now,
  );
}

describe('SentrySimulation', () => {
  it('starts locked and spends nothing while locked', () => {
    const simulation = new SentrySimulation({ seed: 1, now: START });
    const before = simulation.totals(START);
    expect(simulation.snapshot(START).control.state).toBe('LOCKED');
    expect(before.reservedOre).toBe(0);

    const end = run(simulation, START, 30 * MINUTE);

    expect(simulation.totals(end)).toEqual(before);
    expect(simulation.snapshot(end).agents.every((agent) => agent.status === 'PAUSED')).toBe(true);
  });

  it('never lets settled + reserved pass the weekly limit, even when agents push against it', () => {
    const simulation = new SentrySimulation({ seed: 7, now: START });
    arm(simulation, START);
    const campaign = simulation
      .snapshot(START)
      .approvals.find((item) => item.kind === 'CAMPAIGN_LAUNCH');
    if (campaign)
      simulation.decideApproval({ approvalId: campaign.id, decision: 'APPROVE' }, START);

    let lowest = Number.POSITIVE_INFINITY;
    const end = run(simulation, START, 120 * MINUTE, (now) => {
      const totals = simulation.totals(now);
      expect(totals.settledOre + totals.reservedOre).toBeLessThanOrEqual(totals.limitOre);
      lowest = Math.min(lowest, remainingOre(totals));
    });

    const snapshot = simulation.snapshot(end);
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(snapshot.budget.deniedRequests).toBeGreaterThan(0);
    expect(snapshot.audit.some((event) => event.action === 'SPEND_DENIED')).toBe(true);
  });

  it('pauses campaigns on lock, lets in-flight calls settle and starts nothing new', () => {
    const simulation = new SentrySimulation({ seed: 3, now: START });
    arm(simulation, START);
    const campaign = simulation
      .snapshot(START)
      .approvals.find((item) => item.kind === 'CAMPAIGN_LAUNCH');
    expect(campaign).toBeDefined();
    simulation.decideApproval({ approvalId: campaign!.id, decision: 'APPROVE' }, START);

    const lockedAt = run(simulation, START, 3 * MINUTE);
    simulation.setMasterSwitch({ action: 'LOCK', reason: 'Test' }, lockedAt);
    expect(
      simulation.snapshot(lockedAt).audit.some((event) => event.action === 'CAMPAIGN_PAUSED'),
    ).toBe(true);

    const drained = run(simulation, lockedAt, 30 * SECOND);
    const settledAfterDrain = simulation.totals(drained);
    expect(settledAfterDrain.reservedOre).toBe(0);

    const later = run(simulation, drained, 20 * MINUTE);
    expect(simulation.totals(later)).toEqual(settledAfterDrain);
  });

  it('refuses to arm on a stale revision and treats repeated commands as no-ops', () => {
    const simulation = new SentrySimulation({ seed: 5, now: START });
    const { revision } = simulation.snapshot(START).control;

    expect(() =>
      simulation.setMasterSwitch(
        { action: 'ARM', expectedRevision: revision - 1, reason: 'Test' },
        START,
      ),
    ).toThrowError(SentryApiError);

    const armed = simulation.setMasterSwitch(
      { action: 'ARM', expectedRevision: revision, reason: 'Test' },
      START,
    );
    expect(armed).toMatchObject({ state: 'ARMED', revision: revision + 1 });
    expect(
      simulation.setMasterSwitch({ action: 'ARM', expectedRevision: 0, reason: 'Igen' }, START),
    ).toBe(armed);

    const locked = simulation.setMasterSwitch({ action: 'LOCK', reason: 'Test' }, START);
    expect(locked).toMatchObject({ state: 'LOCKED', revision: revision + 2 });
    expect(simulation.setMasterSwitch({ action: 'LOCK', reason: 'Igen' }, START)).toBe(locked);
  });

  it('will not start a campaign while the system is locked', () => {
    const simulation = new SentrySimulation({ seed: 9, now: START });
    const campaign = simulation
      .snapshot(START)
      .approvals.find((item) => item.kind === 'CAMPAIGN_LAUNCH');
    expect(() =>
      simulation.decideApproval({ approvalId: campaign!.id, decision: 'APPROVE' }, START),
    ).toThrowError(/låst/);
  });

  it('produces snapshots that satisfy the n8n contract', () => {
    const simulation = new SentrySimulation({ seed: 11, now: START });
    arm(simulation, START);
    const end = run(simulation, START, 5 * MINUTE);
    const snapshot = simulation.snapshot(end);

    expect(DashboardSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot))).issues).toEqual([]);
    expect(snapshot.agents).toHaveLength(20);
    expect(snapshot.finance.daily).toHaveLength(14);
  });

  describe('weekly limit growth', () => {
    it("proposes half of the settled week's profit on Monday and changes nothing by itself", () => {
      // W44 → the settled week is W41, seeded at 1 840,50 kr: 1 500 + 920 = 2 420 kr.
      const simulation = new SentrySimulation({ seed: 3, now: START });
      const snapshot = simulation.snapshot(START);
      const proposal = snapshot.approvals[0];
      expect(proposal).toMatchObject({
        kind: 'BUDGET_LIMIT',
        requestedBy: 'T2-10',
        costOre: 0,
        proposedLimitOre: 242_000,
      });
      expect(snapshot.budget.limitOre).toBe(150_000);
      expect(snapshot.budget.limitCeilingOre).toBe(500_000);
    });

    it('raises the limit only when the operator approves, even while locked', () => {
      const simulation = new SentrySimulation({ seed: 3, now: START });
      const proposal = simulation.snapshot(START).approvals[0]!;
      simulation.decideApproval({ approvalId: proposal.id, decision: 'APPROVE' }, START);
      const snapshot = simulation.snapshot(START);
      expect(snapshot.control.state).toBe('LOCKED');
      expect(snapshot.budget.limitOre).toBe(242_000);
      expect(snapshot.approvals.some((item) => item.kind === 'BUDGET_LIMIT')).toBe(false);
      expect(snapshot.audit[0]?.action).toBe('WEEKLY_LIMIT_RAISED');
    });

    it('keeps the limit when the proposal is rejected', () => {
      const simulation = new SentrySimulation({ seed: 3, now: START });
      const proposal = simulation.snapshot(START).approvals[0]!;
      simulation.decideApproval({ approvalId: proposal.id, decision: 'REJECT' }, START);
      expect(simulation.snapshot(START).budget.limitOre).toBe(150_000);
    });

    it('lowers the limit by a loss without asking, never below the base', () => {
      const simulation = new SentrySimulation({
        seed: 3,
        now: START,
        limitOre: 200_000,
        pastWeekProfitOre: [50_000, 20_000, -30_000],
      });
      const snapshot = simulation.snapshot(START);
      expect(snapshot.budget.limitOre).toBe(170_000);
      expect(snapshot.approvals.some((item) => item.kind === 'BUDGET_LIMIT')).toBe(false);
      expect(snapshot.audit.some((event) => event.action === 'WEEKLY_LIMIT_LOWERED')).toBe(true);
    });
  });
});
