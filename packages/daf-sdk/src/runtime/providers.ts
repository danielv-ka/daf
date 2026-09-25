import { openai, createOpenAI } from '@ai-sdk/openai';
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { mistral, createMistral } from '@ai-sdk/mistral';
import { google, createGoogleGenerativeAI } from '@ai-sdk/google';
import { xai, createXai } from '@ai-sdk/xai';
import { deepseek, createDeepSeek } from '@ai-sdk/deepseek';
import { moonshotai, createMoonshotAI } from '@ai-sdk/moonshotai';
import type { LanguageModel, ToolSet } from 'ai';
import type { UserProviderSettings } from './types';
import type { ActionVariant } from '../protocol';

export function getProviderFromModel(modelName: string): string {
  if (modelName.startsWith('gpt-')) return 'openai';
  if (modelName.startsWith('claude-')) return 'anthropic';
  if (modelName.startsWith('mistral-')) return 'mistral';
  if (modelName.startsWith('gemini-')) return 'google';
  if (modelName.startsWith('grok-')) return 'xai';
  if (modelName.startsWith('deepseek-')) return 'deepseek';
  if (modelName.startsWith('kimi-') || modelName.startsWith('moonshot-')) return 'moonshot';
  return 'openai';
}

// Anthropic bills the full input price for every token on every call, even when the
// same content was already sent moments earlier, unless a message is explicitly marked
// as a cache breakpoint. DAF conversations resend the entire message history on each
// step (stateless chat API), and the first message of a run typically carries a large,
// unchanging action catalog, so without this the same tokens are billed at full price
// over and over across a multi-step run. Anthropic caches everything up to and including
// the marked message, so marking the second-to-last message (everything except the turn
// just added) lets each later step reuse that growing prefix as a cheap cache read
// instead of full-price input. Only Anthropic reads this; other providers ignore it.
export function applyAnthropicPromptCaching(messages: any[], modelName: string): any[] {
  if (getProviderFromModel(modelName) !== 'anthropic') return messages;
  if (!messages || messages.length === 0) return messages;

  const breakpointIndex = messages.length === 1 ? 0 : messages.length - 2;
  const target = messages[breakpointIndex];

  if (!target || typeof target.content !== 'string') return messages;

  const cachedMessage = {
    ...target,
    content: [
      {
        type: 'text',
        text: target.content,
        providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      },
    ],
  };

  const result = [...messages];
  result[breakpointIndex] = cachedMessage;
  return result;
}

