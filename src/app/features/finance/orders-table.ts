import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { OrderLine } from '../../core/domain/model';
import { orderEconomics, type OrderEconomics } from '../../core/domain/order-economics';
import { SentryStore } from '../../core/state/sentry-store';
import { formatClock, formatDayMonth } from '../../shared/format';
import { BpPipe, SekPipe, SignedSekPipe } from '../../shared/pipes';

/** Margin bar range: −50 % … +100 %, so the zero line sits a third of the way in. */
const MIN_BP = -5_000;
const MAX_BP = 10_000;
const ZERO_AT = (-MIN_BP / (MAX_BP - MIN_BP)) * 100;

const STATUS: Record<OrderLine['status'], string> = {
  PAID: 'Betald, ej skickad',
  FULFILLED: 'Levererad',
  REFUNDED: 'Återbetald',
};

interface OrderRow {
  readonly order: OrderLine;
  readonly economics: OrderEconomics;
  readonly when: string;
  readonly status: string;
  readonly fresh: boolean;
  readonly bar: {
    readonly start: number;
    readonly width: number;
    readonly negative: boolean;
  } | null;
}

/**
 * Every order with its economics recomputed from the raw Stripe numbers on each snapshot.
 * Compact: when, what, what it cost us and what it earned. Detailed: every cost line – VAT,
 * Stripe's fee, supplier cost and shipping, attributed ads – and the margin.
 */
@Component({
  selector: 'app-orders-table',
  imports: [BpPipe, RouterLink, SekPipe, SignedSekPipe],
  templateUrl: './orders-table.html',
  styleUrl: './orders-table.scss',
  host: { '[class.is-detailed]': 'detailed()' },
})
export class OrdersTable {
  /** Rows shown before "Visa alla". */
  readonly limit = input(12);
  /** Link to the orders page instead of expanding in place. */
  readonly linkToAll = input(false);
  /** Show every cost line and the margin instead of the four compact columns. */
  readonly detailed = input(false);

  private readonly store = inject(SentryStore);
  protected readonly zeroAt = ZERO_AT;
  protected readonly simulated = this.store.mode === 'mock';
  protected readonly showAll = signal(false);
  protected readonly total = computed(() => this.store.snapshot()?.orders.length ?? 0);

  protected readonly rows = computed<readonly OrderRow[]>(() => {
    const all = this.store.snapshot()?.orders ?? [];
    const orders = this.showAll() ? all : all.slice(0, this.limit());
    const now = this.store.now();
    const today = formatDayMonth(now);
    return orders.map((order) => {
      const economics = orderEconomics(order);
      const day = formatDayMonth(order.createdAt);
      return {
        order,
        economics,
        when:
          day === today ? formatClock(order.createdAt) : `${day} ${formatClock(order.createdAt)}`,
        status: STATUS[order.status],
        fresh: now - new Date(order.createdAt).getTime() < 8_000,
        bar: marginBar(economics.marginBp),
      };
    });
  });
}

function marginBar(marginBp: number | null): OrderRow['bar'] {
  if (marginBp === null) return null;
  const clamped = Math.min(MAX_BP, Math.max(MIN_BP, marginBp));
  const position = ((clamped - MIN_BP) / (MAX_BP - MIN_BP)) * 100;
  return clamped >= 0
    ? { start: ZERO_AT, width: position - ZERO_AT, negative: false }
    : { start: position, width: ZERO_AT - position, negative: true };
}
