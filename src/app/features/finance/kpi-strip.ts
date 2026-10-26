import { Component, computed, inject } from '@angular/core';
import { basisPoints } from '../../core/domain/money';
import { SentryStore } from '../../core/state/sentry-store';
import {
  formatBp,
  formatDayMonth,
  formatInt,
  formatSek,
  formatSignedSek,
} from '../../shared/format';
import { Sparkline } from '../../shared/ui/sparkline';

interface Readout {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone?: 'gain' | 'loss';
  readonly trend?: {
    readonly name: string;
    readonly values: readonly number[];
    readonly format: (value: number) => string;
  };
}

const sek = (ore: number) => formatSek(ore);
const count = (value: number) => `${formatInt(value)} ordrar`;

/** The week's headline numbers, each with its daily trend over two weeks. */
@Component({
  selector: 'app-kpi-strip',
  imports: [Sparkline],
  styleUrl: './kpi-strip.scss',
  template: `
    <section class="panel strip" aria-label="Nyckeltal denna vecka">
      @for (readout of readouts(); track readout.id) {
        <div class="readout" [attr.data-tone]="readout.tone ?? null">
          <p class="label">{{ readout.label }}</p>
          <p class="value">{{ readout.value }}</p>
          <p class="detail">{{ readout.detail }}</p>
          @if (readout.trend; as trend) {
            <app-sparkline
              [name]="trend.name"
              [values]="trend.values"
              [labels]="days()"
              [format]="trend.format"
            />
          }
        </div>
      }
    </section>
  `,
})
export class KpiStrip {
  private readonly store = inject(SentryStore);
  private readonly finance = computed(() => this.store.snapshot()?.finance ?? null);

  protected readonly days = computed(() =>
    (this.finance()?.daily ?? []).map((point) => formatDayMonth(`${point.date}T12:00:00Z`)),
  );

  protected readonly readouts = computed<readonly Readout[]>(() => {
    const finance = this.finance();
    if (!finance) return [];
    const daily = finance.daily;
    const result = finance.netResultOre;
    const averageOrder =
      finance.orderCount > 0 ? Math.round(finance.grossOre / finance.orderCount) : 0;
    return [
      {
        id: 'sales',
        label: 'Omsättning exkl. moms',
        value: formatSek(finance.netSalesOre),
        detail: `${formatSek(finance.grossOre)} betalt inkl. moms`,
        trend: {
          name: 'Omsättning per dag',
          values: daily.map((point) => point.netSalesOre),
          format: sek,
        },
      },
      {
        id: 'contribution',
        label: 'Täckningsbidrag',
        value: formatSek(finance.contributionOre),
        detail: `${formatBp(basisPoints(finance.contributionOre, finance.netSalesOre))} av omsättningen`,
        trend: {
          name: 'Täckningsbidrag per dag',
          values: daily.map((point) => point.contributionOre),
          format: sek,
        },
      },
      {
        id: 'result',
        label: result >= 0 ? 'Vinst' : 'Förlust',
        value: formatSignedSek(result),
        detail: 'Efter AI, API-anrop och verktyg',
        tone: result >= 0 ? 'gain' : 'loss',
      },
      {
        id: 'orders',
        label: 'Ordrar',
        value: formatInt(finance.orderCount),
        detail: `Snittorder ${formatSek(averageOrder)}`,
        trend: {
          name: 'Ordrar per dag',
          values: daily.map((point) => point.orders),
          format: count,
        },
      },
      {
        id: 'ai',
        label: 'AI och API',
        value: formatSek(finance.aiCostOre + finance.apiCostOre, 'auto'),
        detail: `Annonser ${formatSek(finance.adSpendOre)}`,
      },
    ];
  });
}
