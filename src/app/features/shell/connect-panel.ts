import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, minLength, required, submit } from '@angular/forms/signals';
import { OperatorSession } from '../../core/api/operator-session';
import { SENTRY_CONFIG } from '../../core/api/sentry-config';
import { SentryStore } from '../../core/state/sentry-store';

/** n8n mode only: the operator types the webhook token in; it never ships in the bundle. */
@Component({
  selector: 'app-connect-panel',
  imports: [FormField],
  styles: `
    :host {
      display: block;
      width: min(100%, 440px);
    }
    .panel {
      display: grid;
      gap: 16px;
    }
    .lead {
      color: var(--ink-2);
    }
    form {
      display: grid;
      gap: 12px;
    }
  `,
  template: `
    <section class="panel" aria-labelledby="connect-title">
      <h2 class="panel-title" id="connect-title">Anslut till n8n</h2>
      @if (baseUrl) {
        <p class="lead">
          Kontrollpanelen hämtar läget från {{ baseUrl }}. Ange åtkomsttoken för webhookarna. Den
          sparas bara i den här fliken och försvinner när du stänger den.
        </p>
      } @else {
        <p class="field-error">
          Adressen till n8n saknas. Fyll i n8nBaseUrl i src/environments/environment.ts och bygg om.
        </p>
      }
      <form novalidate (submit)="connect($event)">
        <div class="field">
          <label for="operator-token">Åtkomsttoken</label>
          <input
            id="operator-token"
            type="password"
            autocomplete="off"
            spellcheck="false"
            [formField]="tokenForm.token"
          />
          @if (tokenForm.token().touched()) {
            @for (error of tokenForm.token().errors(); track $index) {
              <p class="field-error">{{ error.message }}</p>
            }
          }
        </div>
        <button class="btn btn--block" type="submit" [disabled]="!baseUrl">Anslut</button>
      </form>
      @if (lastError(); as message) {
        <p class="field-error" role="alert">{{ message }}</p>
      }
    </section>
  `,
})
export class ConnectPanel {
  private readonly session = inject(OperatorSession);
  private readonly store = inject(SentryStore);
  protected readonly baseUrl = inject(SENTRY_CONFIG).n8nBaseUrl;

  private readonly model = signal({ token: '' });
  protected readonly tokenForm = form(this.model, (path) => {
    required(path.token, { message: 'Ange din åtkomsttoken.' });
    minLength(path.token, 24, { message: 'Token ska vara minst 24 tecken.' });
  });

  protected readonly lastError = computed(() => {
    const sync = this.store.sync();
    return sync.phase === 'error' ? sync.error : null;
  });

  protected async connect(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.tokenForm, async (field) => {
      this.session.set(field.token().value());
      this.model.set({ token: '' });
      return undefined;
    });
  }
}
