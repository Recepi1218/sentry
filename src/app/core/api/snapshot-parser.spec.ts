import { SentrySimulation } from '../mock/simulation';
import { SentryApiError } from './sentry-api';
import { parseSnapshot } from './snapshot-parser';

const NOW = Date.parse('2026-10-26T17:00:00Z');
const wire = () =>
  JSON.parse(JSON.stringify(new SentrySimulation({ seed: 2, now: NOW }).snapshot(NOW)));

describe('parseSnapshot', () => {
  it('accepts a valid snapshot without issues', () => {
    const result = parseSnapshot(wire());
    expect(result.issues).toEqual([]);
    expect(result.snapshot.agents).toHaveLength(20);
  });

  it('drops a malformed list row and reports it instead of failing everything', () => {
    const raw = wire();
    raw.agents[3].status = 'DANCING';
    raw.orders[0].grossOre = 12.5;

    const result = parseSnapshot(raw);

    expect(result.snapshot.agents).toHaveLength(19);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatch(/^orders\[0\]\.grossOre/);
    expect(result.issues[1]).toMatch(/^agents\[3\]\.status/);
  });

  it('rejects the whole snapshot when the switch state is unreadable', () => {
    const raw = wire();
    raw.control.state = 'MAYBE';
    expect(() => parseSnapshot(raw)).toThrowError(SentryApiError);
  });

  it('rejects money that is not whole öre in the budget', () => {
    const raw = wire();
    raw.budget.limitOre = 1500.5;
    expect(() => parseSnapshot(raw)).toThrowError(/limitOre/);
  });
});
