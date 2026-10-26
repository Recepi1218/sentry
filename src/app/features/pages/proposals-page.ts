import { Component } from '@angular/core';
import { ApprovalQueue } from '../approvals/approval-queue';

/** Everything the agents propose, waiting for the operator's decision. */
@Component({
  selector: 'app-proposals-page',
  imports: [ApprovalQueue],
  template: `
    <div class="page page--narrow">
      <div class="page-head">
        <h2 class="page-title">Produktförslag</h2>
        <p class="page-intro">
          Produkter, kampanjer och höjningar av veckogränsen som agenterna föreslår. Inget startar
          eller ändras innan du har godkänt det.
        </p>
      </div>
      <app-approval-queue />
    </div>
  `,
})
export class ProposalsPage {}
