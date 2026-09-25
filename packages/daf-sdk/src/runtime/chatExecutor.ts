import { resolveDataReferences, DataReferenceError } from './dataReferences';
import { generateText } from 'ai';
import {
  canUserAffordApiCall,
  checkAndUpdateCostLimit,
  substituteVariables,
  formatActionResult,
  resumeProcessExecution,
  buildFileAttachmentMessage,
} from './executor';
import { processMessageActions } from './actionProcessor';
import { buildActionTools, annotateActionCatalogWithToolNotes } from './actionTools';
import type { DAFStorageAdapter, ActionConfig, UserProviderSettings, ExecutionContext } from './types';
import { calculateTokenCost } from './pricing';
import {
  getProviderFromModel,
  getModelProvider,
  applyAnthropicPromptCaching,
  getNativeReplacedActions,
  getExcludedActions,
  buildNativeProviderTools,
  formatNativeProviderResult,
  getPreferNativeToolCallInstructions,
} from './providers';

function isUsingUserKey(model: string, userSettings: UserProviderSettings | null): boolean {
  if (!userSettings) return false;
  const provider = getProviderFromModel(model);
  if (provider === 'openai' && userSettings.useOpenaiKey) return true;
  if (provider === 'anthropic' && userSettings.useAnthropicKey) return true;
  if (provider === 'mistral' && userSettings.useMistralKey) return true;
  if (provider === 'google' && userSettings.useGoogleKey) return true;
  if (provider === 'xai' && userSettings.useXaiKey) return true;
  if (provider === 'deepseek' && userSettings.useDeepseekKey) return true;
  return false;
}

function buildActionMsg(ar: any, durationMs?: number): any {
  // For editor action results, store structured content so the frontend can
  // detect isEditorActionResult and extract transformedText. For all other
  // action types, keep the formatted string (preserves existing rendering).
  const content = ar.data?.isEditorActionResult
    ? { message: ar.message || 'Action completed successfully', data: ar.data, success: ar.success }
    : formatActionResult(ar);
  return {
    role: 'assistant',
    source: 'prism',
    content,
    timestamp: new Date().toISOString(),
    isActionResult: true,
    chatSource: true,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

async function finalize(
  runId: string,
  userId: string,
  messages: any[],
  run: any,
  adapter: DAFStorageAdapter,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  cachedTokens: number,
  reasoningTokens: number,
  model: string,
): Promise<void> {
  const updatedRun = await adapter.db.run.update({
    where: { id: runId },
    data: {
      messages,
      status: 'COMPLETED',
      completedAt: new Date(),
      model,
      promptTokens: (run.promptTokens || 0) + inputTokens,
      completionTokens: (run.completionTokens || 0) + outputTokens,
      totalTokens: (run.totalTokens || 0) + totalTokens,
      cachedPromptTokens: (run.cachedPromptTokens || 0) + cachedTokens,
      reasoningTokens: (run.reasoningTokens || 0) + reasoningTokens,
      metadata: { ...(run.metadata as any || {}), isChatRun: true },
    },
  });
  adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });
  adapter.emitRunUpdate(runId, { type: 'status-update', status: 'COMPLETED', messages, runId });
  adapter.emitRunListUpdate(userId, updatedRun);
}

// ── Main chat turn executor ────────────────────────────────────────────────────

