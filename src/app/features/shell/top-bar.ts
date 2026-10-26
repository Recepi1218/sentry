import { Component, computed, inject } from '@angular/core';
import { SentryStore } from '../../core/state/sentry-store';
import { formatClock, formatDayMonth, formatDuration } from '../../shared/format';
import { Icon } from '../../shared/ui/icon';

/**
 * Always on screen: where the system stands, how fresh that knowledge is, and – whenever
 * the system might be live – a one-click lock.
 */
@Component({
  selector: 'app-top-bar',
  imports: [Icon],
  styleUrl: './top-bar.scss',
  template: `
    <header class="bar">
      <a class="skip" href="#main">Hoppa till innehållet</a>
      <h1 class="wordmark">Sentry</h1>

      @if (week(); as w) {
        <p class="meta">
          <span class="meta-strong">Vecka {{ w.number }}</span> {{ w.range }}
        </p>
      }

      <p class="meta sync" [attr.data-tone]="sync().tone">
        <span class="lamp" [class]="'lamp lamp--' + sync().tone"></span>{{ sync().text }}
        @if (sync().tone !== 'normal') {
          <button class="btn btn--quiet btn--sm" type="button" (click)="store.refresh()">
            <app-icon name="refresh" />Försök nu
          </button>
        }
      </p>

      <p class="meta source">{{ store.mode === 'mock' ? 'Simulerad data' : 'n8n Cloud' }}</p>

      @if (store.dataIssues().length; as issues) {
        <p
          class="meta issues"
          [attr.title]="
            store.dataIssues().join(
              '
'
            )
          "
        >
          <app-icon name="alert" />{{ issues }} {{ issues === 1 ? 'post' : 'poster' }} kunde inte
          läsas
        </p>
      }

      <div class="state" aria-live="polite">
        @switch (store.switchView()) {
          @case ('locked') {
            <span class="state-label tone-info"><app-icon name="lock" />Låst</span>
          }
          @case ('armed') {
            <span class="state-label tone-caution"
              ><span class="live" aria-hidden="true"></span>Aktiv</span
            >
          }
          @case ('arming') {
            <span class="state-label"
              ><span class="spinner" aria-hidden="true"></span>Aktiverar</span
            >
          }
          @case ('locking') {
            <span class="state-label"><span class="spinner" aria-hidden="true"></span>Låser</span>
          }
          @default {
            <span class="state-label tone-caution"><app-icon name="alert" />Okänt läge</span>
          }
        }
        @if (showLock()) {
          <button class="btn btn--stop btn--sm" type="button" (click)="store.lock()">
            <app-icon name="stop" />Lås systemet
          </button>
        }
      </div>
    </header>
  `,
})
export class TopBar {
  protected readonly store = inject(SentryStore);

  protected readonly week = computed(() => {
    const budget = this.store.snapshot()?.budget;
    if (!budget) return null;
    const lastMoment = new Date(budget.weekEndsAt).getTime() - 1;
    return {
      number: Number(budget.weekId.slice(-2)),
      range: `${formatDayMonth(budget.weekStartsAt)} – ${formatDayMonth(lastMoment)}`,
    };
  });

  protected readonly sync = computed(() => {
    const sync = this.store.sync();
    const last = sync.lastSuccessAt;
    if (last === null) {
      return sync.phase === 'error'
        ? { tone: 'warning', text: 'Ingen kontakt med backend' }
        : { tone: 'neutral', text: 'Ansluter…' };
    }
    if (this.store.isStale()) {
      return {
        tone: 'warning',
        text: `Inaktuellt: senaste svar ${formatClock(last)}, ${formatDuration(this.store.now() - last)} sedan`,
      };
    }
    if (sync.phase === 'error')
      return {
        tone: 'caution',
        text: `Senaste försöket misslyckades, data från ${formatClock(last, true)}`,
      };
    return { tone: 'normal', text: `Synkad ${formatClock(last, true)}` };
  });

  /** Lock is offered whenever the system is, or might be, live. */
  protected readonly showLock = computed(() => {
    const view = this.store.switchView();
    return view === 'armed' || view === 'arming' || view === 'unknown';
  });
}
