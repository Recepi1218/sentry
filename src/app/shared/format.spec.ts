import { zonedTimeToInstant } from '../core/domain/iso-week';
import { formatRelative } from './format';

const at = (day: number, hour: number, minute = 0) =>
  zonedTimeToInstant({ year: 2026, month: 10, day }, hour, minute);

describe('formatRelative', () => {
  it('counts calendar days, so earlier the same day is never "i går"', () => {
    expect(formatRelative(at(26, 0, 10), at(26, 23))).toBe('för 23 timmar sedan');
    expect(formatRelative(at(25, 23), at(26, 22))).toBe('i går');
    expect(formatRelative(at(24, 9), at(26, 22))).toBe('i förrgår');
  });
});
