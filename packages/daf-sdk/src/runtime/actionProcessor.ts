import { generateText } from 'ai';
import type { DAFStorageAdapter, ActionConfig, ExecutionContext } from './types';
import {
  isSandboxActionCallingEnabled,
  mintSandboxToken,
  invalidateSandboxToken,
  resolveSandboxCall,
  buildSandboxProgram,
} from './sandboxTools';
import {
  getGoogleAccessToken,
  getGoogleOAuth2Client,
  readGoogleDoc,
  writeGoogleDoc,
  appendGoogleDoc,
  selectiveUpdateGoogleDoc,
  formatGoogleDoc,
  deleteGoogleDoc,
  renameGoogleDoc,
  duplicateGoogleDoc,
  extractDocIdFromUrl,
  createGoogleDriveFolder,
  extractFolderIdFromUrl,
  deleteGoogleDriveFolder,
  renameGoogleDriveFolder,
  createGoogleDocInFolder,
  listGoogleDriveFolderContents,
} from './integrations/googleDocs';
import {
  getNotionAccessToken,
  readNotionPage,
  writeNotionPage,
  appendNotionPage,
  selectiveUpdateNotionPage,
  deleteNotionPage,
  renameNotionPage,
  duplicateNotionPage,
  extractPageIdFromUrl,
  createNotionSubpage,
  listNotionPageChildren,
  getNotionPageTitle,
} from './integrations/notion';

// Action contract types are defined once in the protocol layer (the canonical DAF
// types). This runtime imports them rather than redefining, so the engine and
// the protocol types can never drift. ActionResult below is runtime-specific.
import type {
  DAFAction,
  DAFEditorAction,
  ReadDocumentAction,
  WriteDocumentAction,
  FormatDocumentAction,
  RemoveDocumentAction,
  RenameDocumentAction,
  DuplicateDocumentAction,
  AddFolderAction,
  RemoveFolderAction,
  ReadFolderAction,
  RenameFolderAction,
  AddDocumentAction,
  CreateDatabaseAction,
  ReadDatabaseAction,
  UpdateDatabaseAction,
  DeleteDatabaseAction,
  WriteDatabaseAction,
  DuplicateDatabaseAction,
  ScrapeAction,
  SearchAction,
  NewsSearchAction,
  QuickSearchAction,
  TavilySearchAction,
  CheckDomainAction,
  CrawlAction,
  DbFindAction,
  DbInsertAction,
  DbUpdateAction,
  DbDeleteAction,
  AskUserInputAction,
  RunCodeAction,
  RunShellAction,
  ReadMdFileAction,
  WriteMdFileAction,
  CreateMdFileAction,
  DeleteMdFileAction,
  RenameMdFileAction,
  DuplicateMdFileAction,
  ReadDataAction,
  WriteDataAction,
  CreateDataAction,
  DeleteDataAction,
  RenameDataAction,
  DuplicateDataAction,
} from '../protocol';

// The runtime treats action + editor actions through one parsing/execution path,
// so `Action` is the combined union (DAFAction is type:'action', DAFEditorAction
// is type:'editorAction').
export type EditorTransformAction = DAFEditorAction;
export type Action = DAFAction | DAFEditorAction;

export interface ActionResult {
  success: boolean;
  error?: string;
  message?: string;
  data?: any;
  pauseForInput?: boolean; // when true, execution pauses and waits for user input in chat
}

// Attempt to repair common JSON escaping issues
function attemptJsonRepair(jsonStr: string): string {
  // Fix invalid escape sequences that LLMs commonly generate
  // We need to be careful not to break valid escape sequences

  let repaired = jsonStr;

  // First, temporarily protect valid escape sequences
  const validEscapes = ['\\n', '\\r', '\\t', '\\b', '\\f', '\\"', '\\\\', '\\/'];
  const placeholders: { [key: string]: string } = {};

  validEscapes.forEach((escape, index) => {
    const placeholder = `___ESCAPE_${index}___`;
    placeholders[placeholder] = escape;
    repaired = repaired.split(escape).join(placeholder);
  });

  // Now fix invalid escapes:
  // Any remaining backslash followed by a character that's not a unicode escape is invalid
  // Replace \X (where X is not a valid escape) with just X
  repaired = repaired.replace(/\\(?![u___])/g, '');

  // Restore valid escapes
  Object.entries(placeholders).forEach(([placeholder, escape]) => {
    repaired = repaired.split(placeholder).join(escape);
  });

  return repaired;
}

// ── Editor transform action (LLM-powered, requires ExecutionContext) ──────────

const EDITOR_TRANSFORM_PROMPTS: Record<string, (p: EditorTransformAction['parameters']) => string> = {
  fixSpellingGrammar: (p) => `Fix the spelling and grammar in the following text. Return ONLY the corrected text with no explanations:\n\n${p.selectedText}`,
  rewrite: (p) => `Rewrite the following text to improve clarity and flow. Return ONLY the rewritten text with no explanations:\n\n${p.selectedText}`,
  extendText: (p) => `Extend and expand the following text with more detail and depth. Return ONLY the extended text:\n\n${p.selectedText}`,
  addText: (p) => `Generate new content to insert after the following text, continuing naturally from where it ends. Return ONLY the new content to insert (do not repeat the original):\n\n${p.selectedText}`,
  reduceText: (p) => `Condense the following text while preserving all key points. Return ONLY the condensed text:\n\n${p.selectedText}`,
  removeText: (_p) => `Return an empty string. The selected text should be removed.`,
  simplify: (p) => `Simplify the following text to make it easier to understand. Return ONLY the simplified text:\n\n${p.selectedText}`,
  completeSentence: (p) => `Complete the following text naturally and coherently. Return ONLY the completed text (including the original):\n\n${p.selectedText}`,
  translate: (p) => `Translate the following text to ${p.language || 'Spanish'}. Return ONLY the translated text with no explanations:\n\n${p.selectedText}`,
  formatText: (p) => `Format the following text with proper structure, capitalization, and punctuation. Return ONLY the formatted text:\n\n${p.selectedText}`,
  directive: (p) => `${p.directive || 'Improve'} the following text. Return ONLY the result with no explanations:\n\n${p.selectedText}`,
};

async function executeEditorTransformAction(action: EditorTransformAction, context: ExecutionContext): Promise<ActionResult> {
  // Direct-apply variants: the frontend already applied the change, just acknowledge without calling the LLM.
  const p = action.parameters as any;
  const isDirectApply =
    action.variant === 'removeText' ||
    (action.variant === 'addText' && p.text != null) ||
    (action.variant === 'formatText' && (p.clearAll || p.format || p.bold !== undefined ||
      p.italic !== undefined || p.underline !== undefined || p.strike !== undefined ||
      p.highlight !== undefined || p.fontSize || p.color));

  if (isDirectApply) {
    let message = 'Action applied to editor';
    if (action.variant === 'removeText') {
      message = 'Removed selected text from document';
    } else if (action.variant === 'addText') {
      const preview = String(p.text).length > 60 ? String(p.text).substring(0, 60) + '\u2026' : String(p.text);
      message = `Added text: \"${preview}\"`;
    } else if (action.variant === 'formatText') {
      if (p.clearAll) message = 'Cleared all formatting from selected text';
      else if (p.fontSize) message = `Set font size to ${p.fontSizePt ?? p.fontSize} on selected text`;
      else if (p.color) message = `Set text color to ${p.color} on selected text`;
      else message = `Toggled ${p.format ?? 'formatting'} on selected text`;
    }
    return { success: true, message, data: { isEditorActionResult: true, directApplied: true, variant: action.variant, parameters: p } };
  }

  try {
    const promptFn = EDITOR_TRANSFORM_PROMPTS[action.variant] ?? EDITOR_TRANSFORM_PROMPTS.rewrite;
    const prompt = promptFn(action.parameters);
    const llmResult = await generateText({
      model: context.modelProvider,
      messages: [{ role: 'user', content: prompt }],
      abortSignal: AbortSignal.timeout(120_000),
    });
    const usage = llmResult.usage;
    const inputTokens = usage?.inputTokens || 0;
    const outputTokens = usage?.outputTokens || 0;
    const totalTokens = usage?.totalTokens || (inputTokens + outputTokens);
    const cachedTokens = (usage as any)?.inputTokenDetails?.cacheReadTokens || 0;
    const reasoningTokens = (usage as any)?.outputTokenDetails?.reasoningTokens || 0;
    await context.onTokenUsage?.(inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens);
    return {
      success: true,
      message: `Text transformed (${action.variant})`,
      data: { isEditorActionResult: true, transformedText: llmResult.text, variant: action.variant },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Editor transform failed',
    };
  }
}

// Parse and extract JSON actions from a message
export function extractActionsFromMessage(message: string): Action[] {
  const actions: Action[] = [];

  console.log('[extractActionsFromMessage] Received message length:', message.length);
  console.log('[extractActionsFromMessage] First 200 chars:', message.substring(0, 200));


  // Also try to find JSON objects by matching balanced braces
  let braceLevel = 0;
  let currentJson = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    const prevChar = i > 0 ? message[i - 1] : '';

    // Handle string escaping
    if (escapeNext) {
      currentJson += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      currentJson += char;
      continue;
    }

    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
      currentJson += char;
      continue;
    }

    // Track brace levels (only when not in string)
    if (!inString) {
      if (char === '{') {
        if (braceLevel === 0) {
          currentJson = '{';
        } else {
          currentJson += char;
        }
        braceLevel++;
      } else if (char === '}') {
        currentJson += char;
        braceLevel--;

        if (braceLevel === 0 && currentJson.length > 2) {
          // Try to parse this as JSON
          try {
            const parsed = JSON.parse(currentJson);

            // Validate that it's a valid action
            if (isValidAction(parsed)) {
              console.log('[extractActionsFromMessage] Found valid action:', parsed.variant);
              actions.push(parsed);
            } else {
              console.log('[extractActionsFromMessage] Parsed JSON but failed validation:', {
                type: parsed.type,
                variant: parsed.variant,
                hasParameters: !!parsed.parameters
              });
            }
          } catch (error) {
            // Try to repair the JSON and parse again
            console.log('[extractActionsFromMessage] Initial JSON parse failed, attempting repair...');
            try {
              const repairedJson = attemptJsonRepair(currentJson);
              const parsed = JSON.parse(repairedJson);

              if (isValidAction(parsed)) {
                console.log('[extractActionsFromMessage] ✓ Successfully repaired and parsed action:', parsed.variant);
                actions.push(parsed);
              } else {
                console.log('[extractActionsFromMessage] Repaired JSON but failed validation:', {
                  type: parsed.type,
                  variant: parsed.variant,
                  hasParameters: !!parsed.parameters
                });
              }
            } catch (repairError) {
              // Log both original and repair failures
              console.log('[extractActionsFromMessage] JSON parse and repair both failed:', {
                originalError: error instanceof Error ? error.message : 'Unknown error',
                repairError: repairError instanceof Error ? repairError.message : 'Unknown error',
                jsonLength: currentJson.length,
                jsonStart: currentJson.substring(0, 100),
                jsonEnd: currentJson.substring(Math.max(0, currentJson.length - 100))
              });
            }
          }
          currentJson = '';
        }
      } else if (braceLevel > 0) {
        currentJson += char;
      }
    } else {
      currentJson += char;
    }
  }

  console.log('[extractActionsFromMessage] Found', actions.length, 'actions');
  return actions;
}

// Validate if a parsed object is a valid action
function isValidAction(obj: any): obj is Action {
  if (!obj || typeof obj !== 'object' || !obj.variant || !obj.parameters) {
    return false;
  }

  // Handle editorAction type, selectedText is required for LLM-powered variants;
  // direct-apply variants (addText, removeText, formatText) don't need it.
  if (obj.type === 'editorAction') {
    const directVariants = ['addText', 'removeText', 'formatText'];
    if (directVariants.includes(obj.variant)) return true;
    return typeof obj.parameters.selectedText === 'string';
  }

  if (obj.type !== 'action') return false;

  switch (obj.variant) {
    case 'sendEmail':
      return (
        typeof obj.parameters.to === 'string' &&
        typeof obj.parameters.subject === 'string' &&
        typeof obj.parameters.content === 'string'
      );
    case 'scrape':
      return isValidScrapeAction(obj);
    case 'search':
      return isValidSearchAction(obj);
    case 'previewSearch':
      return isValidQuickSearchAction(obj);
    case 'tavilySearch':
      return isValidTavilySearchAction(obj);
    case 'checkDomain':
      return isValidCheckDomainAction(obj);
    case 'newsSearch':
      return isValidNewsSearchAction(obj);
    case 'readDocument':
      return isValidReadDocumentAction(obj);
    case 'writeDocument':
      return isValidWriteDocumentAction(obj);
    case 'formatDocument':
      return isValidFormatDocumentAction(obj);
    case 'removeDocument':
      return isValidRemoveDocumentAction(obj);
    case 'renameDocument':
      return isValidRenameDocumentAction(obj);
    case 'duplicateDocument':
      return isValidDuplicateDocumentAction(obj);
    case 'addFolder':
      return isValidAddFolderAction(obj);
    case 'removeFolder':
      return isValidRemoveFolderAction(obj);
    case 'readFolder':
      return isValidReadFolderAction(obj);
    case 'renameFolder':
      return isValidRenameFolderAction(obj);
    case 'addDocument':
      return isValidAddDocumentAction(obj);
    case 'createDatabase':
      return isValidCreateDatabaseAction(obj);
    case 'readDatabase':
      return isValidReadDatabaseAction(obj);
    case 'updateDatabase':
      return isValidUpdateDatabaseAction(obj);
    case 'deleteDatabase':
      return isValidDeleteDatabaseAction(obj);
    case 'writeDatabase':
      return isValidWriteDatabaseAction(obj);
    case 'duplicateDatabase':
      return isValidDuplicateDatabaseAction(obj);
    case 'dbFind':
      return typeof obj.parameters.resourceUrl === 'string';
    case 'dbInsert':
      return (
        typeof obj.parameters.resourceUrl === 'string' &&
        obj.parameters.document !== null &&
        typeof obj.parameters.document === 'object'
      );
    case 'dbUpdate':
      return (
        typeof obj.parameters.resourceUrl === 'string' &&
        obj.parameters.filter !== null &&
        typeof obj.parameters.filter === 'object' &&
        obj.parameters.update !== null &&
        typeof obj.parameters.update === 'object'
      );
    case 'dbDelete':
      return (
        typeof obj.parameters.resourceUrl === 'string' &&
        obj.parameters.filter !== null &&
        typeof obj.parameters.filter === 'object'
      );
    case 'askUserInput':
      // message is optional
      return true;
    case 'runCode':
      return isValidRunCodeAction(obj);
    case 'runShell':
      return isValidRunShellAction(obj);
    case 'readMdFile':
      return typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0;
    case 'writeMdFile':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.content === 'string'
      );
    case 'createMdFile':
      return typeof obj.parameters.name === 'string' && obj.parameters.name.length > 0;
    case 'deleteMdFile':
      return typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0;
    case 'renameMdFile':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.newName === 'string' && obj.parameters.newName.length > 0
      );
    case 'duplicateMdFile':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.newName === 'string' && obj.parameters.newName.length > 0
      );
    case 'readData':
      return typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0;
    case 'writeData':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.content === 'string' && obj.parameters.content.length > 0
      );
    case 'createData':
      return (
        typeof obj.parameters.name === 'string' && obj.parameters.name.length > 0 &&
        typeof obj.parameters.content === 'string' && obj.parameters.content.length > 0 &&
        typeof obj.parameters.mediaType === 'string' && obj.parameters.mediaType.length > 0
      );
    case 'deleteData':
      return typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0;
    case 'renameData':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.newName === 'string' && obj.parameters.newName.length > 0
      );
    case 'duplicateData':
      return (
        typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0 &&
        typeof obj.parameters.newName === 'string' && obj.parameters.newName.length > 0
      );
    // No built-in executeAction case, a host must supply a customActionHandler
    // to actually do anything with this, the SDK only needs to recognize the
    // shape so extractActionsFromMessage doesn't reject it before that handler
    // ever runs.
    case 'attachFile':
      return typeof obj.parameters.id === 'string' && obj.parameters.id.length > 0;
    // DEACTIVATED: Crawl is too powerful for current use case
    // case 'crawl':
    //   return isValidCrawlAction(obj);
    default:
      return false;
  }
}

