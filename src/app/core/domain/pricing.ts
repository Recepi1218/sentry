import { ceilOre, type Ore } from './money';

/** USD per million tokens. */
export interface TokenPrice {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
}

export interface ModelPricing extends TokenPrice {
  readonly label: string;
  /** Prompts above this size are billed at the long-context price. */
  readonly longContext?: TokenPrice & { readonly aboveInputTokens: number };
}

/**
 * Anthropic first-party list prices (checked 2026-10-06). Prices change – the production copy of
 * this table lives in Airtable (ModelPricing) so it can be updated without a deploy.
 */
export const MODEL_PRICING = {
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    longContext: { aboveInputTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5 },
  },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
  'claude-opus-5-5': { label: 'Opus 5.5', inputUsdPerMTok: 4, outputUsdPerMTok: 20 },
} as const satisfies Record<string, ModelPricing>;

export type ModelId = keyof typeof MODEL_PRICING;

/** Prompt-cache writes bill input tokens at 1.25× (5-minute TTL). */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export interface FxPolicy {
  /** SEK per USD. Must be at or above the market rate – a low rate would under-reserve. */
  readonly sekPerUsd: number;
}

export interface CallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens?: number;
  readonly cacheReadTokens?: number;
}

export function isModelId(value: string): value is ModelId {
  return Object.hasOwn(MODEL_PRICING, value);
}

export function modelLabel(model: string): string {
  return isModelId(model) ? MODEL_PRICING[model].label : model;
}

function priceFor(model: ModelId, promptTokens: number): TokenPrice {
  const pricing: ModelPricing = MODEL_PRICING[model];
  const longContext = pricing.longContext;
  return longContext && promptTokens > longContext.aboveInputTokens ? longContext : pricing;
}

const usdToOre = (usd: number, fx: FxPolicy) => usd * fx.sekPerUsd * 100;

/**
 * Upper bound for one Messages API call. The API enforces max_tokens on every output token
 * (thinking included), so this is a true ceiling when `promptTokens` comes from the token
 * counting endpoint. Every prompt token is priced as a cache write, the most expensive way in.
 */
export function worstCaseCallOre(
  model: ModelId,
  promptTokens: number,
  maxOutputTokens: number,
  fx: FxPolicy,
): Ore {
  const price = priceFor(model, promptTokens);
  const usd =
    (promptTokens * price.inputUsdPerMTok * CACHE_WRITE_MULTIPLIER +
      maxOutputTokens * price.outputUsdPerMTok) /
    1_000_000;
  return ceilOre(usdToOre(usd, fx));
}

/** Cost of a finished call from the usage block of the API response. */
export function actualCallOre(model: ModelId, usage: CallUsage, fx: FxPolicy): Ore {
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const price = priceFor(model, usage.inputTokens + cacheWrite + cacheRead);
  const usd =
    (usage.inputTokens * price.inputUsdPerMTok +
      cacheWrite * price.inputUsdPerMTok * CACHE_WRITE_MULTIPLIER +
      cacheRead * price.inputUsdPerMTok * 0.1 +
      usage.outputTokens * price.outputUsdPerMTok) /
    1_000_000;
  return ceilOre(usdToOre(usd, fx));
}