export function getModelProvider(modelName: string, userSettings?: UserProviderSettings | null): LanguageModel {
  const providerType = getProviderFromModel(modelName);

  let useUserKey = false;
  let userApiKey: string | null | undefined = null;

  if (userSettings) {
    switch (providerType) {
      case 'openai':
        useUserKey = userSettings.useOpenaiKey && !!userSettings.openaiApiKey;
        userApiKey = userSettings.openaiApiKey;
        break;
      case 'anthropic':
        useUserKey = userSettings.useAnthropicKey && !!userSettings.anthropicApiKey;
        userApiKey = userSettings.anthropicApiKey;
        break;
      case 'mistral':
        useUserKey = userSettings.useMistralKey && !!userSettings.mistralApiKey;
        userApiKey = userSettings.mistralApiKey;
        break;
      case 'google':
        useUserKey = userSettings.useGoogleKey && !!userSettings.googleApiKey;
        userApiKey = userSettings.googleApiKey;
        break;
      case 'xai':
        useUserKey = userSettings.useXaiKey && !!userSettings.xaiApiKey;
        userApiKey = userSettings.xaiApiKey;
        break;
      case 'deepseek':
        useUserKey = userSettings.useDeepseekKey && !!userSettings.deepseekApiKey;
        userApiKey = userSettings.deepseekApiKey;
        break;
      case 'moonshot':
        useUserKey = !!userSettings.useMoonshotKey && !!userSettings.moonshotApiKey;
        userApiKey = userSettings.moonshotApiKey;
        break;
    }
  }

  if (useUserKey && userApiKey) {
    switch (providerType) {
      case 'openai': {
        const modelId = modelName === 'gpt-5.1 (non reasoning)' ? 'gpt-5.1' : modelName;
        return createOpenAI({ apiKey: userApiKey })(modelId);
      }
      case 'anthropic':
        return createAnthropic({ apiKey: userApiKey })(modelName);
      case 'mistral': {
        const modelId = modelName === 'mistral-medium' ? 'mistral-medium-latest' : modelName;
        return createMistral({ apiKey: userApiKey })(modelId);
      }
      case 'google': {
        const modelId = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
        return createGoogleGenerativeAI({ apiKey: userApiKey })(modelId);
      }
      case 'xai':
        return createXai({ apiKey: userApiKey })(modelName);
      case 'deepseek':
        return createDeepSeek({ apiKey: userApiKey })(modelName);
      case 'moonshot':
        return createMoonshotAI({ apiKey: userApiKey })(modelName);
    }
  }

  // Fall back to environment-variable API keys
  switch (modelName) {
    case 'gpt-4.1-mini': return openai('gpt-4.1-mini');
    case 'gpt-5.1 (non reasoning)': return openai('gpt-5.1');
    case 'gpt-5.1': return openai('gpt-5.1');
    case 'gpt-5.6-luna': return openai('gpt-5.6-luna');
    case 'gpt-5.6-terra': return openai('gpt-5.6-terra');
    case 'gpt-5.6-sol': return openai('gpt-5.6-sol');
    case 'claude-haiku-4-5': return anthropic('claude-haiku-4-5');
    case 'claude-sonnet-5': return anthropic('claude-sonnet-5');
    case 'claude-opus-5': return anthropic('claude-opus-5');
    case 'claude-fable-5': return anthropic('claude-fable-5');
    case 'mistral-medium': return mistral('mistral-medium-latest');
    case 'gemini-2.5-flash': return google('models/gemini-2.5-flash');
    case 'gemini-3.6-flash': return google('models/gemini-3.6-flash');
    case 'gemini-3.1-pro-preview': return google('models/gemini-3.1-pro-preview');
    case 'grok-4-1-fast-non-reasoning': return xai('grok-4-1-fast-non-reasoning');
    case 'grok-4.3': return xai('grok-4.3');
    case 'grok-4.5': return xai('grok-4.5');
    case 'deepseek-chat': return deepseek('deepseek-chat');
    case 'deepseek-v4-flash': return deepseek('deepseek-v4-flash');
    case 'deepseek-v4-pro': return deepseek('deepseek-v4-pro');
    case 'kimi-k2.6': return moonshotai('kimi-k2.6');
    case 'kimi-k3': return moonshotai('kimi-k3');
    default: return openai('gpt-5.1');
  }
}

// ============================================================================
// Native provider tools (hybrid tool-calling)
//
// Host-configurable opt-in, off by default: a fresh host that never calls
// configureNativeToolCalling(true) sees no behavior change at all. When on,
// for a model whose provider has its own equivalent of one of our actions,
// that provider's tool replaces ours for this call (e.g. Anthropic's own
// web search instead of our Firecrawl/Tavily-backed `search`); everything
// else keeps being taught to the model as our own tool, same as always.
// Provider tools execute server-side (see `providerExecuted` on the returned
// tool call), so the caller must not run these through executeAction().
// ============================================================================

let nativeToolCallingEnabled = false;

/** Call once at host startup to opt into native provider tools. Off by default. */
export function configureNativeToolCalling(enabled: boolean): void {
  nativeToolCallingEnabled = enabled;
}

export function isNativeToolCallingEnabled(): boolean {
  return nativeToolCallingEnabled;
}

// Which of our own actions get replaced by a native tool, per provider, when
// native tool calling is on. Only actions with a genuine 1:1 behavioral match
// belong here (see actionTools.ts for the ones deliberately excluded, like
// runCode/runShell, which stay ours even where a native equivalent exists).
const NATIVE_REPLACED_ACTIONS: Partial<Record<string, ActionVariant[]>> = {
  anthropic: ['search', 'scrape', 'tavilySearch'],
};

/** Our own actions to leave out of buildActionTools() for this model, because a native tool below replaces them. Empty when native tool calling is off or this provider has no replacements defined. */
export function getNativeReplacedActions(modelName: string): ActionVariant[] {
  if (!nativeToolCallingEnabled) return [];
  return NATIVE_REPLACED_ACTIONS[getProviderFromModel(modelName)] ?? [];
}