function isValidRunCodeAction(obj: any): obj is RunCodeAction {
  if (!obj.parameters) return false;
  const { code, timeout } = obj.parameters;
  if (typeof code !== 'string' || code.length === 0) return false;
  if (timeout !== undefined && typeof timeout !== 'number') return false;
  return true;
}

function isValidRunShellAction(obj: any): obj is RunShellAction {
  if (!obj.parameters) return false;
  const { command, timeout } = obj.parameters;
  if (typeof command !== 'string' || command.length === 0) return false;
  if (timeout !== undefined && typeof timeout !== 'number') return false;
  return true;
}

function isValidScrapeAction(obj: any): obj is ScrapeAction {
  if (!obj.parameters) return false;
  const { url, timeout } = obj.parameters;

  // URL is required
  if (typeof url !== 'string' || url.length === 0) return false;

  // Validate timeout if provided
  if (timeout !== undefined && typeof timeout !== 'number') return false;

  return true;
}

function isValidSearchAction(obj: any): obj is SearchAction {
  if (!obj.parameters) return false;
  const { query, limit, ignoreInvalidURLs, scrapeOptions } = obj.parameters;

  // Query is required
  if (typeof query !== 'string' || query.length === 0) return false;

  // Validate limit if provided
  if (limit !== undefined && typeof limit !== 'number') return false;

  // Validate ignoreInvalidURLs if provided
  if (ignoreInvalidURLs !== undefined && typeof ignoreInvalidURLs !== 'boolean') return false;

  // Validate scrapeOptions if provided
  if (scrapeOptions !== undefined) {
    if (typeof scrapeOptions !== 'object' || scrapeOptions === null) return false;
    if (scrapeOptions.formats !== undefined && !Array.isArray(scrapeOptions.formats)) return false;
    if (scrapeOptions.onlyMainContent !== undefined && typeof scrapeOptions.onlyMainContent !== 'boolean') return false;
    if (scrapeOptions.timeout !== undefined && typeof scrapeOptions.timeout !== 'number') return false;
    if (scrapeOptions.maxAge !== undefined && typeof scrapeOptions.maxAge !== 'number') return false;
    if (scrapeOptions.parsers !== undefined) {
      if (!Array.isArray(scrapeOptions.parsers)) return false;
      for (const parser of scrapeOptions.parsers) {
        if (typeof parser !== 'object' || parser === null) return false;
        if (typeof parser.type !== 'string') return false;
        if (parser.maxPages !== undefined && typeof parser.maxPages !== 'number') return false;
      }
    }
  }

  return true;
}

function isValidQuickSearchAction(obj: any): obj is QuickSearchAction {
  if (!obj.parameters) return false;
  const { query, limit, sources } = obj.parameters;
  if (typeof query !== 'string' || query.length === 0) return false;
  if (limit !== undefined && typeof limit !== 'number') return false;
  if (sources !== undefined && !Array.isArray(sources)) return false;
  return true;
}

function isValidTavilySearchAction(obj: any): obj is TavilySearchAction {
  if (!obj.parameters) return false;
  const { query, maxResults, searchDepth, includeAnswer } = obj.parameters;
  if (typeof query !== 'string' || query.length === 0) return false;
  if (maxResults !== undefined && typeof maxResults !== 'number') return false;
  if (searchDepth !== undefined && searchDepth !== 'basic' && searchDepth !== 'advanced') return false;
  if (includeAnswer !== undefined && typeof includeAnswer !== 'boolean') return false;
  return true;
}

function isValidCheckDomainAction(obj: any): obj is CheckDomainAction {
  return (
    obj.type === 'action' &&
    obj.variant === 'checkDomain' &&
    obj.parameters &&
    Array.isArray(obj.parameters.domains) &&
    obj.parameters.domains.length > 0 &&
    obj.parameters.domains.every((d: any) => typeof d === 'string' && d.trim().length > 0)
  );
}

function isValidNewsSearchAction(obj: any): obj is NewsSearchAction {
  if (!obj.parameters) return false;
  const { query, limit, ignoreInvalidURLs, scrapeOptions } = obj.parameters;

  // Query is required
  if (typeof query !== 'string' || query.length === 0) return false;

  // Validate limit if provided
  if (limit !== undefined && typeof limit !== 'number') return false;

  // Validate ignoreInvalidURLs if provided
  if (ignoreInvalidURLs !== undefined && typeof ignoreInvalidURLs !== 'boolean') return false;

  // Validate scrapeOptions if provided (same as SearchAction)
  if (scrapeOptions !== undefined) {
    if (typeof scrapeOptions !== 'object' || scrapeOptions === null) return false;
    if (scrapeOptions.formats !== undefined && !Array.isArray(scrapeOptions.formats)) return false;
    if (scrapeOptions.onlyMainContent !== undefined && typeof scrapeOptions.onlyMainContent !== 'boolean') return false;
    if (scrapeOptions.timeout !== undefined && typeof scrapeOptions.timeout !== 'number') return false;
    if (scrapeOptions.maxAge !== undefined && typeof scrapeOptions.maxAge !== 'number') return false;
    if (scrapeOptions.parsers !== undefined) {
      if (!Array.isArray(scrapeOptions.parsers)) return false;
      for (const parser of scrapeOptions.parsers) {
        if (typeof parser !== 'object' || parser === null) return false;
        if (typeof parser.type !== 'string') return false;
        if (parser.maxPages !== undefined && typeof parser.maxPages !== 'number') return false;
      }
    }
  }

  return true;
}

function isValidCrawlAction(obj: any): obj is CrawlAction {
  if (!obj.parameters) return false;
  const { url, includePaths, excludePaths, webhook, scrapeOptions } = obj.parameters;

  // URL is required
  if (typeof url !== 'string' || url.length === 0) return false;

  // Validate includePaths if provided
  if (includePaths !== undefined) {
    if (!Array.isArray(includePaths)) return false;
    for (const path of includePaths) {
      if (typeof path !== 'string') return false;
    }
  }

  // Validate excludePaths if provided
  if (excludePaths !== undefined) {
    if (!Array.isArray(excludePaths)) return false;
    for (const path of excludePaths) {
      if (typeof path !== 'string') return false;
    }
  }

  // Validate webhook if provided
  if (webhook !== undefined) {
    if (typeof webhook !== 'object') return false;
    if (typeof webhook.url !== 'string' || webhook.url.length === 0) return false;

    // Validate events if provided
    if (webhook.events !== undefined) {
      if (!Array.isArray(webhook.events)) return false;
      const validEvents = ['started', 'page', 'completed', 'failed'];
      for (const event of webhook.events) {
        if (!validEvents.includes(event)) return false;
      }
    }

    // Validate metadata if provided
    if (webhook.metadata !== undefined && typeof webhook.metadata !== 'object') {
      return false;
    }
  }

  // Validate scrapeOptions if provided
  if (scrapeOptions !== undefined) {
    if (typeof scrapeOptions !== 'object') return false;
    if (scrapeOptions.formats && !Array.isArray(scrapeOptions.formats)) return false;
  }

  return true;
}

function isValidReadDocumentAction(obj: any): obj is ReadDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl } = obj.parameters;

  // resourceUrl is required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;

  return true;
}

function isValidRemoveDocumentAction(obj: any): obj is RemoveDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl } = obj.parameters;

  // resourceUrl is required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;

  return true;
}

function isValidRenameDocumentAction(obj: any): obj is RenameDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl, newName } = obj.parameters;

  // resourceUrl and newName are required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;
  if (typeof newName !== 'string' || newName.length === 0) return false;

  return true;
}

function isValidDuplicateDocumentAction(obj: any): obj is DuplicateDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl, newName } = obj.parameters;

  // resourceUrl and newName are required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;
  if (typeof newName !== 'string' || newName.length === 0) return false;

  return true;
}

function isValidAddFolderAction(obj: any): obj is AddFolderAction {
  if (!obj.parameters) return false;
  const { folderName, parentUrl, provider } = obj.parameters;

  // folderName is required
  if (typeof folderName !== 'string' || folderName.length === 0) return false;

  // parentUrl is optional but must be a string if provided
  if (parentUrl !== undefined && typeof parentUrl !== 'string') return false;

  // provider is required and must be either 'google' or 'notion'
  if (provider !== 'google' && provider !== 'notion') return false;

  return true;
}

function isValidRemoveFolderAction(obj: any): obj is RemoveFolderAction {
  if (!obj.parameters) return false;
  const { folderUrl } = obj.parameters;

  // folderUrl is required
  if (typeof folderUrl !== 'string' || folderUrl.length === 0) return false;

  return true;
}

function isValidReadFolderAction(obj: any): obj is ReadFolderAction {
  if (!obj.parameters) return false;
  const { folderUrl } = obj.parameters;

  // folderUrl is required
  if (typeof folderUrl !== 'string' || folderUrl.length === 0) return false;

  return true;
}

function isValidRenameFolderAction(obj: any): obj is RenameFolderAction {
  if (!obj.parameters) return false;
  const { folderUrl, newName } = obj.parameters;

  // folderUrl and newName are required
  if (typeof folderUrl !== 'string' || folderUrl.length === 0) return false;
  if (typeof newName !== 'string' || newName.length === 0) return false;

  return true;
}

function isValidAddDocumentAction(obj: any): obj is AddDocumentAction {
  if (!obj.parameters) return false;
  const { locationUrl, documentName, content, provider } = obj.parameters;

  // documentName is required
  if (typeof documentName !== 'string' || documentName.length === 0) return false;

  // locationUrl is optional but must be a string if provided (empty strings are allowed)
  if (locationUrl !== undefined && typeof locationUrl !== 'string') return false;

  // content is optional but must be a string if provided
  if (content !== undefined && typeof content !== 'string') return false;

  // provider is required - must be 'google' or 'notion'
  if (provider !== 'google' && provider !== 'notion') return false;

  return true;
}

function isValidCreateDatabaseAction(obj: any): obj is CreateDatabaseAction {
  if (!obj.parameters) return false;
  const { parentPageUrl, databaseName } = obj.parameters;

  // parentPageUrl is optional but must be a string if provided
  if (parentPageUrl !== undefined && (typeof parentPageUrl !== 'string' || parentPageUrl.length === 0)) return false;

  // databaseName is required
  if (typeof databaseName !== 'string' || databaseName.length === 0) return false;

  return true;
}

function isValidReadDatabaseAction(obj: any): obj is ReadDatabaseAction {
  if (!obj.parameters) return false;
  const { databaseUrl } = obj.parameters;

  // databaseUrl is required
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return false;

  return true;
}

function isValidUpdateDatabaseAction(obj: any): obj is UpdateDatabaseAction {
  if (!obj.parameters) return false;
  const { databaseUrl, databaseName, properties } = obj.parameters;

  // databaseUrl is required
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return false;

  // databaseName is optional but must be a string if provided
  if (databaseName !== undefined && typeof databaseName !== 'string') return false;

  // properties is optional but must be an object if provided
  if (properties !== undefined && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) return false;

  // At least one of databaseName or properties must be provided
  if (databaseName === undefined && properties === undefined) return false;

  return true;
}

function isValidDeleteDatabaseAction(obj: any): obj is DeleteDatabaseAction {
  if (!obj.parameters) return false;
  const { databaseUrl } = obj.parameters;

  // databaseUrl is required
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return false;

  return true;
}

function isValidWriteDatabaseAction(obj: any): obj is WriteDatabaseAction {
  if (!obj.parameters) return false;
  const { databaseUrl, properties } = obj.parameters;

  // databaseUrl is required
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return false;

  // properties is required and must be an object
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return false;

  return true;
}

