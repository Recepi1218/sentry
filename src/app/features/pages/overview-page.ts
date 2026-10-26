import { Component } from '@angular/core';
import { AgentOverview } from '../agents/agent-overview';
import { ApprovalQueue } from '../approvals/approval-queue';
import { BudgetPanel } from '../budget/budget-panel';
import { KpiStrip } from '../finance/kpi-strip';
import { OrdersTable } from '../finance/orders-table';

/** The start page: the week's numbers, the agents at a glance, and what waits for you. */
@Component({
  selector: 'app-overview-page',
  imports: [AgentOverview, ApprovalQueue, BudgetPanel, KpiStrip, OrdersTable],
  template: `
    <div class="page">
      <h2 class="page-title">Översikt</h2>
      <app-kpi-strip />
      <div class="split">
        <div class="stack">
          <app-agent-overview />
          <app-orders-table [limit]="8" [linkToAll]="true" />
        </div>
        <div class="stack">
          <app-budget-panel />
          <app-approval-queue [limit]="2" />
        </div>
      </div>
    </div>
  `,
})
export class OverviewPage {}
