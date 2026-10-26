import { TestBed } from '@angular/core/testing';
import { defer, Observable, of, Subject, throwError } from 'rxjs';
import { SentryApi, SentryApiError, type SnapshotResult } from '../api/sentry-api';
import { SENTRY_CONFIG, type SentryConfig } from '../api/sentry-config';
import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ControlState,
  DashboardSnapshot,
  MasterSwitchCommand,
} from '../domain/model';
import { SentrySimulation } from '../mock/simulation';
import { SentryStore } from './sentry-store';

const NOW = Date.parse('2026-10-26T17:00:00Z');

interface IssuedCommand {
  readonly command: MasterSwitchCommand;
  readonly response: Subject<ControlState>;
  cancelled: boolean;
}

class FakeApi extends SentryApi {
  current: DashboardSnapshot = new SentrySimulation({ seed: 1, now: NOW }).snapshot(NOW);
  failSnapshots = false;
  failLocks = false;
  readonly commands: IssuedCommand[] = [];

  snapshot(): Observable<SnapshotResult> {
    return defer(() =>
      this.failSnapshots
        ? throwError(() => new SentryApiError('network', 'Ingen kontakt'))
        : of({ snapshot: this.current, issues: [] }),
    );
  }

  /** Cold, like HttpClient: every subscription is a new request. */
  setMasterSwitch(command: MasterSwitchCommand): Observable<ControlState> {
    return new Observable<ControlState>((subscriber) => {
      const issued: IssuedCommand = { command, response: new Subject(), cancelled: false };
      this.commands.push(issued);
      if (command.action === 'LOCK' && this.failLocks) {
        subscriber.error(new SentryApiError('network', 'Ingen kontakt med n8n.'));
        return;
      }
      let answered = false;
      const subscription = issued.response.subscribe((control) => {
        answered = true;
        subscriber.next(control);
        subscriber.complete();
      });
      return () => {
        subscription.unsubscribe();
        if (!answered) issued.cancelled = true;
      };
    });
  }

  decideApproval(decision: ApprovalDecision): Observable<ApprovalDecisionResult> {
    return of({
      approvalId: decision.approvalId,
      decision: decision.decision,
      appliedAt: new Date(NOW).toISOString(),
    });
  }

  answer(index: number, state: ControlState['state']): void {
    const control: ControlState = {
      ...this.current.control,
      state,
      revision: this.current.control.revision + 1,
    };
    this.current = { ...this.current, control };
    this.commands[index]?.response.next(control);
  }
}

const config: SentryConfig = {
  mode: 'mock',
  n8nBaseUrl: '',
  pollIntervalMs: 1_000,
  maxBackoffMs: 10_000,
  staleAfterMs: 5_000,
  requestTimeoutMs: 30_000,
};

describe('SentryStore', () => {
  let api: FakeApi;
  let store: SentryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [
        { provide: SentryApi, useValue: api },
        { provide: SENTRY_CONFIG, useValue: config },
      ],
    });
    store = TestBed.inject(SentryStore);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('shows the confirmed locked state and allows arming once fresh data is in', () => {
    expect(store.switchView()).toBe('locked');
    expect(store.armChecks().every((check) => check.ok)).toBe(true);
    expect(store.canArm()).toBe(true);
  });

  it('arms only when the backend confirms, and sends the revision it was based on', () => {
    const revision = api.current.control.revision;
    store.arm('Test');

    expect(store.switchView()).toBe('arming');
    expect(api.commands[0]?.command).toEqual({
      action: 'ARM',
      expectedRevision: revision,
      reason: 'Test',
    });

    api.answer(0, 'ARMED');
    expect(store.switchView()).toBe('armed');
    expect(store.canArm()).toBe(false);
  });

  it('lets a lock supersede an arm that is still in flight', () => {
    store.arm('Test');
    store.lock();

    expect(api.commands[0]?.cancelled).toBe(true);
    expect(api.commands[1]?.command.action).toBe('LOCK');
    expect(store.switchView()).toBe('locking');

    api.answer(1, 'LOCKED');
    expect(store.switchView()).toBe('locked');
  });

  it('ignores a second arm while one is pending', () => {
    store.arm('Först');
    store.arm('Igen');
    expect(api.commands).toHaveLength(1);
  });

  it('shows the state as unknown and blocks arming when the data goes stale', () => {
    api.failSnapshots = true;
    vi.advanceTimersByTime(6_000);

    expect(store.isStale()).toBe(true);
    expect(store.switchView()).toBe('unknown');
    expect(store.canArm()).toBe(false);
    expect(store.armChecks().find((check) => check.id === 'link')?.ok).toBe(false);
  });

  it('keeps arming closed when the weekly budget is used up', () => {
    const { budget } = api.current;
    api.current = {
      ...api.current,
      budget: { ...budget, settledOre: budget.limitOre, reservedOre: 0 },
    };
    store.refresh();

    expect(store.budget()?.remainingOre).toBe(0);
    expect(store.canArm()).toBe(false);
  });

  it('retries a failing lock before reporting that it could not be confirmed', () => {
    api.failLocks = true;
    store.lock();
    vi.advanceTimersByTime(1_000 + 2_000 + 4_000);

    expect(api.commands).toHaveLength(4);
    expect(store.command()).toEqual({
      phase: 'failed',
      action: 'LOCK',
      message: 'Ingen kontakt med n8n.',
    });
  });
});
