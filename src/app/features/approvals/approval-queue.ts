import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Approval } from '../../core/domain/model';
import { SentryStore } from '../../core/state/sentry-store';
import { formatSek } from '../../shared/format';
import { APPROVAL_KIND } from '../../shared/labels';
import { AgoPipe, BpPipe, SekPipe } from '../../shared/pipes';

interface ApprovalRow {
  readonly approval: Approval;
  readonly kind: string;
  readonly from: string;
  readonly pending: 'APPROVE' | 'REJECT' | null;
  readonly error: string | null;
  /** Why approving is impossible right now, or null. */
  readonly blocker: string | null;
}

/** Nothing the agents propose starts until it has been approved here. */
@Component({
  selector: 'app-approval-queue',
  imports: [AgoPipe, BpPipe, RouterLink, SekPipe],
  templateUrl: './approval-queue.html',
  styleUrl: './approval-queue.scss',
})
export class ApprovalQueue {
  /** Show at most this many, with a link to the full list; null shows all. */
  readonly limit = input<number | null>(null);

  protected readonly store = inject(SentryStore);
  protected readonly currentLimitOre = computed(() => this.store.budget()?.totals.limitOre ?? 0);

  protected readonly visible = computed(() => {
    const limit = this.limit();
    return limit === null ? this.rows() : this.rows().slice(0, limit);
  });

  protected readonly rows = computed<readonly ApprovalRow[]>(() => {
    const approvals = this.store.snapshot()?.approvals ?? [];
    const agents = this.store.agentsById();
    const decisions = this.store.decisions();
    const armed = this.store.switchView() === 'armed';
    const remaining = this.store.budget()?.remainingOre ?? 0;
    return approvals.map((approval) => {
      const decision = decisions.get(approval.id);
      let blocker: string | null = null;
      if (approval.costOre > 0 && !armed) {
        blocker = 'Kräver aktivt system, eftersom budgeten reserveras direkt vid godkännande.';
      } else if (approval.costOre > remaining) {
        blocker = `Budgeten räcker inte: ${formatSek(remaining)} återstår den här veckan.`;
      }
      return {
        approval,
        kind: APPROVAL_KIND[approval.kind],
        from: agents.get(approval.requestedBy)?.codename ?? approval.requestedBy,
        pending: decision?.phase === 'pending' ? decision.decision : null,
        error: decision?.phase === 'failed' ? decision.message : null,
        blocker,
      };
    });
  });
}
