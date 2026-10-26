import { InjectionToken } from '@angular/core';

export interface SentryConfig {
  /** 'mock' runs the in-browser simulation; 'n8n' talks to the n8n Cloud webhook API. */
  readonly mode: 'mock' | 'n8n';
  /** e.g. https://din-instans.app.n8n.cloud/webhook/sentry/v1 – not a secret. */
  readonly n8nBaseUrl: string;
  /** How often the dashboard asks for a snapshot. Every n8n call is a billed execution. */
  readonly pollIntervalMs: number;
  /** Upper bound for the back-off after failed polls. */
  readonly maxBackoffMs: number;
  /** A snapshot older than this is shown as stale and the switch state as unknown. */
  readonly staleAfterMs: number;
  readonly requestTimeoutMs: number;
}

export const SENTRY_CONFIG = new InjectionToken<SentryConfig>('SENTRY_CONFIG');

/** Polling n8n faster than this burns executions without making the data meaningfully fresher. */
export const MIN_N8N_POLL_INTERVAL_MS = 30_000;

export interface PollingPlan {
  readonly intervalMs: number;
  readonly staleAfterMs: number;
}

/**
 * The interval actually used, and a staleness threshold that never undercuts it. A threshold
 * shorter than the interval would show the switch as unknown between every poll and make
 * arming impossible.
 */
export function pollingPlan(config: SentryConfig): PollingPlan {
  const intervalMs =
    config.mode === 'n8n'
      ? Math.max(config.pollIntervalMs, MIN_N8N_POLL_INTERVAL_MS)
      : config.pollIntervalMs;
  return { intervalMs, staleAfterMs: Math.max(config.staleAfterMs, Math.round(intervalMs * 2.5)) };
}
