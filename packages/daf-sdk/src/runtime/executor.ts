import { generateText } from 'ai';
import { processMessageActions, ActionResult, extractActionsFromMessage, type Action } from './actionProcessor';
import { mergeVariables } from './genericVariables';
import { buildActionTools, annotateActionCatalogWithToolNotes } from './actionTools';
import type { DAFStorageAdapter, ActionConfig, ExecutionContext, UserProviderSettings } from './types';
import type { MessageContentPart } from '../protocol';
import { calculateTokenCost, getModelPricing } from './pricing';
import { resolveDataReferences } from './dataReferences';
import { getModelProvider, getProviderFromModel, applyAnthropicPromptCaching, getNativeReplacedActions, getExcludedActions, buildNativeProviderTools, formatNativeProviderResult, getPreferNativeToolCallInstructions } from './providers';

// Maximum number of steps that can be executed in a single run (prevents infinite loops)
const MAX_STEPS_EXECUTED = 300;

// Thrown when a userFeedback step is hit, bubbles up through the recursion carrying
// the remaining steps that should execute after the user responds.
class PauseSignal {
  remainingSteps: any[];
  question?: string;
  constructor(remaining: any[], question?: string) {
    this.remainingSteps = remaining;
    this.question = question;
  }
}

// Maximum execution time for a single AI model call (1 hour in milliseconds)
const MAX_AI_CALL_TIMEOUT = 60 * 60 * 1000; // 1 hour

function getCacheDiscountRatio(model: string | undefined): number {
  const table = getModelPricing();
  if (!model || !table[model]?.cachedInput) return 1.0;
  const pricing = table[model];
  return pricing.cachedInput! / pricing.input;
}

// Utility function to count words in text
function countWords(text: string): { wordCount: number } {
  if (!text) return { wordCount: 0 };

  // Count words (split by whitespace)
  const words = text.trim().split(/\s+/);
  const wordCount = words.length;

  return { wordCount };
}

// Utility function to calculate duration since last message.
// Returns empty if the last message is older than 10 minutes, that indicates
// a continued/resumed run where the previous message timestamp is stale and
// would produce an enormous, misleading delta.
function calculateDuration(messages: any[]): { durationMs?: number } {
  if (messages.length === 0) return {};

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage.timestamp) return {};

  const lastTimestamp = new Date(lastMessage.timestamp).getTime();
  const durationMs = Date.now() - lastTimestamp;

  if (durationMs > 10 * 60 * 1000) return {}; // stale, skip

  return { durationMs };
}

// Timeout wrapper for AI SDK calls
// Wraps a promise with a timeout to prevent indefinite hanging
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    })
  ]);
}

type AffordabilityCheck = { allowed: boolean; user: any; message?: string; failureReason?: string };

/**
 * Pre-check before a model call: may this user incur further spend? Spend policy
 * (plans, balances, quotas) belongs to the host and is decided by the adapter's
 * checkAffordability hook. Without one, every call is allowed, which is the
 * right default for a self-hosted deployment that doesn't bill.
 *
 * `usingOwnApiKey` tells the host the call runs on the user's own provider key,
 * which a host may exempt from balance checks.
 */
export async function canUserAffordApiCall(
  userId: string,
  adapter: DAFStorageAdapter,
  model?: string,
  usingOwnApiKey?: boolean,
): Promise<AffordabilityCheck> {
  if (!adapter.checkAffordability) {
    return { allowed: true, user: await adapter.getUser(userId) };
  }
  const result = await adapter.checkAffordability(userId, { model, usingOwnApiKey });
  return {
    allowed: result.allowed,
    user: result.user ?? (await adapter.getUser(userId)),
    message: result.message,
    failureReason: result.failureReason,
  };
}

/**
 * Record a call's usage, then re-check spend policy with the updated totals.
 * Usage is always recorded through the adapter; whether the user may continue
 * is the checkAffordability hook's decision, and without one they always may.
 */
export async function checkAndUpdateCostLimit(
  userId: string,
  costUsed: number,
  tokensUsed: number,
  adapter: DAFStorageAdapter,
  authType?: string
): Promise<AffordabilityCheck> {
  await adapter.updateUserUsage(userId, {
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: tokensUsed,
    costUsd: costUsed,
  });

  if (!adapter.checkAffordability) {
    return { allowed: true, user: await adapter.getUser(userId) };
  }
  const result = await adapter.checkAffordability(userId, { estimatedCostUsd: costUsed });
  return {
    allowed: result.allowed,
    user: result.user ?? (await adapter.getUser(userId)),
    message: result.message,
    failureReason: result.failureReason,
  };
}

// Detect circular process references (infinite loops)
async function detectProcessCycle(
  processId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  visitedProcesses: Set<string> = new Set()
): Promise<{ hasCycle: boolean; cyclePath: string[] }> {
  // If we've already visited this process, we found a cycle
  if (visitedProcesses.has(processId)) {
    return { hasCycle: true, cyclePath: [processId] };
  }

  // Add current process to visited set
  visitedProcesses.add(processId);

  // Fetch the process
  const process = await adapter.db.process.findFirst({
    where: { id: processId, userId }
  });

  if (!process || !process.steps) {
    return { hasCycle: false, cyclePath: [] };
  }

  const steps = process.steps as any[];

  // Check each step for process references
  for (const step of steps) {
    if (step.type === 'process' && step.processId) {
      // Recursively check the referenced process
      const result = await detectProcessCycle(
        step.processId,
        userId,
        adapter,
        new Set(visitedProcesses) // Pass a copy to explore all branches
      );

      if (result.hasCycle) {
        // Build the cycle path
        result.cyclePath.unshift(processId);
        return result;
      }
    }
  }

  return { hasCycle: false, cyclePath: [] };
}

// Get accessible resources for a process (from Resource table + inline backward compatibility)
async function getAccessibleResources(
  processId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  parentProcessIds: string[] = []
): Promise<Array<{ id?: string; name: string; type: string; provider: string; url: string }>> {
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

    // Get resources from Resource table using collected resourceIds
    const dbResources = await adapter.db.resource.findMany({
      where: {
        userId,
        id: { in: Array.from(allResourceIds) },
      },
    });

    // Convert to simple format. id is required for resource types addressed by
    // id rather than url (md_file, data, see readMdFile/readData/attachFile).
    const resourcesList = dbResources.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      provider: r.provider,
      url: r.url,
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

// Substitute variables in a text with user's defined variables and generic variables
export async function substituteVariables(
  text: string,
  userId: string,
  adapter: DAFStorageAdapter,
  processId?: string,
  parentProcessIds: string[] = []
): Promise<string> {
  // Find all $VARIABLE patterns
  const variablePattern = /\$([A-Z_][A-Z0-9_]*)/gi;
  const matches = text.match(variablePattern);

  if (!matches || matches.length === 0) {
    return text; // No variables to substitute
  }

  // Fetch user's variables
  const userVariables = await adapter.getUserVariables(userId, processId, parentProcessIds);

  // Merge generic variables with user variables (user variables override generic)
  const variables = mergeVariables(userVariables);

  // Handle $DATETIME variable - inject current timestamp in user's local timezone
  if (text.includes('$DATETIME')) {
    const now = new Date();
    // Format: "November 27, 2025 at 2:30:45 PM GMT-5"
    const currentDateTime = now.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    });
    variables['DATETIME'] = currentDateTime;
    adapter.log.info(`[Variables] Injected $DATETIME with ${currentDateTime}`);
  }

  // Handle $RESOURCES variable if processId is provided
  // Note: This is done before the loop to inject the actual resources
  if (processId && text.includes('$RESOURCES')) {
    const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
    const resourcesJSON = JSON.stringify(resources, null, 2);
    variables['RESOURCES'] = resourcesJSON;
    adapter.log.info(`[Variables] Injected $RESOURCES with ${resources.length} resource(s) (including parent resources)`);
  }

  // Replace variables recursively (up to 10 levels to prevent infinite loops)
  let result = text;
  let previousResult = '';
  let iterations = 0;
  const maxIterations = 10;

  while (result !== previousResult && iterations < maxIterations) {
    previousResult = result;

    // Re-inject dynamic variables on each iteration to handle nested variable substitution
    // This ensures $RESOURCES and $DATETIME get the actual values even when used in other variables
    if (processId && result.includes('$RESOURCES')) {
      const resources = await getAccessibleResources(processId, userId, adapter, parentProcessIds);
      const resourcesJSON = JSON.stringify(resources, null, 2);
      variables['RESOURCES'] = resourcesJSON;
      if (iterations === 0) {
        adapter.log.info(`[Variables] Re-injected $RESOURCES for nested substitution`);
      }
    }

    if (result.includes('$DATETIME')) {
      const now = new Date();
      const currentDateTime = now.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });
      variables['DATETIME'] = currentDateTime;
      if (iterations === 0) {
        adapter.log.info(`[Variables] Re-injected $DATETIME for nested substitution`);
      }
    }

    // Replace each $VARIABLE with its value
    const currentMatches = result.match(variablePattern);
    if (!currentMatches) break;

    for (const match of currentMatches) {
      const varName = match.substring(1); // Remove the $
      const value = variables[varName];

      if (value !== undefined) {
        // Replace all occurrences of this variable
        result = result.replace(new RegExp(`\\$${varName}`, 'g'), value);
        if (iterations === 0) {
          adapter.log.info(`[Variables] Substituted $${varName} with value`);
        }
      } else {
        if (iterations === 0) {
          adapter.log.warn(`[Variables] Variable $${varName} not found, keeping placeholder`);
        }
      }
    }

    iterations++;
  }

  if (iterations >= maxIterations) {
    adapter.log.warn(`[Variables] Reached maximum iteration limit (${maxIterations}), possible circular reference`);
  }

  return result;
}

