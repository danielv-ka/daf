import { tool, type ToolSet } from 'ai';
import { ACTION_TYPES, actionParamSchemas, type ActionVariant } from '../protocol';
import { getGenericVariable } from './genericVariables';

// Pulls the one-paragraph "what this does" line out of an existing DESC_*
// prose string instead of hand-writing a second description per action.
// Keeps the native tool-calling description and the plain-JSON convention's
// prompt text from drifting apart as actions change.
function extractDescription(prose: string | undefined, fallback: string): string {
  if (!prose) return fallback;
  const match = prose.match(/\*\*Description:\*\*\s*\n([\s\S]*?)(?:\n\s*\n|\n\*\*|$)/);
  const text = match?.[1]?.trim();
  return text ? text.replace(/\s+/g, ' ') : fallback;
}

// Actions whose DESC_* entry doesn't follow the DESC_<ACTION_TYPES key>
// naming, so the default lookup would miss it and fall back to a generic
// "Run the ... action." line (the model then gets no real description).
const DESC_KEY_ALIASES: Record<string, string> = {
  PREVIEW_SEARCH: 'DESC_QUICK_SEARCH',
};

/**
 * Build native AI SDK tool definitions, one per DAF action that has a
 * parameter schema, for use as `generateText`'s `tools` option. Deliberately
 * has no `execute`. DAF's own turn-by-turn loop (wallet checks, pause/resume,
 * loop-stop conditions between every action) executes the resulting tool
 * calls itself via the existing `executeAction` dispatcher, the same as it
 * already does for actions parsed out of plain text. This just gives models
 * that support it a structured way to request an action instead of writing
 * JSON as text; models that don't use it fall back to the text convention
 * automatically (see executor.ts / chatExecution.ts's `toolCalls` check).
 *
 * `crawl` is excluded: it has no parameter schema in protocol/schemas.ts
 * today (deliberately deactivated).
 *
 * `excludeVariants` is how a host leaves out an action that a *native*
 * provider tool will replace instead (see providers.ts's
 * `getNativeReplacedActions`/`buildNativeProviderTools`), e.g. Anthropic's
 * own web search replacing our `search`, when native tool calling is on.
 */
export function buildActionTools(options?: { allowedVariants?: ActionVariant[]; excludeVariants?: ActionVariant[] }): ToolSet {
  const allowed = options?.allowedVariants ? new Set<string>(options.allowedVariants) : null;
  const excluded = options?.excludeVariants ? new Set<string>(options.excludeVariants) : null;
  const tools: ToolSet = {};

  for (const variant of Object.values(ACTION_TYPES) as string[]) {
    const schema = actionParamSchemas[variant];
    if (!schema) continue; // no schema, can't build a tool input shape for it
    if (allowed && !allowed.has(variant)) continue;
    if (excluded && excluded.has(variant)) continue;

    const typeKey = Object.entries(ACTION_TYPES).find(([, v]) => v === variant)?.[0];
    const descKey = (typeKey && DESC_KEY_ALIASES[typeKey]) || `DESC_${typeKey}`;
    tools[variant] = tool({
      description: extractDescription(getGenericVariable(descKey), `Run the "${variant}" action.`),
      inputSchema: schema,
    });
  }

  return tools;
}

// Matches the fixed template every DESC_* entry's JSON-format block ends with
// (see genericVariables.ts), the anchor this note gets inserted right after.
const JSON_FORMAT_BLOCK_END = '*(Quotation marks added to escape execution - this is documentation only)*';

/**
 * Inserts a short note right after an action's JSON-format example, for any
 * variant that also has a real tool available this turn. The action catalog
 * shows a worked JSON example for every action, and a model sees dozens of
 * these in a row, and a single instruction elsewhere telling it to prefer tools
 * doesn't reliably compete with that much repetition. This leaves every
 * example fully intact (still the correct fallback for a model that doesn't
 * use the tool, or a provider with no tool-calling support at all) and just
 * adds the counter-signal in the same spot the model is already looking at.
 *
 * Operates on the already-substituted message text (no `$DESC_X` placeholders
 * left), so it has to work on whichever message actually contains the
 * catalog, usually the first one, but this scans all of them and leaves any
 * message without a JSON-format block untouched. Handles both plain string
 * content and the content-parts array shape prompt caching produces.
 */
export function annotateActionCatalogWithToolNotes<T extends { content: unknown }>(messages: T[], toolVariants: string[]): T[] {
  if (toolVariants.length === 0) return messages;

  const annotate = (text: string): string => {
    if (!text.includes('**JSON Format:**')) return text;
    let result = text;
    for (const variant of toolVariants) {
      const variantMarker = `"variant": "${variant}"`;
      let searchFrom = 0;
      for (;;) {
        const variantIndex = result.indexOf(variantMarker, searchFrom);
        if (variantIndex === -1) break;
        const anchorIndex = result.indexOf(JSON_FORMAT_BLOCK_END, variantIndex);
        if (anchorIndex === -1) break;
        const insertAt = anchorIndex + JSON_FORMAT_BLOCK_END.length;
        const note = `\n\n**Note:** A native tool is also available for the "${variant}" action this turn. Call it directly using your native tool-calling mechanism instead of using this JSON format.`;
        result = result.slice(0, insertAt) + note + result.slice(insertAt);
        searchFrom = insertAt + note.length;
      }
    }
    return result;
  };

  return messages.map((msg: any) => {
    if (typeof msg.content === 'string') {
      const annotated = annotate(msg.content);
      return annotated === msg.content ? msg : { ...msg, content: annotated };
    }
    if (Array.isArray(msg.content)) {
      let changed = false;
      const content = msg.content.map((part: any) => {
        if (part?.type === 'text' && typeof part.text === 'string') {
          const annotated = annotate(part.text);
          if (annotated !== part.text) { changed = true; return { ...part, text: annotated }; }
        }
        return part;
      });
      return changed ? { ...msg, content } : msg;
    }
    return msg;
  });
}
