/**
 * ISO 8601 weeks (Monday–Sunday) anchored to a wall-clock time zone.
 * The weekly budget resets at Monday 00:00 Europe/Stockholm, including across DST changes.
 */
export const SENTRY_TIME_ZONE = 'Europe/Stockholm';

const DAY_MS = 86_400_000;

export interface CalendarDate {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  readonly day: number;
}

export interface IsoWeek {
  /** e.g. "2026-W44" */
  readonly id: string;
  readonly isoYear: number;
  readonly week: number;
  /** Instant (ms) of Monday 00:00 in the anchor time zone. */
  readonly startsAt: number;
  /** Instant (ms) of the following Monday 00:00 – exclusive end. */
  readonly endsAt: number;
}

interface ZonedParts extends CalendarDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(instant: number, timeZone: string = SENTRY_TIME_ZONE): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to an instant. */
export function zonedTimeToInstant(
  date: CalendarDate,
  hour: number,
  minute: number,
  timeZone: string = SENTRY_TIME_ZONE,
): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}

/** ISO week-numbering year and week for a calendar date. */
export function isoWeekOfDate(date: CalendarDate): { isoYear: number; week: number } {
  const target = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const weekday = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - weekday + 3); // Thursday decides the year
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { isoYear, week };
}

export function isoWeekId(isoYear: number, week: number): string {
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function calendarDateOf(instant: number, timeZone: string = SENTRY_TIME_ZONE): CalendarDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

export function isoDateString(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function isoWeekAt(instant: number, timeZone: string = SENTRY_TIME_ZONE): IsoWeek {
  const today = calendarDateOf(instant, timeZone);
  const weekday = (new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  const { isoYear, week } = isoWeekOfDate(today);
  return {
    id: isoWeekId(isoYear, week),
    isoYear,
    week,
    startsAt: zonedTimeToInstant(monday, 0, 0, timeZone),
    endsAt: zonedTimeToInstant(addDays(monday, 7), 0, 0, timeZone),
  };
}
