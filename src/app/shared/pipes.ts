import { Pipe, type PipeTransform } from '@angular/core';
import {
  formatBp,
  formatClock,
  formatInt,
  formatRelative,
  formatSek,
  formatSignedSek,
  type SekStyle,
} from './format';

/** Öre → "1 234 kr". */
@Pipe({ name: 'sek' })
export class SekPipe implements PipeTransform {
  transform(ore: number | null | undefined, style: SekStyle = 'whole'): string {
    return ore === null || ore === undefined ? '–' : formatSek(ore, style);
  }
}

/** Öre → "+1 234 kr" / "−1 234 kr". */
@Pipe({ name: 'signedSek' })
export class SignedSekPipe implements PipeTransform {
  transform(ore: number | null | undefined, style: SekStyle = 'whole'): string {
    return ore === null || ore === undefined ? '–' : formatSignedSek(ore, style);
  }
}

/** Basis points → "38,6 %". */
@Pipe({ name: 'bp' })
export class BpPipe implements PipeTransform {
  transform(bp: number | null | undefined): string {
    return formatBp(bp ?? null);
  }
}

@Pipe({ name: 'int' })
export class IntPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return value === null || value === undefined ? '–' : formatInt(value);
  }
}

/** ISO time → "18:04" (Europe/Stockholm). */
@Pipe({ name: 'clock' })
export class ClockPipe implements PipeTransform {
  transform(iso: string | number | null | undefined, withSeconds = false): string {
    return iso === null || iso === undefined ? '–' : formatClock(iso, withSeconds);
  }
}

/** ISO time → "för 5 minuter sedan". Pass the store's clock so it stays current. */
@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  transform(iso: string | number | null | undefined, now: number): string {
    return iso === null || iso === undefined ? '–' : formatRelative(iso, now);
  }
}
