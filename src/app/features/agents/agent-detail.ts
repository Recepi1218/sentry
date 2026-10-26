import { afterRenderEffect, Component, computed, ElementRef, inject, input, output } from '@angular/core';
import type { Agent } from '../../core/domain/model';
import { modelLabel } from '../../core/domain/pricing';
import { SentryStore } from '../../core/state/sentry-store';
import { AGENT_STATUS, TASK_OUTCOME } from '../../shared/labels';
import { ClockPipe, SekPipe } from '../../shared/pipes';
import { Icon } from '../../shared/ui/icon';
import { activityOf } from './agent-activity';

/** Everything about one agent: its place in the chain of command, current task and history. */
@Component({
  selector: 'app-agent-detail',
  imports: [ClockPipe, Icon, SekPipe],
  templateUrl: './agent-detail.html',
  styleUrl: './agent-detail.scss',
})
export class AgentDetail {
  readonly agent = input.required<Agent>();
  readonly dismiss = output<void>();

  private readonly store = inject(SentryStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly outcomes = TASK_OUTCOME;

  /** Snapshots replace the agent object on every poll; only a new id should move the page. */
  private readonly agentId = computed(() => this.agent().id);
  protected readonly status = computed(() => AGENT_STATUS[this.agent().status]);
  protected readonly model = computed(() => modelLabel(this.agent().model));
  protected readonly activity = computed(() => activityOf(this.agent(), this.store.now()));

  protected readonly rank = computed(() => {
    switch (this.agent().rank) {
      case 'CHIEF':
        return 'Divisionschef';
      case 'OVERSIGHT':
        return 'Tillsyn över båda divisionerna';
      default:
        return this.agent().team ? `Arbetare i ${this.agent().team}` : 'Arbetare';
    }
  });

  protected readonly manager = computed(() => {
    const id = this.agent().reportsTo;
    if (id === null) return 'dig';
    return this.store.agentsById().get(id)?.codename ?? id;
  });

  /** The workers who report to this agent, for chiefs. */
  protected readonly reports = computed(() =>
    (this.store.snapshot()?.agents ?? []).filter((agent) => agent.reportsTo === this.agent().id),
  );

  constructor() {
    // Bring the detail into view when a different agent is opened, without jumping if it already is.
    afterRenderEffect(() => {
      this.agentId();
      this.host.nativeElement.scrollIntoView({ block: 'nearest' });
    });
  }
}
