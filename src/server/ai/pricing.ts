/**
 * Per-token prices in USD, from OpenRouter's public model list (GET /api/v1/models, checked 2026-11-14).
 * Used only to reserve budget before a call; the charged amount comes from `usage.cost`
 * in the OpenRouter response. Reasoning tokens are billed at the completion price.
 */
export interface ModelPrice {
  prompt: number;
  completion: number;
  /** Price per image token; an image is estimated at IMAGE_TOKENS tokens. */
  image: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'google/gemini-3.8-flash': { prompt: 0.000000825, completion: 0.000004125, image: 0.000000825 },
  'google/gemini-3.7-flash': { prompt: 0.00000075, completion: 0.00000375, image: 0.00000075 },
  'google/gemini-3.5-flash-lite': { prompt: 0.0000003, completion: 0.0000025, image: 0.0000003 },
};

/** Unknown models are priced as a pro-tier model so the reservation errs on the safe side. */
const FALLBACK_PRICE: ModelPrice = { prompt: 0.000004, completion: 0.000018, image: 0.000004 };

export const IMAGE_TOKENS = 1_800;

export function getPrice(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/**
 * Upper estimate for a call. Prompt tokens are counted as one token per 2 characters
 * (Cyrillic and Kazakh text tokenizes far denser than English), completion as the full
 * `maxTokens` cap, which on OpenRouter also bounds reasoning tokens.
 */
export function estimateMaxCostUsd(input: { model: string; promptChars: number; images: number; maxTokens: number }): number {
  const p = getPrice(input.model);
  const promptTokens = Math.ceil(input.promptChars / 2) + 50;
  return promptTokens * p.prompt + input.images * IMAGE_TOKENS * p.image + input.maxTokens * p.completion;
}

/** Fallback when the provider omits `usage.cost`. */
export function costFromTokens(model: string, promptTokens: number, completionTokens: number): number {
  const p = getPrice(model);
  return promptTokens * p.prompt + completionTokens * p.completion;
}
