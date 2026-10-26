import { Component, input } from '@angular/core';

export type IconName =
  | 'lock'
  | 'power'
  | 'check'
  | 'alert'
  | 'stop'
  | 'info'
  | 'refresh'
  | 'arrow'
  | 'clock'
  | 'close'
  | 'overview'
  | 'agents'
  | 'inbox'
  | 'orders'
  | 'chart'
  | 'log';

/** 16px stroke icons. Always decorative – the text next to them carries the meaning. */
@Component({
  selector: 'app-icon',
  host: { class: 'icon' },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
  template: `
    <svg
      viewBox="0 0 16 16"
      [attr.width]="size()"
      [attr.height]="size()"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('lock') {
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        }
        @case ('power') {
          <path d="M8 2v6" />
          <path d="M4.6 4.2a5 5 0 1 0 6.8 0" />
        }
        @case ('check') {
          <path d="M3 8.5l3 3 7-7" />
        }
        @case ('alert') {
          <path d="M8 2.5l6 11H2z" />
          <path d="M8 6.5v3" />
          <path d="M8 11.6v.01" />
        }
        @case ('stop') {
          <path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5z" />
          <path d="M8 5v3.5" />
          <path d="M8 10.8v.01" />
        }
        @case ('info') {
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.5v3.5" />
          <path d="M8 5.1v.01" />
        }
        @case ('refresh') {
          <path d="M13 3v3.5H9.5" />
          <path d="M12.6 6.5A5 5 0 1 0 13 9" />
        }
        @case ('arrow') {
          <path d="M3 8h10" />
          <path d="M9.5 4.5L13 8l-3.5 3.5" />
        }
        @case ('clock') {
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        }
        @case ('close') {
          <path d="M4 4l8 8M12 4l-8 8" />
        }
        @case ('overview') {
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
        }
        @case ('agents') {
          <circle cx="8" cy="3.6" r="1.6" />
          <circle cx="3.6" cy="12" r="1.6" />
          <circle cx="12.4" cy="12" r="1.6" />
          <path d="M8 5.2v3M3.6 10.4V8.2h8.8v2.2" />
        }
        @case ('inbox') {
          <path d="M2.5 9.5l1.8-6h7.4l1.8 6v3.5h-11z" />
          <path d="M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2" />
        }
        @case ('orders') {
          <path d="M2 2.5h1.8l1.4 7.5h7l1.3-5.5H4.4" />
          <circle cx="6" cy="13" r="1" />
          <circle cx="11.5" cy="13" r="1" />
        }
        @case ('chart') {
          <path d="M2.5 13.5h11" />
          <path d="M4.5 11V7.5M8 11V4M11.5 11V6" />
        }
        @case ('log') {
          <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
          <path d="M2.5 4v.01M2.5 8v.01M2.5 12v.01" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
}
