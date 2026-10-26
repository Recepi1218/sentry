import {
  afterNextRender,
  afterRenderEffect,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { form, FormField, maxLength, submit } from '@angular/forms/signals';
import { SentryStore, type SwitchView } from '../../core/state/sentry-store';
import { byActor } from '../../shared/labels';
import { ClockPipe } from '../../shared/pipes';
import { Icon } from '../../shared/ui/icon';

/** An open guard drops back by itself, like a spring-loaded cover. */
const GUARD_OPEN_MS = 12_000;

const STATE_COPY: Record<SwitchView, { readonly word: string; readonly text: string }> = {
  locked: { word: 'LÅST', text: 'Inga agenter kan förbruka pengar. Varje kostnad är spärrad.' },
  armed: { word: 'AKTIV', text: 'Agenterna får förbruka budget, aldrig mer än veckogränsen.' },
  arming: { word: 'AKTIVERAR', text: 'Aktiveringen är skickad men ännu inte bekräftad.' },
  locking: { word: 'LÅSER', text: 'Låsningen är skickad men ännu inte bekräftad.' },
  unknown: { word: 'OKÄNT', text: 'Det finns ingen bekräftad status från backend just nu.' },
};

/**
 * The master switch. Easy to stop, hard to start: arming takes two deliberate steps (lift the
 * guard, then activate) and passes the pre-flight checks; locking is one click from any state.
 * The UI only ever shows a state the backend has confirmed.
 */
@Component({
  selector: 'app-master-switch',
  imports: [ClockPipe, FormField, Icon],
  templateUrl: './master-switch.html',
  styleUrl: './master-switch.scss',
})
export class MasterSwitch {
  protected readonly store = inject(SentryStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly view = this.store.switchView;
  protected readonly copy = computed(() => STATE_COPY[this.view()]);
  protected readonly backend = this.store.mode === 'mock' ? 'simuleringen' : 'n8n';
  protected readonly byActor = byActor;

  private readonly guardOpenedAt = signal<number | null>(null);

  protected readonly guardSecondsLeft = computed(() => {
    const openedAt = this.guardOpenedAt();
    if (openedAt === null) return 0;
    return Math.max(0, Math.ceil((openedAt + GUARD_OPEN_MS - this.store.now()) / 1000));
  });

  /** Only meaningful while locked; it expires on its own. */
  protected readonly guardLifted = computed(
    () => this.view() === 'locked' && this.store.canArm() && this.guardSecondsLeft() > 0,
  );

  protected readonly guardPosition = computed(() => {
    const view = this.view();
    return view === 'armed' || view === 'arming' || this.guardLifted() ? 'open' : 'closed';
  });

  protected readonly leverPosition = computed(() => {
    const view = this.view();
    if (view === 'armed') return 'up';
    if (view === 'arming' || view === 'locking') return 'mid';
    return 'down';
  });

  protected readonly failure = computed(() => {
    const command = this.store.command();
    return command.phase === 'failed' ? command : null;
  });

  private readonly reasonModel = signal({ reason: '' });
  protected readonly reasonForm = form(this.reasonModel, (path) => {
    maxLength(path.reason, 120, { message: 'Skriv högst 120 tecken.' });
  });

  /** Until when a state change may move focus: only right after the operator acted here. */
  private focusIntentUntil = 0;

  constructor() {
    // When a state change swaps the buttons out from under the operator's focus, put focus on
    // the new primary action instead of dropping it on <body>.
    let previous: string | null = null;
    afterRenderEffect(() => {
      const key = `${this.view()}:${this.guardLifted()}`;
      if (previous !== null && previous !== key && Date.now() < this.focusIntentUntil) {
        const active = this.document.activeElement;
        if (active === null || active === this.document.body) {
          this.host.nativeElement.querySelector<HTMLElement>('[data-primary]')?.focus();
        }
      }
      previous = key;
    });
  }

  protected liftGuard(): void {
    if (!this.store.canArm()) return;
    this.markIntent();
    this.guardOpenedAt.set(this.store.now());
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#arm-reason')?.focus(),
      { injector: this.injector },
    );
  }

  protected lowerGuard(): void {
    this.markIntent();
    this.guardOpenedAt.set(null);
  }

  protected async arm(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.reasonForm, async (field) => {
      const reason = field.reason().value().trim() || 'Manuell aktivering från kontrollpanelen';
      this.markIntent();
      this.guardOpenedAt.set(null);
      this.reasonModel.set({ reason: '' });
      this.store.arm(reason);
      return undefined;
    });
  }

  protected lock(): void {
    this.markIntent();
    this.guardOpenedAt.set(null);
    this.store.lock();
  }

  private markIntent(): void {
    this.focusIntentUntil = Date.now() + 20_000;
  }
}
