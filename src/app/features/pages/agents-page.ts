import { Component } from '@angular/core';
import { OrgChart } from '../agents/org-chart';
import { SignalFeed } from '../agents/signal-feed';

/** The organisation, every agent's status, and how work moves between them. */
@Component({
  selector: 'app-agents-page',
  imports: [OrgChart, SignalFeed],
  template: `
    <div class="page">
      <div class="page-head">
        <h2 class="page-title">Agenter</h2>
        <p class="page-intro">20 agenter i två divisioner. Välj en agent för att se dess uppgifter.</p>
      </div>
      <app-org-chart />
      <app-signal-feed />
    </div>
  `,
})
export class AgentsPage {}
