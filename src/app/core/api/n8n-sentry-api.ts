import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { catchError, map, throwError, type Observable } from 'rxjs';
import * as z from 'zod';
import {
  ApprovalDecisionResultSchema,
  ApprovalDecisionSchema,
  ControlStateSchema,
  MasterSwitchCommandSchema,
  type ApprovalDecision,
  type ApprovalDecisionResult,
  type ControlState,
  type MasterSwitchCommand,
} from '../domain/model';
import { SentryApi, SentryApiError, toSentryApiError, type SnapshotResult } from './sentry-api';
import { SENTRY_CONFIG } from './sentry-config';
import { parseResponse, parseSnapshot } from './snapshot-parser';

/*
 * Talks to three n8n Webhook nodes (see docs/ARCHITECTURE.md, "API mellan dashboard och n8n"):
 *   GET  {base}/snapshot             → DashboardSnapshot
 *   POST {base}/control              → { control: ControlState }
 *   POST {base}/approvals/decision   → { result: ApprovalDecisionResult }
 * Errors come back as HTTP status + { error: { code, message } }.
 */

const ControlResponseSchema = z.object({ control: ControlStateSchema });
const DecisionResponseSchema = z.object({ result: ApprovalDecisionResultSchema });
const ErrorBodySchema = z.union([
  z.object({ error: z.object({ message: z.string() }) }).transform((body) => body.error.message),
  z.object({ message: z.string() }).transform((body) => body.message),
]);

@Service({ autoProvided: false })
export class N8nSentryApi extends SentryApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(SENTRY_CONFIG).n8nBaseUrl.replace(/\/+$/, '');

  snapshot(): Observable<SnapshotResult> {
    return this.http
      .get<unknown>(`${this.baseUrl}/snapshot`)
      .pipe(map(parseSnapshot), catchError(rethrowAsApiError));
  }

  setMasterSwitch(command: MasterSwitchCommand): Observable<ControlState> {
    return this.http
      .post<unknown>(`${this.baseUrl}/control`, MasterSwitchCommandSchema.parse(command))
      .pipe(
        map((raw) => parseResponse(ControlResponseSchema, raw, 'styrsvar').control),
        catchError(rethrowAsApiError),
      );
  }

  decideApproval(decision: ApprovalDecision): Observable<ApprovalDecisionResult> {
    return this.http
      .post<unknown>(`${this.baseUrl}/approvals/decision`, ApprovalDecisionSchema.parse(decision))
      .pipe(
        map((raw) => parseResponse(DecisionResponseSchema, raw, 'beslutssvar').result),
        catchError(rethrowAsApiError),
      );
  }
}

function rethrowAsApiError(error: unknown): Observable<never> {
  return throwError(() =>
    error instanceof HttpErrorResponse ? fromHttp(error) : toSentryApiError(error),
  );
}

function fromHttp(error: HttpErrorResponse): SentryApiError {
  const parsed = ErrorBodySchema.safeParse(error.error);
  const detail = parsed.success ? parsed.data : null;
  switch (true) {
    case error.status === 0:
      return new SentryApiError(
        'network',
        'Ingen kontakt med n8n. Kontrollera nätverket och att arbetsflödet är aktivt.',
      );
    case error.status === 401 || error.status === 403:
      return new SentryApiError('unauthorized', 'n8n avvisade åtkomsttoken.');
    case error.status === 404:
      return new SentryApiError(
        'not-found',
        detail ?? 'Webhooken hittades inte. Är arbetsflödet aktiverat i n8n?',
      );
    case error.status === 409:
      return new SentryApiError(
        'conflict',
        detail ?? 'Läget har ändrats sedan du hämtade det. Försök igen.',
      );
    case error.status === 422:
      return new SentryApiError('rejected', detail ?? 'Begäran avvisades av n8n.');
    default:
      return new SentryApiError('server', detail ?? `n8n svarade med fel ${error.status}.`);
  }
}
