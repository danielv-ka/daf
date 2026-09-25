import { describe, it, expect, vi } from 'vitest';
import { executeAction } from './actionProcessor';
import { canUserAffordApiCall, checkAndUpdateCostLimit } from './executor';
import type { DAFStorageAdapter } from './types';

// The SDK ships no implementation for email or web retrieval, and no spend
// policy: those are host concerns reached through adapter hooks.

const HOOKED_ACTIONS: Array<[string, string, Record<string, unknown>]> = [
  ['sendEmail', 'sendEmail', { to: 'a@b.com', subject: 's', content: 'c' }],
  ['scrape', 'webScrape', { url: 'https://example.com' }],
  ['search', 'webSearch', { query: 'q' }],
  ['previewSearch', 'webPreviewSearch', { query: 'q' }],
  ['tavilySearch', 'webTavilySearch', { query: 'q' }],
  ['checkDomain', 'webCheckDomain', { domains: ['example.com'] }],
  ['newsSearch', 'webNewsSearch', { query: 'q' }],
];

describe('email and web retrieval actions', () => {
  it.each(HOOKED_ACTIONS)('%s reports it is unavailable when the adapter has no %s hook', async (variant, hook, parameters) => {
    const result = await executeAction({ type: 'action', variant, parameters } as any, 'user-1', {} as DAFStorageAdapter, 'proc-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain(`"${variant}" action is not available`);
    expect(result.error).toContain(`${hook} hook`);
  });

  it.each(HOOKED_ACTIONS)('%s runs the %s hook with the action parameters', async (variant, hook, parameters) => {
    const impl = vi.fn(async (_params: unknown) => ({ success: true, message: 'from host' }));
    const adapter = { [hook]: impl } as unknown as DAFStorageAdapter;
    const result = await executeAction({ type: 'action', variant, parameters } as any, 'user-1', adapter, 'proc-1');
    expect(result).toEqual({ success: true, message: 'from host' });
    expect(impl).toHaveBeenCalledOnce();
    expect(impl.mock.calls[0][0]).toEqual(parameters);
  });
});

describe('spend policy', () => {
  const user = { id: 'user-1' };

  it('allows every call when the adapter has no checkAffordability hook', async () => {
    const adapter = { getUser: async () => user } as unknown as DAFStorageAdapter;
    expect(await canUserAffordApiCall('user-1', adapter)).toEqual({ allowed: true, user });
  });

  it('passes the model and own-key flag to the hook and returns its decision', async () => {
    const checkAffordability = vi.fn(async () => ({ allowed: false, user, message: 'no', failureReason: 'X' }));
    const adapter = { getUser: async () => user, checkAffordability } as unknown as DAFStorageAdapter;
    const result = await canUserAffordApiCall('user-1', adapter, 'some-model', true);
    expect(checkAffordability).toHaveBeenCalledWith('user-1', { model: 'some-model', usingOwnApiKey: true });
    expect(result).toEqual({ allowed: false, user, message: 'no', failureReason: 'X' });
  });

  it('records usage and allows the next call when there is no hook', async () => {
    const updateUserUsage = vi.fn(async () => ({ newBalance: -5, newTokenCount: 1e12 }));
    const adapter = { getUser: async () => user, updateUserUsage } as unknown as DAFStorageAdapter;
    const result = await checkAndUpdateCostLimit('user-1', 0.5, 1000, adapter);
    expect(updateUserUsage).toHaveBeenCalledOnce();
    expect(result.allowed).toBe(true);
  });
});
