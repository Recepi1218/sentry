import { Component, computed, inject, signal } from '@angular/core';
import type { AuditEvent } from '../../core/domain/model';
import { SentryStore } from '../../core/state/sentry-store';
import { SEVERITY } from '../../shared/labels';
import { ClockPipe } from '../../shared/pipes';
import { Icon, type IconName } from '../../shared/ui/icon';

type Filter = 'all' | 'decisions' | 'warnings' | 'agents';

const FILTERS: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: 'all', label: 'Allt' },
  { id: 'decisions', label: 'Dina beslut' },
  { id: 'warnings', label: 'Varningar' },
  { id: 'agents', label: 'Agenter' },
];

const MATCHES: Record<Filter, (event: AuditEvent) => boolean> = {
  all: () => true,
  decisions: (event) => event.actor.kind === 'OPERATOR',
  warnings: (event) => event.severity === 'WARNING' || event.severity === 'CRITICAL',
  agents: (event) => event.actor.kind === 'AGENT' || event.actor.kind === 'SENTINEL',
};

const SEVERITY_ICON: Record<AuditEvent['severity'], IconName> = {
  INFO: 'info',
  NOTICE: 'check',
  WARNING: 'alert',
  CRITICAL: 'stop',
};

/** The audit trail: every decision, denial and state change, newest first. */
@Component({
  selector: 'app-audit-log',
  imports: [ClockPipe, Icon],
  styleUrl: './audit-log.scss',
  template: `
    <section class="panel" aria-labelledby="audit-title">
      <div class="panel-head">
        <h2 class="panel-title" id="audit-title">Logg</h2>
        <div class="filters" role="group" aria-label="Visa i loggen">
          @for (option of filters; track option.id) {
            <button
              class="chip"
              type="button"
              [attr.aria-pressed]="filter() === option.id"
              (click)="filter.set(option.id)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>
      <ol class="log" tabindex="0" aria-label="Händelser, senaste först">
        @for (event of events(); track event.id) {
          <li class="event" [attr.data-severity]="event.severity">
            <time class="time" [attr.datetime]="event.at">{{ event.at | clock: true }}</time>
            <span [class]="'severity tone-' + severity[event.severity].tone">
              <app-icon [name]="icons[event.severity]" />{{ severity[event.severity].label }}
            </span>
            <span class="actor">{{ event.actor.label }}</span>
            <p class="message">{{ event.message }}</p>
          </li>
        } @empty {
          <li class="empty">Inga händelser för det här urvalet.</li>
        }
      </ol>
    </section>
  `,
})
export class AuditLog {
  private readonly store = inject(SentryStore);
  protected readonly filters = FILTERS;
  protected readonly severity = SEVERITY;
  protected readonly icons = SEVERITY_ICON;
  protected readonly filter = signal<Filter>('all');

  protected readonly events = computed(() =>
    (this.store.snapshot()?.audit ?? []).filter(MATCHES[this.filter()]).slice(0, 60),
  );
}
