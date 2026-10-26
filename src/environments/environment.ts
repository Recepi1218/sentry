import type { SentryConfig } from '../app/core/api/sentry-config';

/**
 * Production build. Stays on the simulation until the n8n workflows exist – then set
 * mode: 'n8n', n8nBaseUrl and pollIntervalMs: 120_000 (see docs/SETUP.md, "Kvoter").
 * The store never polls n8n more often than every 30 s, and never treats data as stale
 * sooner than 2.5 poll intervals.
 */
export const environment: SentryConfig = {
  mode: 'mock',
  n8nBaseUrl: '',
  pollIntervalMs: 1_500,
  maxBackoffMs: 300_000,
  staleAfterMs: 12_000,
  requestTimeoutMs: 15_000,
};
