import { Component, computed, input, signal } from '@angular/core';

interface Point {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/**
 * A daily trend line for a stat tile: de-emphasised line, today's point in the accent.
 * Hover or focus + arrow keys reads out any day; the summary label covers screen readers.
 */
@Component({
  selector: 'app-sparkline',
  styles: `
    :host {
      display: block;
    }
    .spark {
      position: relative;
      height: 34px;
      touch-action: none;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      border-radius: 2px;
    }
    .line {
      fill: none;
      stroke: var(--ink-3);
      stroke-width: 1.5px;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .cross {
      stroke: var(--rule-strong);
      stroke-width: 1px;
    }
    .dot {
      position: absolute;
      width: 8px;
      height: 8px;
      margin: -4px 0 0 -4px;
      border-radius: 50%;
      box-shadow: 0 0 0 2px var(--bezel);
      pointer-events: none;
    }
    .dot--now {
      background: var(--info-mark);
    }
    .dot--active {
      background: var(--ink);
    }
    .tip {
      position: absolute;
      bottom: calc(100% + 8px);
      z-index: 2;
      padding: 4px 8px;
      color: var(--ink-2);
      font-size: var(--t-xs);
      white-space: nowrap;
      background: var(--bezel-raised);
      border: 1px solid var(--rule-strong);
      border-radius: var(--radius-control);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .tip[data-align='start'] {
      transform: none;
    }
    .tip[data-align='end'] {
      transform: translateX(-100%);
    }
    .tip strong {
      color: var(--ink);
    }
  `,
  template: `
    <div class="spark" (pointermove)="track($event)" (pointerleave)="active.set(null)">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        tabindex="0"
        [attr.aria-label]="summary()"
        (keydown)="step($event)"
        (blur)="active.set(null)"
      >
        <path class="line" [attr.d]="path()" vector-effect="non-scaling-stroke" />
        @if (activePoint(); as point) {
          <line
            class="cross"
            [attr.x1]="point.x"
            [attr.x2]="point.x"
            y1="0"
            y2="100"
            vector-effect="non-scaling-stroke"
          />
        }
      </svg>
      @if (points().at(-1); as last) {
        <span class="dot dot--now" [style.left.%]="last.x" [style.top.%]="last.y"></span>
      }
      @if (activePoint(); as point) {
        <span class="dot dot--active" [style.left.%]="point.x" [style.top.%]="point.y"></span>
        <span
          class="tip"
          aria-live="polite"
          [style.left.%]="point.x"
          [attr.data-align]="align(point)"
        >
          <strong>{{ format()(point.value) }}</strong> {{ labels()[point.index] }}
        </span>
      }
    </div>
  `,
})
export class Sparkline {
  readonly values = input.required<readonly number[]>();
  readonly labels = input.required<readonly string[]>();
  readonly format = input.required<(value: number) => string>();
  /** What the line shows, e.g. "Omsättning per dag". */
  readonly name = input.required<string>();

  protected readonly active = signal<number | null>(null);

  protected readonly points = computed<readonly Point[]>(() => {
    const values = this.values();
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min;
    return values.map((value, index) => ({
      index,
      value,
      x: values.length === 1 ? 50 : (index / (values.length - 1)) * 100,
      y: span === 0 ? 50 : 10 + (1 - (value - min) / span) * 80,
    }));
  });

  protected readonly path = computed(() =>
    this.points()
      .map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' '),
  );

  protected readonly activePoint = computed(() => {
    const index = this.active();
    return index === null ? null : (this.points()[index] ?? null);
  });

  protected readonly summary = computed(() => {
    const values = this.values();
    const labels = this.labels();
    const format = this.format();
    if (values.length === 0) return `${this.name()}: inga data`;
    return `${this.name()}, ${labels[0]} till ${labels.at(-1)}. Senaste ${format(values.at(-1) ?? 0)}, högsta ${format(Math.max(...values))}, lägsta ${format(Math.min(...values))}. Använd piltangenterna för att läsa enskilda dagar.`;
  });

  protected track(event: PointerEvent): void {
    const count = this.values().length;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (count === 0 || box.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    this.active.set(Math.round(ratio * (count - 1)));
  }

  protected step(event: KeyboardEvent): void {
    const last = this.values().length - 1;
    const current = this.active() ?? last;
    const next =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) {
      if (event.key === 'Escape') this.active.set(null);
      return;
    }
    event.preventDefault();
    this.active.set(Math.min(last, Math.max(0, next)));
  }

  protected align(point: Point): 'start' | 'middle' | 'end' {
    if (point.x < 25) return 'start';
    if (point.x > 75) return 'end';
    return 'middle';
  }
}
