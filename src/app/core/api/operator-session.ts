import { computed, DOCUMENT, inject, Service, signal } from '@angular/core';

const STORAGE_KEY = 'sentry.operatorToken';

/**
 * Holds the operator's n8n access token for this browser tab only. It is typed in at runtime –
 * never baked into the bundle – and sessionStorage forgets it when the tab closes.
 */
@Service()
export class OperatorSession {
  private readonly storage = safeSessionStorage(inject(DOCUMENT).defaultView);
  private readonly tokenState = signal<string | null>(this.read());

  readonly token = this.tokenState.asReadonly();
  readonly hasToken = computed(() => this.tokenState() !== null);

  set(token: string): void {
    const trimmed = token.trim();
    if (!trimmed) return;
    this.tokenState.set(trimmed);
    try {
      this.storage?.setItem(STORAGE_KEY, trimmed);
    } catch {
      // Storage can be full or blocked; the token still works for this page load.
    }
  }

  clear(): void {
    this.tokenState.set(null);
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }
}

function safeSessionStorage(view: Window | null): Storage | null {
  try {
    return view?.sessionStorage ?? null;
  } catch {
    return null;
  }
}
