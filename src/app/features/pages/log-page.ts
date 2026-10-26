import { Component } from '@angular/core';
import { AuditLog } from '../audit/audit-log';

/** The full audit trail of decisions and actions. */
@Component({
  selector: 'app-log-page',
  imports: [AuditLog],
  template: `
    <div class="page page--narrow">
      <div class="page-head">
        <h2 class="page-title">Logg</h2>
        <p class="page-intro">Varje beslut och åtgärd, från dig och från agenterna.</p>
      </div>
      <app-audit-log />
    </div>
  `,
})
export class LogPage {}
