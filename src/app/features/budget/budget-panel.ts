import { Component, computed, inject } from '@angular/core';
import type { BudgetSeverity } from '../../core/domain/budget-gate';
import { SentryStore } from '../../core/state/sentry-store';
import { formatBp, formatDuration, formatSek, formatWeekdayClock } from '../../shared/format';
import { SPEND_CATEGORY } from '../../shared/labels';
import { BpPipe, IntPipe, SekPipe } from '../../shared/pipes';
import { Icon, type IconName } from '../../shared/ui/icon';

const SEVERITY_COPY: Record<BudgetSeverity, { readonly text: string; readonly icon: IconName }> = {
  normal: { text: 'Inom budget', icon: 'check' },
  warning: { text: 'Över varningsnivån', icon: 'alert' },
  critical: { text: 'Nära eller vid gränsen', icon: 'stop' },
};

/** The weekly budget against its hard limit. The limit itself lives server-side. */
@Component({
  selector: 'app-budget-panel',
  imports: [BpPipe, Icon, IntPipe, SekPipe],
  templateUrl: './budget-panel.html',
  styleUrl: './budget-panel.scss',
})
export class BudgetPanel {
  private readonly store = inject(SentryStore);
  protected readonly budget = this.store.budget;

  protected readonly severity = computed(() => {
    const budget = this.budget();
    return budget ? SEVERITY_COPY[budget.severity] : null;
  });

  protected readonly meter = computed(() => {
    const budget = this.budget();
    if (!budget) return null;
    const { limitOre, settledOre, reservedOre } = budget.totals;
    const share = (ore: number) => (limitOre > 0 ? Math.min(100, (ore / limitOre) * 100) : 0);
    const usedOre = settledOre + reservedOre;
    return {
      settled: share(settledOre),
      reserved: share(reservedOre),
      warnAt: budget.status.warnAtBp / 100,
      usedOre,
      text: `${formatSek(usedOre)} av ${formatSek(limitOre)} förbrukat eller reserverat, ${formatBp(budget.utilizationBp)}`,
    };
  });

  protected readonly categories = computed(() => {
    const budget = this.budget();
    if (!budget) return [];
    const limit = budget.totals.limitOre || 1;
    return budget.status.byCategory.map((entry) => ({
      ...entry,
      label: SPEND_CATEGORY[entry.category],
      settledShare: Math.min(100, (entry.settledOre / limit) * 100),
      reservedShare: Math.min(100, (entry.reservedOre / limit) * 100),
    }));
  });

  protected readonly resetsAt = computed(() => {
    const budget = this.budget();
    return budget ? formatWeekdayClock(budget.status.weekEndsAt) : null;
  });

  /** Only meaningful while the system is live. */
  protected readonly runway = computed(() => {
    const budget = this.budget();
    if (!budget || this.store.switchView() !== 'armed') return null;
    const perHour = budget.status.burnRateOrePerHour;
    if (perHour <= 0) return null;
    const runwayMs = (budget.remainingOre / perHour) * 3_600_000;
    const untilReset = new Date(budget.status.weekEndsAt).getTime() - this.store.now();
    return {
      rate: formatSek(perHour),
      text: runwayMs >= untilReset ? 'veckan ut' : formatDuration(runwayMs),
    };
  });
}
