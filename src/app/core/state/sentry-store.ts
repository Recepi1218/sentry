import { computed, DOCUMENT, inject, Service, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  EMPTY,
  filter,
  fromEvent,
  interval,
  map,
  of,
  repeat,
  retry,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  throwError,
  timeout,
  timer,
  type Observable,
  type Subscription,
} from 'rxjs';
import { OperatorSession } from '../api/operator-session';
import { SentryApi, toSentryApiError, type SnapshotResult } from '../api/sentry-api';
import { pollingPlan, SENTRY_CONFIG } from '../api/sentry-config';
import {
  budgetSeverity,
  remainingOre,
  utilizationBp,
  type BudgetSeverity,
  type LedgerTotals,
} from '../domain/budget-gate';
import type { BudgetStatus, DashboardSnapshot, MasterSwitchCommand } from '../domain/model';
import type { Ore } from '../domain/money';
import { formatDuration, formatSek } from '../../shared/format';

/** What the master switch should show. Never derived from a guess: stale data is 'unknown'. */
export type SwitchView = 'locked' | 'armed' | 'arming' | 'locking' | 'unknown';

export interface SyncState {
  readonly phase: 'connecting' | 'ok' | 'error';
  readonly lastSuccessAt: number | null;
  readonly failures: number;
  readonly error: string | null;
}

export type CommandState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pending'; readonly action: 'ARM' | 'LOCK'; readonly since: number }
  | { readonly phase: 'failed'; readonly action: 'ARM' | 'LOCK'; readonly message: string };

export type DecisionState =
  | { readonly phase: 'pending'; readonly decision: 'APPROVE' | 'REJECT' }
  | { readonly phase: 'failed'; readonly message: string };

export interface ArmCheck {
  readonly id: 'link' | 'budget' | 'alerts';
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface BudgetView {
  readonly status: BudgetStatus;
  readonly totals: LedgerTotals;
  readonly remainingOre: Ore;
  readonly utilizationBp: number;
  readonly severity: BudgetSeverity;
}

/** A command response is trusted over an older poll for this long. */
const COMMAND_PRECEDENCE_MS = 15_000;

/**
 * The dashboard's state: one snapshot from the backend, polled sparingly, plus the operator's
 * commands. Components read signals from here and never talk to the API themselves.
 */
@Service()
export class SentryStore {
  private readonly api = inject(SentryApi);
  private readonly config = inject(SENTRY_CONFIG);
  private readonly session = inject(OperatorSession);
  private readonly document = inject(DOCUMENT);

  private readonly refresh$ = new Subject<void>();
  private readonly snapshotState = signal<DashboardSnapshot | null>(null);
  private readonly syncState = signal<SyncState>({
    phase: 'connecting',
    lastSuccessAt: null,
    failures: 0,
    error: null,
  });
  private readonly commandState = signal<CommandState>({ phase: 'idle' });
  private readonly issuesState = signal<readonly string[]>([]);
  private readonly decisionsState = signal<ReadonlyMap<string, DecisionState>>(new Map());
  private readonly clock = signal(Date.now());
  private readonly polling = pollingPlan(this.config);
  private commandSubscription: Subscription | null = null;
  private commandAppliedAt = 0;

  readonly mode = this.config.mode;
  readonly now = this.clock.asReadonly();
  readonly snapshot = this.snapshotState.asReadonly();
  readonly sync = this.syncState.asReadonly();
  readonly command = this.commandState.asReadonly();
  readonly dataIssues = this.issuesState.asReadonly();
  readonly decisions = this.decisionsState.asReadonly();

  readonly needsToken = computed(() => this.mode === 'n8n' && !this.session.hasToken());
  readonly control = computed(() => this.snapshotState()?.control ?? null);
  readonly isStale = computed(() => {
    const last = this.syncState().lastSuccessAt;
    return last === null || this.clock() - last > this.polling.staleAfterMs;
  });

  readonly switchView = computed<SwitchView>(() => {
    const command = this.commandState();
    if (command.phase === 'pending') return command.action === 'ARM' ? 'arming' : 'locking';
    const control = this.control();
    if (!control || this.isStale()) return 'unknown';
    return control.state === 'ARMED' ? 'armed' : 'locked';
  });

  readonly budget = computed<BudgetView | null>(() => {
    const status = this.snapshotState()?.budget;
    if (!status) return null;
    const totals: LedgerTotals = {
      limitOre: status.limitOre,
      settledOre: status.settledOre,
      reservedOre: status.reservedOre,
    };
    return {
      status,
      totals,
      remainingOre: Math.max(0, remainingOre(totals)),
      utilizationBp: utilizationBp(totals),
      severity: budgetSeverity(totals, status.warnAtBp),
    };
  });

  readonly agentsById = computed(
    () => new Map((this.snapshotState()?.agents ?? []).map((agent) => [agent.id, agent] as const)),
  );

  readonly criticalAlerts = computed(
    () => this.snapshotState()?.alerts.filter((alert) => alert.severity === 'CRITICAL') ?? [],
  );

  /** Pre-flight checks for arming. Locking has none – it must always be possible. */
  readonly armChecks = computed<readonly ArmCheck[]>(() => {
    const sync = this.syncState();
    const budget = this.budget();
    const critical = this.criticalAlerts();
    const lastSync = sync.lastSuccessAt;
    return [
      {
        id: 'link',
        label: 'Kontakt med backend',
        ok: sync.phase === 'ok' && !this.isStale(),
        detail:
          lastSync === null
            ? 'Ingen kontakt än'
            : this.isStale()
              ? `Senaste svar för ${formatDuration(this.clock() - lastSync)} sedan`
              : 'Aktuellt läge',
      },
      {
        id: 'budget',
        label: 'Budget kvar den här veckan',
        ok: budget !== null && budget.remainingOre > 0,
        detail: budget
          ? `${formatSek(budget.remainingOre)} av ${formatSek(budget.totals.limitOre)}`
          : 'Okänd',
      },
      {
        id: 'alerts',
        label: 'Inga kritiska larm',
        ok: critical.length === 0,
        detail: critical[0]?.message ?? 'Sentinel rapporterar inget kritiskt',
      },
    ];
  });

