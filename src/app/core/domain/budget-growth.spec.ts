import { DEFAULT_GROWTH_POLICY, nextWeeklyLimit, settledWeekAt } from './budget-growth';
import { type CalendarDate, zonedTimeToInstant } from './iso-week';

const policy = DEFAULT_GROWTH_POLICY;
const at = (date: CalendarDate, hour = 0, minute = 0) => zonedTimeToInstant(date, hour, minute);

describe('nextWeeklyLimit', () => {
  it('proposes half of the realised profit on top, in whole kronor', () => {
    expect(nextWeeklyLimit(150_000, 184_050, policy)).toEqual({ kind: 'RAISE', limitOre: 242_000 });
  });

  it('never proposes more than the ceiling, and leaves a limit at or above it alone', () => {
    expect(nextWeeklyLimit(480_000, 200_000, policy)).toEqual({ kind: 'RAISE', limitOre: 500_000 });
    expect(nextWeeklyLimit(500_000, 200_000, policy).kind).toBe('KEEP');
    expect(nextWeeklyLimit(650_000, 200_000, policy).kind).toBe('KEEP');
  });

  it('lowers by the full loss, never below the base', () => {
    expect(nextWeeklyLimit(300_000, -40_000, policy)).toEqual({ kind: 'LOWER', limitOre: 260_000 });
    expect(nextWeeklyLimit(200_000, -90_000, policy)).toEqual({ kind: 'LOWER', limitOre: 150_000 });
    expect(nextWeeklyLimit(150_000, -90_000, policy).kind).toBe('KEEP');
  });

  it('keeps the limit when the step rounds to nothing or there was no result', () => {
    expect(nextWeeklyLimit(150_000, 150, policy).kind).toBe('KEEP');
    expect(nextWeeklyLimit(150_000, 0, policy).kind).toBe('KEEP');
  });
});

describe('settledWeekAt', () => {
  it('picks the week that ended 14 days before Monday – its orders are past the refund window', () => {
    // Monday 2 November 2026 (W45) → W42, which ended Monday 19 October.
    expect(settledWeekAt(at({ year: 2026, month: 11, day: 2 }), 14).id).toBe('2026-W42');
    // Later in the same week the answer is the same.
    expect(settledWeekAt(at({ year: 2026, month: 11, day: 6 }, 18), 14).id).toBe('2026-W42');
  });

  it('is not thrown a week off by daylight saving inside the window', () => {
    // 30 March 2026 is the Monday after the spring shift: W14 → W11.
    expect(settledWeekAt(at({ year: 2026, month: 3, day: 30 }), 14).id).toBe('2026-W11');
    // 9 November 2026 is two weeks after the autumn shift: W46 → W43.
    expect(settledWeekAt(at({ year: 2026, month: 11, day: 9 }), 14).id).toBe('2026-W43');
  });
});