function isValidDuplicateDatabaseAction(obj: any): obj is DuplicateDatabaseAction {
  if (!obj.parameters) return false;
  const { databaseUrl, newDatabaseName } = obj.parameters;

  // databaseUrl is required
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) return false;

  // newDatabaseName is optional but if provided must be a string
  if (newDatabaseName !== undefined && typeof newDatabaseName !== 'string') return false;

  return true;
}

// TEMPORARILY HIDDEN - Update Database validation
// function isValidUpdateDatabaseAction(obj: any): obj is UpdateDatabaseAction {
//   if (!obj.parameters) return false;
//   const { pageUrl, properties } = obj.parameters;
//
//   // pageUrl is required
//   if (typeof pageUrl !== 'string' || pageUrl.length === 0) return false;
//
//   // properties is required and must be an object
//   if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return false;
//
//   return true;
// }

function isValidWriteDocumentAction(obj: any): obj is WriteDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl, content, mode, range } = obj.parameters;

  // resourceUrl and content are required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;
  if (typeof content !== 'string') return false;

  // Validate mode if provided
  if (mode !== undefined && mode !== 'replace' && mode !== 'append' && mode !== 'selective') return false;

  // Validate range if mode is selective
  if (mode === 'selective') {
    if (!range || typeof range.startIndex !== 'number' || typeof range.endIndex !== 'number') return false;
    if (range.startIndex < 0 || range.endIndex <= range.startIndex) return false;
  }

  return true;
}

function isValidFormatDocumentAction(obj: any): obj is FormatDocumentAction {
  if (!obj.parameters) return false;
  const { resourceUrl, range, formatting } = obj.parameters;

  // resourceUrl and formatting are required
  if (typeof resourceUrl !== 'string' || resourceUrl.length === 0) return false;
  if (!formatting || typeof formatting !== 'object') return false;

  // Validate range if provided
  if (range !== undefined) {
    if (typeof range !== 'object') return false;
    if (typeof range.startIndex !== 'number' || typeof range.endIndex !== 'number') return false;
  }

  // At least one formatting option must be specified
  if (formatting.bold === undefined && formatting.italic === undefined && formatting.fontSize === undefined) {
    return false;
  }

  // Validate formatting options
  if (formatting.bold !== undefined && typeof formatting.bold !== 'boolean') return false;
  if (formatting.italic !== undefined && typeof formatting.italic !== 'boolean') return false;
  if (formatting.fontSize !== undefined && typeof formatting.fontSize !== 'number') return false;

  return true;
}

/**
 * Handles one callback from inside a runCode sandbox (see sandboxTools.ts).
 * Hosts expose this behind an internal HTTP route that the sandboxed
 * subprocess's injected code calls over localhost. Lives here rather than in
 * sandboxTools.ts so it can call `executeAction` directly without a circular
 * import between the two files.
 */
export async function handleSandboxActionCall(
  token: string,
  variant: string,
  parameters: Record<string, unknown>,
  adapter: DAFStorageAdapter,
): Promise<{ success: boolean; result?: string; error?: string }> {
  const resolved = resolveSandboxCall(token, variant, parameters);
  if (!resolved.ok) return { success: false, error: resolved.error };

  const candidate = { type: 'action', variant, parameters } as unknown as Action;
  const result = await executeAction(candidate, resolved.userId, adapter, resolved.processId, resolved.parentProcessIds);
  if (!result.success) return { success: false, error: result.error || `${variant} failed` };
  return { success: true, result: JSON.stringify(result.data ?? result.message ?? null) };
}

// Execute a single action
export async function executeAction(action: Action, userId?: string, adapter?: DAFStorageAdapter, processId?: string, parentProcessIds: string[] = [], context?: ExecutionContext): Promise<ActionResult> {
  if (context?.customActionHandler && userId && adapter && processId) {
    const overridden = await context.customActionHandler(action, { userId, adapter, processId, parentProcessIds });
    if (overridden) return overridden as ActionResult;
  }

  try {
    switch (action.variant) {
      // Editor transform actions (require ExecutionContext with a model provider)
      case 'fixSpellingGrammar':
      case 'rewrite':
      case 'extendText':
      case 'addText':
      case 'reduceText':
      case 'removeText':
      case 'simplify':
      case 'completeSentence':
      case 'translate':
      case 'formatText':
      case 'directive':
        if (!context) {
          return { success: false, error: `Action "${action.variant}" failed: editor actions are only available in the Editor app` };
        }
        return await executeEditorTransformAction(action as EditorTransformAction, context);
      // Email and web retrieval have no implementation in the SDK: sending mail
      // and calling retrieval providers is a host concern. Each action runs the
      // host's hook, or reports that it isn't available here.
      case 'sendEmail':
        if (adapter?.sendEmail && userId) return await adapter.sendEmail(action.parameters, userId, processId);
        return notConfigured(action.variant, 'sendEmail');
      case 'scrape':
        if (adapter?.webScrape) return await adapter.webScrape(action.parameters, userId);
        return notConfigured(action.variant, 'webScrape');
      case 'search':
        if (adapter?.webSearch) return await adapter.webSearch(action.parameters, userId);
        return notConfigured(action.variant, 'webSearch');
      case 'previewSearch':
        if (adapter?.webPreviewSearch) return await adapter.webPreviewSearch(action.parameters, userId);
        return notConfigured(action.variant, 'webPreviewSearch');
      case 'tavilySearch':
        if (adapter?.webTavilySearch) return await adapter.webTavilySearch(action.parameters, userId);
        return notConfigured(action.variant, 'webTavilySearch');
      case 'checkDomain':
        if (adapter?.webCheckDomain) return await adapter.webCheckDomain(action.parameters, userId);
        return notConfigured(action.variant, 'webCheckDomain');
      case 'newsSearch':
        if (adapter?.webNewsSearch) return await adapter.webNewsSearch(action.parameters, userId);
        return notConfigured(action.variant, 'webNewsSearch');
      case 'readDocument':
        return await executeReadDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'writeDocument':
        return await executeWriteDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'formatDocument':
        return await executeFormatDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'removeDocument':
        return await executeRemoveDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'renameDocument':
        return await executeRenameDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'duplicateDocument':
        return await executeDuplicateDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'addFolder':
        return await executeAddFolderAction(action, userId, adapter, processId, parentProcessIds);
      case 'removeFolder':
        return await executeRemoveFolderAction(action, userId, adapter, processId, parentProcessIds);
      case 'readFolder':
        return await executeReadFolderAction(action, userId, adapter, processId, parentProcessIds);
      case 'renameFolder':
        return await executeRenameFolderAction(action, userId, adapter, processId, parentProcessIds);
      case 'addDocument':
        return await executeAddDocumentAction(action, userId, adapter, processId, parentProcessIds);
      case 'createDatabase':
        return await executeCreateDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'readDatabase':
        return await executeReadDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'updateDatabase':
        return await executeUpdateDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'deleteDatabase':
        return await executeDeleteDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'writeDatabase':
        return await executeWriteDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'duplicateDatabase':
        return await executeDuplicateDatabaseAction(action, userId, adapter, processId, parentProcessIds);
      case 'dbFind':
        return await executeDbFindAction(action, userId, adapter, processId, parentProcessIds);
      case 'dbInsert':
        return await executeDbInsertAction(action, userId, adapter, processId, parentProcessIds);
      case 'dbUpdate':
        return await executeDbUpdateAction(action, userId, adapter, processId, parentProcessIds);
      case 'dbDelete':
        return await executeDbDeleteAction(action, userId, adapter, processId, parentProcessIds);
      // DEACTIVATED: Crawl is too powerful for current use case
      // case 'crawl':
      //   return await executeCrawlAction(action, userId);
      case 'askUserInput':
        return {
          success: true,
          message: (action as any).parameters?.message || 'Waiting for your input...',
          pauseForInput: true,
        };
      case 'runCode': {
        if (!userId) return { success: false, error: 'Cannot run code: no user context' };
        if (!adapter?.executeRunCode) {
          return { success: false, error: 'Code execution is not available in this environment' };
        }
        const codeAction = action as RunCodeAction;
        const timeout = codeAction.parameters.timeout ?? 30000;

        if (!isSandboxActionCallingEnabled()) {
          return await adapter.executeRunCode(codeAction.parameters.code, timeout, userId);
        }

        // Prepend callable wrappers for the read-only actions available to
        // programmatic tool calling (see sandboxTools.ts), the model's own
        // code can then call e.g. search(...) directly instead of needing a
        // separate model turn per action. Token is single-run-scoped and
        // never leaves this server.
        const sandboxToken = mintSandboxToken(userId, processId, parentProcessIds, timeout + 10_000);
        try {
          const wrappedCode = buildSandboxProgram(sandboxToken, codeAction.parameters.code);
          return await adapter.executeRunCode(wrappedCode, timeout, userId);
        } finally {
          invalidateSandboxToken(sandboxToken);
        }
      }
      case 'runShell': {
        if (!userId) return { success: false, error: 'Cannot run shell command: no user context' };
        if (!adapter?.executeRunShell) {
          return { success: false, error: 'Shell execution is not available in this environment' };
        }
        const shellAction = action as RunShellAction;
        return await adapter.executeRunShell(
          shellAction.parameters.command,
          shellAction.parameters.timeout ?? 30000,
          userId
        );
      }
      case 'readMdFile':
        return await executeReadMdFileAction(action as ReadMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'writeMdFile':
        return await executeWriteMdFileAction(action as WriteMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'createMdFile':
        return await executeCreateMdFileAction(action as CreateMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'deleteMdFile':
        return await executeDeleteMdFileAction(action as DeleteMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'renameMdFile':
        return await executeRenameMdFileAction(action as RenameMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'duplicateMdFile':
        return await executeDuplicateMdFileAction(action as DuplicateMdFileAction, userId, adapter, processId, parentProcessIds);
      case 'readData':
        return await executeReadDataAction(action as ReadDataAction, userId, adapter, processId, parentProcessIds);
      case 'writeData':
        return await executeWriteDataAction(action as WriteDataAction, userId, adapter, processId, parentProcessIds);
      case 'createData':
        return await executeCreateDataAction(action as CreateDataAction, userId, adapter, processId, parentProcessIds);
      case 'deleteData':
        return await executeDeleteDataAction(action as DeleteDataAction, userId, adapter, processId, parentProcessIds);
      case 'renameData':
        return await executeRenameDataAction(action as RenameDataAction, userId, adapter, processId, parentProcessIds);
      case 'duplicateData':
        return await executeDuplicateDataAction(action as DuplicateDataAction, userId, adapter, processId, parentProcessIds);
      default:
        return {
          success: false,
          error: `Unknown action variant: ${(action as any).variant}`
        };
    }
  } catch (error) {
    console.error('Error executing action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

// Result for an action whose implementation the host has not supplied.
function notConfigured(variant: string, hook: string): ActionResult {
  return {
    success: false,
    error: `The "${variant}" action is not available in this environment (the DAF adapter has no ${hook} hook).`,
  };
}

// Helper function to get accessible resources for a process
async function getAccessibleResources(
  processId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  parentProcessIds: string[] = []
): Promise<Array<{ id?: string; name: string; type: string; provider: string; url: string; metadata?: any }>> {
  try {
    // Collect all process IDs (current + parents)
    const allProcessIds = [processId, ...parentProcessIds];

    // Get all processes to check resourceIds
    const processes = await adapter.db.process.findMany({
      where: {
        id: { in: allProcessIds },
        userId
      },
      select: { id: true, resourceIds: true, resources: true },
    });

    if (processes.length === 0) {
      return [];
    }

    // Collect all resource IDs from all processes
    const allResourceIds = new Set<string>();
    processes.forEach(proc => {
      (proc.resourceIds || []).forEach((id: string) => allResourceIds.add(id));
    });

    // Get resources from Resource table using collected resourceIds + all global resources
    const dbResources = await adapter.db.resource.findMany({
      where: {
        userId,
        OR: [
          { id: { in: Array.from(allResourceIds) } },
          { isGlobal: true },
        ],
      },
    });

    // Convert to simple format for action processing
    const resourcesList = dbResources.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      provider: r.provider,
      url: r.url,
      metadata: r.metadata,
    }));

    // Also check for inline resources (backward compatibility) from all processes
    const resourceMap = new Map<string, any>();

    // Add inline resources from all processes (lower priority)
    processes.forEach(proc => {
      const inlineResources = (proc.resources as any) || [];
      inlineResources.forEach((r: any) => {
        if (r.name && r.url && !resourceMap.has(r.url)) {
          resourceMap.set(r.url, {
            name: r.name,
            type: r.type || 'document',
            provider: r.provider || r.type,
            url: r.url
          });
        }
      });
    });

    // Add DB resources (higher priority - will overwrite inline if same URL)
    resourcesList.forEach(r => {
      resourceMap.set(r.url, r);
    });

    return Array.from(resourceMap.values());
  } catch (error) {
    console.error('Error getting accessible resources:', error);
    return [];
  }
}

// Helper function to normalize URLs by removing query parameters
// This ensures URLs with ?source=copy_link etc. match stored URLs
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Special handling for Notion URLs
    // Notion URLs can be: notion.so/Page-Title-abc123 or notion.so/abc123
    // We normalize to just the page ID to avoid duplicates
    if (urlObj.hostname.includes('notion.so') || urlObj.hostname.includes('notion.site')) {
      const pathname = urlObj.pathname;
      // Extract the page ID (last 32 hex chars or UUID format)
      const pageIdMatch = pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
      if (pageIdMatch) {
        // Return normalized URL with just the page ID (no title slug)
        return `${urlObj.origin}/${pageIdMatch[1]}`;
      }
    }

    return urlObj.origin + urlObj.pathname;
  } catch {
    // If URL parsing fails, just strip query string manually
    return url.split('?')[0];
  }
}

/**
 * Check if a document/page URL is accessible in the current process
 * A document is accessible if:
 * 1. It's directly added as a resource, OR
 * 2. It's contained within a folder/page that is a resource
 */
async function isDocumentAccessible(
  documentUrl: string,
  resources: Array<{ id?: string; name: string; type: string; provider: string; url: string; metadata?: any }>,
  userId: string,
  adapter: DAFStorageAdapter
): Promise<{ accessible: boolean; provider?: string; documentUrl?: string }> {
  const normalizedDocUrl = normalizeUrl(documentUrl);

  // First, check if document is directly a resource
  const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedDocUrl);
  if (directResource) {
    return { accessible: true, provider: directResource.provider, documentUrl: directResource.url };
  }

  // Check if document is a Google Drive document
  if (documentUrl.includes('docs.google.com/document')) {
    const docId = extractDocIdFromUrl(documentUrl);
    if (!docId) {
      return { accessible: false };
    }

    // Get folder resources for this process
    const folderResources = resources.filter((r: any) =>
      r.provider === 'google_drive' && r.type === 'folder'
    );

    if (folderResources.length === 0) {
      return { accessible: false };
    }

    // Check if document is in any of the folder resources (recursively check ancestors)
    try {
      const accessToken = await getGoogleAccessToken(userId, adapter);
      const { google } = await import('googleapis');
      const oauth2Client = getGoogleOAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // Recursively check if document or any of its ancestor folders is a resource
      const isInResourceFolder = async (fileId: string, visited: Set<string> = new Set()): Promise<boolean> => {
        // Prevent infinite loops
        if (visited.has(fileId)) {
          return false;
        }
        visited.add(fileId);

        // Check if this is one of our folder resources
        for (const folderResource of folderResources) {
          const resourceFolderId = extractFolderIdFromUrl(folderResource.url);
          if (resourceFolderId === fileId) {
            return true;
          }
        }

        // Get parent folders
        try {
          const metadata = await drive.files.get({
            fileId: fileId,
            fields: 'parents',
          });

          const parentIds = metadata.data.parents || [];

          // If no parents (root), stop recursion
          if (parentIds.length === 0) {
            return false;
          }

          // Recursively check each parent
          for (const parentId of parentIds) {
            if (await isInResourceFolder(parentId, visited)) {
              return true;
            }
          }
        } catch (error) {
          // If we can't access the parent, stop recursion
          return false;
        }

        return false;
      };

      // Start checking from the document
      if (await isInResourceFolder(docId)) {
        return { accessible: true, provider: 'google_drive', documentUrl };
      }
    } catch (error) {
      console.error('Error checking document accessibility:', error);
      return { accessible: false };
    }
  }

  // Check if document is a Notion page
  if (documentUrl.includes('notion.so') || documentUrl.includes('notion.site')) {
    const pageId = extractPageIdFromUrl(documentUrl);
    if (!pageId) {
      return { accessible: false };
    }

    // Get Notion page resources for this process
    const notionPageResources = resources.filter((r: any) =>
      r.provider === 'notion' && r.type === 'doc'
    );

    if (notionPageResources.length === 0) {
      return { accessible: false };
    }

    // Check if page is a descendant of any page resources (recursively check ancestors)
    try {
      const accessToken = await getNotionAccessToken(userId, adapter);
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: accessToken });

      // Recursively check if page or any of its ancestor pages is a resource
      const isInResourcePage = async (checkPageId: string, visited: Set<string> = new Set()): Promise<boolean> => {
        // Prevent infinite loops
        if (visited.has(checkPageId)) {
          return false;
        }
        visited.add(checkPageId);

        // Check if this page is one of our resources
        const pageUrl = `https://www.notion.so/${checkPageId.replace(/-/g, '')}`;
        const normalizedPageUrl = normalizeUrl(pageUrl);

        const matchingResource = notionPageResources.find((r: any) =>
          normalizeUrl(r.url) === normalizedPageUrl
        );

        if (matchingResource) {
          return true;
        }

        // Get the page to check its parent
        try {
          const page = await notion.pages.retrieve({ page_id: checkPageId });

          if ('parent' in page) {
            const parent = page.parent;

            // Check if parent is a page (if workspace, we've reached the top)
            if ('page_id' in parent) {
              const parentPageId = parent.page_id;
              // Recursively check the parent
              return await isInResourcePage(parentPageId, visited);
            }
          }
        } catch (error) {
          // If we can't access the parent, stop recursion
          return false;
        }

        return false;
      };

      // Start checking from the document page
      if (await isInResourcePage(pageId)) {
        return { accessible: true, provider: 'notion', documentUrl };
      }
    } catch (error) {
      console.error('Error checking Notion page accessibility:', error);
      return { accessible: false };
    }
  }

  return { accessible: false };
}

