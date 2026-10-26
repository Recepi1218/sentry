import { actualCallOre, worstCaseCallOre } from './pricing';

const fx = { sekPerUsd: 11 };

describe('worstCaseCallOre', () => {
  it('prices every prompt token as a cache write and every allowed output token', () => {
    // 20k prompt × $2/M × 1.25 + 4k output × $10/M = $0.09 → 0.99 kr
    expect(worstCaseCallOre('claude-sonnet-5-5', 20_000, 4_000, fx)).toBe(99);
  });

  it('rounds up to whole öre so the reservation never undershoots', () => {
    // $0.000125 + $0.0005 = $0.000625 → 0.6875 öre → 1 öre
    expect(worstCaseCallOre('claude-haiku-5-5', 1_000, 1_000, fx)).toBe(1);
  });

  it('switches Haiku 5.5 to its long-context price above 100k prompt tokens', () => {
    expect(worstCaseCallOre('claude-haiku-5-5', 100_000, 0, fx)).toBe(14);
    expect(worstCaseCallOre('claude-haiku-5-5', 100_001, 0, fx)).toBe(69);
  });
});

describe('actualCallOre', () => {
  it('never exceeds the worst case for the same call', () => {
    const worst = worstCaseCallOre('claude-opus-5-5', 30_000, 8_000, fx);
    const actual = actualCallOre(
      'claude-opus-5-5',
      { inputTokens: 2_000, cacheReadTokens: 26_000, cacheWriteTokens: 2_000, outputTokens: 8_000 },
      fx,
    );
    expect(actual).toBeLessThanOrEqual(worst);
  });
});
