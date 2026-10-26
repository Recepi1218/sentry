import { Component, computed, inject, input, output } from '@angular/core';
import type { Agent } from '../../core/domain/model';
import { SentryStore } from '../../core/state/sentry-store';
import { AGENT_STATUS } from '../../shared/labels';
import { SekPipe } from '../../shared/pipes';
import { activityOf } from './agent-activity';

/** One agent in the org chart: who it is, its status and what it is doing right now. */
@Component({
  selector: 'app-agent-card',
  imports: [SekPipe],
  template: `
    <button
      class="card"
      type="button"
      [attr.data-rank]="agent().rank"
      [attr.data-status]="agent().status"
      [attr.aria-expanded]="selected()"
      [attr.aria-controls]="selected() ? 'agent-detail' : null"
      (click)="pick.emit()"
    >
      <span class="head">
        <span class="codename">{{ agent().codename }}</span>
        <span class="spend">{{ agent().weekSpendOre | sek: 'auto' }}</span>
      </span>
      @if (badge(); as text) {
        <span class="badge">{{ text }}</span>
      }
      <span class="role">{{ agent().role }}</span>
      <span class="status" [class]="'status tone-' + status().tone">
        <span [class]="'lamp lamp--' + status().tone"></span>{{ status().label }}
      </span>
      <span class="activity">{{ activity() }}</span>
    </button>
  `,
  styleUrl: './agent-card.scss',
})
export class AgentCard {
  readonly agent = input.required<Agent>();
  readonly selected = input(false);
  readonly pick = output<void>();

  private readonly store = inject(SentryStore);
  protected readonly status = computed(() => AGENT_STATUS[this.agent().status]);
  protected readonly activity = computed(() => activityOf(this.agent(), this.store.now()));
  protected readonly badge = computed(() => {
    switch (this.agent().rank) {
      case 'CHIEF':
        return 'Divisionschef';
      case 'OVERSIGHT':
        return 'Tillsyn, rapporterar till dig';
      default:
        return null;
    }
  });
}