/**
 * Check if a folder URL is accessible in the current process
 * A folder is accessible if:
 * 1. It's directly added as a resource, OR
 * 2. It's contained within a parent folder that is a resource (for Google Drive)
 */
async function isFolderAccessible(
  folderUrl: string,
  resources: Array<{ id?: string; name: string; type: string; provider: string; url: string; metadata?: any }>,
  userId: string,
  adapter: DAFStorageAdapter
): Promise<{ accessible: boolean; provider?: string; folderUrl?: string }> {
  const normalizedFolderUrl = normalizeUrl(folderUrl);

  // First, check if folder is directly a resource
  const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedFolderUrl);
  if (directResource) {
    return { accessible: true, provider: directResource.provider, folderUrl: directResource.url };
  }

  // Check if folder is a Google Drive folder
  if (folderUrl.includes('drive.google.com/drive/folders')) {
    const folderId = extractFolderIdFromUrl(folderUrl);
    if (!folderId) {
      return { accessible: false };
    }

    // Get folder resources for this process
    const folderResources = resources.filter((r: any) =>
      r.provider === 'google_drive' && r.type === 'folder'
    );

    if (folderResources.length === 0) {
      return { accessible: false };
    }

    // Check if folder is inside any of the folder resources (recursively check ancestors)
    try {
      const accessToken = await getGoogleAccessToken(userId, adapter);
      const { google } = await import('googleapis');
      const oauth2Client = getGoogleOAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // Recursively check if folder or any of its ancestor folders is a resource
      const isInResourceFolder = async (checkFolderId: string, visited: Set<string> = new Set()): Promise<boolean> => {
        // Prevent infinite loops
        if (visited.has(checkFolderId)) {
          return false;
        }
        visited.add(checkFolderId);

        // Check if this is one of our folder resources
        for (const folderResource of folderResources) {
          const resourceFolderId = extractFolderIdFromUrl(folderResource.url);
          if (resourceFolderId === checkFolderId) {
            return true;
          }
        }

        // Get parent folders
        try {
          const metadata = await drive.files.get({
            fileId: checkFolderId,
            fields: 'parents',
          });

          const parentIds = metadata.data.parents || [];

          // If no parents (root), stop recursion
          if (parentIds.length === 0) {
            return false;
          }

          // Recursively check each parent
          for (const parentId of parentIds) {
            if (await isInResourceFolder(parentId, visited)) {
              return true;
            }
          }
        } catch (error) {
          // If we can't access the parent, stop recursion
          return false;
        }

        return false;
      };

      // Start checking from the folder
      if (await isInResourceFolder(folderId)) {
        return { accessible: true, provider: 'google_drive', folderUrl };
      }
    } catch (error) {
      console.error('Error checking folder accessibility:', error);
      return { accessible: false };
    }
  }

  // Check if this is a Notion page (which acts as a folder in our system)
  if (folderUrl.includes('notion.so')) {
    const pageId = extractPageIdFromUrl(folderUrl);
    if (!pageId) {
      return { accessible: false };
    }

    // Get Notion page resources for this process
    const notionPageResources = resources.filter((r: any) =>
      r.provider === 'notion' && r.type === 'doc'
    );

    if (notionPageResources.length === 0) {
      return { accessible: false };
    }

    // Check if page is a descendant of any of the Notion page resources (recursively check ancestors)
    try {
      const accessToken = await getNotionAccessToken(userId, adapter);
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: accessToken });

      // Recursively check if page or any of its ancestor pages is a resource
      const isInResourcePage = async (checkPageId: string, visited: Set<string> = new Set()): Promise<boolean> => {
        // Prevent infinite loops
        if (visited.has(checkPageId)) {
          return false;
        }
        visited.add(checkPageId);

        // Check if this page is one of our resources
        const pageUrl = `https://www.notion.so/${checkPageId.replace(/-/g, '')}`;
        const normalizedPageUrl = normalizeUrl(pageUrl);

        const matchingResource = notionPageResources.find((r: any) =>
          normalizeUrl(r.url) === normalizedPageUrl
        );

        if (matchingResource) {
          return true;
        }

        // Get the page to check its parent
        try {
          const page = await notion.pages.retrieve({ page_id: checkPageId });

          if ('parent' in page) {
            const parent = page.parent;

            // Check if parent is a page (if workspace, we've reached the top)
            if ('page_id' in parent) {
              const parentPageId = parent.page_id;
              // Recursively check the parent
              return await isInResourcePage(parentPageId, visited);
            }
          }
        } catch (error) {
          // If we can't access the parent, stop recursion
          return false;
        }

        return false;
      };

      // Start checking from the folder page
      if (await isInResourcePage(pageId)) {
        return { accessible: true, provider: 'notion', folderUrl };
      }
    } catch (error) {
      console.error('Error checking Notion page accessibility:', error);
      return { accessible: false };
    }
  }

  return { accessible: false };
}

/**
 * Check if a database URL is accessible in the current process
 * A database is accessible if:
 * 1. It's directly added as a resource, OR
 * 2. It's a child of a Notion page that is a resource (recursively checking ancestors)
 */
async function isDatabaseAccessible(
  databaseUrl: string,
  resources: Array<{ id?: string; name: string; type: string; provider: string; url: string; metadata?: any }>,
  userId: string,
  adapter: DAFStorageAdapter
): Promise<{ accessible: boolean; provider?: string; databaseUrl?: string }> {
  const normalizedDatabaseUrl = normalizeUrl(databaseUrl);

  // First, check if database is directly a resource
  const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedDatabaseUrl);
  if (directResource) {
    return { accessible: true, provider: directResource.provider, databaseUrl: directResource.url };
  }

  // Check if this is a Notion database
  if (databaseUrl.includes('notion.so')) {
    const { extractDatabaseIdFromUrl } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(databaseUrl);
    if (!databaseId) {
      return { accessible: false };
    }

    // Get Notion page resources for this process (databases can be children of pages)
    const notionPageResources = resources.filter((r: any) =>
      r.provider === 'notion' && r.type === 'doc'
    );

    if (notionPageResources.length === 0) {
      return { accessible: false };
    }

    // Check if database is a child of any page resources (recursively check ancestors)
    try {
      const accessToken = await getNotionAccessToken(userId, adapter);
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: accessToken });

      // Get the database to check its parent
      const database = await notion.databases.retrieve({ database_id: databaseId }) as any;

      if ('parent' in database) {
        const parent = database.parent;

        // Check if parent is a page
        if ('page_id' in parent) {
          const parentPageId = parent.page_id;

          // Recursively check if the parent page or any of its ancestors is a resource
          const isInResourcePage = async (checkPageId: string, visited: Set<string> = new Set()): Promise<boolean> => {
            // Prevent infinite loops
            if (visited.has(checkPageId)) {
              return false;
            }
            visited.add(checkPageId);

            // Check if this page is one of our resources
            const pageUrl = `https://www.notion.so/${checkPageId.replace(/-/g, '')}`;
            const normalizedPageUrl = normalizeUrl(pageUrl);

            const matchingResource = notionPageResources.find((r: any) =>
              normalizeUrl(r.url) === normalizedPageUrl
            );

            if (matchingResource) {
              return true;
            }

            // Get the page to check its parent
            try {
              const page = await notion.pages.retrieve({ page_id: checkPageId });

              if ('parent' in page) {
                const pageParent = page.parent;

                // Check if parent is a page (if workspace, we've reached the top)
                if ('page_id' in pageParent) {
                  const parentPageId = pageParent.page_id;
                  // Recursively check the parent
                  return await isInResourcePage(parentPageId, visited);
                }
              }
            } catch (error) {
              // If we can't access the parent, stop recursion
              return false;
            }

            return false;
          };

          // Start checking from the database's parent page
          if (await isInResourcePage(parentPageId)) {
            return { accessible: true, provider: 'notion', databaseUrl };
          }
        }
      }
    } catch (error) {
      console.error('Error checking Notion database accessibility:', error);
      return { accessible: false };
    }
  }

  return { accessible: false };
}

// Execute read document action - Read content from Google Docs or Notion
async function executeReadDocumentAction(
  action: ReadDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;

    // Execute based on provider
    if (provider === 'google_drive') {
      const docId = extractDocIdFromUrl(documentUrl);
      if (!docId) {
        return {
          success: false,
          error: `Invalid Google Doc URL: ${documentUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      const { title, content } = await readGoogleDoc(docId, accessToken);

      return {
        success: true,
        message: `Successfully read Google Doc`,
        data: { title, content, documentId: docId, resourceUrl: action.parameters.resourceUrl }
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(documentUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${documentUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);

      const [content, title, children] = await Promise.all([
        readNotionPage(pageId, accessToken),
        getNotionPageTitle(pageId, accessToken),
        listNotionPageChildren(pageId, accessToken),
      ]);

      return {
        success: true,
        message: `Successfully read Notion page${children.length > 0 ? ` (${children.length} subpage${children.length > 1 ? 's' : ''} found)` : ''}`,
        data: {
          title: title || '',
          content: content,
          pageId,
          resourceUrl: action.parameters.resourceUrl,
          subpages: children
        }
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only 'google_drive' and 'notion' are supported for reading.`
      };
    }

  } catch (error) {
    console.error('Error executing read document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read document'
    };
  }
}

