import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ControlState } from '../../core/domain/model';
import {
  SentryStore,
  type ArmCheck,
  type CommandState,
  type SwitchView,
} from '../../core/state/sentry-store';
import { MasterSwitch } from './master-switch';

const control: ControlState = {
  state: 'LOCKED',
  revision: 4,
  changedAt: '2026-10-26T15:00:00.000Z',
  changedBy: { kind: 'OPERATOR', id: 'operator', label: 'Du' },
  reason: 'Paus för genomgång',
};

function stubStore() {
  return {
    mode: 'mock' as const,
    now: signal(Date.parse('2026-10-26T17:00:00Z')),
    switchView: signal<SwitchView>('locked'),
    control: signal<ControlState | null>(control),
    canArm: signal(true),
    armChecks: signal<readonly ArmCheck[]>([
      { id: 'link', label: 'Kontakt med backend', ok: true, detail: 'Aktuellt läge' },
      { id: 'budget', label: 'Budget kvar den här veckan', ok: true, detail: '453 kr av 1 500 kr' },
      { id: 'alerts', label: 'Inga kritiska larm', ok: true, detail: 'Inget kritiskt' },
    ]),
    command: signal<CommandState>({ phase: 'idle' }),
    arm: vi.fn(),
    lock: vi.fn(),
    refresh: vi.fn(),
    dismissCommandError: vi.fn(),
  };
}

describe('MasterSwitch', () => {
  let store: ReturnType<typeof stubStore>;
  let fixture: ComponentFixture<MasterSwitch>;
  let element: HTMLElement;

  const button = (text: string) =>
    [...element.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    );

  async function render(): Promise<void> {
    fixture = TestBed.createComponent(MasterSwitch);
    element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  }

  beforeEach(() => {
    store = stubStore();
    TestBed.configureTestingModule({
      imports: [MasterSwitch],
      providers: [{ provide: SentryStore, useValue: store }],
    });
  });

  it('shows the confirmed locked state and keeps the arm control behind the guard', async () => {
    await render();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('LÅST');
    expect(button('Aktivera systemet')).toBeUndefined();
    expect(button('Lyft skyddet')?.disabled).toBe(false);
  });

  it('arms in two deliberate steps and logs the reason', async () => {
    await render();
    button('Lyft skyddet')?.click();
    await fixture.whenStable();

    const input = element.querySelector<HTMLInputElement>('#arm-reason');
    expect(input).not.toBeNull();
    input!.value = 'Kvällskörning';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(store.arm).toHaveBeenCalledWith('Kvällskörning');
  });

  it('cannot lift the guard while a pre-flight check fails', async () => {
    store.canArm.set(false);
    await render();
    expect(button('Lyft skyddet')?.disabled).toBe(true);
  });

  it('locks with a single click when armed', async () => {
    store.switchView.set('armed');
    store.control.set({ ...control, state: 'ARMED' });
    await render();

    expect(element.textContent).toContain('AKTIV');
    button('Lås systemet')?.click();
    expect(store.lock).toHaveBeenCalledTimes(1);
  });

  it('still offers a lock when the state is unknown', async () => {
    store.switchView.set('unknown');
    await render();
    expect(element.textContent).toContain('OKÄNT');
    expect(button('Lås systemet')).toBeDefined();
  });

  it('warns loudly when a lock could not be confirmed', async () => {
    store.switchView.set('armed');
    store.command.set({ phase: 'failed', action: 'LOCK', message: 'Ingen kontakt med n8n.' });
    await render();

    const alert = element.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Låsningen kunde inte bekräftas');
    expect(alert?.textContent).toContain('kan fortfarande vara aktivt');
    button('Försök låsa igen')?.click();
    expect(store.lock).toHaveBeenCalled();
  });
});