// Builds a hidden, UI-suppressed message carrying an action result's real file
// bytes as a native AI SDK content-part array, so future generateText calls in
// this run see the actual image/PDF instead of only a one-shot text
// description. Returns null when the action result didn't request live
// injection (ActionResult.data.injectLive unset, the default for every
// existing action, and for attachFile on unsupported providers/oversized files).
export function buildFileAttachmentMessage(actionResult: ActionResult, indexPath?: number[]): any | null {
  const d = actionResult.data;
  if (!d?.injectLive || !d?.rawContent || !d?.mediaType) return null;

  const content: MessageContentPart[] = [
    { type: 'text', text: `[Attached file: ${d.name || d.id}]` },
    { type: 'file', data: d.rawContent, mediaType: d.mediaType },
  ];
  const msg: any = {
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    isFileAttachment: true, // hidden from chat UI, NOT excluded from the messages sent to the model
    sourceActionId: d.id,
  };
  indexPath?.forEach((idx, level) => {
    msg[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
  });
  return msg;
}

// Format action result for display in chat
export function formatActionResult(actionResult: ActionResult): string {
  if (actionResult.success) {
    let resultText = actionResult.message || 'Action completed successfully';

    // Skip data details for editor action results, these are internal metadata
    if (actionResult.data?.isEditorActionResult) {
      return resultText;
    }

    // Add data details if present (including empty strings)
    if (actionResult.data !== undefined && actionResult.data !== null) {
      // For scrape actions with JSON extraction
      if (actionResult.data.json) {
        resultText += '\n\n**Extracted Data:**\n';
        resultText += '```json\n';
        resultText += JSON.stringify(actionResult.data.json, null, 2);
        resultText += '\n```';
      }

      // For scrape actions with markdown content
      if (actionResult.data.markdown) {
        resultText += '\n\n**Content:**\n';
        resultText += actionResult.data.markdown;
      }

      // For scrape actions with HTML
      if (actionResult.data.html && !actionResult.data.markdown) {
        resultText += '\n\n**HTML Content:**\n';
        // Truncate HTML if too long
        const htmlContent = actionResult.data.html;
        if (htmlContent.length > 2000) {
          resultText += htmlContent.substring(0, 2000) + '\n...(truncated)';
        } else {
          resultText += htmlContent;
        }
      }

      // For scrape actions with links
      if (actionResult.data.links && Array.isArray(actionResult.data.links)) {
        resultText += '\n\n**Links found:**\n';
        actionResult.data.links.forEach((link: string) => {
          resultText += `- ${link}\n`;
        });
      }

      // For scrape actions with screenshots
      if (actionResult.data.screenshot) {
        resultText += '\n\n**Screenshot:** ' + actionResult.data.screenshot;
      }

      // For scrape actions with summary
      if (actionResult.data.summary) {
        resultText += '\n\n**Summary:**\n' + actionResult.data.summary;
      }

      // For actions with screenshots from page interactions
      if (actionResult.data.actions) {
        const actionsResult = actionResult.data.actions as any;
        if (actionsResult.screenshots && Array.isArray(actionsResult.screenshots)) {
          resultText += '\n\n**Screenshots from actions:**\n';
          actionsResult.screenshots.forEach((screenshot: string, index: number) => {
            resultText += `${index + 1}. ${screenshot}\n`;
          });
        }
        if (actionsResult.scrapes && Array.isArray(actionsResult.scrapes)) {
          resultText += '\n\n**Additional scrapes from actions:**\n';
          actionsResult.scrapes.forEach((scrape: any, index: number) => {
            resultText += `${index + 1}. ${scrape.url}\n`;
          });
        }
      }

      // For search actions, show search results
      if (actionResult.data.web || actionResult.data.images || actionResult.data.news) {
        resultText += '\n\n';

        if (actionResult.data.web && actionResult.data.web.length > 0) {
          resultText += '**Web Results:**\n';
          actionResult.data.web.forEach((result: any, index: number) => {
            resultText += `${index + 1}. **${result.title}**\n`;
            resultText += `   ${result.url}\n`;
            if (result.description) {
              resultText += `   ${result.description}\n`;
            }
            if (result.category) {
              resultText += `   Category: ${result.category}\n`;
            }

            // If search result includes scraped content
            if (result.markdown) {
              resultText += `\n${result.markdown}\n`;
            }

            resultText += '\n';
          });
        }

        if (actionResult.data.images && actionResult.data.images.length > 0) {
          resultText += '\n**Image Results:**\n';
          actionResult.data.images.forEach((result: any, index: number) => {
            resultText += `${index + 1}. ${result.title || 'Image'}\n`;
            resultText += `   ${result.imageUrl}\n`;
            if (result.imageWidth && result.imageHeight) {
              resultText += `   Size: ${result.imageWidth}x${result.imageHeight}\n`;
            }
            resultText += '\n';
          });
        }

        if (actionResult.data.news && actionResult.data.news.length > 0) {
          resultText += '\n**News Results:**\n';
          actionResult.data.news.forEach((result: any, index: number) => {
            resultText += `${index + 1}. **${result.title}**\n`;
            resultText += `   ${result.url}\n`;
            if (result.snippet) {
              resultText += `   ${result.snippet}\n`;
            }
            if (result.date) {
              resultText += `   Date: ${result.date}\n`;
            }
            if (result.markdown) {
              resultText += `\n${result.markdown}\n`;
            }
            resultText += '\n';
          });
        }
      }

      // For crawl actions, show job status and configuration
      if (actionResult.data.jobId) {
        resultText += '\n\n**Crawl Job Details:**\n';
        resultText += `Job ID: ${actionResult.data.jobId}\n`;
        resultText += `Status: ${actionResult.data.status || 'pending'}\n`;
        resultText += `URL: ${actionResult.data.crawlUrl || actionResult.data.url || 'N/A'}\n`;

        if (actionResult.data.total !== undefined) {
          resultText += `\n**Progress:**\n`;
          resultText += `Completed: ${actionResult.data.completed || 0}/${actionResult.data.total} pages\n`;
          if (actionResult.data.creditsUsed) {
            resultText += `Credits Used: ${actionResult.data.creditsUsed}\n`;
          }
          if (actionResult.data.expiresAt) {
            resultText += `Expires: ${actionResult.data.expiresAt}\n`;
          }
        }

        if (actionResult.data.configuration) {
          resultText += `\n**Configuration:**\n`;
          const config = actionResult.data.configuration;
          if (config.limit) resultText += `Max Pages: ${config.limit}\n`;
          if (config.maxDepth) resultText += `Max Depth: ${config.maxDepth}\n`;
          if (config.allowSubdomains) resultText += `Allow Subdomains: Yes\n`;
          if (config.crawlEntireDomain) resultText += `Crawl Entire Domain: Yes\n`;
          if (config.includePaths) resultText += `Include Paths: ${config.includePaths.join(', ')}\n`;
          if (config.excludePaths) resultText += `Exclude Paths: ${config.excludePaths.join(', ')}\n`;
          if (config.webhook) resultText += `Webhook: Enabled\n`;
        }

        // Show crawled page data if available
        if (actionResult.data.data && Array.isArray(actionResult.data.data)) {
          resultText += `\n**Crawled Pages (${actionResult.data.data.length}):**\n`;
          actionResult.data.data.slice(0, 10).forEach((page: any, index: number) => {
            if (page.metadata && page.metadata.sourceURL) {
              resultText += `${index + 1}. ${page.metadata.sourceURL}\n`;
              if (page.metadata.title) {
                resultText += `   Title: ${page.metadata.title}\n`;
              }
              if (page.metadata.statusCode) {
                resultText += `   Status: ${page.metadata.statusCode}\n`;
              }
            }
          });
          if (actionResult.data.data.length > 10) {
            resultText += `\n...(${actionResult.data.data.length - 10} more pages)\n`;
          }
        }

        if (actionResult.data.next) {
          resultText += `\n**Next Page:** Use the provided URL to fetch more results\n`;
        }
      }

      // For MD file read actions, show content with label, matching readDocument pattern.
      // A file with a stated description (a purpose, "use this when...") reads as
      // instructions; a plain file with no description is just content.
      if (actionResult.data && typeof actionResult.data === 'object' &&
        'id' in actionResult.data && 'content' in actionResult.data) {
        resultText += actionResult.data.hasDescription ? '\n\nInstructions:\n' : '\n\nContent:\n';
        if (actionResult.data.content) {
          resultText += actionResult.data.content;
        }
      }
      // For MD file write/create/delete/rename/duplicate, message is sufficient
      else if (actionResult.data && typeof actionResult.data === 'object' &&
        ('id' in actionResult.data || 'oldId' in actionResult.data || 'originalId' in actionResult.data)) {
        // no extra output needed
      }
      // For document read actions (Google Docs, Notion), show content with label
      else if (actionResult.data && typeof actionResult.data === 'object' &&
        'content' in actionResult.data &&
        (actionResult.data.documentId || actionResult.data.pageId)) {
        if (actionResult.data.title) {
          resultText += '\n\nTitle:\n' + actionResult.data.title;
        }
        resultText += '\n\nContent:\n';
        if (actionResult.data.content) {
          resultText += actionResult.data.content;
        }
      }
      // For document write/append actions (Google Docs, Notion)
      else if (actionResult.data && actionResult.data.resourceName &&
        (actionResult.data.documentId || actionResult.data.pageId) &&
        actionResult.data.mode) {
        const docType = actionResult.data.documentId ? 'Google Doc' : 'Notion page';
        const docUrl = actionResult.data.documentId
          ? `https://docs.google.com/document/d/${actionResult.data.documentId}/edit`
          : actionResult.data.pageId
            ? `https://notion.so/${actionResult.data.pageId.replace(/-/g, '')}`
            : null;

        if (docUrl) {
          resultText += `\n\n[Open ${actionResult.data.resourceName}](${docUrl})`;
        }
      }
      // For document format actions (Google Docs)
      else if (actionResult.data && actionResult.data.documentId &&
        actionResult.data.formatting && actionResult.data.resourceName) {
        const docUrl = `https://docs.google.com/document/d/${actionResult.data.documentId}/edit`;
        resultText += `\n\n[Open ${actionResult.data.resourceName}](${docUrl})`;
      }
      // For email send actions, show simplified details
      else if (actionResult.data && (actionResult.data.messageId || actionResult.data.sent)) {
        // Handle multiple recipients case
        if (actionResult.data.total && actionResult.data.sent) {
          resultText += '\n\n**Email Summary:**\n';
          resultText += `✓ Sent: ${actionResult.data.sent.length}\n`;
          if (actionResult.data.skipped && actionResult.data.skipped.length > 0) {
            resultText += `⊘ Skipped (not confirmed): ${actionResult.data.skipped.length}\n`;
          }
          if (actionResult.data.failed && actionResult.data.failed.length > 0) {
            resultText += `✗ Failed: ${actionResult.data.failed.length}\n`;
          }

          if (actionResult.data.sent.length > 0) {
            resultText += `\n**Delivered to:**\n`;
            actionResult.data.sent.forEach((email: string) => {
              resultText += `- ${email}\n`;
            });
          }

          if (actionResult.data.skipped && actionResult.data.skipped.length > 0) {
            resultText += `\n**Pending confirmation:**\n`;
            actionResult.data.skipped.forEach((email: string) => {
              resultText += `- ${email} (confirmation email sent)\n`;
            });
          }

          if (actionResult.data.failed && actionResult.data.failed.length > 0) {
            resultText += `\n**Failed:**\n`;
            actionResult.data.failed.forEach((email: string) => {
              resultText += `- ${email}\n`;
            });
          }
        }
        // Handle single recipient case
        else if (actionResult.data.to) {
          resultText += '\n\n**Email Details:**\n';
          resultText += `To: ${actionResult.data.to}\n`;
          if (actionResult.data.subject) {
            resultText += `Subject: ${actionResult.data.subject}\n`;
          }
          if (actionResult.data.accepted && actionResult.data.accepted.length > 0) {
            resultText += `Status: ✓ Delivered successfully\n`;
          }
          if (actionResult.data.rejected && actionResult.data.rejected.length > 0) {
            resultText += `Some recipients rejected: ${actionResult.data.rejected.join(', ')}\n`;
          }
          if (actionResult.data.skipped) {
            resultText += `Status: ⊘ Skipped - waiting for confirmation\n`;
          }
        }
      }
      // For simple string data (like URLs from duplicate/rename actions or page content), show with label
      else if (typeof actionResult.data === 'string') {
        // If it looks like page content (from read actions), add Content: label
        if (actionResult.message &&
          (actionResult.message.includes('read') || actionResult.message.includes('Read')) &&
          (actionResult.data === '' || !actionResult.data.startsWith('http'))) {
          resultText += '\n\nContent:\n';
          if (actionResult.data) {
            resultText += actionResult.data;
          }
        } else {
          resultText += `\n\n${actionResult.data}`;
        }
      }
      // readMdFile / readDocument (Google Docs, Notion), always surface the actual
      // content, even though these results also carry an id-like field (id,
      // documentId, pageId) that would otherwise make the generic fallback below
      // skip rendering entirely, silently hiding the retrieved text from the model
      else if (actionResult.data && typeof actionResult.data.content === 'string') {
        resultText += '\n\nContent:\n';
        resultText += actionResult.data.content;
      }
      // DB insert, message already contains the inserted ID
      else if (actionResult.data && 'insertedId' in actionResult.data) {
        // message is sufficient ("Document inserted with id xxx"), no extra data needed
      }
      // DB update, message already contains matched/modified counts
      else if (actionResult.data && 'modifiedCount' in actionResult.data) {
        if (actionResult.data.upsertedId) {
          resultText += `\n\nInserted new document with id ${actionResult.data.upsertedId}`;
        }
      }
      // DB delete, message already contains deleted count
      else if (actionResult.data && 'deletedCount' in actionResult.data) {
        // message is sufficient
      }
      // DB find / aggregate, show documents in a readable list
      else if (actionResult.data && 'documents' in actionResult.data && Array.isArray(actionResult.data.documents)) {
        const docs = actionResult.data.documents as any[];
        if (docs.length === 0) {
          resultText += '\n\nNo documents found.';
        } else {
          resultText += '\n\n**Documents:**\n';
          docs.forEach((doc: any, i: number) => {
            resultText += `\n**${i + 1}.** `;
            const { _id, ...rest } = doc;
            if (_id) resultText += `\`${_id}\` `;
            const fields = Object.entries(rest).map(([k, v]) =>
              `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`
            ).join(' · ');
            resultText += fields;
          });
        }
      }
      // runCode / runShell, `message` is just "Code executed successfully (Nms)",
      // it never contains the script's actual output. Without this, the model has
      // no way to know what its own console.log()/print output actually was, it
      // was confirmed fabricating plausible-looking success JSON (fake ids included)
      // for runCode calls whose real result it never saw, silently inserting
      // nothing while reporting success.
      else if (actionResult.data && 'exitCode' in actionResult.data) {
        const stdout = (actionResult.data.stdout || '').trim();
        const stderr = (actionResult.data.stderr || '').trim();
        if (stdout) {
          resultText += '\n\n**Output:**\n```\n' + stdout + '\n```';
        }
        if (stderr) {
          resultText += '\n\n**Stderr:**\n```\n' + stderr + '\n```';
        }
      }
      // For extract actions or any other JSON data without specific formatting
      // Skip rendering if data only contains internal flags like 'skipped'
      else if (actionResult.data &&
        !actionResult.data.json &&
        !actionResult.data.markdown &&
        !actionResult.data.html &&
        !actionResult.data.web &&
        !actionResult.data.news &&
        !actionResult.data.images &&
        !actionResult.data.links &&
        !actionResult.data.screenshot &&
        !actionResult.data.summary &&
        !actionResult.data.actions &&
        !actionResult.data.metadata &&
        !actionResult.data.jobId &&
        !actionResult.data.documentId &&
        !actionResult.data.pageId &&
        !actionResult.data.messageId &&
        !actionResult.data.domainSummary &&
        !actionResult.data.skipped &&
        !actionResult.data.id &&
        !actionResult.data.oldId &&
        !actionResult.data.originalId) {
        resultText += '\n\n**Data:**\n';
        resultText += '```json\n';
        resultText += JSON.stringify(actionResult.data, null, 2);
        resultText += '\n```';
      }
    }

    // Add truncation notice at the very end if content was truncated
    if (actionResult.data && actionResult.data.truncated && actionResult.data.originalWordCount) {
      resultText += `\n\n**[Very long result, cut off after 7500 words]**`;
    }

    return resultText;
  } else {
    // Format errors more clearly. actionResult.error is often just a bare
    // summary (e.g. "Script exited with code 1"), the actual diagnostic detail
    // (the real exception, stack trace, or stderr output) lives in data.stdout/
    // data.stderr when the host adapter provides it. Without surfacing that, the
    // model has nothing to diagnose the failure from and just retries blind.
    let resultText = `Action failed: ${actionResult.error || 'Unknown error'}`;
    const data = actionResult.data as any;
    if (data?.stderr) {
      resultText += `\n\nstderr:\n${String(data.stderr)}`;
    }
    if (data?.stdout) {
      resultText += `\n\nstdout:\n${String(data.stdout)}`;
    }
    return resultText;
  }
}

// Helper function to check if loop should stop based on stopOn conditions
function shouldStopLoop(
  step: any,
  loopIteration: number,
  lastResponseText: string | null
): { shouldStop: boolean; reason?: string } {
  // Only check stopOn conditions if loopType is 'stopOn'
  if (step.loopType !== 'stopOn') {
    return { shouldStop: false };
  }

  // Check Max Loops condition
  const maxLoops = step.stopOnMaxLoops || 5;
  if (loopIteration >= maxLoops) {
    return {
      shouldStop: true,
      reason: `Maximum loops reached (${maxLoops})`
    };
  }

  // Check Keyword condition
  if (step.stopOnKeyword && lastResponseText) {
    const keyword = step.stopOnKeyword.trim();
    if (keyword && lastResponseText.includes(keyword)) {
      return {
        shouldStop: true,
        reason: `Keyword "${keyword}" detected in response`
      };
    }
  }

  return { shouldStop: false };
}

// Helper function to check if process should stop based on stopProcessKeyword
function shouldStopProcess(
  ownKeyword: string | null | undefined,
  parentKeywords: (string | null | undefined)[],
  lastResponseText: string | null
): { shouldStop: boolean; reason?: string; isParentKeyword: boolean } {
  if (!lastResponseText) {
    return { shouldStop: false, reason: undefined, isParentKeyword: false };
  }

  // First check parent keywords (these should stop everything)
  const validParentKeywords = parentKeywords.filter(k => k && k.trim());
  for (const keyword of validParentKeywords) {
    const trimmedKeyword = keyword!.trim();
    if (trimmedKeyword && lastResponseText.includes(trimmedKeyword)) {
      return {
        shouldStop: true,
        reason: `Stop process keyword "${trimmedKeyword}" detected in response`,
        isParentKeyword: true
      };
    }
  }

  // Then check own keyword (only stops this process level)
  if (ownKeyword && ownKeyword.trim()) {
    const trimmedKeyword = ownKeyword.trim();
    if (lastResponseText.includes(trimmedKeyword)) {
      return {
        shouldStop: true,
        reason: `Stop process keyword "${trimmedKeyword}" detected in response`,
        isParentKeyword: false
      };
    }
  }

  return { shouldStop: false, reason: undefined, isParentKeyword: false };
}

// Maximum nesting depth for process references (prevents excessive recursion)
const MAX_NESTING_DEPTH = 10;

// Recursive helper function to execute a single step with support for nested processes at any depth
async function executeStepRecursively(
  step: any,
  stepIndex: number,
  totalSteps: number,
  indexPath: number[], // Array tracking the step index at each nesting level [i, j, k, ...]
  depth: number,
  userId: string,
  adapter: DAFStorageAdapter,
  processId: string, // Current process ID
  parentProcessIds: string[], // Array of parent process IDs for resource inheritance
  modelOverride: string,
  messages: any[],
  saveAndEmitMessages: () => Promise<void>,
  totalStepsExecuted: { count: number },
  hasError: { value: boolean },
  errorMessage: { text: string | null },
  runId: string,
  tokenUsageRef: { prompt: number; completion: number; total: number; cachedPromptTokens: number; reasoningTokens: number },
  lastAiResponseRef: { text: string | null }, // Add reference to track last AI response across nested calls
  shouldStopLoopRef: { value: boolean; keyword?: string }, // Add reference to signal when stopOn loop should stop
  shouldStopProcessRef: { value: boolean }, // Add reference to signal when this process level should stop
  detectedStopKeyword: { value: string | null }, // Track which parent keyword was detected to stop only affected processes
  parentStopOnKeyword: string | null, // Keyword from parent stopOn loop (if any)
  ownStopProcessKeyword: string | null | undefined, // This process's own stop keyword
  parentStopProcessKeywords: (string | null | undefined)[], // Array of parent process stop keywords
  processes?: any[], // Optional: pass processes array for better logging
  userProviderSettings?: UserProviderSettings | null, // User's BYOK configuration
  authType?: string, // Auth type for tracking last used timestamp
  editorContext?: boolean, // Whether execution is in the Editor app
  isChatContext?: boolean, // Whether execution is inside the Chat app
  customActionHandler?: ExecutionContext['customActionHandler'] // Generic host action override
): Promise<void> {
  // Check max nesting depth
  if (depth > MAX_NESTING_DEPTH) {
    const errorMsg = `Maximum nesting depth (${MAX_NESTING_DEPTH}) exceeded. Possible infinite recursion detected.`;
    adapter.log.error(errorMsg);
    hasError.value = true;
    errorMessage.text = errorMsg;
    messages.push({
      role: 'assistant',
      source: 'prism',
      content: errorMsg,
      timestamp: new Date().toISOString(),
      error: true
    });
    await saveAndEmitMessages();
    return;
  }

  // Create logging prefix based on depth
  const depthPrefix = depth === 0 ? 'Step' : `${'Nested '.repeat(depth)}Step`;
  const indexStr = indexPath.map((idx, i) => idx + 1).join('.');

  // Determine loop behavior based on loopType
  const loopType = step.loopType || 'fixed';
  const loopCount = loopType === 'fixed' ? (step.forLoopCount || 1) : (step.stopOnMaxLoops || 5);

  // Determine which stopOnKeyword to check for (current step or inherited from parent)
  const activeStopOnKeyword = (loopType === 'stopOn' && step.stopOnKeyword) ? step.stopOnKeyword : parentStopOnKeyword;

  if (loopType === 'fixed' && loopCount > 1) {
    adapter.log.info(`[${depthPrefix} ${indexStr}] Processing with fixed loop (${loopCount} iterations)...`);
  } else if (loopType === 'stopOn') {
    adapter.log.info(`[${depthPrefix} ${indexStr}] Processing with stopOn (max ${loopCount} iterations, keyword: "${step.stopOnKeyword || 'none'}")...`);
  }

  // Execute the step with loop support
  let loopIteration = 0;
  let shouldContinueLoop = true;

  while (shouldContinueLoop && loopIteration < loopCount) {
    if (loopCount > 1 || loopType === 'stopOn') {
      adapter.log.info(`[${depthPrefix} ${indexStr}] Loop iteration ${loopIteration + 1}/${loopType === 'stopOn' ? `max ${loopCount}` : loopCount}`);
    }

    // Track total steps executed (for loop counting)
    totalStepsExecuted.count++;

    if (totalStepsExecuted.count > MAX_STEPS_EXECUTED) {
      const errorMsg = `EXECUTION LIMIT EXCEEDED! Process executed ${totalStepsExecuted.count} steps (limit: ${MAX_STEPS_EXECUTED}). Stopping to prevent infinite loop.`;
      adapter.log.error(errorMsg);
      hasError.value = true;
      errorMessage.text = errorMsg;

      messages.push({
        role: 'assistant',
        source: 'prism',
        content: errorMsg,
        timestamp: new Date().toISOString(),
        error: true
      });
      await saveAndEmitMessages();
      return;
    }

    // Check if run has been aborted
    const runStatus = await adapter.db.run.findUnique({
      where: { id: runId },
      select: { status: true }
    });

    if (runStatus?.status === 'ABORTED') {
      adapter.log.info(`Run ${runId} has been aborted at depth ${depth}, stopping execution`);
      hasError.value = true;
      errorMessage.text = 'Run stopped by user';
      return;
    }

    // Check if this step is a process reference (recursive case)
    try {
      if (step.type === 'userFeedback') {
        adapter.log.info(`[${depthPrefix} ${indexStr}] Pausing for user input (userFeedback step)`);
        const feedbackQuestion = (step as any).prompt || (step as any).question || undefined;
        if (feedbackQuestion) {
          messages.push({
            role: 'assistant',
            source: 'prism',
            content: feedbackQuestion,
            timestamp: new Date().toISOString(),
            isUserFeedbackPrompt: true,
          });
          await saveAndEmitMessages();
        }
        throw new PauseSignal([], feedbackQuestion);
      } else if (step.type === 'process' && step.processId) {
        adapter.log.info(`[${depthPrefix} ${indexStr}] This is a process reference: ${step.processId}, inlining recursively at depth ${depth + 1}`);

        // Fetch the referenced process
        const referencedProcess = await adapter.db.process.findFirst({
          where: {
            id: step.processId,
            userId: userId
          }
        });

        if (!referencedProcess) {
          throw new Error(`Referenced process not found: ${step.processId}`);
        }

        const referencedSteps = (referencedProcess.steps as any[]) || [];
        adapter.log.info(`[${depthPrefix} ${indexStr}] Inlining ${referencedSteps.length} steps from process: ${referencedProcess.name} at depth ${depth + 1}`);

        // Add a header message indicating we're starting the referenced process
        const processStartMessage: any = {
          role: 'system',
          source: 'prism',
          content: `--- Starting ${depth > 0 ? 'nested ' : ''}process: ${referencedProcess.name} ---`,
          timestamp: new Date().toISOString(),
          isProcessReference: true,
          referencedProcessId: step.processId,
          depth: depth + 1
        };

        // Add index path to message
        indexPath.forEach((idx, level) => {
          processStartMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
        });

        messages.push(processStartMessage);
        await saveAndEmitMessages();

        // Build parent keywords array for child: current parent list + this process's own keyword
        const childParentKeywords = [...parentStopProcessKeywords];
        if (ownStopProcessKeyword) {
          childParentKeywords.push(ownStopProcessKeyword);
        }

        // Create a new shouldStopProcessRef for the child process
        const childShouldStopProcessRef = { value: false };

        // Recursively execute each step from the referenced process
        for (let j = 0; j < referencedSteps.length; j++) {
          const nestedStep = referencedSteps[j];
          const newIndexPath = [...indexPath, j];

          try {
            await executeStepRecursively(
              nestedStep,
              j,
              referencedSteps.length,
              newIndexPath,
              depth + 1,
              userId,
              adapter,
              step.processId, // Use nested process's ID so it gets its own resources
              [processId, ...parentProcessIds], // Pass current processId as parent
              modelOverride,
              messages,
              saveAndEmitMessages,
              totalStepsExecuted,
              hasError,
              errorMessage,
              runId,
              tokenUsageRef,
              lastAiResponseRef, // Pass the reference so nested processes can update it
              shouldStopLoopRef, // Pass the reference so nested processes can signal stop
              childShouldStopProcessRef, // Pass child's own stop flag
              detectedStopKeyword, // Pass the detected keyword reference
              activeStopOnKeyword, // Pass down the stopOnKeyword from parent loop
              referencedProcess.stopProcessKeyword, // Child's own stop keyword
              childParentKeywords, // Parent keywords (original parents + current process)
              processes,
              userProviderSettings, // Pass user's BYOK configuration
              authType, // Pass auth type for last used tracking
              editorContext, // Pass editor context flag
              isChatContext, // Pass chat context flag
              customActionHandler // Pass generic host action override
            );
          } catch (e) {
            if (e instanceof PauseSignal) {
              // Add remaining nested steps from the current iteration
              e.remainingSteps = [...e.remainingSteps, ...referencedSteps.slice(j + 1)];
              throw e;
            }
            throw e;
          }

          // If error occurred, stop execution
          if (hasError.value) {
            return;
          }

          // If a parent keyword was detected and it's MY keyword, I should also stop
          if (detectedStopKeyword.value && ownStopProcessKeyword && detectedStopKeyword.value === ownStopProcessKeyword) {
            shouldStopProcessRef.value = true;
            return;
          }

          // If child process should stop, break out of the loop
          if (childShouldStopProcessRef.value) {
            break;
          }

          // Check if we should stop looping due to stopOn keyword detected
          // This allows early exit from the iteration when keyword is found
          if (loopType === 'stopOn' && step.stopOnKeyword) {
            const stopCheck = shouldStopLoop(step, loopIteration, lastAiResponseRef.text);
            if (stopCheck.shouldStop) {
              adapter.log.info(`[${depthPrefix} ${indexStr}] Keyword detected during nested process, stopping iteration early`);
              // We'll break out of this nested process execution
              // and the loop check at the end will handle the stop message
              break;
            }
          }
        }

        // Add a footer message indicating process is complete
        const processEndMessage: any = {
          role: 'system',
          source: 'prism',
          content: `--- Completed ${depth > 0 ? 'nested ' : ''}process: ${referencedProcess.name} ---`,
          timestamp: new Date().toISOString(),
          isProcessReference: true,
          referencedProcessId: step.processId,
          depth: depth + 1
        };

        // Add index path to message
        indexPath.forEach((idx, level) => {
          processEndMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
        });

        messages.push(processEndMessage);
        await saveAndEmitMessages();

        adapter.log.info(`[${depthPrefix} ${indexStr}] Completed inlining process: ${referencedProcess.name}`);
      } else {
        // Base case: execute regular prompt step (or completionWithoutPrompt step)
        const isCompletionOnly = step.type === 'completionWithoutPrompt';
        let userMessageContent = isCompletionOnly ? '' : (step.userMessage || step.prompt || '');
        if (!isCompletionOnly) {
          userMessageContent = await substituteVariables(userMessageContent, userId, adapter, processId, parentProcessIds);

          // $<resource id> references to data resources: send the actual file
          // with this prompt (see dataReferences.ts). Throws with a clear
          // message when this step's model can't read the referenced type.
          const refs = await resolveDataReferences(userMessageContent, {
            userId, adapter, model: modelOverride || 'gpt-5.1 (non reasoning)',
            processId, parentProcessIds, existingMessages: messages,
          });
          if (refs.attachmentMessages.length > 0) {
            userMessageContent = refs.text;
            for (const attachment of refs.attachmentMessages) {
              indexPath.forEach((idx, level) => {
                attachment[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
              });
              messages.push(attachment);
            }
          } else {
            userMessageContent = refs.text;
          }
        }

        let userActionResult: any = { hasActions: false, actionResults: [] };
        let actionsHandled = false;

        if (!isCompletionOnly) {
          adapter.log.info(`[${depthPrefix} ${indexStr}] User message length: ${userMessageContent.length}`);

          // Extract actions from user message (without executing) to check if there are any
          const extractedActions = extractActionsFromMessage(userMessageContent);

          // Add user message to conversation
          const userMessage: any = {
            role: 'user',
            content: userMessageContent,
            timestamp: new Date().toISOString(),
            ...countWords(userMessageContent),
            ...calculateDuration(messages)
          };

          // If there are executable actions, mark the message before emitting
          if (extractedActions.length > 0) {
            userMessage.hasExecutableActions = true;
          }

          // Add index path to message
          indexPath.forEach((idx, level) => {
            userMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
          });

          messages.push(userMessage);
          await saveAndEmitMessages();

          // Now process and execute the actions.
          // editorContext enables editor-only actions; isChatContext enables chat-only actions.
          // Context is undefined when neither flag is set, which causes editor/chat-only actions to fail gracefully.
          // customActionHandler is threaded through regardless of those flags, it's
          // a generic host override, not an editor/chat-only capability.
          const userStepModel = modelOverride || 'gpt-5.1 (non reasoning)';
          const userStepContext: ExecutionContext | undefined = (editorContext || isChatContext) ? {
            model: userStepModel,
            modelProvider: getModelProvider(userStepModel, userProviderSettings),
            isChatContext: !!isChatContext,
            customActionHandler,
          } : (customActionHandler ? {
            model: userStepModel,
            modelProvider: getModelProvider(userStepModel, userProviderSettings),
            customActionHandler,
          } : undefined);
          userActionResult = await processMessageActions(userMessageContent, userId, adapter, processId, parentProcessIds, userStepContext);

          if (userActionResult.hasActions && userActionResult.actionResults.length > 0) {
            adapter.log.info(`[${depthPrefix} ${indexStr}] Executing ${userActionResult.actionResults.length} action(s), SKIPPING LLM`);

            for (const actionResult of userActionResult.actionResults) {
              const formattedResult = formatActionResult(actionResult);
              const prismMessage: any = {
                role: 'assistant',
                source: 'prism',
                content: formattedResult,
                timestamp: new Date().toISOString(),
                isActionResult: true,
                actionResult: actionResult,
                ...countWords(formattedResult),
                ...calculateDuration(messages)
              };

              // Add index path to message
              indexPath.forEach((idx, level) => {
                prismMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
              });

              messages.push(prismMessage);
              await saveAndEmitMessages();

              const fileAttachmentMessage = buildFileAttachmentMessage(actionResult, indexPath);
              if (fileAttachmentMessage) {
                messages.push(fileAttachmentMessage);
                await saveAndEmitMessages();
              }
            }

            // If any action requested a pause for user input, trigger PauseSignal after saving results
            if (userActionResult.actionResults.some((r: any) => r.pauseForInput)) {
              const pausingAction = userActionResult.actionResults.find((r: any) => r.pauseForInput);
              throw new PauseSignal([], pausingAction?.message || undefined);
            }

            adapter.log.info(`[${depthPrefix} ${indexStr}] Completed - executed action(s), skipped LLM`);
            actionsHandled = true;
          } else if (step.skipCompletion) {
            // Skip LLM completion if skipCompletion flag is set
            adapter.log.info(`[${depthPrefix} ${indexStr}] skipCompletion flag is set, skipping LLM call and proceeding to next step`);
            actionsHandled = true;
          }
        }

        if (isCompletionOnly || !actionsHandled) {
          if (isCompletionOnly) {
            adapter.log.info(`[${depthPrefix} ${indexStr}] completionWithoutPrompt, calling LLM with current conversation context`);
          }
          // No actions / completionWithoutPrompt: call LLM
          const llmCallStartTime = Date.now();
          const llmCallTimestamp = new Date().toISOString();
          adapter.log.info(`[${depthPrefix} ${indexStr}] No actions detected, calling LLM`);
          console.log(`[${llmCallTimestamp}] [${depthPrefix} ${indexStr}] Starting LLM call...`);

          const modelName = modelOverride || 'gpt-5.1 (non reasoning)';

          // Determine if we're using the user's own API key or the platform's
          const providerType = getProviderFromModel(modelName);
          let usingUserApiKey = false;
          if (userProviderSettings) {
            switch (providerType) {
              case 'openai':
                usingUserApiKey = userProviderSettings.useOpenaiKey && !!userProviderSettings.openaiApiKey;
                break;
              case 'anthropic':
                usingUserApiKey = userProviderSettings.useAnthropicKey && !!userProviderSettings.anthropicApiKey;
                break;
              case 'mistral':
                usingUserApiKey = userProviderSettings.useMistralKey && !!userProviderSettings.mistralApiKey;
                break;
              case 'google':
                usingUserApiKey = userProviderSettings.useGoogleKey && !!userProviderSettings.googleApiKey;
                break;
              case 'xai':
                usingUserApiKey = userProviderSettings.useXaiKey && !!userProviderSettings.xaiApiKey;
                break;
              case 'deepseek':
                usingUserApiKey = userProviderSettings.useDeepseekKey && !!userProviderSettings.deepseekApiKey;
                break;
            }
          }

          // PRE-CHECK: host spend policy, for every call (own keys or platform keys)
          const preCheck = await canUserAffordApiCall(userId, adapter, modelName, usingUserApiKey);
          if (!preCheck.allowed) {
            adapter.log.warn(`User ${userId} has reached their monthly Plan Allowance`);

            await adapter.db.schedule.updateMany({
              where: { userId },
              data: { status: 'PAUSED' }
            });

            if (preCheck.user) {
              await adapter.onMonthlyLimitReached?.(userId, preCheck.user);
            }

            const errorMsg = preCheck.message || 'Monthly Plan Allowance reached';
            adapter.log.error(errorMsg);
            hasError.value = true;
            errorMessage.text = errorMsg;

            messages.push({
              role: 'assistant',
              source: 'prism',
              content: errorMsg,
              timestamp: new Date().toISOString(),
              error: true
            });
            await saveAndEmitMessages();
            return;
          }

          const modelProvider = getModelProvider(modelName, userProviderSettings);

          // Filter out process reference messages (nested process start/end markers) from LLM context
          // These are only for UI display, not for the LLM
          let llmMessages = messages.filter((msg: any) => !msg.isProcessReference);

          // Convert messages for Gemini models (system messages must be at the beginning only)
          if (isGeminiModel(modelName)) {
            llmMessages = convertMessagesForGemini(llmMessages);
          }

          llmMessages = applyAnthropicPromptCaching(llmMessages, modelName);

          // DAF actions used to be taught only as plain-text JSON
          // ({"type":"action","variant":"...","parameters":{...}}) with no real
          // tool/function schemas ever declared to the API. Gemini (2.5 and
          // especially 3.x) recognizes this shape as a genuine function-calling
          // convention and sometimes tried to emit a native function call for
          // it instead of text, with no matching declared function, that call
          // was rejected as "Malformed function call" and the whole turn came
          // back empty (finishReason 'other'/'error', confirmed via
          // providerMetadata.google.finishMessage). Measured: ~50% empty-response
          // rate on gemini-2.5-flash and ~87% on gemini-3.6-flash for this
          // executor's large action-doc prompts, both dropping to 0/8 in repeated
          // trials once this instruction was passed.
          //
          // Real tools are now declared below (see `tools: buildActionTools()`),
          // so a Gemini function-call attempt matches a real declared tool
          // instead of failing as malformed, the instruction is disabled by
          // default rather than deleted outright, pending a burn-in period to
          // re-measure the failure rate with tools on before removing it for
          // good. Passed via the `instructions` option when re-enabled, not an
          // inline system-role message, ai@7's generateText rejects any
          // role:'system' entry inside `messages` outright.
          const APPLY_GEMINI_NO_TOOL_CALL_WORKAROUND = false;
          const geminiNoToolCallInstructions = APPLY_GEMINI_NO_TOOL_CALL_WORKAROUND && isGeminiModel(modelName)
            ? 'Do not use native function-calling or tool-use for any actions described in this conversation. Always output action JSON as plain visible text in your written response, never as a structured tool/function call.'
            : undefined;
          // Gemini's own workaround above (when active) takes priority for Gemini
          // models, it exists to dodge a real malformed-call bug. Otherwise, steer
          // every model toward using a real tool when one's available instead of
          // defaulting to the JSON-in-text convention (see providers.ts).
          const toolCallInstructions = geminiNoToolCallInstructions ?? getPreferNativeToolCallInstructions(modelName);

          let assistantContent: string;
          let toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean }> = [];
          let providerToolResults: any[] = [];
          let llmApiDuration: number;
          let llmCompleteTimestamp: string;

          try {
            const llmApiStartTime = Date.now();

            // Determine if we should disable reasoning (only for "gpt-5.1 (non reasoning)")
            const shouldDisableReasoning = modelOverride === 'gpt-5.1 (non reasoning)';

            // Hybrid tool calling: our own actions, minus whichever this model's
            // provider replaces with its own native tool (off entirely unless a
            // host has called configureNativeToolCalling(true), see providers.ts),
            // minus anything the host has excluded outright via configureExcludedActions().
            const nativeReplacedActions = getNativeReplacedActions(modelName);
            const excludeVariants = [...nativeReplacedActions, ...getExcludedActions()];
            const ourOwnTools = buildActionTools(excludeVariants.length > 0 ? { excludeVariants } : undefined);
            const tools = {
              ...ourOwnTools,
              ...buildNativeProviderTools(modelName),
            };
            // Put a note right next to each action's JSON-format example when a
            // real tool also covers it this turn (see actionTools.ts). The
            // example itself is untouched, this just adds the counter-signal
            // where the model is actually looking instead of relying only on
            // toolCallInstructions from far away in the prompt.
            const annotatedMessages = annotateActionCatalogWithToolNotes(llmMessages, Object.keys(ourOwnTools));
            const callGenerateText = () => withTimeout(
              generateText({
                model: modelProvider,
                messages: annotatedMessages,
                tools,
                instructions: toolCallInstructions,
                ...(shouldDisableReasoning && {
                  providerOptions: {
                    openai: {
                      reasoningEffort: 'none',
                    },
                  },
                }),
              }),
              MAX_AI_CALL_TIMEOUT,
              `AI model call timed out after ${MAX_AI_CALL_TIMEOUT / 1000 / 60} minutes. The model did not respond in time.`
            );

            // Gemini 2.5 has a measured ~50% chance of returning a completely empty
            // response (finishReason 'other', zero output/reasoning tokens, not a
            // token-budget issue) on long, tool-doc-heavy prompts like this executor
            // sends on every turn. It's non-deterministic per call, not fixable by
            // tuning thinkingBudget/maxOutputTokens, retrying the identical request
            // reliably succeeds within a couple of attempts, matching what's been
            // observed manually. Retry up to twice (3 attempts total) before falling
            // through to the empty-response error below. A native tool call commonly
            // returns empty `text` with everything in `toolCalls` instead, that's a
            // successful turn, not the empty-response failure this retry exists for.
            const MAX_EMPTY_RETRIES = 2;
            let result = await callGenerateText();
            let emptyRetryCount = 0;
            while ((!result.text || !result.text.trim()) && result.toolCalls.length === 0 && emptyRetryCount < MAX_EMPTY_RETRIES) {
              emptyRetryCount++;
              adapter.log.warn(
                `[${depthPrefix} ${indexStr}] Empty response from ${modelName} (finishReason: ${(result as any).finishReason}), retrying (attempt ${emptyRetryCount + 1}/${MAX_EMPTY_RETRIES + 1})...`
              );
              result = await callGenerateText();
            }

            llmApiDuration = Date.now() - llmApiStartTime;
            llmCompleteTimestamp = new Date().toISOString();

            toolCalls = result.toolCalls.map((tc: any) => ({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.input,
              providerExecuted: !!tc.providerExecuted,
            }));
            providerToolResults = result.toolResults as any[];
            assistantContent = result.text;

            // The model can legitimately return empty text (see comment above) with no
            // thrown error, finishReason is just 'length' with nothing to show for it.
            // Treat that as a failure instead of silently completing the step and moving
            // on, which previously left runs advancing past a step that did nothing. Empty
            // text with a populated toolCalls is a successful native tool-call turn, not
            // this failure.
            if ((!assistantContent || !assistantContent.trim()) && toolCalls.length === 0) {
              const finishReason = (result as any).finishReason;
              const geminiNote = isGeminiModel(modelName)
                ? ' This is a known Gemini failure mode where thinking tokens consume the entire output budget.'
                : '';
              throw new Error(
                `Model ${modelName} returned an empty response (finishReason: ${finishReason || 'unknown'}).` +
                geminiNote +
                ' Retrying the run usually succeeds.'
              );
            }

            lastAiResponseRef.text = assistantContent;
            assistantContent = await substituteVariables(assistantContent, userId, adapter, processId, parentProcessIds);

            // Capture token usage with precise values from AI SDK
            if (result.usage) {
              const currentInputTokens = result.usage.inputTokens || 0;
              const currentOutputTokens = result.usage.outputTokens || 0;
              // Use totalTokens from provider (includes reasoning, cache overhead, etc)
              const totalCurrentTokens = result.usage.totalTokens || (currentInputTokens + currentOutputTokens);
              const cachedInputTokens = result.usage.inputTokenDetails?.cacheReadTokens || 0;
              const reasoningTokens = result.usage.outputTokenDetails?.reasoningTokens || 0;

              // Accumulate token counts
              tokenUsageRef.prompt += currentInputTokens;
              tokenUsageRef.completion += currentOutputTokens;
              tokenUsageRef.total += totalCurrentTokens;
              tokenUsageRef.cachedPromptTokens += cachedInputTokens;
              tokenUsageRef.reasoningTokens += reasoningTokens;

              // Calculate actual cost for this LLM call
              const currentCost = calculateTokenCost(
                modelOverride || 'gpt-5.1 (non reasoning)',
                currentInputTokens,
                currentOutputTokens,
                cachedInputTokens,
                reasoningTokens
              );

              // Record usage for every call; cost is charged only for platform-key calls.
              // Own-key users: costUsed=0 (token tracking + plan allowance check only).
              // Platform-key calls: costUsed=currentCost.
              const costLimitCheck = await checkAndUpdateCostLimit(
                userId,
                usingUserApiKey ? 0 : currentCost,
                totalCurrentTokens,
                adapter,
                authType
              );
              if (usingUserApiKey) {
                adapter.log.info(`[${depthPrefix} ${indexStr}] Using user's own ${providerType} API key - wallet not charged`);
              }
              if (!costLimitCheck.allowed) {
                adapter.log.warn(`User ${userId} wallet balance insufficient during execution at depth ${depth}`);

                await adapter.db.schedule.updateMany({
                  where: { userId },
                  data: { status: 'PAUSED' }
                });

                if (costLimitCheck.user) {
                  if (costLimitCheck.failureReason === 'WALLET_DEPLETED') {
                    await adapter.onWalletDepleted?.(userId, costLimitCheck.user);
                  } else if (costLimitCheck.failureReason === 'MONTHLY_LIMIT_REACHED') {
                    await adapter.onMonthlyLimitReached?.(userId, costLimitCheck.user);
                  }
                }

                const errorMsg = costLimitCheck.message || 'Insufficient wallet balance';
                adapter.log.error(errorMsg);
                hasError.value = true;
                errorMessage.text = errorMsg;

                messages.push({
                  role: 'assistant',
                  source: 'prism',
                  content: errorMsg,
                  timestamp: new Date().toISOString(),
                  error: true
                });
                await saveAndEmitMessages();
                return;
              }

              // Log detailed token usage
              console.log(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] Token usage: input=${currentInputTokens}, output=${currentOutputTokens}, total=${totalCurrentTokens}`);
              if (cachedInputTokens > 0 || reasoningTokens > 0) {
                console.log(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] Additional tokens: cached=${cachedInputTokens}, reasoning=${reasoningTokens}`);
                console.log(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] Running totals: cachedPromptTokens=${tokenUsageRef.cachedPromptTokens}, reasoningTokens=${tokenUsageRef.reasoningTokens}`);
              }
            }

            console.log(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] LLM API completed in ${llmApiDuration}ms, response length: ${assistantContent.length} chars`);
          } catch (error: any) {
            // Handle errors from LLM call
            llmApiDuration = Date.now() - Date.now();
            llmCompleteTimestamp = new Date().toISOString();

            let errorMsg: string;

            // Check if this is a user API key error
            if (usingUserApiKey) {
              // Pass through the provider's error message when using user's API keys
              const providerName = providerType.charAt(0).toUpperCase() + providerType.slice(1);
              const baseError = error.message || error.toString();

              // Try to extract the actual API error from the error chain
              let apiError = baseError;
              if (error.cause?.message) {
                apiError = error.cause.message;
              } else if (error.error?.message) {
                apiError = error.error.message;
              }

              errorMsg = `${providerName} API key error: ${apiError}. Please check your API key configuration in the Provider settings.`;
              console.error(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] User API key error for ${providerName}: ${apiError}`);
            } else {
              // General error handling for platform API keys
              errorMsg = error.message || 'AI model call failed';
              console.error(`[${llmCompleteTimestamp}] [${depthPrefix} ${indexStr}] ${errorMsg}`);
            }

            // Set error state
            hasError.value = true;
            errorMessage.text = errorMsg;

            // Add error message to conversation
            messages.push({
              role: 'assistant',
              source: 'prism',
              content: `**Error:** ${errorMsg}`,
              timestamp: new Date().toISOString(),
              error: true,
              ...countWords(`**Error:** ${errorMsg}`)
            });
            await saveAndEmitMessages();

            return; // Stop execution
          }

          // A native tool call is already a structured, schema-validated action,
          // use it directly instead of scanning `assistantContent` for JSON (there
          // may be none to find; a pure tool-call turn commonly has empty text).
          // Falls back to the existing text-scan whenever the model didn't use a
          // native tool call, unchanged from before tools were declared.
          //
          // `providerExecuted` calls (Anthropic's own web_search/web_fetch, see
          // providers.ts) are a different case from our own actions: the provider
          // already ran them, there's nothing for executeAction to do. Keep them
          // out of what gets executed, but still represent them in the message
          // trace and in assistantContent's empty-text backstop below, same as
          // any other tool call.
          const allToolActions: Action[] = toolCalls.map((tc) => ({
            type: 'action',
            variant: tc.toolName,
            parameters: tc.input,
          } as unknown as Action));
          const clientToolCalls = toolCalls.filter((tc) => !tc.providerExecuted);
          const clientActions: Action[] = clientToolCalls.map((tc) => ({
            type: 'action',
            variant: tc.toolName,
            parameters: tc.input,
          } as unknown as Action));
          const providerExecutedCalls = toolCalls.filter((tc) => tc.providerExecuted);
          const extractedAiActions = allToolActions.length > 0 ? allToolActions : extractActionsFromMessage(assistantContent);

          // A pure native tool-call turn leaves assistantContent empty (see comment
          // above). Represent it as the same JSON text shape the plain-text action
          // convention already produces before saving it, an empty text content block
          // gets rejected outright by some providers (e.g. Anthropic) when this message
          // is replayed as history on the next turn.
          if (allToolActions.length > 0 && (!assistantContent || !assistantContent.trim())) {
            assistantContent = allToolActions.map((a) => JSON.stringify(a, null, 2)).join('\n\n');
          }

          const messageCreationTime = Date.now();
          const messageCreationTimestamp = new Date().toISOString();
          // Add assistant response to messages
          const assistantMessage: any = {
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date().toISOString(),
            model: modelName,
            ...countWords(assistantContent),
            ...calculateDuration(messages)
          };

          // If there are executable actions, mark the message before emitting
          if (extractedAiActions.length > 0) {
            assistantMessage.hasExecutableActions = true;
          }

          // Add index path to message
          indexPath.forEach((idx, level) => {
            assistantMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
          });

          messages.push(assistantMessage);
          const beforeSaveTime = Date.now();
          const messageCreationDuration = beforeSaveTime - messageCreationTime;

          adapter.log.info(`[${depthPrefix} ${indexStr}] Message object created in ${messageCreationDuration}ms, starting save & emit...`);
          console.log(`[${messageCreationTimestamp}] [${depthPrefix} ${indexStr}] Message object created in ${messageCreationDuration}ms (timestamp: ${assistantMessage.timestamp}), starting save & emit...`);

          const beforeSaveTimestamp = new Date().toISOString();
          await saveAndEmitMessages();
          const saveEmitDuration = Date.now() - beforeSaveTime;
          const afterSaveTimestamp = new Date().toISOString();
          const totalProcessingTime = Date.now() - llmCallStartTime;

          adapter.log.info(`[${depthPrefix} ${indexStr}] Save & emit completed in ${saveEmitDuration}ms`);
          console.log(`[${afterSaveTimestamp}] [${depthPrefix} ${indexStr}] Save & emit completed in ${saveEmitDuration}ms`);

          adapter.log.info(`[${depthPrefix} ${indexStr}] ⏱️  TIMING SUMMARY: LLM=${llmApiDuration}ms, MsgCreate=${messageCreationDuration}ms, SaveEmit=${saveEmitDuration}ms, Total=${totalProcessingTime}ms`);
          console.log(`[${afterSaveTimestamp}] [${depthPrefix} ${indexStr}] TIMING SUMMARY: LLM=${llmApiDuration}ms, MsgCreate=${messageCreationDuration}ms, SaveEmit=${saveEmitDuration}ms, Total=${totalProcessingTime}ms`);
          console.log(`[${afterSaveTimestamp}] [${depthPrefix} ${indexStr}] Timeline: Start=${llmCallTimestamp}, LLMComplete=${llmCompleteTimestamp}, MsgCreate=${messageCreationTimestamp}, SaveStart=${beforeSaveTimestamp}, SaveComplete=${afterSaveTimestamp}`);

          // Now process and execute the actions
          const aiStepContext: ExecutionContext = {
            model: modelName,
            modelProvider,
            isChatContext: !!isChatContext,
            customActionHandler,
            ...(editorContext ? {} : {}),
          };
          const aiActionResult = await processMessageActions(
            assistantContent, userId, adapter, processId, parentProcessIds, aiStepContext,
            // Pass the (possibly empty) client-action list whenever any tool call
            // happened at all, so a turn that was ONLY provider-executed calls
            // doesn't fall through to scanning assistantContent for JSON, that
            // text is just the provider actions' own JSON (see the empty-text
            // backstop above), not a real action for us to (re-)execute.
            toolCalls.length > 0 ? clientActions : undefined,
          );

          // Provider-executed calls (web_search/web_fetch today) never go through
          // executeAction, the provider already ran them, so their results live
          // in `providerToolResults`, not `aiActionResult`. Record them the same
          // way a client action's result gets recorded, so the message trace and
          // frontend collapsing treat them identically either way.
          for (const call of providerExecutedCalls) {
            const toolResult = providerToolResults.find((tr: any) => tr.toolCallId === call.toolCallId);
            const formattedResult = formatNativeProviderResult(call.toolName, toolResult?.output);
            const prismMessage: any = {
              role: 'assistant',
              source: 'prism',
              content: formattedResult,
              timestamp: new Date().toISOString(),
              isActionResult: true,
              actionResult: { success: true, message: formattedResult },
              ...countWords(formattedResult),
              ...calculateDuration(messages)
            };
            indexPath.forEach((idx, level) => {
              prismMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
            });
            messages.push(prismMessage);
            await saveAndEmitMessages();
          }

          if (aiActionResult.hasActions && aiActionResult.actionResults.length > 0) {
            for (const actionResult of aiActionResult.actionResults) {
              const formattedResult = formatActionResult(actionResult);
              const prismMessage: any = {
                role: 'assistant',
                source: 'prism',
                content: formattedResult,
                timestamp: new Date().toISOString(),
                isActionResult: true,
                actionResult: actionResult,
                ...countWords(formattedResult),
                ...calculateDuration(messages)
              };

              // Add index path to message
              indexPath.forEach((idx, level) => {
                prismMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
              });

              messages.push(prismMessage);
              await saveAndEmitMessages();

              const fileAttachmentMessage = buildFileAttachmentMessage(actionResult, indexPath);
              if (fileAttachmentMessage) {
                messages.push(fileAttachmentMessage);
                await saveAndEmitMessages();
              }
            }

            // If any action requested a user input pause, trigger PauseSignal after saving results
            if (aiActionResult.actionResults.some(r => r.pauseForInput)) {
              const pausingAction = aiActionResult.actionResults.find(r => r.pauseForInput);
              throw new PauseSignal([], (pausingAction as any)?.message || undefined);
            }
          } else if (extractedAiActions.length === 0 && /"type"\s*:\s*"(action|editorAction)"/.test(assistantContent)) {
            // The message contained action-shaped JSON (a "type": "action" object),
            // but nothing in it validated as a real action, most commonly an
            // unrecognized variant name. extractActionsFromMessage silently drops
            // anything that fails validation, so without this the model has no
            // way to know its attempt failed and may go on to answer as if the
            // action had actually run. Surfacing the failure gives it a chance to
            // notice the mistake and retry, the same way a real tool-call error
            // would.
            const correctionText = 'No valid action was recognized in your last message. Check that "variant" exactly matches one of the actions listed in the catalog above, and that "parameters" matches its required shape, then try again.';
            const correctionMessage: any = {
              role: 'assistant',
              source: 'prism',
              content: correctionText,
              timestamp: new Date().toISOString(),
              isActionResult: true,
              ...countWords(correctionText),
              ...calculateDuration(messages)
            };
            indexPath.forEach((idx, level) => {
              correctionMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
            });
            messages.push(correctionMessage);
            await saveAndEmitMessages();
          }

          // Check if we should stop the entire process based on stopProcessKeyword
          const processStopCheck = shouldStopProcess(ownStopProcessKeyword, parentStopProcessKeywords, lastAiResponseRef.text);
          if (processStopCheck.shouldStop) {
            adapter.log.info(`[${depthPrefix} ${indexStr}] ${processStopCheck.reason}, stopping process execution`);

            // Add a system message indicating why process stopped
            const stopMessage: any = {
              role: 'assistant',
              source: 'prism',
              content: `Process stopped: ${processStopCheck.reason}`,
              timestamp: new Date().toISOString(),
              ...countWords(`Process stopped: ${processStopCheck.reason}`),
              ...calculateDuration(messages)
            };

            // Add index path to message
            indexPath.forEach((idx, level) => {
              stopMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
            });

            messages.push(stopMessage);
            await saveAndEmitMessages();

            // If it's a parent keyword, store which keyword was detected so parent can check
            if (processStopCheck.isParentKeyword) {
              // Extract the keyword from the reason string
              const keywordMatch = processStopCheck.reason?.match(/"([^"]+)"/);
              if (keywordMatch) {
                detectedStopKeyword.value = keywordMatch[1];
              }
            } else {
              // If it's own keyword, set the flag so calling code knows to stop
              shouldStopProcessRef.value = true;
            }
            // Return to exit current step execution
            return;
          }

          adapter.log.info(`[${depthPrefix} ${indexStr}] Completed`);
        }
      } // end if/else if/else
    } catch (e) {
      if (e instanceof PauseSignal) {
        // Propagate PauseSignal upward; include remaining loop iterations if any.
        const remainingIterations = loopCount - loopIteration - 1;
        if (remainingIterations > 0) {
          e.remainingSteps = [...e.remainingSteps, { ...step, forLoopCount: remainingIterations, loopType: 'fixed' }];
        }
        throw e;
      }
      throw e;
    }

    // Increment loop iteration
    loopIteration++;

    // Check if we should stop the loop (for stopOn type)
    // Only stop THIS loop if the detected keyword matches THIS loop's keyword
    if (loopType === 'stopOn' && loopIteration <= loopCount) {
      const stopCheck = shouldStopLoop(step, loopIteration, lastAiResponseRef.text);
      if (stopCheck.shouldStop) {
        adapter.log.info(`[${depthPrefix} ${indexStr}] Stopping loop: ${stopCheck.reason}`);

        // Add a system message indicating why loop stopped
        const stopMessage: any = {
          role: 'assistant',
          source: 'prism',
          content: `Loop stopped: ${stopCheck.reason}`,
          timestamp: new Date().toISOString(),
          ...countWords(`Loop stopped: ${stopCheck.reason}`),
          ...calculateDuration(messages)
        };

        // Add index path to message
        indexPath.forEach((idx, level) => {
          stopMessage[`stepIndex${level === 0 ? '' : level + 1}`] = idx + 1;
        });

        messages.push(stopMessage);
        await saveAndEmitMessages();

        shouldContinueLoop = false;
      }
    }

    // For fixed loop type, just continue until loopCount is reached
    if (loopType === 'fixed' && loopIteration >= loopCount) {
      shouldContinueLoop = false;
    }
  } // End of loop iteration
}

export async function executeProcess(processId: string, userId: string, adapter: DAFStorageAdapter, modelOverride?: string, scheduleId?: string, authType?: string, editorContext?: boolean, customActionHandler?: ExecutionContext['customActionHandler']) {
  let process;
  let userProviderSettings: UserProviderSettings | null = null;

  try {
    // Get the process
    process = await adapter.db.process.findFirst({
      where: {
        id: processId,
        userId
      }
    });

    if (!process) {
      throw new Error('Process not found');
    }

    // Fetch user's provider settings for BYOK, adapter returns pre-decrypted keys
    const userWithSettings = await adapter.getUser(userId);
    if (userWithSettings) {
      userProviderSettings = userWithSettings as UserProviderSettings;
    }

    // CHECK FOR CIRCULAR PROCESS REFERENCES (INFINITE LOOPS)
    adapter.log.info(`Checking process "${process.name}" for circular references...`);
    const cycleCheck = await detectProcessCycle(processId, userId, adapter);

    if (cycleCheck.hasCycle) {
      const cyclePath = cycleCheck.cyclePath.join(' → ');
      const errorMsg = `INFINITE LOOP DETECTED! Process chain: ${cyclePath} → ${processId}. Cannot execute.`;
      adapter.log.error(errorMsg);

      // Create a failed run to record the error
      const run = await adapter.db.run.create({
        data: {
          processId: processId,
          userId: userId,
          messages: [{
            role: 'assistant',
            source: 'prism',
            content: errorMsg,
            timestamp: new Date().toISOString(),
            error: true
          }],
          status: 'ERROR',
          error: errorMsg,
          completedAt: new Date(),
          model: modelOverride || 'gpt-5.1 (non reasoning)',
          scheduleId: scheduleId || null
        }
      });

      throw new Error(errorMsg);
    }

    adapter.log.info(`No circular references detected for process "${process.name}"`);

    // Check for stuck/timed-out runs (but allow parallel execution)
    const runningRuns = await adapter.db.run.findMany({
      where: {
        processId,
        status: 'RUNNING'
      }
    });

    // Clean up any stuck runs (timeout detection)
    for (const runningRun of runningRuns) {
      const runAge = Date.now() - new Date(runningRun.createdAt).getTime();
      const timeoutMs = MAX_AI_CALL_TIMEOUT; // 1 hour - matches the in-execution timeout

      if (runAge > timeoutMs) {
        // Run is stuck, mark it as error
        adapter.log.warn(`Run ${runningRun.id} has been running for ${Math.round(runAge / 60000)} minutes, marking as timed out`);

        await adapter.db.run.update({
          where: { id: runningRun.id },
          data: {
            status: 'ERROR',
            completedAt: new Date(),
            error: `Run timed out after ${Math.round(runAge / 60000)} minutes`
          }
        });

        adapter.log.info(`Cleaned up stuck run ${runningRun.id}`);
      }
    }

    // Allow parallel execution - don't skip if process is already running
    // This enables high-frequency schedules (e.g., every 1 second) to trigger multiple parallel runs

    // Create a new run  
    const run = await adapter.db.run.create({
      data: {
        processId: processId,
        userId: userId,
        messages: [],
        status: 'RUNNING',
        model: modelOverride || 'gpt-5.1 (non reasoning)', // Store the actual model used
        scheduleId: scheduleId || null // Track which schedule triggered this run
      }
    });

    // Get updated running count and emit to sidebar
    const runningCount = await adapter.db.run.count({
      where: {
        userId: userId,
        status: 'RUNNING'
      }
    });
    adapter.emitRunningCountUpdate(userId, runningCount);

    adapter.log.info(`Starting execution of process "${process.name}" (ID: ${processId})`);

    // Execute the process steps asynchronously
    executeProcessSteps(process, run.id, userId, adapter, modelOverride, userProviderSettings, authType, editorContext, undefined, undefined, customActionHandler).catch((error) => {
      adapter.log.error(`Error in process execution: ${error instanceof Error ? error.message : String(error)}`);
    });

    return {
      success: true,
      runId: run.id,
      processId
    };
  } catch (error) {
    adapter.log.error(`Error starting process execution: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function executeProcessSteps(process: any, runId: string, userId: string, adapter: DAFStorageAdapter, modelOverride?: string, userProviderSettings?: UserProviderSettings | null, authType?: string, editorContext?: boolean, initialMessages?: any[], isChatContext?: boolean, customActionHandler?: ExecutionContext['customActionHandler']) {
  const messages: any[] = initialMessages ? [...initialMessages] : [];
  let hasError = false;
  let errorMessage: string | null = null;
  let errorReason: string | null = null; // 'WALLET_DEPLETED' | 'MONTHLY_LIMIT_REACHED' | null
  let totalStepsExecuted = 0; // Track total steps to prevent infinite loops
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  // Helper function to save and emit messages in real-time
  const saveAndEmitMessages = async () => {
    const saveStartTime = Date.now();
    const saveStartTimestamp = new Date().toISOString();
    try {
      const dbStartTime = Date.now();
      await adapter.db.run.update({
        where: { id: runId },
        data: { messages }
      });
      const dbDuration = Date.now() - dbStartTime;

      const emitStartTime = Date.now();
      // Emit SSE update
      adapter.emitRunUpdate(runId, {
        type: 'messages-update',
        messages,
        runId
      });
      const emitDuration = Date.now() - emitStartTime;

      const totalDuration = Date.now() - saveStartTime;
      const completeTimestamp = new Date().toISOString();

      adapter.log.info(`[Timing] Save & Emit: DB=${dbDuration}ms, SSE=${emitDuration}ms, Total=${totalDuration}ms`);
      console.log(`[${completeTimestamp}] [Timing] Save & Emit: DB=${dbDuration}ms, SSE=${emitDuration}ms, Total=${totalDuration}ms (Started: ${saveStartTimestamp})`);
    } catch (error) {
      adapter.log.error(`Error saving/emitting messages: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[${new Date().toISOString()}] Error saving/emitting messages:`, error);
    }
  };

  try {
    const steps = process.steps;
    const effectiveModel = modelOverride || 'gpt-5.1 (non reasoning)'; // Default model if not provided

    const processStartTime = Date.now();
    const processStartTimestamp = new Date().toISOString();

    adapter.log.info(`Starting execution of process "${process.name}" with ${steps.length} steps using model: ${effectiveModel}${modelOverride ? ' (override)' : ''}`);
    console.log(`[${processStartTimestamp}] Starting execution of process "${process.name}" (runId: ${runId}) with ${steps.length} steps using model: ${effectiveModel}${modelOverride ? ' (override)' : ''}`);

    // Chat-visible start marker for the top-level process, mirroring the one
    // nested process-reference steps already get (see executeStepRecursively)
    // and the completion marker below. Only on a genuinely fresh run (no prior
    // messages, a resume already has context) and only when it'll actually be
    // paired with that completion marker (chat context, not a hidden __chat__
    // wrapper process), so the two stay symmetric.
    const isHiddenProcess = process.name.startsWith('__chat__');
    if (isChatContext && !isHiddenProcess && messages.length === 0) {
      messages.push({
        role: 'system',
        source: 'prism',
        content: `--- Starting process: ${process.name} ---`,
        timestamp: new Date().toISOString(),
        isProcessReference: true,
        depth: 0,
      });
      await saveAndEmitMessages();
    }

    // Use object wrappers for mutable state that needs to be passed by reference
    const totalStepsRef = { count: totalStepsExecuted };
    const hasErrorRef = { value: hasError };
    const errorMessageRef = { text: errorMessage };
    const errorReasonRef = { value: errorReason };
    const tokenUsageRef = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalTokens,
      cachedPromptTokens: 0,    // Track OpenAI's official cached token count for monitoring
      reasoningTokens: 0         // Track OpenAI's reasoning tokens (for o1/o3/o4 models)
    };
    const lastAiResponseRef = { text: null as string | null }; // Track last AI response for stopOn loops
    const shouldStopLoopRef = { value: false, keyword: undefined as string | undefined }; // Track if stopOn loop should stop
    const shouldStopProcessRef = { value: false }; // Track if this process level should stop
    const detectedStopKeyword = { value: null as string | null }; // Track which parent keyword was detected

    // Execute each step using the recursive helper
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      try {
        await executeStepRecursively(
          step,
          i,
          steps.length,
          [i], // Index path starts with just the main step index
          0, // Depth 0 for main process
          userId,
          adapter,
          process.id, // Pass process.id
          [], // Empty parent process IDs array for top-level process
          effectiveModel,
          messages,
          saveAndEmitMessages,
          totalStepsRef,
          hasErrorRef,
          errorMessageRef,
          runId,
          tokenUsageRef,
          lastAiResponseRef, // Pass the reference
          shouldStopLoopRef, // Pass the reference
          shouldStopProcessRef, // Pass the shouldStopProcess reference
          detectedStopKeyword, // Pass the detected keyword reference
          null, // No parent stopOnKeyword at top level
          process.stopProcessKeyword, // This process's own stop keyword
          [], // No parent keywords at top level
          undefined, // No processes array at top level
          userProviderSettings, // Pass user's BYOK configuration
          authType, // Pass auth type for last used tracking
          editorContext, // Pass editor context flag
          isChatContext, // Pass chat context flag
          customActionHandler // Pass generic host action override
        );
      } catch (e) {
        if (e instanceof PauseSignal) {
          // Add remaining top-level steps after this one
          e.remainingSteps = [...e.remainingSteps, ...steps.slice(i + 1)];

          // Persist current messages and store resume state
          const existingRun = await adapter.db.run.findUnique({ where: { id: runId }, select: { metadata: true } });
          const existingMetadata = (existingRun?.metadata as any) || {};
          const resumeState = {
            remainingSteps: e.remainingSteps,
            processId: process.id,
            model: effectiveModel,
          };

          const updatedRun = await adapter.db.run.update({
            where: { id: runId },
            data: {
              status: 'WAITING_FOR_INPUT',
              messages,
              metadata: { ...existingMetadata, resumeState, waitingQuestion: e.question || null },
            },
            select: {
              id: true, processId: true, userId: true, scheduleId: true, status: true,
              startedAt: true, completedAt: true, error: true, metadata: true, model: true,
              promptTokens: true, completionTokens: true, totalTokens: true,
              cachedPromptTokens: true, reasoningTokens: true, createdAt: true, updatedAt: true,
              process: { select: { id: true, name: true } }
            }
          });

          adapter.emitRunUpdate(runId, { type: 'status-update', status: 'WAITING_FOR_INPUT', messages, runId, waitingQuestion: e.question || null });
          adapter.emitRunListUpdate(userId, { type: 'run-updated', run: updatedRun });
          const runningCount = await adapter.db.run.count({ where: { userId, status: 'RUNNING' } });
          adapter.emitRunningCountUpdate(userId, runningCount);
          adapter.log.info(`[Process] Run ${runId} paused at userFeedback step, waiting for user input`);
          return; // Don't finalize as COMPLETED
        }
        throw e;
      }

      // If error occurred, break out of main loop
      if (hasErrorRef.value) {
        hasError = hasErrorRef.value;
        errorMessage = errorMessageRef.text;
        break;
      }

      // If this process should stop, break out of main loop
      if (shouldStopProcessRef.value) {
        break;
      }
    }

    // Update totalStepsExecuted from reference
    totalStepsExecuted = totalStepsRef.count;
    totalPromptTokens = tokenUsageRef.prompt;
    totalCompletionTokens = tokenUsageRef.completion;
    totalTokens = tokenUsageRef.total;

    // Log total process execution time
    const processDuration = Date.now() - processStartTime;
    const processCompleteTimestamp = new Date().toISOString();
    const avgStepTime = totalStepsExecuted > 0 ? Math.round(processDuration / totalStepsExecuted) : 0;

    adapter.log.info(`Process "${process.name}" execution time: ${processDuration}ms (${totalStepsExecuted} steps, avg ${avgStepTime}ms/step)`);
    console.log(`[${processCompleteTimestamp}] Process "${process.name}" (runId: ${runId}) execution time: ${processDuration}ms (${totalStepsExecuted} steps, avg ${avgStepTime}ms/step)`);
    console.log(`[${processCompleteTimestamp}] Process Timeline: Started=${processStartTimestamp}, Completed=${processCompleteTimestamp}, Duration=${processDuration}ms`);
    console.log(`[DEBUG] Final token counts before saving: promptTokens=${totalPromptTokens}, completionTokens=${totalCompletionTokens}, totalTokens=${totalTokens}`);
    console.log(`[DEBUG] OpenAI cache metrics (for monitoring): cachedPromptTokens=${tokenUsageRef.cachedPromptTokens}, reasoningTokens=${tokenUsageRef.reasoningTokens}`);

    // Mark run as completed or error
    const finalStatus = hasError ? 'ERROR' : 'COMPLETED';

    // Persist a chat-visible completion marker when a named (non-hidden) process finishes in chat context
    if (isChatContext && !hasError && !isHiddenProcess) {
      const completionMarker: any = {
        role: 'assistant',
        source: 'prism',
        chatSource: true,
        isProcessCompletion: true,
        content: `Process "${process.name}" completed.`,
        timestamp: new Date().toISOString(),
      };
      messages.push(completionMarker);
    }

    const updatedRun = await adapter.db.run.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        error: errorMessage,
        messages,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalTokens,
        cachedPromptTokens: tokenUsageRef.cachedPromptTokens,
        reasoningTokens: tokenUsageRef.reasoningTokens
      },
      select: {
        id: true,
        processId: true,
        userId: true,
        scheduleId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        error: true,
        metadata: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        cachedPromptTokens: true,
        reasoningTokens: true,
        createdAt: true,
        updatedAt: true,
        process: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });

    // Derive errorReason from message text for limit-related errors
    const errMsg = errorMessage ?? '';
    const errorReasonForEmit = errMsg.toLowerCase().includes('wallet')
      ? 'WALLET_DEPLETED'
      : errMsg.toLowerCase().includes('monthly') || errMsg.toLowerCase().includes('allowance')
        ? 'MONTHLY_LIMIT_REACHED'
        : errorReason || undefined;

    // Emit final status update via SSE to detail view
    adapter.emitRunUpdate(runId, {
      type: 'status-update',
      status: finalStatus,
      completedAt: new Date().toISOString(),
      error: errorMessage,
      errorReason: errorReasonForEmit,
      messages,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalTokens,
      runId
    });

    // Emit to list views
    adapter.emitRunListUpdate(userId, {
      type: 'run-updated',
      run: updatedRun
    });

    // Update running count in sidebar
    const runningCount = await adapter.db.run.count({
      where: {
        userId: userId,
        status: 'RUNNING'
      }
    });
    adapter.emitRunningCountUpdate(userId, runningCount);

    if (hasError) {
      adapter.log.error(`Process "${process.name}" completed with errors: ${errorMessage}`);
    } else {
      adapter.log.info(`Process "${process.name}" completed successfully`);
    }

  } catch (error: any) {
    adapter.log.error(`Fatal error in process execution: ${error instanceof Error ? error.message : String(error)}`);

    // Mark run as error
    const updatedRun = await adapter.db.run.update({
      where: { id: runId },
      data: {
        status: 'ERROR',
        completedAt: new Date(),
        error: error.message,
        messages,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalTokens
      },
      select: {
        id: true,
        processId: true,
        userId: true,
        scheduleId: true,
        status: true,
        startedAt: true,
        completedAt: true,
        error: true,
        metadata: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        createdAt: true,
        updatedAt: true,
        process: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });

    // Emit error status via SSE to detail view
    adapter.emitRunUpdate(runId, {
      type: 'status-update',
      status: 'ERROR',
      completedAt: new Date().toISOString(),
      error: error.message,
      messages,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      totalTokens: totalTokens,
      runId
    });

    // Emit to list views
    adapter.emitRunListUpdate(userId, {
      type: 'run-updated',
      run: updatedRun
    });

    // Update running count in sidebar
    const runningCount = await adapter.db.run.count({
      where: {
        userId: userId,
        status: 'RUNNING'
      }
    });
    adapter.emitRunningCountUpdate(userId, runningCount);
  }
}

// Check if model is a Gemini model (which has system message restrictions)
function isGeminiModel(modelName: string): boolean {
  return modelName.startsWith('gemini-');
}

// Convert messages for Gemini compatibility
// Gemini only supports system messages at the beginning of the conversation
// Mid-conversation system messages must be converted to user messages
function convertMessagesForGemini(messages: any[]): any[] {
  if (messages.length === 0) return messages;

  const convertedMessages = [];
  let firstMessageProcessed = false;

  for (const msg of messages) {
    // Keep the very first system message unchanged (if it's the first message)
    if (!firstMessageProcessed && msg.role === 'system') {
      convertedMessages.push(msg);
      firstMessageProcessed = true;
    }
    // Convert any subsequent system messages to user messages with a prefix
    else if (msg.role === 'system') {
      convertedMessages.push({
        ...msg,
        role: 'user',
        content: `[System]: ${msg.content}`
      });
    }
    // Keep all other messages unchanged
    else {
      convertedMessages.push(msg);
      if (!firstMessageProcessed) firstMessageProcessed = true;
    }
  }

  return convertedMessages;
}

async function fetchUserProviderSettings(userId: string, adapter: DAFStorageAdapter): Promise<UserProviderSettings | null> {
  const user = await adapter.getUser(userId);
  if (!user) return null;
  return user as UserProviderSettings;
}

// Run a named process but append its messages to an already-existing run (e.g. an active chat run).
export async function executeProcessInRun(
  processId: string,
  runId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  model?: string,
  chatResourceIds: string[] = [],
  customActionHandler?: ExecutionContext['customActionHandler'],
): Promise<void> {
  const [process, userProviderSettings] = await Promise.all([
    adapter.db.process.findFirst({ where: { id: processId, userId } }),
    fetchUserProviderSettings(userId, adapter),
  ]);

  if (!process) throw new Error('Process not found');

  const effectiveModel = model || 'gpt-5.1 (non reasoning)';

  // Temporarily merge chat resources into the process so action handlers can access them
  const originalResourceIds: string[] = (process.resourceIds as string[]) || [];
  if (chatResourceIds.length > 0) {
    const merged = [...new Set([...originalResourceIds, ...chatResourceIds])];
    await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: merged } });
    (process as any).resourceIds = merged;
  }

  // Load existing messages so the process sees prior conversation context
  const existingRun = await adapter.db.run.findUnique({ where: { id: runId } });
  const initialMessages = Array.isArray(existingRun?.messages) ? [...(existingRun!.messages as any[])] : [];

  // Mark run as RUNNING and emit
  await adapter.db.run.update({ where: { id: runId }, data: { status: 'RUNNING', model: effectiveModel } });
  adapter.emitRunUpdate(runId, { type: 'status-update', status: 'RUNNING', messages: initialMessages, runId });
  const runningCount = await adapter.db.run.count({ where: { userId, status: 'RUNNING' } });
  adapter.emitRunningCountUpdate(userId, runningCount);

  try {
    await executeProcessSteps(process, runId, userId, adapter, effectiveModel, userProviderSettings, undefined, undefined, initialMessages, true, customActionHandler);
  } finally {
    // Restore original resource IDs so chat resources don't permanently persist on the process
    if (chatResourceIds.length > 0) {
      await adapter.db.process.update({ where: { id: processId }, data: { resourceIds: originalResourceIds } }).catch(() => { });
    }
  }
}

// Resume a WAITING_FOR_INPUT run: inject user message then continue remaining steps.
export async function resumeProcessExecution(
  runId: string,
  userId: string,
  userMessage: string,
  model: string,
  adapter: DAFStorageAdapter,
  customActionHandler?: ExecutionContext['customActionHandler'],
  /**
   * The resources attached to the conversation right now, when the host
   * sends them with each reply (e.g. a chat UI's attached-file chips).
   * Replaces the list saved when the run started, so a file attached
   * after the first message reaches the process too. Omit to keep the
   * saved list.
   */
  resourceIds?: string[],
): Promise<void> {
  const run = await adapter.db.run.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Run ${runId} not found`);

  const metadata = (run.metadata as any) || {};
  const resumeState = metadata.resumeState;
  if (!resumeState?.remainingSteps) throw new Error('No resume state found on run');
  if (resourceIds) metadata.chatResourceIds = [...new Set(resourceIds)];

  const existingMessages: any[] = Array.isArray(run.messages) ? [...(run.messages as any[])] : [];

  // $<resource id> references in the user's reply (see dataReferences.ts).
  // The reply isn't variable-substituted, but a data resource reference still
  // means "send this file", same as in a prompt step. Chat-attached resources
  // count as accessible here even before they're merged into the process below.
  const replyRefs = await resolveDataReferences(userMessage, {
    userId, adapter, model,
    processId: resumeState.processId || run.processId,
    parentProcessIds: resumeState.parentProcessIds ?? [],
    extraResourceIds: metadata.chatResourceIds || [],
    existingMessages,
  });
  userMessage = replyRefs.text;
  existingMessages.push(...replyRefs.attachmentMessages);

  // Append the user message immediately
  const userMsg: any = {
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString(),
    chatSource: true,
  };
  existingMessages.push(userMsg);

  // Persist, clear resumeState, and set back to RUNNING
  await adapter.db.run.update({
    where: { id: runId },
    data: {
      status: 'RUNNING',
      messages: existingMessages,
      metadata: { ...metadata, resumeState: null },
    },
  });
  adapter.emitRunUpdate(runId, { type: 'messages-update', messages: existingMessages, runId });
  adapter.emitRunUpdate(runId, { type: 'status-update', status: 'RUNNING', messages: existingMessages, runId });
  const runningCount = await adapter.db.run.count({ where: { userId, status: 'RUNNING' } });
  adapter.emitRunningCountUpdate(userId, runningCount);

  const userProviderSettings = await fetchUserProviderSettings(userId, adapter);

  // Re-apply chat resource IDs and resolve real process name
  const chatResourceIds: string[] = metadata.chatResourceIds || [];
  const targetProcessId = resumeState.processId || run.processId;
  let originalResourceIds: string[] = [];
  const targetProcess = await adapter.db.process.findUnique({ where: { id: targetProcessId } });
  if (targetProcess && chatResourceIds.length > 0) {
    originalResourceIds = (targetProcess.resourceIds as string[]) || [];
    const merged = [...new Set([...originalResourceIds, ...chatResourceIds])];
    await adapter.db.process.update({ where: { id: targetProcessId }, data: { resourceIds: merged } });
  }

  // No auto-completion after user input (Option B), continue with remaining steps as-is.
  // Add a "Trigger another completion" step explicitly in the process if an LLM response is needed.
  const fakeProcess = {
    id: targetProcessId,
    name: targetProcess?.name || 'Process',
    steps: resumeState.remainingSteps,
    stopProcessKeyword: (targetProcess?.stopProcessKeyword as string | null) ?? null,
  };

  try {
    await executeProcessSteps(fakeProcess, runId, userId, adapter, model, userProviderSettings, undefined, undefined, existingMessages, true, customActionHandler);
  } finally {
    if (chatResourceIds.length > 0) {
      await adapter.db.process.update({ where: { id: targetProcessId }, data: { resourceIds: originalResourceIds } }).catch(() => { });
    }
  }
}