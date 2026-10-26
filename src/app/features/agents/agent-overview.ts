import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AgentStatus, Division } from '../../core/domain/model';
import { SentryStore } from '../../core/state/sentry-store';
import { AGENT_STATUS, AGENT_STATUS_ORDER, DIVISION } from '../../shared/labels';

/** The overview's glance at the agents: status counts and how each division is doing. */
@Component({
  selector: 'app-agent-overview',
  imports: [RouterLink],
  template: `
    <section class="panel" aria-labelledby="agent-overview-title">
      <div class="panel-head">
        <h3 class="panel-title" id="agent-overview-title">Agenter</h3>
        <a class="panel-link" routerLink="/agenter">Visa organisationen</a>
      </div>

      <ul class="counts" aria-label="Status för alla agenter">
        @for (item of counts(); track item.status) {
          <li class="count">
            <span [class]="'lamp lamp--' + item.tone"></span>
            <span class="count-value">{{ item.count }}</span>
            <span class="count-label">{{ item.label }}</span>
          </li>
        }
      </ul>

      <ul class="divisions">
        @for (division of divisions(); track division.id) {
          <li class="division">
            <span class="division-name">{{ division.name }}</span>
            <span class="division-chief">
              @if (division.chief; as chief) {
                Chef {{ chief.codename }}:
                <span [class]="'tone-' + chief.tone">{{ chief.label }}</span>
              }
            </span>
            <span class="division-working">{{ division.working }} av {{ division.total }} arbetar</span>
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .panel-link {
      color: var(--info);
      font-size: var(--t-xs);
      text-underline-offset: 3px;
    }

    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .count {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 0 12px;
      background: var(--bezel-raised);
      border-radius: 999px;
    }

    .count-value {
      font-weight: 650;
      font-variant-numeric: tabular-nums;
    }

    .count-label {
      color: var(--ink-2);
      font-size: var(--t-xs);
    }

    .divisions {
      display: grid;
      margin-top: 16px;
    }

    .division {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
      align-items: baseline;
      gap: 4px 16px;
      padding: 10px 0;
      border-top: 1px solid var(--rule);
    }

    .division-name {
      font-weight: 600;
    }

    .division-chief,
    .division-working {
      color: var(--ink-2);
      font-size: var(--t-xs);
    }

    .tone-neutral {
      color: var(--ink-3);
    }

    @media (max-width: 560px) {
      .division {
        grid-template-columns: minmax(0, 1fr) auto;
      }

      .division-chief {
        grid-row: 2;
      }
    }
  `,
})
export class AgentOverview {
  private readonly store = inject(SentryStore);
  private readonly agents = computed(() => this.store.snapshot()?.agents ?? []);

  protected readonly counts = computed(() => {
    const counts = new Map<AgentStatus, number>();
    for (const agent of this.agents()) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
    return AGENT_STATUS_ORDER.filter((status) => counts.has(status)).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      ...AGENT_STATUS[status],
    }));
  });

  protected readonly divisions = computed(() =>
    (['VANGUARD', 'MERIDIAN'] as const satisfies readonly Division[]).map((id) => {
      const members = this.agents().filter(
        (agent) => agent.division === id && agent.rank !== 'OVERSIGHT',
      );
      const chief = members.find((agent) => agent.rank === 'CHIEF');
      return {
        id,
        name: DIVISION[id].name,
        chief: chief ? { codename: chief.codename, ...AGENT_STATUS[chief.status] } : null,
        total: members.length,
        working: members.filter((agent) => agent.status === 'WORKING').length,
      };
    }),
  );
}