// Execute write document action - Write content to Google Docs or Notion
async function executeWriteDocumentAction(
  action: WriteDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;
    const mode = action.parameters.mode || 'replace';
    const content = action.parameters.content;
    const range = action.parameters.range;

    // Execute based on provider
    if (provider === 'google_drive') {
      const docId = extractDocIdFromUrl(documentUrl);
      if (!docId) {
        return {
          success: false,
          error: `Invalid Google Doc URL: ${documentUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);

      if (mode === 'append') {
        await appendGoogleDoc(docId, content, accessToken);
      } else if (mode === 'selective') {
        if (!range) {
          return {
            success: false,
            error: 'Range is required for selective mode'
          };
        }
        await selectiveUpdateGoogleDoc(docId, content, range.startIndex, range.endIndex, accessToken);
      } else {
        await writeGoogleDoc(docId, content, accessToken);
      }

      return {
        success: true,
        message: `Successfully ${mode === 'append' ? 'appended to' : mode === 'selective' ? 'selectively updated' : 'wrote to'} Google Doc`,
        data: { documentId: docId, resourceUrl: action.parameters.resourceUrl, mode }
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(documentUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${documentUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);

      if (mode === 'append') {
        await appendNotionPage(pageId, content, accessToken);
      } else if (mode === 'selective') {
        if (!range) {
          return {
            success: false,
            error: 'Range is required for selective mode'
          };
        }
        await selectiveUpdateNotionPage(pageId, content, range.startIndex, range.endIndex, accessToken);
      } else {
        await writeNotionPage(pageId, content, accessToken);
      }

      return {
        success: true,
        message: `Successfully ${mode === 'append' ? 'appended to' : mode === 'selective' ? 'selectively updated' : 'wrote to'} Notion page`,
        data: { pageId, resourceUrl: action.parameters.resourceUrl, mode }
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only 'google_drive' and 'notion' are supported for writing.`
      };
    }

  } catch (error) {
    console.error('Error executing write document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write to document'
    };
  }
}

// Execute format document action - Apply formatting to Google Docs (Notion not supported)
async function executeFormatDocumentAction(
  action: FormatDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;

    // Only Google Docs supports formatting
    if (provider !== 'google_drive') {
      return {
        success: false,
        error: `Formatting is only supported for Google Docs. Resource provider: ${provider}`
      };
    }

    const docId = extractDocIdFromUrl(documentUrl);
    if (!docId) {
      return {
        success: false,
        error: `Invalid Google Doc URL: ${documentUrl}`
      };
    }

    const accessToken = await getGoogleAccessToken(userId, adapter);
    const { range, formatting } = action.parameters;

    let startIndex = 1; // Google Docs start at index 1
    let endIndex: number;

    if (range) {
      // Use provided range
      startIndex = range.startIndex;
      endIndex = range.endIndex;
    } else {
      // Read the document to get its actual length
      const { content } = await readGoogleDoc(docId, accessToken);
      // The endIndex should be the length of content + 1 (Google Docs convention)
      // But we need to subtract 1 because we can't format past the last character
      endIndex = content.length + 1;

      // If document is empty or very short, use a minimum range
      if (endIndex <= 1) {
        return {
          success: false,
          error: 'Document appears to be empty or cannot be formatted'
        };
      }
    }

    await formatGoogleDoc(docId, startIndex, endIndex, formatting, accessToken);

    const formattingDetails = [];
    if (formatting.bold) formattingDetails.push('bold');
    if (formatting.italic) formattingDetails.push('italic');
    if (formatting.fontSize) formattingDetails.push(`font size: ${formatting.fontSize}`);

    return {
      success: true,
      message: `Successfully applied formatting (${formattingDetails.join(', ')}) to Google Doc`,
      data: { documentId: docId, resourceUrl: action.parameters.resourceUrl, formatting, range: { startIndex, endIndex } }
    };

  } catch (error) {
    console.error('Error executing format document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to format document'
    };
  }
}

// Execute remove document action - Delete/trash a Google Doc or Notion page
async function executeRemoveDocumentAction(
  action: RemoveDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;

    // Check if this is a direct resource (has ID in database) for cleanup
    const normalizedRequestUrl = normalizeUrl(action.parameters.resourceUrl);
    const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedRequestUrl);

    // Execute based on provider
    if (provider === 'google_drive') {
      const docId = extractDocIdFromUrl(documentUrl);
      if (!docId) {
        return {
          success: false,
          error: `Invalid Google Doc URL: ${documentUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      await deleteGoogleDoc(docId, accessToken);

      // Delete the resource from the database if it's a direct resource
      if (directResource?.id) {
        await adapter.db.resource.delete({
          where: { id: directResource.id }
        });
      }

      return {
        success: true,
        message: `Successfully removed document${directResource?.id ? ' and deleted resource' : ''}`,
        data: { documentId: docId, resourceUrl: action.parameters.resourceUrl }
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(documentUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${documentUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      await deleteNotionPage(pageId, accessToken);

      // Delete the resource from the database if it's a direct resource
      if (directResource?.id) {
        await adapter.db.resource.delete({
          where: { id: directResource.id }
        });
      }

      return {
        success: true,
        message: `Successfully removed document${directResource?.id ? ' and deleted resource' : ''}`,
        data: { pageId, resourceUrl: action.parameters.resourceUrl }
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only 'google_drive' and 'notion' are supported for removal.`
      };
    }

  } catch (error) {
    console.error('Error executing remove document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove document'
    };
  }
}

