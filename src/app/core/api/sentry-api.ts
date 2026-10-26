import { TimeoutError, type Observable } from 'rxjs';
import type {
  ApprovalDecision,
  ApprovalDecisionResult,
  ControlState,
  DashboardSnapshot,
  MasterSwitchCommand,
} from '../domain/model';

export interface SnapshotResult {
  readonly snapshot: DashboardSnapshot;
  /** Records that failed validation and were left out, described for the operator. */
  readonly issues: readonly string[];
}

/**
 * The dashboard's only door to the backend. The mock simulation and the n8n adapter both
 * implement it, so the rest of the app never knows which one it is talking to.
 * Nothing here enforces money rules – that happens behind the door, in n8n's budget gate.
 */
export abstract class SentryApi {
  abstract snapshot(): Observable<SnapshotResult>;
  abstract setMasterSwitch(command: MasterSwitchCommand): Observable<ControlState>;
  abstract decideApproval(decision: ApprovalDecision): Observable<ApprovalDecisionResult>;
}

export type SentryApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'not-found'
  | 'conflict'
  | 'rejected'
  | 'server'
  | 'invalid-response';

export class SentryApiError extends Error {
  constructor(
    readonly kind: SentryApiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SentryApiError';
  }

  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

export function toSentryApiError(error: unknown): SentryApiError {
  if (error instanceof SentryApiError) return error;
  if (error instanceof TimeoutError) {
    return new SentryApiError('timeout', 'Backend svarade inte i tid.');
  }
  return new SentryApiError('network', 'Okänt fel vid kontakt med backend.');
}
