import { calendarDateOf, SENTRY_TIME_ZONE } from '../core/domain/iso-week';
import type { Ore } from '../core/domain/money';

/* Swedish number, money and time formatting. Pure functions, shared by pipes and the simulation. */

const kronor = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  maximumFractionDigits: 0,
});
const kronorPrecise = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('sv-SE', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const clock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SENTRY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});
const clockSeconds = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SENTRY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dayMonth = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SENTRY_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});
const weekdayClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SENTRY_TIME_ZONE,
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
});
const relative = new Intl.RelativeTimeFormat('sv', { numeric: 'auto' });

export type SekStyle = 'whole' | 'precise' | 'auto';

/**
 * "1 234 kr". `auto` keeps öre for amounts under 10 kr so small AI costs don't round to 0 kr.
 */
export function formatSek(ore: Ore, style: SekStyle = 'whole'): string {
  const kr = ore / 100;
  const precise = style === 'precise' || (style === 'auto' && Math.abs(kr) < 10 && ore !== 0);
  return (precise ? kronorPrecise : kronor).format(kr);
}

/** Like formatSek but always signed: "+1 234 kr" / "−1 234 kr". */
export function formatSignedSek(ore: Ore, style: SekStyle = 'whole'): string {
  const formatted = formatSek(Math.abs(ore), style);
  if (ore > 0) return `+${formatted}`;
  if (ore < 0) return `−${formatted}`;
  return formatted;
}

export function formatInt(value: number): string {
  return integer.format(value);
}

/** Basis points as a percentage: 3855 → "38,6 %". */
export function formatBp(bp: number | null): string {
  return bp === null ? '–' : percent.format(bp / 10_000);
}

export function formatClock(iso: string | number, withSeconds = false): string {
  return (withSeconds ? clockSeconds : clock).format(new Date(iso));
}

export function formatDayMonth(iso: string | number): string {
  return dayMonth.format(new Date(iso));
}

export function formatWeekdayClock(iso: string | number): string {
  return weekdayClock.format(new Date(iso));
}

/** "för 5 minuter sedan", "om 2 timmar". */
export function formatRelative(iso: string | number, now: number): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return diffSeconds <= 0 ? 'nyss' : 'om några sekunder';
  if (abs < 45 * 60) return relative.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 22 * 3600) return relative.format(Math.round(diffSeconds / 3600), 'hour');
  // Days are calendar days in Stockholm: 00:10 seen at 23:00 the same day is not "i går".
  const days = calendarDayIndex(new Date(iso).getTime()) - calendarDayIndex(now);
  if (days === 0) return relative.format(Math.round(diffSeconds / 3600), 'hour');
  return relative.format(days, 'day');
}

function calendarDayIndex(instant: number): number {
  const { year, month, day } = calendarDateOf(instant);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** "3 tim 20 min", "45 min", "12 s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} tim ${minutes % 60} min` : `${hours} tim`;
  return `${Math.floor(hours / 24)} dygn`;
}