  readonly canArm = computed(
    () => this.switchView() === 'locked' && this.armChecks().every((check) => check.ok),
  );

  private readonly visible$ = fromEvent(this.document, 'visibilitychange').pipe(
    map(() => this.isVisible()),
    startWith(this.isVisible()),
  );

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.clock.set(Date.now()));

    const enabled$ = this.mode === 'mock' ? of(true) : toObservable(this.session.hasToken);
    enabled$
      .pipe(
        switchMap((enabled) =>
          enabled
            ? this.refresh$.pipe(
                startWith(undefined),
                switchMap(() =>
                  this.fetchSnapshot().pipe(repeat({ delay: () => this.nextPollDelay() })),
                ),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  refresh(): void {
    this.refresh$.next();
  }

  arm(reason: string): void {
    const control = this.control();
    if (!control || !this.canArm()) return;
    this.runSwitch({ action: 'ARM', expectedRevision: control.revision, reason });
  }

  /** Always available, from any state. A lock supersedes an arm that is still in flight. */
  lock(reason = 'Manuell låsning från kontrollpanelen'): void {
    this.runSwitch({ action: 'LOCK', reason });
  }

  dismissCommandError(): void {
    if (this.commandState().phase === 'failed') this.commandState.set({ phase: 'idle' });
  }

  decide(approvalId: string, decision: 'APPROVE' | 'REJECT'): void {
    if (this.decisionsState().get(approvalId)?.phase === 'pending') return;
    this.setDecision(approvalId, { phase: 'pending', decision });
    this.api
      .decideApproval({ approvalId, decision })
      .pipe(timeout(this.config.requestTimeoutMs))
      .subscribe({
        next: () => {
          this.setDecision(approvalId, null);
          this.snapshotState.update(
            (snapshot) =>
              snapshot && {
                ...snapshot,
                approvals: snapshot.approvals.filter((item) => item.id !== approvalId),
              },
          );
          this.refresh$.next();
        },
        error: (error: unknown) =>
          this.setDecision(approvalId, {
            phase: 'failed',
            message: toSentryApiError(error).message,
          }),
      });
  }

  private runSwitch(command: MasterSwitchCommand): void {
    if (command.action === 'ARM' && this.commandState().phase === 'pending') return;
    this.commandSubscription?.unsubscribe();
    this.commandState.set({ phase: 'pending', action: command.action, since: Date.now() });

    const request$ = this.api.setMasterSwitch(command).pipe(timeout(this.config.requestTimeoutMs));
    const attempt$ =
      command.action === 'LOCK'
        ? request$.pipe(
            retry({
              count: 3,
              delay: (error: unknown, attempt) =>
                toSentryApiError(error).retryable
                  ? timer(500 * 2 ** attempt)
                  : throwError(() => error),
            }),
          )
        : request$;

    this.commandSubscription = attempt$.subscribe({
      next: (control) => {
        this.commandAppliedAt = Date.now();
        this.snapshotState.update((snapshot) => snapshot && { ...snapshot, control });
        this.commandState.set({ phase: 'idle' });
        this.refresh$.next();
      },
      error: (error: unknown) => {
        const apiError = toSentryApiError(error);
        if (apiError.kind === 'unauthorized') this.session.clear();
        this.commandState.set({
          phase: 'failed',
          action: command.action,
          message: apiError.message,
        });
        this.refresh$.next();
      },
    });
  }

  private fetchSnapshot(): Observable<void> {
    return this.api.snapshot().pipe(
      timeout(this.config.requestTimeoutMs),
      tap((result) => this.applySnapshot(result)),
      map(() => undefined),
      catchError((error: unknown) => {
        const apiError = toSentryApiError(error);
        if (apiError.kind === 'unauthorized') this.session.clear();
        this.syncState.update((sync) => ({
          ...sync,
          phase: 'error',
          failures: sync.failures + 1,
          error: apiError.message,
        }));
        return of(undefined);
      }),
    );
  }

  private applySnapshot({ snapshot, issues }: SnapshotResult): void {
    this.snapshotState.update((previous) => {
      const keepCommandResult =
        previous !== null &&
        previous.control.revision > snapshot.control.revision &&
        Date.now() - this.commandAppliedAt < COMMAND_PRECEDENCE_MS;
      return keepCommandResult ? { ...snapshot, control: previous.control } : snapshot;
    });
    this.issuesState.set(issues);
    this.syncState.set({ phase: 'ok', lastSuccessAt: Date.now(), failures: 0, error: null });
  }

  private nextPollDelay(): Observable<unknown> {
    const base = this.polling.intervalMs;
    const failures = this.syncState().failures;
    const delay =
      failures === 0 ? base : Math.min(base * 2 ** Math.min(failures, 6), this.config.maxBackoffMs);
    return timer(delay).pipe(switchMap(() => this.visible$.pipe(filter(Boolean), take(1))));
  }

  private isVisible(): boolean {
    return this.document.visibilityState !== 'hidden';
  }

  private setDecision(approvalId: string, state: DecisionState | null): void {
    this.decisionsState.update((current) => {
      const next = new Map(current);
      if (state) next.set(approvalId, state);
      else next.delete(approvalId);
      return next;
    });
  }
}