// Actions a host wants left out of the model's tool set entirely (distinct
// from NATIVE_REPLACED_ACTIONS above, which excludes an action because a
// native tool covers it: these are just not offered to the model at all).
// Off by default: an empty list changes nothing.
let excludedActions: ActionVariant[] = [];

/** Call once at host startup to stop offering specific actions to the model as tools, independent of any native tool calling. */
export function configureExcludedActions(variants: ActionVariant[]): void {
  excludedActions = variants;
}

export function getExcludedActions(): ActionVariant[] {
  return excludedActions;
}

// buildActionTools() always offers our own actions as real tools, and the
// prompt always also teaches the plain-JSON-in-text convention (for models/
// providers with no tool-calling support at all), so a model that supports
// tools still sees both options side by side, with nothing steering it
// toward the structured one. Passed as `instructions` alongside `tools` in
// every generateText call, this tips that choice: prefer the real tool when
// one exists, fall back to text only when it doesn't (i.e. genuinely custom
// actions with no matching tool, or a provider with no tool support).
// Kept as the fallback-inclusive wording for non-Anthropic providers: Gemini's
// own malformed-function-call history (see isGeminiModel workaround in
// executor.ts) means full tool reliability isn't proven there the way it now
// is for Claude, so those models keep an explicit JSON escape hatch.
export const PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS =
  'When you need to take an action that has a matching tool available to you, call that tool directly using your native tool-calling mechanism instead of writing it out as JSON text in your response. Only use the JSON action format for actions that have no matching tool available to you.';

/**
 * Model-specific tool-call steering. Claude gets an unconditional rule instead
 * of the softer "prefer it" wording above: every action with a schema also
 * gets a real tool (buildActionTools() covers all of them), so there's no
 * legitimate case left where Claude would need the JSON fallback. In
 * practice, a soft preference plus an explicit "otherwise fall back to JSON"
 * carve-out turned out to be exactly the out Claude kept taking, even with
 * that instruction, a native tool call available, and a note right next to
 * the specific action's JSON example, all at once (confirmed via live
 * testing, see the native/programmatic tool calling work this shipped
 * alongside). Removing the carve-out entirely is the untried lever.
 */
export function getPreferNativeToolCallInstructions(modelName: string): string {
  if (getProviderFromModel(modelName) === 'anthropic') {
    return 'Never write an action as JSON text, under any circumstance. Every action available to you also has a matching tool, so call it directly using your native tool-calling mechanism, always, with no exceptions.';
  }
  return PREFER_NATIVE_TOOL_CALL_INSTRUCTIONS;
}

/** The actual native provider tools to merge into `tools` for this model. Empty when native tool calling is off or this provider has none defined. */
export function buildNativeProviderTools(modelName: string): ToolSet {
  if (!nativeToolCallingEnabled) return {};
  if (getProviderFromModel(modelName) !== 'anthropic') return {};
  // Anthropic's factories return a concrete provider-executed tool type that
  // doesn't structurally satisfy the generic ToolSet shape TypeScript infers
  // for a plain object literal here. It's a real Tool at runtime (the same
  // shape generateText's own `tools` option expects), just typed more
  // narrowly than a heterogeneous record can express cleanly.
  return {
    web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
    web_fetch: anthropic.tools.webFetch_20250910({ maxUses: 5 }),
  } as ToolSet;
}

/**
 * Turn a native provider tool's already-computed output into the same kind of
 * plain-text result our own actions produce (see formatActionResult in
 * executor.ts), since these never go through executeAction. The provider
 * already ran them. Only `web_search`/`web_fetch` exist today; anything else
 * gets a generic JSON fallback rather than silently dropping the result.
 */
export function formatNativeProviderResult(toolName: string, output: unknown): string {
  if (toolName === 'web_search' && Array.isArray(output)) {
    if (output.length === 0) return 'No results found.';
    return output
      .map((r: any) => `- [${r.title || r.url}](${r.url})`)
      .join('\n');
  }
  if (toolName === 'web_fetch' && output && typeof output === 'object') {
    const content = (output as any).content;
    const source = content?.source;
    if (source?.type === 'text') {
      return source.data as string;
    }
    return `Fetched ${(output as any).url} (${source?.mediaType || 'binary content'}, not displayable as text).`;
  }
  return JSON.stringify(output, null, 2);
}