// Execute rename document action - Rename a Google Doc or Notion page
async function executeRenameDocumentAction(
  action: RenameDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;

    // Check if this is a direct resource (has ID in database) for updating
    const normalizedRequestUrl = normalizeUrl(action.parameters.resourceUrl);
    const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedRequestUrl);

    // Execute based on provider
    if (provider === 'google_drive') {
      const docId = extractDocIdFromUrl(documentUrl);
      if (!docId) {
        return {
          success: false,
          error: `Invalid Google Doc URL: ${documentUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      await renameGoogleDoc(docId, action.parameters.newName, accessToken);

      // Update the resource name in the database if it's a direct resource
      if (directResource?.id) {
        await adapter.db.resource.update({
          where: { id: directResource.id },
          data: { name: action.parameters.newName }
        });
      }

      return {
        success: true,
        message: `Successfully renamed document to "${action.parameters.newName}"`,
        data: { documentId: docId, resourceUrl: action.parameters.resourceUrl, newName: action.parameters.newName }
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(documentUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${documentUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      await renameNotionPage(pageId, action.parameters.newName, accessToken);

      // Update the resource name and URL in the database if it's a direct resource
      if (directResource?.id) {
        // Generate new Notion URL with updated title slug
        // Convert title to slug: lowercase, replace spaces with hyphens, remove special chars
        const titleSlug = action.parameters.newName
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();
        const newUrl = `https://www.notion.so/${titleSlug}-${pageId.replace(/-/g, '')}`;

        await adapter.db.resource.update({
          where: { id: directResource.id },
          data: {
            name: action.parameters.newName,
            url: newUrl
          }
        });
      }

      return {
        success: true,
        message: `Successfully renamed document to "${action.parameters.newName}"`,
        data: { pageId, resourceUrl: action.parameters.resourceUrl, newName: action.parameters.newName }
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only 'google_drive' and 'notion' are supported for renaming.`
      };
    }

  } catch (error) {
    console.error('Error executing rename document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename document'
    };
  }
}

// Execute duplicate document action - Duplicate a Google Doc or Notion page
async function executeDuplicateDocumentAction(
  action: DuplicateDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent resources)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if document is accessible (either directly or inside a folder resource)
    const accessCheck = await isDocumentAccessible(action.parameters.resourceUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Document not accessible with URL: ${action.parameters.resourceUrl}. Make sure the document or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const documentUrl = accessCheck.documentUrl!;

    // Execute based on provider
    if (provider === 'google_drive') {
      const docId = extractDocIdFromUrl(documentUrl);
      if (!docId) {
        return {
          success: false,
          error: `Invalid Google Doc URL: ${documentUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      const result = await duplicateGoogleDoc(docId, action.parameters.newName, accessToken);

      return {
        success: true,
        message: `Document duplicated successfully. New document: "${action.parameters.newName}"`,
        data: result.url
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(documentUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${documentUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      const result = await duplicateNotionPage(pageId, action.parameters.newName, accessToken);

      return {
        success: true,
        message: `Document duplicated successfully. New document: "${action.parameters.newName}"`,
        data: result.url
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only 'google_drive' and 'notion' are supported for duplication.`
      };
    }

  } catch (error) {
    console.error('Error executing duplicate document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to duplicate document'
    };
  }
}

// Execute add folder action - Create a folder in Google Drive or a page in Notion
async function executeAddFolderAction(
  action: AddFolderAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    let result: { url: string; folderId?: string; pageId?: string };
    let provider: string;
    let resourceType: string;

    // If parentUrl is provided, validate the parent is accessible
    if (action.parameters.parentUrl) {
      const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

      // Check if parent folder/page is accessible
      const accessCheck = await isFolderAccessible(action.parameters.parentUrl, resources, userId, adapter);

      if (!accessCheck.accessible) {
        return {
          success: false,
          error: `Parent folder/page not accessible with URL: ${action.parameters.parentUrl}. Make sure the parent folder or its parent is added to this process.`
        };
      }
    }

    if (action.parameters.provider === 'google') {
      // Execute for Google Drive
      const accessToken = await getGoogleAccessToken(userId, adapter);

      // If parentUrl is provided, extract folder ID
      let parentFolderId: string | undefined;
      if (action.parameters.parentUrl) {
        const extractedId = extractFolderIdFromUrl(action.parameters.parentUrl);
        if (!extractedId) {
          return {
            success: false,
            error: `Invalid Google Drive folder URL: ${action.parameters.parentUrl}`
          };
        }
        parentFolderId = extractedId;
      }

      // Create the folder
      const folderResult = await createGoogleDriveFolder(
        action.parameters.folderName,
        accessToken,
        parentFolderId
      );

      result = { url: folderResult.url, folderId: folderResult.folderId };
      provider = 'google_drive';
      resourceType = 'folder';

    } else if (action.parameters.provider === 'notion') {
      // Execute for Notion
      const accessToken = await getNotionAccessToken(userId, adapter);

      // If parentUrl is provided, extract page ID
      let parentPageId: string | undefined;
      if (action.parameters.parentUrl) {
        const extractedId = extractPageIdFromUrl(action.parameters.parentUrl);
        if (!extractedId) {
          return {
            success: false,
            error: `Invalid Notion page URL: ${action.parameters.parentUrl}`
          };
        }
        parentPageId = extractedId;
      }

      // Create the page (acts as a folder in Notion)
      const pageResult = await createNotionSubpage(
        parentPageId,
        action.parameters.folderName,
        accessToken
      );

      result = { url: pageResult.url, pageId: pageResult.pageId };
      provider = 'notion';
      resourceType = 'page';

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${action.parameters.provider}. Must be 'google' or 'notion'.`
      };
    }

    // Don't auto-add as resource - user must explicitly add it if needed
    const itemType = action.parameters.provider === 'google' ? 'Folder' : 'Page';
    return {
      success: true,
      message: `${itemType} created successfully: "${action.parameters.folderName}"`,
      data: result.url
    };

  } catch (error) {
    console.error('Error executing add folder action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create folder/page'
    };
  }
}

// Execute read folder action - List contents of Google Drive folder or Notion page children
async function executeReadFolderAction(
  action: ReadFolderAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent processes)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if folder is accessible (either directly or inside a parent folder resource)
    const accessCheck = await isFolderAccessible(action.parameters.folderUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Folder not accessible with URL: ${action.parameters.folderUrl}. Make sure the folder or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const folderUrl = accessCheck.folderUrl!;

    // Execute based on provider
    if (provider === 'google_drive') {
      const folderId = extractFolderIdFromUrl(folderUrl);
      if (!folderId) {
        return {
          success: false,
          error: `Invalid Google Drive folder URL: ${folderUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);

      // Get folder metadata for name
      const { google } = await import('googleapis');
      const oauth2Client = getGoogleOAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const folderMetadata = await drive.files.get({
        fileId: folderId,
        fields: 'name',
      });
      const folderName = folderMetadata.data.name || 'Folder';

      const contents = await listGoogleDriveFolderContents(folderId, accessToken);

      // Format output as human-readable text
      let output = `# Folder: ${folderName}\n\n`;

      if (contents.length === 0) {
        output += `The folder is empty or contains files not accessible to this app.\n\n`;
        output += `**Note:** Due to Google Drive permissions, this action can only see:\n`;
        output += `- Files created by this app\n`;
        output += `- Files you've explicitly selected through the Google Picker\n\n`;
        output += `To make existing files visible, you need to select them individually using the Google Picker when adding resources.`;
      } else {
        output += `**Total items:** ${contents.length}\n\n`;

        // Group by type
        const folders = contents.filter(item => item.type === 'folder');
        const files = contents.filter(item => item.type === 'file');

        if (folders.length > 0) {
          output += `## Folders (${folders.length})\n\n`;
          folders.forEach(folder => {
            output += `**${folder.name}**\n`;
            output += `${folder.url}\n\n`;
          });
        }

        if (files.length > 0) {
          output += `## Files (${files.length})\n\n`;
          files.forEach(file => {
            const fileType = file.mimeType === 'application/vnd.google-apps.document' ? '[Document]' :
              file.mimeType === 'application/vnd.google-apps.spreadsheet' ? '[Spreadsheet]' :
                file.mimeType === 'application/vnd.google-apps.presentation' ? '[Presentation]' : '[File]';
            output += `**${file.name}** ${fileType}\n`;
            output += `${file.url}\n\n`;
          });
        }
      }

      return {
        success: true,
        message: `Successfully read folder "${folderName}"`,
        data: output
      };

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(folderUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${folderUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);

      // Get the page content (child pages are already included inline)
      const pageContent = await readNotionPage(pageId, accessToken);

      // Get child pages for count in message
      const childPages = await listNotionPageChildren(pageId, accessToken);

      // Get page name from API
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: accessToken });
      const page = await notion.pages.retrieve({ page_id: pageId });
      let pageName = 'Untitled';
      if ('properties' in page && 'title' in page.properties) {
        const titleProp = page.properties.title;
        if ('title' in titleProp && Array.isArray(titleProp.title) && titleProp.title.length > 0) {
          pageName = titleProp.title[0].plain_text || 'Untitled';
        }
      }

      return {
        success: true,
        message: `Successfully read Notion page "${pageName}"${childPages.length > 0 ? ` with ${childPages.length} child page(s)` : ''}`,
        data: pageContent
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only Google Drive folders and Notion pages are supported.`
      };
    }

  } catch (error) {
    console.error('Error executing read folder action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read folder'
    };
  }
}

// Execute remove folder action: delete a folder from Google Drive and remove its resource
async function executeRemoveFolderAction(
  action: RemoveFolderAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent processes)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if folder is accessible (either directly or inside a parent folder resource)
    const accessCheck = await isFolderAccessible(action.parameters.folderUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Folder not accessible with URL: ${action.parameters.folderUrl}. Make sure the folder or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const folderUrl = accessCheck.folderUrl!;

    // Check if this is a direct resource (has ID in database) for cleanup
    const normalizedRequestUrl = normalizeUrl(action.parameters.folderUrl);
    const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedRequestUrl);

    // Handle based on provider
    if (provider === 'google_drive') {
      const folderId = extractFolderIdFromUrl(folderUrl);
      if (!folderId) {
        return {
          success: false,
          error: `Invalid Google Drive folder URL: ${folderUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      await deleteGoogleDriveFolder(folderId, accessToken);

    } else if (provider === 'notion') {
      const pageId = extractPageIdFromUrl(folderUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${folderUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      await deleteNotionPage(pageId, accessToken);

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only Google Drive folders and Notion pages are supported for folder removal.`
      };
    }

    // Remove the resource from database and processes if it's a direct resource
    if (directResource?.id) {
      // Remove the resource ID from all processes that reference it
      const allProcessIds = [processId, ...parentProcessIds];
      const processes = await adapter.db.process.findMany({
        where: {
          id: { in: allProcessIds },
          userId
        },
        select: { id: true, resourceIds: true }
      });

      for (const proc of processes) {
        const currentResourceIds = proc.resourceIds || [];
        if (currentResourceIds.includes(directResource.id)) {
          await adapter.db.process.update({
            where: { id: proc.id },
            data: {
              resourceIds: currentResourceIds.filter((id: string) => id !== directResource.id)
            }
          });
        }
      }

      // Delete the resource from the database
      await adapter.db.resource.delete({
        where: {
          id: directResource.id
        }
      });
    }

    const itemType = provider === 'google_drive' ? 'Folder' : 'Page';
    return {
      success: true,
      message: `${itemType} removed successfully${directResource?.id ? ' and deleted resource' : ''}`,
      data: null
    };

  } catch (error) {
    console.error('Error executing remove folder action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove folder'
    };
  }
}

// Execute rename folder action - Rename a Google Drive folder
async function executeRenameFolderAction(
  action: RenameFolderAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process (including parent processes)
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if folder is accessible (either directly or inside a parent folder resource)
    const accessCheck = await isFolderAccessible(action.parameters.folderUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Folder not accessible with URL: ${action.parameters.folderUrl}. Make sure the folder or its parent folder is added to this process.`
      };
    }

    const provider = accessCheck.provider!;
    const folderUrl = accessCheck.folderUrl!;

    // Check if this is a direct resource (has ID in database) for updating
    const normalizedRequestUrl = normalizeUrl(action.parameters.folderUrl);
    const directResource = resources.find((r: any) => normalizeUrl(r.url) === normalizedRequestUrl);

    // Support both Google Drive folders and Notion pages
    if (provider === 'google_drive') {
      const folderId = extractFolderIdFromUrl(folderUrl);
      if (!folderId) {
        return {
          success: false,
          error: `Invalid Google Drive folder URL: ${folderUrl}`
        };
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      await renameGoogleDriveFolder(folderId, action.parameters.newName, accessToken);

      // Update the resource name in the database if it's a direct resource
      if (directResource?.id) {
        await adapter.db.resource.update({
          where: { id: directResource.id },
          data: { name: action.parameters.newName }
        });
      }

      return {
        success: true,
        message: `Folder renamed to "${action.parameters.newName}"`,
        data: null
      };

    } else if (provider === 'notion') {
      // Notion pages should be renamed via renameDocument action
      const pageId = extractPageIdFromUrl(folderUrl);
      if (!pageId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${folderUrl}`
        };
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      await renameNotionPage(pageId, action.parameters.newName, accessToken);

      // Update the resource name and URL in the database if it's a direct resource
      if (directResource?.id) {
        // Generate new Notion URL with updated title slug
        const titleSlug = action.parameters.newName
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();
        const newUrl = `https://www.notion.so/${titleSlug}-${pageId.replace(/-/g, '')}`;

        await adapter.db.resource.update({
          where: { id: directResource.id },
          data: {
            name: action.parameters.newName,
            url: newUrl
          }
        });
      }

      return {
        success: true,
        message: `Page renamed to "${action.parameters.newName}"`,
        data: null
      };

    } else {
      return {
        success: false,
        error: `Unsupported provider: ${provider}. Only Google Drive folders and Notion pages are supported for renaming.`
      };
    }

  } catch (error) {
    console.error('Error executing rename folder action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to rename folder'
    };
  }
}

// Execute add document action - Create a new document in a folder or as a subpage
async function executeAddDocumentAction(
  action: AddDocumentAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Check if locationUrl is an empty string - show helpful error
    if (action.parameters.locationUrl !== undefined && action.parameters.locationUrl === '') {
      return {
        success: false,
        error: `locationUrl cannot be empty. Please provide a valid Google Drive folder URL or Notion page URL, or omit the locationUrl parameter to create in the root/workspace.`
      };
    }

    // If locationUrl is provided, validate the location is accessible (directly or via parent hierarchy)
    let locationProvider: string | null = null;
    let locationUrl: string | null = null;
    if (action.parameters.locationUrl) {
      const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

      // Use isFolderAccessible to check if the location is accessible (supports nested folders/pages)
      const accessCheck = await isFolderAccessible(
        action.parameters.locationUrl,
        resources,
        userId,
        adapter
      );

      if (!accessCheck.accessible) {
        return {
          success: false,
          error: `Location not accessible with URL: ${action.parameters.locationUrl}. Make sure the location or its parent folder/page is added to this process.`
        };
      }

      locationProvider = accessCheck.provider || null;
      locationUrl = accessCheck.folderUrl || action.parameters.locationUrl;

      // Validate that the location is compatible
      // For Google Drive: must be a folder (not a document)
      // For Notion: pages can always have subpages
      if (locationProvider === 'google_drive') {
        // For Google Drive, verify it's actually a folder
        if (action.parameters.locationUrl.includes('docs.google.com/document')) {
          return {
            success: false,
            error: `Cannot add a document to a Google Doc. Please use a Google Drive folder as the location, or omit locationUrl to create in root.`
          };
        }
      }
    }

    // Determine provider - if locationUrl is provided, validate it matches the provider parameter
    // Otherwise, use the required provider parameter
    let provider: 'google' | 'notion' | null = null;

    if (locationProvider) {
      // Location provided - determine provider from location check
      if (locationProvider === 'google_drive') {
        provider = 'google';
      } else if (locationProvider === 'notion') {
        provider = 'notion';
      }

      // Validate that the provider parameter matches the location's provider
      if (provider !== action.parameters.provider) {
        return {
          success: false,
          error: `Provider mismatch: location resource is for '${provider === 'google' ? 'Google Drive' : 'Notion'}' but provider parameter is '${action.parameters.provider}'. Provider must match the location's provider.`
        };
      }
    } else {
      // No location specified - use required provider parameter
      provider = action.parameters.provider;

      // Verify the specified provider integration exists
      const integration = await adapter.db.integration.findUnique({
        where: { userId_provider: { userId, provider: action.parameters.provider } }
      });

      if (!integration) {
        return {
          success: false,
          error: `Provider '${action.parameters.provider}' is not connected. Please connect your ${action.parameters.provider === 'google' ? 'Google' : 'Notion'} account.`
        };
      }
    }

    // Execute based on provider
    if (provider === 'google') {
      let folderId: string | undefined;
      if (locationUrl && locationProvider === 'google_drive') {
        const extractedFolderId = extractFolderIdFromUrl(locationUrl);
        if (!extractedFolderId) {
          return {
            success: false,
            error: `Invalid Google Drive folder URL: ${locationUrl}`
          };
        }
        folderId = extractedFolderId;
      }

      const accessToken = await getGoogleAccessToken(userId, adapter);
      const result = await createGoogleDocInFolder(
        action.parameters.documentName,
        accessToken,
        folderId,
        action.parameters.content
      );

      // Only create resource and add to process if parent folder is NOT already a resource
      // This prevents resource bloat in scheduled processes
      let shouldAddResource = true;
      if (locationUrl) {
        const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
        const normalizedLocationUrl = normalizeUrl(locationUrl);

        // Check if the parent folder is already a direct resource
        const parentIsResource = resources.some((r: any) =>
          r.type === 'folder' &&
          normalizeUrl(r.url) === normalizedLocationUrl
        );

        if (parentIsResource) {
          shouldAddResource = false;
        }
      }

      if (shouldAddResource) {
        // Create a new resource entry for the document
        const newResource = await adapter.db.resource.create({
          data: {
            userId,
            name: action.parameters.documentName,
            type: 'doc',
            provider: 'google_drive',
            url: result.url,
            isGlobal: false,
          },
        });

        // Add the resource ID to the current process's resourceIds
        const process = await adapter.db.process.findUnique({
          where: { id: processId },
          select: { resourceIds: true }
        });

        if (process) {
          const currentResourceIds = process.resourceIds || [];
          if (!currentResourceIds.includes(newResource.id)) {
            await adapter.db.process.update({
              where: { id: processId },
              data: {
                resourceIds: [...currentResourceIds, newResource.id]
              }
            });
          }
        }
      }

      return {
        success: true,
        message: `Document created successfully: "${action.parameters.documentName}"`,
        data: result.url
      };

    } else if (provider === 'notion') {
      let pageId: string | undefined;
      if (locationUrl && locationProvider === 'notion') {
        const extractedPageId = extractPageIdFromUrl(locationUrl);
        if (!extractedPageId) {
          return {
            success: false,
            error: `Invalid Notion page URL: ${locationUrl}`
          };
        }
        pageId = extractedPageId;
      }

      const accessToken = await getNotionAccessToken(userId, adapter);
      const result = await createNotionSubpage(
        pageId,
        action.parameters.documentName,
        accessToken,
        action.parameters.content
      );

      // Only create resource and add to process if parent page is NOT already a resource
      // This prevents resource bloat in scheduled processes
      let shouldAddResource = true;
      if (locationUrl) {
        const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
        const normalizedLocationUrl = normalizeUrl(locationUrl);

        // Check if the parent page is already a direct resource
        // For Notion, pages can be type 'doc' or 'folder' (both can contain children)
        const parentIsResource = resources.some((r: any) =>
          r.provider === 'notion' &&
          (r.type === 'folder' || r.type === 'doc') &&
          normalizeUrl(r.url) === normalizedLocationUrl
        );

        if (parentIsResource) {
          shouldAddResource = false;
        }
      }

      if (shouldAddResource) {
        // Create a new resource entry for the page
        const newResource = await adapter.db.resource.create({
          data: {
            userId,
            name: action.parameters.documentName,
            type: 'doc',
            provider: 'notion',
            url: result.url,
            isGlobal: false,
          },
        });

        // Add the resource ID to the current process's resourceIds
        const process = await adapter.db.process.findUnique({
          where: { id: processId },
          select: { resourceIds: true }
        });

        if (process) {
          const currentResourceIds = process.resourceIds || [];
          if (!currentResourceIds.includes(newResource.id)) {
            await adapter.db.process.update({
              where: { id: processId },
              data: {
                resourceIds: [...currentResourceIds, newResource.id]
              }
            });
          }
        }
      }

      return {
        success: true,
        message: `Document created successfully: "${action.parameters.documentName}"`,
        data: result.url
      };

    } else {
      return {
        success: false,
        error: `Unable to determine provider. Please specify a locationUrl or ensure you have a Google or Notion integration connected.`
      };
    }

  } catch (error) {
    console.error('Error executing add document action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add document'
    };
  }
}

async function executeCreateDatabaseAction(
  action: CreateDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    let parentPageId: string | undefined;

    // If parentPageUrl is provided, validate and extract ID
    if (action.parameters.parentPageUrl) {
      // Get accessible resources for this process
      const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

      // Check if the parent page is accessible
      const accessCheck = await isDocumentAccessible(action.parameters.parentPageUrl, resources, userId, adapter);

      if (!accessCheck.accessible || accessCheck.provider !== 'notion') {
        return {
          success: false,
          error: `Parent page not accessible with URL: ${action.parameters.parentPageUrl}. Make sure it's a Notion page added as a resource.`
        };
      }

      // Extract parent page ID from URL
      const { extractPageIdFromUrl } = await import('./integrations/notion');
      const extractedId = extractPageIdFromUrl(action.parameters.parentPageUrl);

      if (!extractedId) {
        return {
          success: false,
          error: `Invalid Notion page URL: ${action.parameters.parentPageUrl}`
        };
      }

      parentPageId = extractedId;
    }

    // Get Notion access token
    const { getNotionAccessToken, createNotionDatabase } = await import('./integrations/notion');
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Create default property schema with just a title property
    const defaultProperties = {
      "Name": { "title": {} }
    };

    // Create the database (at workspace level if no parent, or nested if parent provided)
    const result = await createNotionDatabase(
      parentPageId,
      action.parameters.databaseName,
      defaultProperties,
      accessToken
    );

    // Only create resource and add to process if parent page is NOT already a resource
    // This prevents resource bloat in scheduled processes
    let shouldAddResource = true;
    if (action.parameters.parentPageUrl) {
      const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
      const normalizedParentUrl = normalizeUrl(action.parameters.parentPageUrl);

      // Check if the parent page is already a direct resource
      // For Notion, pages can be type 'doc' or 'folder' (both can contain children)
      const parentIsResource = resources.some((r: any) =>
        r.provider === 'notion' &&
        (r.type === 'folder' || r.type === 'doc') &&
        normalizeUrl(r.url) === normalizedParentUrl
      );

      if (parentIsResource) {
        shouldAddResource = false;
      }
    }

    if (shouldAddResource) {
      // Add database as a resource to the current process
      const newResource = await adapter.db.resource.create({
        data: {
          userId,
          name: action.parameters.databaseName,
          type: 'database',
          provider: 'notion',
          url: result.url,
          isGlobal: false,
        },
      });

      // Add the resource ID to the current process's resourceIds
      const process = await adapter.db.process.findUnique({
        where: { id: processId },
        select: { resourceIds: true }
      });

      if (process) {
        const currentResourceIds = process.resourceIds || [];
        if (!currentResourceIds.includes(newResource.id)) {
          await adapter.db.process.update({
            where: { id: processId },
            data: {
              resourceIds: [...currentResourceIds, newResource.id]
            }
          });
        }
      }
    }

    const location = action.parameters.parentPageUrl ? 'as child of parent page' : 'at workspace level';
    return {
      success: true,
      message: `Database "${action.parameters.databaseName}" created successfully ${location}`,
      data: result.url
    };

  } catch (error) {
    console.error('Error executing create database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create database'
    };
  }
}

async function executeReadDatabaseAction(
  action: ReadDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if database is accessible (either directly or as a child of a page resource)
    const accessCheck = await isDatabaseAccessible(action.parameters.databaseUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Database not accessible with URL: ${action.parameters.databaseUrl}. Make sure the database or its parent page is added as a resource.`
      };
    }

    const databaseUrl = accessCheck.databaseUrl!;

    // Extract database ID from URL
    const { extractDatabaseIdFromUrl, getNotionAccessToken, readNotionDatabase } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(action.parameters.databaseUrl);

    if (!databaseId) {
      return {
        success: false,
        error: `Invalid Notion database URL: ${action.parameters.databaseUrl}`
      };
    }

    // Get Notion access token
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Read the database
    const database = await readNotionDatabase(databaseId, accessToken);

    // Format properties for display
    const propertiesDescription = Object.entries(database.properties).map(([name, prop]: [string, any]) => {
      return `- **${name}** (${prop.type})`;
    }).join('\n');

    return {
      success: true,
      message: `Successfully read database "${database.title}"`,
      data: `# Database: ${database.title}\n\n**URL:** ${database.url}\n\n## Properties:\n${propertiesDescription}`
    };

  } catch (error) {
    console.error('Error executing read database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read database'
    };
  }
}

async function executeUpdateDatabaseAction(
  action: UpdateDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if database is accessible (either directly or as a child of a page resource)
    const accessCheck = await isDatabaseAccessible(action.parameters.databaseUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Database not accessible with URL: ${action.parameters.databaseUrl}. Make sure the database or its parent page is added as a resource.`
      };
    }

    const databaseUrl = accessCheck.databaseUrl!;
    const normalizedDatabaseUrl = normalizeUrl(databaseUrl);

    // Extract database ID from URL
    const { extractDatabaseIdFromUrl, getNotionAccessToken, updateNotionDatabase } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(action.parameters.databaseUrl);

    if (!databaseId) {
      return {
        success: false,
        error: `Invalid Notion database URL: ${action.parameters.databaseUrl}`
      };
    }

    // Get Notion access token
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Update the database
    await updateNotionDatabase(
      databaseId,
      accessToken,
      action.parameters.databaseName,
      action.parameters.properties
    );

    // Update resource name in database if name was changed and it's a direct resource
    if (action.parameters.databaseName) {
      const databaseResource = resources.find((r: any) =>
        r.provider === 'notion' &&
        r.type === 'database' &&
        normalizeUrl(r.url) === normalizedDatabaseUrl
      );

      if (databaseResource && databaseResource.id) {
        await adapter.db.resource.update({
          where: { id: databaseResource.id },
          data: { name: action.parameters.databaseName }
        });
      }
    }

    let message = 'Database updated successfully';
    if (action.parameters.databaseName && action.parameters.properties) {
      message += ' (name and properties)';
    } else if (action.parameters.databaseName) {
      message += ' (name only)';
    } else if (action.parameters.properties) {
      message += ' (properties only)';
    }

    return {
      success: true,
      message,
      data: action.parameters.databaseUrl
    };

  } catch (error) {
    console.error('Error executing update database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update database'
    };
  }
}

async function executeDeleteDatabaseAction(
  action: DeleteDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if database is accessible (either directly or as a child of a page resource)
    const accessCheck = await isDatabaseAccessible(action.parameters.databaseUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Database not accessible with URL: ${action.parameters.databaseUrl}. Make sure the database or its parent page is added as a resource.`
      };
    }

    const databaseUrl = accessCheck.databaseUrl!;
    const normalizedDatabaseUrl = normalizeUrl(databaseUrl);

    // Extract database ID from URL
    const { extractDatabaseIdFromUrl, getNotionAccessToken, deleteNotionDatabase } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(action.parameters.databaseUrl);

    if (!databaseId) {
      return {
        success: false,
        error: `Invalid Notion database URL: ${action.parameters.databaseUrl}`
      };
    }

    // Get Notion access token
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Delete (archive) the database
    await deleteNotionDatabase(databaseId, accessToken);

    // Remove from database if it's a direct resource (only if explicitly added)
    const databaseResource = resources.find((r: any) =>
      r.provider === 'notion' &&
      r.type === 'database' &&
      normalizeUrl(r.url) === normalizedDatabaseUrl
    );

    if (databaseResource && databaseResource.id) {
      await adapter.db.resource.delete({
        where: { id: databaseResource.id }
      });
    }

    return {
      success: true,
      message: `Database "${databaseResource?.name || 'Database'}" archived successfully`,
      data: action.parameters.databaseUrl
    };

  } catch (error) {
    console.error('Error executing delete database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete database'
    };
  }
}

async function executeDuplicateDatabaseAction(
  action: DuplicateDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if database is accessible (either directly or as a child of a page resource)
    const accessCheck = await isDatabaseAccessible(action.parameters.databaseUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Database not accessible with URL: ${action.parameters.databaseUrl}. Make sure the database or its parent page is added as a resource.`
      };
    }

    const provider = accessCheck.provider!;
    const databaseUrl = accessCheck.databaseUrl!;
    const normalizedDatabaseUrl = normalizeUrl(databaseUrl);

    // Extract database ID from URL
    const { extractDatabaseIdFromUrl, getNotionAccessToken, duplicateNotionDatabase } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(action.parameters.databaseUrl);

    if (!databaseId) {
      return {
        success: false,
        error: `Invalid database URL: ${action.parameters.databaseUrl}`
      };
    }

    // Get Notion access token
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Duplicate the database
    const result = await duplicateNotionDatabase(
      databaseId,
      accessToken,
      action.parameters.newDatabaseName
    );

    // Smart resource management: Only add the duplicated database as a resource if the 
    // original database was explicitly added (not just accessible as a child of another resource)
    const isExplicitlyAdded = resources.some((r: any) =>
      r.provider === 'notion' &&
      r.type === 'database' &&
      normalizeUrl(r.url) === normalizedDatabaseUrl
    );

    if (isExplicitlyAdded) {
      // Check if a resource with this name already exists and determine final name
      let finalName = result.title;
      const existingResource = await adapter.db.resource.findFirst({
        where: {
          userId,
          name: finalName
        }
      });

      // If name exists, append a number
      if (existingResource) {
        let counter = 2;
        while (true) {
          const testName = `${result.title} (${counter})`;
          const exists = await adapter.db.resource.findFirst({
            where: {
              userId,
              name: testName
            }
          });
          if (!exists) {
            finalName = testName;
            break;
          }
          counter++;
        }
      }

      // Create a new resource entry for the duplicated database
      const newResource = await adapter.db.resource.create({
        data: {
          userId,
          name: finalName,
          type: 'database',
          provider: 'notion',
          url: result.url,
          isGlobal: false,
        },
      });

      // Add the new resource to the process's resourceIds
      const currentProcess = await adapter.db.process.findUnique({
        where: { id: processId },
        select: { resourceIds: true }
      });

      if (currentProcess && !currentProcess.resourceIds.includes(newResource.id)) {
        await adapter.db.process.update({
          where: { id: processId },
          data: {
            resourceIds: [...currentProcess.resourceIds, newResource.id]
          }
        });
      }

      console.log(`[duplicateDatabase] Added duplicated database as resource: ${finalName}`);
    } else {
      console.log(`[duplicateDatabase] Original database not explicitly added as resource, skipping resource creation for duplicate`);
    }

    return {
      success: true,
      message: `Database duplicated successfully as "${result.title}"`,
      data: result.url
    };

  } catch (error) {
    console.error('Error executing duplicate database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to duplicate database'
    };
  }
}

async function executeWriteDatabaseAction(
  action: WriteDatabaseAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return {
        success: false,
        error: 'Missing required context (userId, adapter, or processId)'
      };
    }

    // Get accessible resources for this process
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);

    // Check if database is accessible (either directly or as a child of a page resource)
    const accessCheck = await isDatabaseAccessible(action.parameters.databaseUrl, resources, userId, adapter);

    if (!accessCheck.accessible) {
      return {
        success: false,
        error: `Database not accessible with URL: ${action.parameters.databaseUrl}. Make sure the database or its parent page is added as a resource.`
      };
    }

    const databaseUrl = accessCheck.databaseUrl!;

    // Extract database ID from URL
    const { extractDatabaseIdFromUrl, getNotionAccessToken, createNotionDatabasePage } = await import('./integrations/notion');
    const databaseId = extractDatabaseIdFromUrl(action.parameters.databaseUrl);

    if (!databaseId) {
      return {
        success: false,
        error: `Invalid database URL: ${action.parameters.databaseUrl}`
      };
    }

    console.log(`[writeDatabase] Extracted database ID: ${databaseId} from URL: ${action.parameters.databaseUrl}`);

    // Get Notion access token
    const accessToken = await getNotionAccessToken(userId, adapter);

    // Create the page in the database
    const result = await createNotionDatabasePage(
      databaseId,
      action.parameters.properties,
      accessToken,
      action.parameters.content
    );

    return {
      success: true,
      message: `Database page created successfully`,
      data: result.url
    };

  } catch (error) {
    console.error('Error executing write database action:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create database page'
    };
  }
}

// TEMPORARILY HIDDEN - Update Database execution
// async function executeUpdateDatabaseAction(
//   action: UpdateDatabaseAction,
//   userId?: string,
//   adapter?: DAFStorageAdapter,
//   processId?: string,
//   parentProcessIds: string[] = []
// ): Promise<ActionResult> {
//   try {
//     if (!userId || !adapter || !processId) {
//       return {
//         success: false,
//         error: 'Missing required context (userId, adapter, or processId)'
//       };
//     }
//
//     // Get accessible resources for this process
//     const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
//
//     // Check if the page is accessible through a database resource
//     const normalizedPageUrl = normalizeUrl(action.parameters.pageUrl);
//     
//     // Check if any database resource exists (database pages inherit access from database)
//     const databaseResources = resources.filter((r: any) => 
//       r.provider === 'notion' && 
//       r.type === 'database'
//     );
//
//     if (databaseResources.length === 0) {
//       return {
//         success: false,
//         error: `No database resources found. Make sure the parent database is added as a resource.`
//       };
//     }
//
//     // Extract page ID from URL
//     const { extractPageIdFromUrl, getNotionAccessToken } = await import('./integrations/notion');
//     const pageId = extractPageIdFromUrl(action.parameters.pageUrl);
//
//     if (!pageId) {
//       return {
//         success: false,
//         error: `Invalid page URL: ${action.parameters.pageUrl}`
//       };
//     }
//
//     // Get Notion access token
//     const accessToken = await getNotionAccessToken(userId, adapter);
//
//     // Verify the page exists and is a database page
//     try {
//       const { Client } = await import('@notionhq/client');
//       const notion = new Client({ auth: accessToken });
//       const page = await notion.pages.retrieve({ page_id: pageId }) as any;
//
//       // Check if it's a database page
//       if (!('parent' in page && 'database_id' in page.parent)) {
//         return {
//           success: false,
//           error: `Page is not a database page: ${action.parameters.pageUrl}`
//         };
//       }
//
//       // Check if the parent database is in our resources
//       const parentDatabaseId = page.parent.database_id;
//       const parentDatabase = databaseResources.find((r: any) => {
//         const dbId = extractPageIdFromUrl(r.url);
//         return dbId === parentDatabaseId;
//       });
//
//       if (!parentDatabase) {
//         return {
//           success: false,
//           error: `Parent database not accessible. Make sure the parent database is added as a resource.`
//         };
//       }
//     } catch (error) {
//       console.error('Error checking page accessibility:', error);
//       return {
//         success: false,
//         error: `Failed to verify page: ${error instanceof Error ? error.message : 'Unknown error'}`
//       };
//     }
//
//     // Update the page properties
//     const { updateNotionDatabasePage } = await import('./integrations/notion');
//     await updateNotionDatabasePage(
//       pageId,
//       accessToken,
//       action.parameters.properties
//     );
//
//     return {
//       success: true,
//       message: `Database page updated successfully`,
//       data: action.parameters.pageUrl
//     };
//
//   } catch (error) {
//     console.error('Error executing update database action:', error);
//     return {
//       success: false,
//       error: error instanceof Error ? error.message : 'Failed to update database page'
//     };
//   }
// }

// ── Generic DB action executors ───────────────────────────────────────────────

// Verifies the MongoDB resource is attached to this process and that the host has
// wired up Mongo support. Returns the validated userId for the delegated call.
// The actual database access lives in the host via the adapter's mongo* hooks.
async function assertDbResourceAccessible(
  resourceUrl: string,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<{ userId: string; adapter: DAFStorageAdapter }> {
  if (!userId || !adapter || !processId) {
    throw new Error('Missing required context (userId, adapter, or processId)');
  }

  // Verify this resource is accessible to the process
  const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
  const resource = resources.find(r => r.provider === 'mongodb' && r.url === resourceUrl);

  if (!resource) {
    throw new Error(
      `MongoDB resource "${resourceUrl}" is not accessible. Make sure it is added to this process.`
    );
  }

  return { userId, adapter };
}

async function executeDbFindAction(
  action: DbFindAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    const ctx = await assertDbResourceAccessible(action.parameters.resourceUrl, userId, adapter, processId, parentProcessIds);
    if (!ctx.adapter.mongoFind) {
      return { success: false, error: 'MongoDB is not configured in this environment.' };
    }
    const docs = await ctx.adapter.mongoFind(
      action.parameters.resourceUrl,
      ctx.userId,
      action.parameters.filter || {},
      {
        sort: action.parameters.sort,
        limit: action.parameters.limit,
        projection: action.parameters.projection,
      }
    );
    return {
      success: true,
      message: `Found ${docs.length} document(s)`,
      data: { documents: docs, count: docs.length },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'dbFind failed' };
  }
}

async function executeDbInsertAction(
  action: DbInsertAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    const ctx = await assertDbResourceAccessible(action.parameters.resourceUrl, userId, adapter, processId, parentProcessIds);
    if (!ctx.adapter.mongoInsert) {
      return { success: false, error: 'MongoDB is not configured in this environment.' };
    }
    const result = await ctx.adapter.mongoInsert(action.parameters.resourceUrl, ctx.userId, action.parameters.document);
    return {
      success: true,
      message: `Document inserted with id ${result.insertedId}`,
      data: result,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'dbInsert failed' };
  }
}

async function executeDbUpdateAction(
  action: DbUpdateAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    const ctx = await assertDbResourceAccessible(action.parameters.resourceUrl, userId, adapter, processId, parentProcessIds);
    if (!ctx.adapter.mongoUpdate) {
      return { success: false, error: 'MongoDB is not configured in this environment.' };
    }
    const result = await ctx.adapter.mongoUpdate(
      action.parameters.resourceUrl,
      ctx.userId,
      action.parameters.filter,
      action.parameters.update as any,
      { multi: action.parameters.multi, upsert: action.parameters.upsert }
    );
    return {
      success: true,
      message: `Updated ${result.modifiedCount} document(s) (matched ${result.matchedCount})`,
      data: result,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'dbUpdate failed' };
  }
}

async function executeDbDeleteAction(
  action: DbDeleteAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (action.parameters.confirm !== true) {
      return {
        success: false,
        error: 'dbDelete requires confirm: true. Set "confirm": true in the parameters to proceed with the deletion.',
      };
    }

    const filterKeys = Object.keys(action.parameters.filter || {});
    if (filterKeys.length === 0) {
      return {
        success: false,
        error: 'dbDelete with an empty filter is not allowed. Provide at least one filter field.',
      };
    }

    const ctx = await assertDbResourceAccessible(action.parameters.resourceUrl, userId, adapter, processId, parentProcessIds);
    if (!ctx.adapter.mongoDelete) {
      return { success: false, error: 'MongoDB is not configured in this environment.' };
    }
    const result = await ctx.adapter.mongoDelete(action.parameters.resourceUrl, ctx.userId, action.parameters.filter, { multi: action.parameters.multi });
    return {
      success: true,
      message: `Deleted ${result.deletedCount} document(s)`,
      data: result,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'dbDelete failed' };
  }
}

// ── MD File helpers ───────────────────────────────────────────────────────────

function isMdFileAccessible(
  id: string,
  resources: Array<{ id?: string; name: string; type: string; provider: string; url: string }>
): boolean {
  return resources.some((r) => r.type === 'md_file' && r.id === id);
}

// Fetch the DB resource record for an MD file
async function getMdFileResource(id: string, userId: string, adapter: DAFStorageAdapter) {
  return adapter.db.resource.findFirst({ where: { id, userId, type: 'md_file' } });
}

// Execute readMdFile action, reads content from DB metadata
async function executeReadMdFileAction(
  action: ReadMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id } = action.parameters;

    if (!isMdFileAccessible(id, resources)) {
      return {
        success: false,
        error: `MD file not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getMdFileResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `MD file resource not found: ${id}` };
    }

    const content = (resource.metadata as any)?.content ?? '';
    // A description means this file states a purpose (e.g. "use this when..."),
    // that's what distinguishes an instruction-style file from a plain document,
    // without the SDK needing any app-specific concept of "skill".
    const hasDescription = typeof (resource.metadata as any)?.description === 'string' && (resource.metadata as any).description.length > 0;

    return {
      success: true,
      message: `Read MD file: ${resource.name}`,
      data: { id, name: resource.name, content, hasDescription },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to read MD file' };
  }
}

// Execute writeMdFile action, updates content in DB metadata
async function executeWriteMdFileAction(
  action: WriteMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, content, mode = 'replace' } = action.parameters;

    if (!isMdFileAccessible(id, resources)) {
      return {
        success: false,
        error: `MD file not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getMdFileResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `MD file resource not found: ${id}` };
    }

    const existing = (resource.metadata as any)?.content ?? '';
    const newContent = mode === 'append' ? existing + content : content;

    await adapter.db.resource.update({
      where: { id: resource.id },
      data: { metadata: { content: newContent } },
    });

    return {
      success: true,
      message: `${mode === 'append' ? 'Appended to' : 'Wrote to'} MD file: ${resource.name}`,
      data: { id, mode },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to write MD file' };
  }
}

// Execute createMdFile action, creates a new resource record in the DB
async function executeCreateMdFileAction(
  action: CreateMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const { name, content = '' } = action.parameters;

    const proc = await adapter.db.process.findUnique({ where: { id: processId }, select: { resourceIds: true } });
    const newResource = await adapter.db.resource.create({
      data: {
        name: name.trim() || 'Untitled',
        type: 'md_file',
        provider: 'local',
        url: `md/${(name.trim() || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        metadata: { content },
        userId,
      },
    });

    const updatedIds = [...(proc?.resourceIds || []), newResource.id];
    await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: updatedIds } });

    return {
      success: true,
      message: `Created MD file: ${newResource.name}`,
      data: { id: newResource.id, name: newResource.name },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create MD file' };
  }
}

