import type { SentryConfig } from '../app/core/api/sentry-config';

/** `ng serve`: the in-browser simulation, polled fast because it costs nothing. */
export const environment: SentryConfig = {
  mode: 'mock',
  n8nBaseUrl: '',
  pollIntervalMs: 1_500,
  maxBackoffMs: 30_000,
  staleAfterMs: 12_000,
  requestTimeoutMs: 15_000,
};
