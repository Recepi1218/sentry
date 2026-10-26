import { pollingPlan, type SentryConfig } from './sentry-config';

const base: SentryConfig = {
  mode: 'n8n',
  n8nBaseUrl: 'https://acme.app.n8n.cloud/webhook/sentry/v1',
  pollIntervalMs: 1_500,
  maxBackoffMs: 300_000,
  staleAfterMs: 12_000,
  requestTimeoutMs: 15_000,
};

describe('pollingPlan', () => {
  it('never polls n8n more often than every 30 seconds', () => {
    expect(pollingPlan(base).intervalMs).toBe(30_000);
  });

  it('keeps the staleness threshold well above the interval, so the switch never flickers to unknown', () => {
    expect(pollingPlan({ ...base, pollIntervalMs: 120_000 })).toEqual({
      intervalMs: 120_000,
      staleAfterMs: 300_000,
    });
  });

  it('respects a longer threshold and the fast simulation interval', () => {
    expect(pollingPlan({ ...base, mode: 'mock', staleAfterMs: 12_000 })).toEqual({
      intervalMs: 1_500,
      staleAfterMs: 12_000,
    });
    expect(
      pollingPlan({ ...base, pollIntervalMs: 60_000, staleAfterMs: 600_000 }).staleAfterMs,
    ).toBe(600_000);
  });
});