// Execute deleteMdFile action, removes the resource record from the DB
async function executeDeleteMdFileAction(
  action: DeleteMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id } = action.parameters;

    if (!isMdFileAccessible(id, resources)) {
      return {
        success: false,
        error: `MD file not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getMdFileResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `MD file resource not found: ${id}` };
    }

    await adapter.db.resource.delete({ where: { id: resource.id } });

    return {
      success: true,
      message: `Deleted MD file: ${resource.name}`,
      data: { id },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete MD file' };
  }
}

// Execute renameMdFile action, updates name and url in the DB
async function executeRenameMdFileAction(
  action: RenameMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, newName } = action.parameters;

    if (!isMdFileAccessible(id, resources)) {
      return {
        success: false,
        error: `MD file not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getMdFileResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `MD file resource not found: ${id}` };
    }

    await adapter.db.resource.update({
      where: { id: resource.id },
      data: { name: newName },
    });

    return {
      success: true,
      message: `Renamed MD file from "${resource.name}" to "${newName}"`,
      data: { id, newName },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to rename MD file' };
  }
}

// Execute duplicateMdFile action, copies content into a new resource record
async function executeDuplicateMdFileAction(
  action: DuplicateMdFileAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, newName } = action.parameters;

    if (!isMdFileAccessible(id, resources)) {
      return {
        success: false,
        error: `MD file not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const source = await getMdFileResource(id, userId, adapter);
    if (!source) {
      return { success: false, error: `MD file resource not found: ${id}` };
    }

    const content = (source.metadata as any)?.content ?? '';

    const proc = await adapter.db.process.findUnique({ where: { id: processId }, select: { resourceIds: true } });
    const newResource = await adapter.db.resource.create({
      data: {
        name: newName,
        type: 'md_file',
        provider: 'local',
        url: `md/${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        metadata: { content },
        userId,
      },
    });

    const updatedIds = [...(proc?.resourceIds || []), newResource.id];
    await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: updatedIds } });

    return {
      success: true,
      message: `Duplicated "${source.name}" as "${newName}"`,
      data: { originalId: id, newId: newResource.id, newName },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to duplicate MD file' };
  }
}

