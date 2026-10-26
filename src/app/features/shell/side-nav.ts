import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SentryStore } from '../../core/state/sentry-store';
import { Icon, type IconName } from '../../shared/ui/icon';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
  readonly exact: boolean;
}

const ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Översikt', icon: 'overview', exact: true },
  { path: '/agenter', label: 'Agenter', icon: 'agents', exact: false },
  { path: '/forslag', label: 'Produktförslag', icon: 'inbox', exact: false },
  { path: '/ordrar', label: 'Ordrar', icon: 'orders', exact: false },
  { path: '/ekonomi', label: 'Ekonomi och budget', icon: 'chart', exact: false },
  { path: '/logg', label: 'Logg', icon: 'log', exact: false },
];

/** The main menu: a sidebar on wide screens, a scrolling tab row on narrow ones. */
@Component({
  selector: 'app-side-nav',
  imports: [Icon, RouterLink, RouterLinkActive],
  template: `
    <nav class="nav" aria-label="Huvudmeny">
      <ul class="items">
        @for (item of items; track item.path) {
          <li>
            <a
              class="item"
              [routerLink]="item.path"
              routerLinkActive="is-active"
              ariaCurrentWhenActive="page"
              [routerLinkActiveOptions]="{ exact: item.exact }"
            >
              <app-icon [name]="item.icon" [size]="18" />
              <span class="label">{{ item.label }}</span>
              @if (badges()[item.path]; as badge) {
                <span class="badge" [class]="'badge badge--' + badge.tone">
                  {{ badge.count }}<span class="visually-hidden"> {{ badge.text }}</span>
                </span>
              }
            </a>
          </li>
        }
      </ul>
    </nav>
  `,
  styleUrl: './side-nav.scss',
})
export class SideNav {
  private readonly store = inject(SentryStore);
  protected readonly items = ITEMS;

  /** Counts that ask for attention: decisions waiting, and agents at work. */
  protected readonly badges = computed(() => {
    const snapshot = this.store.snapshot();
    const badges: Partial<
      Record<string, { readonly count: number; readonly text: string; readonly tone: string }>
    > = {};
    if (!snapshot) return badges;
    const pending = snapshot.approvals.length;
    if (pending > 0) badges['/forslag'] = { count: pending, text: 'väntar på dig', tone: 'caution' };
    const working = snapshot.agents.filter((agent) => agent.status === 'WORKING').length;
    if (working > 0) badges['/agenter'] = { count: working, text: 'arbetar', tone: 'info' };
    return badges;
  });
}
