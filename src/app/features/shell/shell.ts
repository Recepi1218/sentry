import { afterNextRender, Component, ElementRef, inject, Injector, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, skip } from 'rxjs';
import { SentryStore } from '../../core/state/sentry-store';
import { Icon } from '../../shared/ui/icon';
import { MasterSwitch } from '../control/master-switch';
import { ConnectPanel } from './connect-panel';
import { SideNav } from './side-nav';
import { TopBar } from './top-bar';

/**
 * The app frame: top bar, the main menu and – on every page, so it is never more than a glance
 * away – the master switch. Pages render once the first snapshot has arrived.
 */
@Component({
  selector: 'app-shell',
  imports: [ConnectPanel, Icon, MasterSwitch, RouterOutlet, SideNav, TopBar],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly store = inject(SentryStore);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  constructor() {
    // After moving to another page, start keyboard and screen-reader users at its content.
    const injector = inject(Injector);
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        skip(1),
        takeUntilDestroyed(),
      )
      .subscribe(() =>
        afterNextRender(() => this.main()?.nativeElement.focus({ preventScroll: true }), {
          injector,
        }),
      );
  }
}
