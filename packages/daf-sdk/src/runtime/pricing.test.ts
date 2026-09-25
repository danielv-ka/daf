import { describe, it, expect } from 'vitest';
import { calculateTokenCost, configurePricing, getModelPricing, getTierTokenLimits } from './pricing';

// Pricing is module state, so these run in order: unconfigured first.
describe('pricing', () => {
  it('ships no rates or plan limits, so an unconfigured host is charged nothing', () => {
    expect(getModelPricing()).toEqual({});
    expect(getTierTokenLimits()).toEqual({});
    expect(calculateTokenCost('any-model', 1_000_000, 1_000_000)).toBe(0);
  });

  it('uses the rates a host registers', () => {
    configurePricing({ modelPricing: { m: { input: 2, output: 10, cachedInput: 0.5 } } });
    // 0.5M regular input at $2 + 0.5M cached at $0.5 + 1M output at $10
    expect(calculateTokenCost('m', 1_000_000, 1_000_000, 500_000)).toBeCloseTo(1 + 0.25 + 10);
  });

  it('prices an unknown model at zero unless the host names a fallback model', () => {
    expect(calculateTokenCost('unknown', 1_000_000, 0)).toBe(0);
    configurePricing({ fallbackModel: 'm' });
    expect(calculateTokenCost('unknown', 1_000_000, 0)).toBe(2);
  });
});
