import type { TokenUsage } from './types';

export interface ModelPrice {
  input: number;
  output: number;
  cachedInput?: number;
}

export interface PricingConfig {
  /** Per-model rates in USD per million tokens. */
  modelPricing?: Record<string, ModelPrice>;
  /** Monthly token allowance per plan tier. */
  tierTokenLimits?: Record<string, number>;
  /** Model whose rate is used when the requested model is not in the table. */
  fallbackModel?: string;
}

// Rates and plan limits are commercial policy, not protocol, so the SDK ships
// none: a host that bills for usage registers its own via configurePricing().
// Without one, every call costs 0 and no plan limit applies, which is correct
// for a self-hosted deployment that doesn't bill.
let activeConfig: PricingConfig = {};

/**
 * Register the host's pricing table and plan limits. Call once at startup,
 * before executing any process. Omitted fields keep their current value.
 */
export function configurePricing(config: PricingConfig): void {
  activeConfig = { ...activeConfig, ...config };
}

/** Per-model rates registered by the host, empty when none were. */
export function getModelPricing(): Record<string, ModelPrice> {
  return activeConfig.modelPricing ?? {};
}

/** Per-tier token allowances registered by the host, empty when none were. */
export function getTierTokenLimits(): Record<string, number> {
  return activeConfig.tierTokenLimits ?? {};
}

export function calculateTokenCost(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
  reasoningTokens = 0,
): number {
  const table = getModelPricing();
  const pricing = model ? table[model] : undefined;
  const p = pricing ?? (activeConfig.fallbackModel ? table[activeConfig.fallbackModel] : undefined);
  if (!p) return 0;

  const regularInput = Math.max(0, inputTokens - cachedInputTokens);
  const inputCost = (regularInput / 1_000_000) * p.input;
  const cachedCost = p.cachedInput ? (cachedInputTokens / 1_000_000) * p.cachedInput : 0;
  const outputCost = ((outputTokens + reasoningTokens) / 1_000_000) * (p.output ?? p.input);

  return inputCost + cachedCost + outputCost;
}

export function buildTokenUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
  reasoningTokens = 0,
): TokenUsage {
  return {
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens,
    costUsd: calculateTokenCost(model, inputTokens, outputTokens, cachedTokens, reasoningTokens),
  };
}
