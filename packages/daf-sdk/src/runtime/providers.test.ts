import { describe, it, expect, afterEach } from 'vitest';
import {
  applyAnthropicPromptCaching,
  configureNativeToolCalling,
  isNativeToolCallingEnabled,
  getNativeReplacedActions,
  buildNativeProviderTools,
  formatNativeProviderResult,
  configureExcludedActions,
  getExcludedActions,
  getPreferNativeToolCallInstructions,
  PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS,
} from './providers';

describe('applyAnthropicPromptCaching', () => {
  it('leaves messages untouched for non-Anthropic models', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const result = applyAnthropicPromptCaching(messages, 'gpt-5.6-terra');
    expect(result).toBe(messages);
  });

  it('caches the only message when there is just one', () => {
    const messages = [{ role: 'user', content: 'the huge action catalog' }];
    const result = applyAnthropicPromptCaching(messages, 'claude-sonnet-5');
    expect(result[0].content).toEqual([
      {
        type: 'text',
        text: 'the huge action catalog',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ]);
  });

  it('caches the second-to-last message and leaves the newest untouched', () => {
    const messages = [
      { role: 'user', content: 'catalog + step 1' },
      { role: 'assistant', content: 'step 1 response' },
      { role: 'user', content: 'step 2 instructions' },
    ];
    const result = applyAnthropicPromptCaching(messages, 'claude-opus-5');

    expect(result[0].content).toBe('catalog + step 1');
    expect(result[1].content).toEqual([
      {
        type: 'text',
        text: 'step 1 response',
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ]);
    expect(result[2].content).toBe('step 2 instructions');
  });

  it('does not mutate the original messages array', () => {
    const messages = [
      { role: 'user', content: 'catalog' },
      { role: 'user', content: 'step 2' },
    ];
    applyAnthropicPromptCaching(messages, 'claude-haiku-4-5');
    expect(messages[0].content).toBe('catalog');
    expect(messages[1].content).toBe('step 2');
  });

  it('skips a target message with non-string content instead of throwing', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'already structured' }] }];
    const result = applyAnthropicPromptCaching(messages, 'claude-sonnet-5');
    expect(result).toBe(messages);
  });
});

describe('native tool calling (hybrid)', () => {
  afterEach(() => {
    // Module-level flag, always leave it off for the next test/file.
    configureNativeToolCalling(false);
  });

  it('is off by default', () => {
    expect(isNativeToolCallingEnabled()).toBe(false);
    expect(getNativeReplacedActions('claude-sonnet-5')).toEqual([]);
    expect(buildNativeProviderTools('claude-sonnet-5')).toEqual({});
  });

  it('replaces search/scrape/tavilySearch for Anthropic once enabled', () => {
    configureNativeToolCalling(true);
    expect(getNativeReplacedActions('claude-sonnet-5').sort()).toEqual(['scrape', 'search', 'tavilySearch']);
    expect(Object.keys(buildNativeProviderTools('claude-sonnet-5')).sort()).toEqual(['web_fetch', 'web_search']);
  });

  it('does nothing for a provider with no native replacements defined, even when enabled', () => {
    configureNativeToolCalling(true);
    expect(getNativeReplacedActions('gpt-5.6-terra')).toEqual([]);
    expect(buildNativeProviderTools('gpt-5.6-terra')).toEqual({});
  });

  it('formats a web_search result as a markdown link list', () => {
    const formatted = formatNativeProviderResult('web_search', [
      { url: 'https://example.com', title: 'Example' },
    ]);
    expect(formatted).toBe('- [Example](https://example.com)');
  });

  it('formats an empty web_search result set', () => {
    expect(formatNativeProviderResult('web_search', [])).toBe('No results found.');
  });

  it('formats a text web_fetch result as its raw text content', () => {
    const formatted = formatNativeProviderResult('web_fetch', {
      url: 'https://example.com',
      content: { source: { type: 'text', mediaType: 'text/plain', data: 'page content here' } },
    });
    expect(formatted).toBe('page content here');
  });

  it('formats a non-text web_fetch result as a note instead of raw bytes', () => {
    const formatted = formatNativeProviderResult('web_fetch', {
      url: 'https://example.com/file.pdf',
      content: { source: { type: 'base64', mediaType: 'application/pdf', data: 'aGVsbG8=' } },
    });
    expect(formatted).toContain('https://example.com/file.pdf');
    expect(formatted).toContain('application/pdf');
  });
});

describe('configureExcludedActions', () => {
  afterEach(() => {
    configureExcludedActions([]);
  });

  it('is empty by default', () => {
    expect(getExcludedActions()).toEqual([]);
  });

  it('returns whatever a host configures', () => {
    configureExcludedActions(['runShell']);
    expect(getExcludedActions()).toEqual(['runShell']);
  });
});

describe('getPreferNativeToolCallInstructions', () => {
  it('gives Claude an unconditional rule, not the soft fallback-inclusive wording', () => {
    const instructions = getPreferNativeToolCallInstructions('claude-sonnet-5');
    expect(instructions).toContain('Never write an action as JSON text');
    expect(instructions).not.toBe(PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS);
  });

  it('keeps the fallback-inclusive wording for non-Anthropic providers', () => {
    expect(getPreferNativeToolCallInstructions('gpt-5.1')).toBe(PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS);
    expect(getPreferNativeToolCallInstructions('gemini-3.1-pro-preview')).toBe(PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS);
  });
});
