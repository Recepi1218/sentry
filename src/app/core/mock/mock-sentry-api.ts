import { DestroyRef, inject, Service } from '@angular/core';
import { interval, map, timer, type Observable } from 'rxjs';
import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ControlState,
  MasterSwitchCommand,
} from '../domain/model';
import { SentryApi, type SnapshotResult } from '../api/sentry-api';
import { SentrySimulation } from './simulation';

/** Network-like latency, so pending states in the UI are visible and honest. */
const LATENCY = { snapshot: 120, command: 650, decision: 400 } as const;

/**
 * SentryApi backed by the in-browser simulation. Commands only take effect when their
 * simulated response arrives; a request abandoned before that never reaches the "server".
 */
@Service({ autoProvided: false })
export class MockSentryApi extends SentryApi {
  private readonly simulation = new SentrySimulation({ seed: 44_2026, now: Date.now() });

  constructor() {
    super();
    const ticker = interval(1000).subscribe(() => this.simulation.tick(Date.now()));
    inject(DestroyRef).onDestroy(() => ticker.unsubscribe());
  }

  snapshot(): Observable<SnapshotResult> {
    return timer(LATENCY.snapshot).pipe(
      map(() => ({ snapshot: this.simulation.snapshot(Date.now()), issues: [] })),
    );
  }

  setMasterSwitch(command: MasterSwitchCommand): Observable<ControlState> {
    return timer(LATENCY.command).pipe(
      map(() => this.simulation.setMasterSwitch(command, Date.now())),
    );
  }

  decideApproval(decision: ApprovalDecision): Observable<ApprovalDecisionResult> {
    return timer(LATENCY.decision).pipe(
      map(() => this.simulation.decideApproval(decision, Date.now())),
    );
  }
}
