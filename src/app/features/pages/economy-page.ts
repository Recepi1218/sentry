import { Component } from '@angular/core';
import { BudgetPanel } from '../budget/budget-panel';
import { KpiStrip } from '../finance/kpi-strip';
import { ProfitLoss } from '../finance/profit-loss';

/** The week's result, what AI and tools cost, and the budget that caps it all. */
@Component({
  selector: 'app-economy-page',
  imports: [BudgetPanel, KpiStrip, ProfitLoss],
  template: `
    <div class="page">
      <h2 class="page-title">Ekonomi och budget</h2>
      <app-kpi-strip />
      <div class="split">
        <app-profit-loss />
        <app-budget-panel />
      </div>
    </div>
  `,
})
export class EconomyPage {}