export async function executeChatTurn(
  runId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  message: string,
  model: string,
  resourceIds: string[],
  editorContext?: boolean,
  customActionHandler?: ExecutionContext['customActionHandler'],
): Promise<void> {
  let run: any;
  let currentMessages: any[] = [];

  try {
    run = await adapter.db.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} not found`);

    // If the run was paused waiting for user input, resume process execution instead
    if ((run.status as string) === 'WAITING_FOR_INPUT' && (run.metadata as any)?.resumeState) {
      // An empty list means "nothing sent", not "detach everything", so it
      // keeps whatever the conversation started with.
      await resumeProcessExecution(runId, userId, message, model, adapter, customActionHandler, resourceIds.length > 0 ? resourceIds : undefined);
      return;
    }

    currentMessages = Array.isArray(run.messages) ? [...run.messages] : [];

    // Sync resource IDs to the process so action handlers can access them
    await adapter.db.process.update({
      where: { id: run.processId },
      data: { resourceIds },
    });

    // Variable substitution
    let processedMessage = await substituteVariables(message, userId, adapter, run.processId);

    // $<resource id> references to data resources: send the actual file with
    // this message (see dataReferences.ts). Throws with a clear message when
    // the chosen model can't read the referenced type.
    const refs = await resolveDataReferences(processedMessage, {
      userId, adapter, model, processId: run.processId, extraResourceIds: resourceIds, existingMessages: currentMessages,
    });
    processedMessage = refs.text;
    currentMessages.push(...refs.attachmentMessages);

    // Build + emit user message immediately so the SSE stream shows it right away
    const userMessageObj: any = {
      role: 'user',
      content: processedMessage,
      timestamp: new Date().toISOString(),
      source: 'chat',
      chatSource: true,
    };
    currentMessages.push(userMessageObj);

    await adapter.db.run.update({
      where: { id: runId },
      data: { messages: currentMessages },
    });
    adapter.emitRunUpdate(runId, { type: 'messages-update', messages: currentMessages, runId });

    // Pre-check credits
    const affordCheck = await canUserAffordApiCall(userId, adapter);
    if (!affordCheck.allowed) {
      await adapter.db.run.update({
        where: { id: runId },
        data: { messages: currentMessages, status: 'ERROR', completedAt: new Date(), error: affordCheck.failureReason },
      });
      adapter.emitRunUpdate(runId, { type: 'status-update', status: 'ERROR', messages: currentMessages, runId, errorReason: affordCheck.failureReason });
      adapter.emitRunListUpdate(userId, { id: runId, status: 'ERROR' });
      adapter.log.warn(`[ChatExecution] Insufficient credits for user ${userId}`);
      if (affordCheck.user) {
        if (affordCheck.failureReason === 'MONTHLY_LIMIT_REACHED') {
          await adapter.onMonthlyLimitReached?.(userId, affordCheck.user);
        } else if (affordCheck.failureReason === 'WALLET_DEPLETED') {
          await adapter.onWalletDepleted?.(userId, affordCheck.user);
        }
      }
      return;
    }

    // Fetch user provider settings for BYOK, adapter returns pre-decrypted keys
    const decryptedSettings: UserProviderSettings | null = await adapter.getUser(userId) as UserProviderSettings | null;
    const modelProvider = getModelProvider(model, decryptedSettings);

    // Token accumulator, populated by onTokenUsage callback (used for action-only turns)
    let accInputTokens = 0, accOutputTokens = 0, accTotalTokens = 0;
    let accCachedTokens = 0, accReasoningTokens = 0;

    // Execution context passed into the action processor so it can call the LLM
    // (avoids circular import: actionProcessor cannot import from processExecution)
    const executionContext: ExecutionContext = {
      model,
      modelProvider,
      customActionHandler,
      onTokenUsage: async (input, output, total, cached, reasoning) => {
        accInputTokens += input;
        accOutputTokens += output;
        accTotalTokens += total;
        accCachedTokens += cached;
        accReasoningTokens += reasoning;
        const cost = isUsingUserKey(model, decryptedSettings) ? 0 : calculateTokenCost(model, input, output, cached, reasoning);
        await checkAndUpdateCostLimit(userId, cost, total, adapter);
      },
    };

    // customActionHandler needs to run even outside the Editor app (unlike editor
    // actions, gated by editorContext below), so build a context for the action
    // loop that always carries it, without granting editor-only actions.
    const actionLoopContext: ExecutionContext | undefined = customActionHandler
      ? (editorContext ? executionContext : { model, modelProvider, customActionHandler })
      : (editorContext ? executionContext : undefined);

    // Check if user message has actions (including editorAction), if so, execute and skip LLM
    const userActionStart = Date.now();
    const userActionCheck = await processMessageActions(processedMessage, userId, adapter, run.processId, [], actionLoopContext);
    if (userActionCheck.hasActions && userActionCheck.actionResults?.length > 0) {
      const userActionDuration = Date.now() - userActionStart;
      for (const ar of userActionCheck.actionResults) {
        currentMessages.push(buildActionMsg(ar, userActionDuration));
        const fileAttachmentMessage = buildFileAttachmentMessage(ar);
        if (fileAttachmentMessage) currentMessages.push(fileAttachmentMessage);
      }
      adapter.emitRunUpdate(runId, { type: 'messages-update', messages: currentMessages, runId });
      await finalize(runId, userId, currentMessages, run, adapter, accInputTokens, accOutputTokens, accTotalTokens, accCachedTokens, accReasoningTokens, model);
      return;
    }

    // Build LLM messages from conversation history (exclude action results)
    const llmMessages = applyAnthropicPromptCaching(
      currentMessages
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && !m.isActionResult)
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
      model
    );

    adapter.log.info(`[ChatExecution] Calling ${model} for user ${userId}, run ${runId}`);

    // Hybrid tool calling: our own actions, minus whichever this model's provider
    // replaces with its own native tool (off entirely unless a host has called
    // configureNativeToolCalling(true), see providers.ts), minus anything the
    // host has excluded outright via configureExcludedActions().
    const nativeReplacedActions = getNativeReplacedActions(model);
    const excludeVariants = [...nativeReplacedActions, ...getExcludedActions()];
    const ourOwnTools = buildActionTools(excludeVariants.length > 0 ? { excludeVariants } : undefined);
    const tools = {
      ...ourOwnTools,
      ...buildNativeProviderTools(model),
    };
    // Put a note right next to each action's JSON-format example when a real
    // tool also covers it this turn (see actionTools.ts).
    const annotatedMessages = annotateActionCatalogWithToolNotes(llmMessages, Object.keys(ourOwnTools));

    const llmStart = Date.now();
    const llmResult = await generateText({
      model: modelProvider,
      messages: annotatedMessages,
      tools,
      instructions: getPreferNativeToolCallInstructions(model),
      abortSignal: AbortSignal.timeout(120_000),
    });
    let assistantContent = await substituteVariables(llmResult.text, userId, adapter, run.processId);
    const usage = llmResult.usage;
    const inputTokens = usage?.inputTokens || 0;
    const outputTokens = usage?.outputTokens || 0;
    const totalTokens = usage?.totalTokens || (inputTokens + outputTokens);
    const cachedTokens = (usage as any)?.inputTokenDetails?.cacheReadTokens || 0;
    const reasoningTokens = (usage as any)?.outputTokenDetails?.reasoningTokens || 0;

    // A native tool call is a structured, schema-validated action already,
    // use it directly instead of scanning `assistantContent` for JSON. A pure
    // tool-call turn commonly returns empty text, so without this the action
    // would be silently dropped (processMessageActions('') finds nothing).
    // `providerExecuted` calls (Anthropic's own web_search/web_fetch) are a
    // different case: the provider already ran them, nothing for
    // processMessageActions/executeAction to do, handled separately below
    // from `llmResult.toolResults` instead.
    const allToolCalls = llmResult.toolCalls || [];
    const clientToolCalls = allToolCalls.filter((tc: any) => !tc.providerExecuted);
    const providerExecutedCalls = allToolCalls.filter((tc: any) => tc.providerExecuted);
    const nativeActions = allToolCalls.map((tc: any) => ({
      type: 'action' as const,
      variant: tc.toolName,
      parameters: tc.input,
    }));
    const clientActions = clientToolCalls.map((tc: any) => ({
      type: 'action' as const,
      variant: tc.toolName,
      parameters: tc.input,
    }));

    // A pure native tool-call turn leaves assistantContent empty. Represent it
    // as the same JSON text shape the plain-text action convention already
    // produces before saving it, an empty text content block gets rejected
    // outright by some providers (e.g. Anthropic) when this message is
    // replayed as history on a later turn.
    if (nativeActions.length > 0 && !assistantContent.trim()) {
      assistantContent = nativeActions.map((a) => JSON.stringify(a, null, 2)).join('\n\n');
    }

    currentMessages.push({
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
      source: 'chat',
      chatSource: true,
      model,
      wordCount: assistantContent.trim().split(/\s+/).filter(Boolean).length,
      durationMs: Date.now() - llmStart,
      ...(nativeActions.length > 0 ? { hasExecutableActions: true } : {}),
    });

    // Provider-executed calls never go through processMessageActions/executeAction,
    // so record their already-computed result directly.
    for (const call of providerExecutedCalls as any[]) {
      const toolResult = (llmResult.toolResults || []).find((tr: any) => tr.toolCallId === call.toolCallId);
      const formattedResult = formatNativeProviderResult(call.toolName, toolResult?.output);
      currentMessages.push(buildActionMsg({ success: true, message: formattedResult }, Date.now() - llmStart));
    }

    // Process any actions embedded in the AI response (or, if the model used
    // native tool calling, the pre-parsed client actions from above, passed
    // whenever any tool call happened at all, even if none were client
    // actions, so a provider-executed-only turn doesn't fall back to scanning
    // assistantContent's own action JSON text)
    const aiActionStart = Date.now();
    const aiActionResult = await processMessageActions(
      assistantContent, userId, adapter, run.processId, [], actionLoopContext,
      allToolCalls.length > 0 ? (clientActions as any) : undefined,
    );
    if (aiActionResult.hasActions && aiActionResult.actionResults?.length > 0) {
      const aiActionDuration = Date.now() - aiActionStart;
      for (const ar of aiActionResult.actionResults) {
        currentMessages.push(buildActionMsg(ar, aiActionDuration));
        const fileAttachmentMessage = buildFileAttachmentMessage(ar);
        if (fileAttachmentMessage) currentMessages.push(fileAttachmentMessage);
      }
    }

    const cost = isUsingUserKey(model, decryptedSettings) ? 0 : calculateTokenCost(model, inputTokens, outputTokens, cachedTokens, reasoningTokens);
    const costCheck = await checkAndUpdateCostLimit(userId, cost, totalTokens, adapter);

    if (!costCheck.allowed && costCheck.user) {
      if (costCheck.failureReason === 'MONTHLY_LIMIT_REACHED') {
        await adapter.onMonthlyLimitReached?.(userId, costCheck.user);
      } else if (costCheck.failureReason === 'WALLET_DEPLETED') {
        await adapter.onWalletDepleted?.(userId, costCheck.user);
      }
    }

    await finalize(runId, userId, currentMessages, run, adapter, inputTokens, outputTokens, totalTokens, cachedTokens, reasoningTokens, model);
    adapter.log.info(`[ChatExecution] Completed run ${runId}, tokens: ${totalTokens}`);

  } catch (err: any) {
    adapter.log.error(`[ChatExecution] executeChatTurn failed: ${err instanceof Error ? err.message : String(err)}`);

    // A $<resource id> the chosen model can't read (or that isn't attached) is
    // the user's to fix, not a failed run: say why and leave the conversation
    // where it was, still waiting for a reply if it was paused, so they can
    // change the model or the reference and send again. Thrown before
    // anything about the run changed (see resolveDataReferences callers).
    if (err instanceof DataReferenceError) {
      try {
        const current = await adapter.db.run.findUnique({ where: { id: runId }, select: { messages: true, metadata: true } });
        const messages = Array.isArray(current?.messages) ? [...(current!.messages as any[])] : [];
        // The reference is resolved before the user's own message is saved, so
        // save it here first, otherwise the error would appear above it.
        const now = new Date().toISOString();
        messages.push({ role: 'user', content: message, timestamp: now, source: 'chat', chatSource: true });
        messages.push({ role: 'assistant', source: 'prism', content: err.message, timestamp: now, error: true });
        const status = (current?.metadata as any)?.resumeState ? 'WAITING_FOR_INPUT' : 'COMPLETED';
        await adapter.db.run.update({ where: { id: runId }, data: { messages, status } });
        adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });
        adapter.emitRunUpdate(runId, { type: 'status-update', status, messages, runId });
        adapter.emitRunListUpdate(userId, { id: runId, status });
        return;
      } catch { }
    }

    try {
      if (run?.id) {
        await adapter.db.run.update({
          where: { id: runId },
          data: { status: 'ERROR', completedAt: new Date() },
        });
      }
      adapter.emitRunUpdate(runId, { type: 'status-update', status: 'ERROR', runId });
      adapter.emitRunListUpdate(userId, { id: runId, status: 'ERROR' });
    } catch { }
  }
}
