import { Component, computed, inject } from '@angular/core';
import { SentryStore } from '../../core/state/sentry-store';
import { ClockPipe } from '../../shared/pipes';
import { Icon } from '../../shared/ui/icon';

/** How the agents talk: never directly, always as rows in Airtable picked up by n8n. */
@Component({
  selector: 'app-signal-feed',
  imports: [ClockPipe, Icon],
  styleUrl: './signal-feed.scss',
  template: `
    <section class="panel" aria-labelledby="signals-title">
      <div class="panel-head">
        <h2 class="panel-title" id="signals-title">Överlämningar mellan agenter</h2>
        <p class="panel-note">Via n8n och Airtable</p>
      </div>
      <p class="explain">
        Agenterna anropar aldrig varandra direkt. En agent skriver sitt resultat som en rad i
        tabellen Tasks i Airtable, och nästa agents arbetsflöde i n8n plockar upp raden därifrån.
      </p>
      <ol class="feed">
        @for (handoff of handoffs(); track handoff.id) {
          <li class="handoff">
            <time class="time" [attr.datetime]="handoff.at">{{ handoff.at | clock }}</time>
            <p class="route">
              <span class="code">{{ handoff.from }}</span>
              <app-icon name="arrow" />
              <span class="visually-hidden">till</span>
              <span class="code">{{ handoff.to }}</span>
            </p>
            <p class="subject">{{ handoff.subject }}</p>
            <p class="via">{{ handoff.workflow }}, tabellen {{ handoff.table }}</p>
          </li>
        } @empty {
          <li class="empty">Inga överlämningar än. De syns här när agenterna arbetar.</li>
        }
      </ol>
    </section>
  `,
})
export class SignalFeed {
  private readonly store = inject(SentryStore);

  protected readonly handoffs = computed(() => {
    const agents = this.store.agentsById();
    return (this.store.snapshot()?.handoffs ?? []).slice(0, 8).map((handoff) => ({
      ...handoff,
      from: agents.get(handoff.fromAgentId)?.codename ?? handoff.fromAgentId,
      to: agents.get(handoff.toAgentId)?.codename ?? handoff.toAgentId,
    }));
  });
}
