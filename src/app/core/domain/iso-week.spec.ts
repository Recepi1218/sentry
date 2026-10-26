import { isoWeekAt, isoWeekOfDate, zonedTimeToInstant } from './iso-week';

describe('isoWeekOfDate', () => {
  it.each([
    [{ year: 2026, month: 10, day: 26 }, 2026, 44],
    [{ year: 2026, month: 1, day: 1 }, 2026, 1],
    [{ year: 2027, month: 1, day: 1 }, 2026, 53],
    [{ year: 2021, month: 1, day: 3 }, 2020, 53],
    [{ year: 2024, month: 12, day: 30 }, 2025, 1],
  ])('%o is in %i-W%i', (date, isoYear, week) => {
    expect(isoWeekOfDate(date)).toEqual({ isoYear, week });
  });
});

describe('isoWeekAt (Europe/Stockholm)', () => {
  it('starts the week at local midnight right after the switch to winter time', () => {
    const week = isoWeekAt(Date.parse('2026-10-26T17:00:00Z'));
    expect(week.id).toBe('2026-W44');
    expect(new Date(week.startsAt).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(new Date(week.endsAt).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });

  it('uses summer time for weeks that start in CEST', () => {
    const week = isoWeekAt(Date.parse('2026-10-21T08:00:00Z'));
    expect(week.id).toBe('2026-W43');
    expect(new Date(week.startsAt).toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(week.endsAt - week.startsAt).toBe(7 * 86_400_000 + 3_600_000);
  });

  it('puts Sunday 23:30 local time in the week that is ending', () => {
    expect(isoWeekAt(Date.parse('2026-11-01T22:30:00Z')).id).toBe('2026-W44');
    expect(isoWeekAt(Date.parse('2026-11-01T23:00:00Z')).id).toBe('2026-W45');
  });
});

describe('zonedTimeToInstant', () => {
  it('converts Stockholm wall-clock time on both sides of DST', () => {
    expect(
      new Date(zonedTimeToInstant({ year: 2026, month: 7, day: 1 }, 12, 0)).toISOString(),
    ).toBe('2026-07-01T10:00:00.000Z');
    expect(
      new Date(zonedTimeToInstant({ year: 2026, month: 12, day: 1 }, 12, 0)).toISOString(),
    ).toBe('2026-12-01T11:00:00.000Z');
  });
});
