import { Component, computed, inject } from '@angular/core';
import { basisPoints } from '../../core/domain/money';
import { SentryStore } from '../../core/state/sentry-store';
import { BpPipe, IntPipe, SekPipe, SignedSekPipe } from '../../shared/pipes';

/** The week as a profit and loss statement, plus what the tools and models cost. */
@Component({
  selector: 'app-profit-loss',
  imports: [BpPipe, IntPipe, SekPipe, SignedSekPipe],
  templateUrl: './profit-loss.html',
  styleUrl: './profit-loss.scss',
})
export class ProfitLoss {
  private readonly store = inject(SentryStore);
  protected readonly finance = computed(() => this.store.snapshot()?.finance ?? null);
  protected readonly costs = computed(() => this.store.snapshot()?.costs ?? null);
  protected readonly marginBp = computed(() => {
    const finance = this.finance();
    return finance ? basisPoints(finance.contributionOre, finance.netSalesOre) : null;
  });
  protected readonly monthlyTools = computed(() =>
    (this.costs()?.tools ?? []).reduce((sum, tool) => sum + tool.monthlyOre, 0),
  );
}