function isDataResourceAccessible(
  id: string,
  resources: Array<{ id?: string; name: string; type: string; provider: string; url: string }>
): boolean {
  return resources.some((r) => r.type === 'data' && r.id === id);
}

// Fetch the DB resource record for a data resource
async function getDataResource(id: string, userId: string, adapter: DAFStorageAdapter) {
  return adapter.db.resource.findFirst({ where: { id, userId, type: 'data' } });
}

// Execute readData action, reads base64 content and mediaType from DB metadata
async function executeReadDataAction(
  action: ReadDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id } = action.parameters;

    if (!isDataResourceAccessible(id, resources)) {
      return {
        success: false,
        error: `Data resource not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getDataResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `Data resource not found: ${id}` };
    }

    const content = (resource.metadata as any)?.content ?? '';
    const mediaType = (resource.metadata as any)?.mediaType ?? 'application/octet-stream';

    return {
      success: true,
      message: `Read data resource: ${resource.name}`,
      data: { id, name: resource.name, content, mediaType },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to read data resource' };
  }
}

// Execute writeData action, replaces base64 content (and optionally mediaType) in DB metadata
async function executeWriteDataAction(
  action: WriteDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, content, mediaType } = action.parameters;

    if (!isDataResourceAccessible(id, resources)) {
      return {
        success: false,
        error: `Data resource not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getDataResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `Data resource not found: ${id}` };
    }

    const existingMediaType = (resource.metadata as any)?.mediaType ?? 'application/octet-stream';

    await adapter.db.resource.update({
      where: { id: resource.id },
      data: { metadata: { content, mediaType: mediaType ?? existingMediaType } },
    });

    return {
      success: true,
      message: `Wrote to data resource: ${resource.name}`,
      data: { id },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to write data resource' };
  }
}

// Execute createData action, creates a new resource record in the DB
async function executeCreateDataAction(
  action: CreateDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const { name, content, mediaType } = action.parameters;

    const proc = await adapter.db.process.findUnique({ where: { id: processId }, select: { resourceIds: true } });
    const newResource = await adapter.db.resource.create({
      data: {
        name: name.trim() || 'Untitled',
        type: 'data',
        provider: 'local',
        url: `data/${(name.trim() || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        metadata: { content, mediaType },
        userId,
      },
    });

    const updatedIds = [...(proc?.resourceIds || []), newResource.id];
    await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: updatedIds } });

    return {
      success: true,
      message: `Created data resource: ${newResource.name}`,
      data: { id: newResource.id, name: newResource.name },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create data resource' };
  }
}

// Execute deleteData action, removes the resource record from the DB
async function executeDeleteDataAction(
  action: DeleteDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id } = action.parameters;

    if (!isDataResourceAccessible(id, resources)) {
      return {
        success: false,
        error: `Data resource not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getDataResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `Data resource not found: ${id}` };
    }

    await adapter.db.resource.delete({ where: { id: resource.id } });

    return {
      success: true,
      message: `Deleted data resource: ${resource.name}`,
      data: { id },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to delete data resource' };
  }
}

// Execute renameData action, updates the resource name in the DB
async function executeRenameDataAction(
  action: RenameDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, newName } = action.parameters;

    if (!isDataResourceAccessible(id, resources)) {
      return {
        success: false,
        error: `Data resource not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const resource = await getDataResource(id, userId, adapter);
    if (!resource) {
      return { success: false, error: `Data resource not found: ${id}` };
    }

    await adapter.db.resource.update({
      where: { id: resource.id },
      data: { name: newName },
    });

    return {
      success: true,
      message: `Renamed data resource from "${resource.name}" to "${newName}"`,
      data: { id, newName },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to rename data resource' };
  }
}

// Execute duplicateData action, copies content into a new resource record
async function executeDuplicateDataAction(
  action: DuplicateDataAction,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<ActionResult> {
  try {
    if (!userId || !adapter || !processId) {
      return { success: false, error: 'Missing required context (userId, adapter, or processId)' };
    }

    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const { id, newName } = action.parameters;

    if (!isDataResourceAccessible(id, resources)) {
      return {
        success: false,
        error: `Data resource not accessible: ${id}. Make sure it is added as a resource in this process.`,
      };
    }

    const source = await getDataResource(id, userId, adapter);
    if (!source) {
      return { success: false, error: `Data resource not found: ${id}` };
    }

    const content = (source.metadata as any)?.content ?? '';
    const mediaType = (source.metadata as any)?.mediaType ?? 'application/octet-stream';

    const proc = await adapter.db.process.findUnique({ where: { id: processId }, select: { resourceIds: true } });
    const newResource = await adapter.db.resource.create({
      data: {
        name: newName,
        type: 'data',
        provider: 'local',
        url: `data/${newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        metadata: { content, mediaType },
        userId,
      },
    });

    const updatedIds = [...(proc?.resourceIds || []), newResource.id];
    await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: updatedIds } });

    return {
      success: true,
      message: `Duplicated "${source.name}" as "${newName}"`,
      data: { originalId: id, newId: newResource.id, newName },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to duplicate data resource' };
  }
}

// Process all actions in a message and return the updated message with results.
// `preParsedActions`, when given, skips extracting actions from `message` text
// entirely, used for native tool calls, which already arrive as structured,
// schema-validated actions (see executor.ts / chatExecution.ts's `toolCalls`
// handling) rather than JSON embedded in the model's text output.
export async function processMessageActions(
  message: string,
  userId?: string,
  adapter?: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = [],
  context?: ExecutionContext,
  preParsedActions?: Action[],
): Promise<{
  originalMessage: string;
  processedMessage: string;
  actionResults: ActionResult[];
  hasActions: boolean;
}> {
  const actions = preParsedActions ?? extractActionsFromMessage(message);

  if (actions.length === 0) {
    return {
      originalMessage: message,
      processedMessage: message,
      actionResults: [],
      hasActions: false
    };
  }

  const actionResults: ActionResult[] = [];

  // Execute actions in order
  for (const action of actions) {
    const result = await executeAction(action, userId, adapter, processId, parentProcessIds, context);
    actionResults.push(result);
  }

  return {
    originalMessage: message,
    processedMessage: message,
    actionResults,
    hasActions: true
  };
}
