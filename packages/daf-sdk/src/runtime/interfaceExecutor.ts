// Interfaces v0.1: a multi-participant, multi-room process type. Originally
// built host-side in an application while the design was still settling; moved into
// the SDK once the shape proved out, so every daf-sdk host can offer it, not
// just the one that happened to build it first. A host still owns its own
// Process/Run schema (this reads/writes through the loose `adapter.db`
// passthrough, exactly like chatExecutor.ts does for its own extra columns)
// and its own per-model action handlers (e.g. attachFile), the engine only
// owns the turn-taking, prompt-building and action-loop logic, which has no
// host-specific dependency at all.
import { generateText } from 'ai';
import {
  canUserAffordApiCall,
  checkAndUpdateCostLimit,
  substituteVariables,
  formatActionResult,
} from './executor';
import { processMessageActions, type ActionResult } from './actionProcessor';
import { buildActionTools, annotateActionCatalogWithToolNotes } from './actionTools';
import {
  getProviderFromModel,
  getModelProvider,
  getNativeReplacedActions,
  getExcludedActions,
  buildNativeProviderTools,
  formatNativeProviderResult,
  getPreferNativeToolCallInstructions,
} from './providers';
import { calculateTokenCost } from './pricing';
import { resolveDataReferences, dataReferenceSupport } from './dataReferences';
import type { DAFStorageAdapter, UserProviderSettings, ExecutionContext } from './types';
import type { DAFInterfaceParticipant, DAFInterfaceDef } from '../protocol';

const DEFAULT_MAX_STEPS = 200;
// Providers whose participants get actions only as native tools, without
// the long text catalog (see the prompt assembly in executeInterfacesProcess).
const NATIVE_ACTIONS_ONLY_PROVIDERS = new Set(['anthropic', 'openai']);
const MAX_ACTIONS_PER_TURN = 5;
const PASS_KEYWORD = /^\s*PASS\s*$/i;

// Rooms and participants are part of the DAF format (see protocol types
// DAFInterfaceParticipant / DAFInterfaceDef and their schemas); these names
// are kept for existing callers. A room with no `type` is 'text+data', so
// every process built before the field existed keeps behaving the same:
// 'text+data' rooms get the action catalog, tools and real files, 'text'
// rooms are conversation only (no catalog text, no tools, no action loop).
export type InterfaceParticipant = DAFInterfaceParticipant;
export type InterfaceDef = DAFInterfaceDef;

export interface InterfaceAttachment {
  resourceId: string;
  name: string;
  mediaType: string;
  /** base64 */
  data: string;
}

export interface InterfaceMessage {
  role: 'assistant';
  content: string;
  timestamp: string;
  source: 'interfaces';
  model?: string;
  interfaceId: string;
  interfaceName: string;
  participantId: string;
  participantName: string;
  isActionResult?: boolean;
  /**
   * Real files that belong to this room message: an attachFile result's
   * bytes, or data resources a System step referenced as $<id>. Every
   * participant of the room whose model can read the type gets the actual
   * file on each of their turns (see collectRoomFiles); the visible
   * `content` only carries a label or the text description.
   */
  attachments?: InterfaceAttachment[];
  durationMs?: number;
  // The exact prompt sent to the model for this turn, the room framing, the
  // action catalog, the transcript, all of it. Never shown anywhere by
  // default; a host UI can surface it behind a toggle so a user can actually
  // inspect what a participant was told, instead of that only being knowable
  // by reading source code.
  debugPrompt?: string;
}

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

// The order a (participant, interface) pair is prompted in is generated as a
// simple repeating sequence, computed once up front. Random draws a fresh pair
// each turn instead, since there is no fixed sequence to repeat.
function buildSequence(
  participants: InterfaceParticipant[],
  interfaces: InterfaceDef[],
  order: 'RANDOM' | 'ROUND_ROBIN_INTERFACE_FIRST' | 'ROUND_ROBIN_PARTICIPANT_FIRST'
): Array<{ participant: InterfaceParticipant; iface: InterfaceDef }> | null {
  if (order === 'RANDOM') return null; // computed per turn instead

  const sequence: Array<{ participant: InterfaceParticipant; iface: InterfaceDef }> = [];
  const byId = new Map(participants.map((p) => [p.id, p]));

  if (order === 'ROUND_ROBIN_INTERFACE_FIRST') {
    for (const iface of interfaces) {
      for (const pid of iface.participantIds) {
        const participant = byId.get(pid);
        if (participant) sequence.push({ participant, iface });
      }
    }
  } else {
    for (const participant of participants) {
      for (const ifaceId of participant.interfaceIds) {
        const iface = interfaces.find((i) => i.id === ifaceId);
        if (iface) sequence.push({ participant, iface });
      }
    }
  }
  return sequence;
}

function pickRandomPair(
  participants: InterfaceParticipant[],
  interfaces: InterfaceDef[]
): { participant: InterfaceParticipant; iface: InterfaceDef } | null {
  const pairs: Array<{ participant: InterfaceParticipant; iface: InterfaceDef }> = [];
  for (const participant of participants) {
    for (const ifaceId of participant.interfaceIds) {
      const iface = interfaces.find((i) => i.id === ifaceId);
      if (iface) pairs.push({ participant, iface });
    }
  }
  if (pairs.length === 0) return null;
  return pairs[Math.floor(Math.random() * pairs.length)];
}

// Builds the single user-role prompt sent for one participant's turn: the
// interface convention, the participant's own persona (if any), the transcript
// of every interface they belong to (tagged so they can tell rooms apart), and
// the instruction naming which interface this specific turn targets. One plain
// text block avoids any need to reconstruct per-participant role alternation
// across a conversation that, from each participant's own view, is really N
// interleaved conversations at once.
// What a room that allows actions tells the participant about them.
// `catalog` is the full action documentation (the JSON-convention fallback),
// or null for models that get every action as a native tool and don't need
// it repeated as text. `resources` lists the ids actions refer to, always.
interface ParticipantActionsText {
  catalog: string | null;
  resources: string;
}

/**
 * Builds a participant's turn as two parts, so the part that doesn't change
 * between turns can be cached by the provider: `stable` (who they are, their
 * own instructions, the actions and resources available) goes first and is
 * identical on every turn of this participant in this kind of room; `turn`
 * (the conversation so far and "speak in room X now") is what changes. Before
 * this split the action catalog sat after the transcript and was resent at
 * full price on every turn (~40k characters per turn).
 */
function buildParticipantPrompt(
  participant: InterfaceParticipant,
  targetInterface: InterfaceDef,
  allInterfaces: InterfaceDef[],
  history: InterfaceMessage[],
  // null for a 'text' room: no actions section at all, not even a mention
  // that actions exist, the model never knows they were an option here.
  actions: ParticipantActionsText | null
): { stable: string; turn: string } {
  const ownInterfaces = allInterfaces.filter((i) => participant.interfaceIds.includes(i.id));
  const ownInterfaceNames = ownInterfaces.map((i) => i.name).join(', ');

  const transcript = history
    .filter((m) => participant.interfaceIds.includes(m.interfaceId))
    .map((m) => `[${m.interfaceName}] ${m.participantName}: ${m.content}`)
    .join('\n');

  const stable: string[] = [
    `You are "${participant.name}", one of several participants in a multi-room conversation. ` +
    `You are a member of these interfaces (rooms): ${ownInterfaceNames}. ` +
    `Each line of the conversation is tagged with the room it was said in, in the form "[Room] Speaker: message". ` +
    `You can only see rooms you belong to.`,
  ];
  if (participant.starterPrompt?.trim()) {
    stable.push(`\nYour own instructions: ${participant.starterPrompt.trim()}`);
  }
  if (actions) {
    if (actions.catalog !== null) {
      stable.push(
        `\nYou also have access to actions. To call one, reply with ONLY a JSON object of the form ` +
        `{"type":"action","variant":"<name>","parameters":{...}}, nothing else. If you already called one and ` +
        `its result appears in the conversation, use that result rather than calling it again.\n\n${actions.catalog}`
      );
    } else {
      stable.push(
        `\nYou also have access to actions, provided as tools: call a tool directly when you need one. If you ` +
        `already called one and its result appears in the conversation, use that result rather than calling it again.`
      );
    }
    stable.push(`\n${actions.resources}`);
  }

  const turn: string[] = [
    transcript ? `Conversation so far:\n${transcript}` : `Conversation so far: (nothing said yet)`,
  ];
  if (actions) {
    const callOption = actions.catalog !== null ? 'a single action-call JSON object' : 'a tool call';
    turn.push(
      `\nYou are now being asked to speak in "${targetInterface.name}". Reply with EXACTLY ONE of: (a) ${callOption}, ` +
      `(b) only the message you want to add to that room, nothing else, no tags, no room name, or (c) if you ` +
      `have nothing to add this round, exactly: PASS`
    );
  } else {
    turn.push(
      `\nYou are now being asked to speak in "${targetInterface.name}". Reply with EXACTLY ONE of: (a) only the ` +
      `message you want to add to that room, nothing else, no tags, no room name, or (b) if you have nothing to ` +
      `add this round, exactly: PASS`
    );
  }
  return { stable: stable.join('\n'), turn: turn.join('\n') };
}

/**
 * The files a participant should see this turn: from rooms they belong to
 * that allow data, once each. A file their model can read goes in as a real
 * file part; one it can't read becomes a short note, since the room's text
 * (an attachFile description, or a System label) is all that model can use.
 */
export function collectRoomFiles(
  participant: InterfaceParticipant,
  allInterfaces: InterfaceDef[],
  history: InterfaceMessage[],
): any[] {
  const dataRooms = new Set(
    allInterfaces.filter((i) => i.type !== 'text' && participant.interfaceIds.includes(i.id)).map((i) => i.id),
  );
  const seen = new Set<string>();
  const parts: any[] = [];
  for (const m of history) {
    if (!m.attachments?.length || !dataRooms.has(m.interfaceId)) continue;
    for (const a of m.attachments) {
      if (seen.has(a.resourceId)) continue;
      seen.add(a.resourceId);
      const label = `[${m.interfaceName}] Attached file: ${a.name}`;
      if (dataReferenceSupport(participant.model, a.mediaType) === 'file') {
        parts.push({ type: 'text', text: label }, { type: 'file', data: a.data, mediaType: a.mediaType });
      } else {
        parts.push({ type: 'text', text: `${label} (${a.mediaType}). Your model can't view this file type, so rely on what the room says about it.` });
      }
    }
  }
  return parts;
}

function buildInterfaceActionMsg(
  ar: ActionResult,
  participant: InterfaceParticipant,
  iface: InterfaceDef,
  durationMs: number,
  debugPrompt: string
): InterfaceMessage {
  // attachFile hands back the real bytes (data.rawContent, injectLive) when
  // the host decided they can stay in the conversation; in a room that
  // allows data they become part of the room, for every participant.
  const d: any = ar.data;
  const attachments: InterfaceAttachment[] | undefined =
    iface.type !== 'text' && d?.injectLive && d?.rawContent && d?.mediaType
      ? [{ resourceId: d.id, name: d.name || d.id, mediaType: d.mediaType, data: d.rawContent }]
      : undefined;
  return {
    ...(attachments ? { attachments } : {}),
    role: 'assistant',
    content: formatActionResult(ar),
    timestamp: new Date().toISOString(),
    source: 'interfaces',
    isActionResult: true,
    participantId: participant.id,
    participantName: participant.name,
    // Real interfaceId, same as a dialogue message, becomes part of this room's
    // shared history for every participant, not just the one who called it: an
    // action result that only the caller remembers can't be recalled later or
    // verified by the rest of the room.
    interfaceId: iface.id,
    interfaceName: iface.name,
    model: participant.model,
    durationMs,
    debugPrompt,
  };
}

export async function executeInterfacesProcess(
  processId: string,
  runId: string,
  userId: string,
  adapter: DAFStorageAdapter,
  model: string,
  resourceIds: string[],
  // Interfaces has one model per PARTICIPANT, not one per run like every other
  // engine in this SDK, so a single customActionHandler (fixed at call time)
  // can't work here. The host gets a factory instead, called fresh for
  // whichever model is acting this turn.
  customActionHandlerFactory?: (model: string) => ExecutionContext['customActionHandler']
): Promise<void> {
  let run: any;

  try {
    const process = await adapter.db.process.findFirst({ where: { id: processId, userId } });
    if (!process) throw new Error(`Process ${processId} not found`);
    run = await adapter.db.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`Run ${runId} not found`);

    if (resourceIds.length > 0) {
      await adapter.db.process.update({ where: { id: processId }, data: { resourceIds } });
    }

    const participants = ((process.interfaceParticipants as any) || []) as InterfaceParticipant[];
    const interfaces = ((process.interfaceDefs as any) || []) as InterfaceDef[];
    const order = (process.interfaceExecutionOrder as any) || 'ROUND_ROBIN_INTERFACE_FIRST';
    const maxSteps = process.interfaceMaxSteps || DEFAULT_MAX_STEPS;
    const stopKeyword = process.stopProcessKeyword?.trim() || null;

    if (participants.length === 0 || interfaces.length === 0) {
      throw new Error('An interfaces process needs at least one participant and one interface');
    }

    const steps = Array.isArray(process.steps) ? (process.steps as any[]) : [];
    let nextStepIndexPerInterface = new Map<string, number>(interfaces.map((i) => [i.id, 0]));

    const decryptedSettings = await adapter.getUser(userId);

    // Resolved once, not per-turn: the transcript is rebuilt from scratch every
    // call, and substituteVariables's $VAR regex would needlessly re-scan it and
    // could false-match a participant's own dialogue (e.g. literal "$Total").
    const actionCatalogText = await substituteVariables('$DESC_ALL_ACTIONS', userId, adapter, processId);
    const resourcesText = await substituteVariables('Available resources:\n$RESOURCES', userId, adapter, processId);

    const messages: any[] = Array.isArray(run.messages) ? [...run.messages] : [];
    const sequence = buildSequence(participants, interfaces, order);
    let seqIndex = 0;
    let accInputTokens = 0, accOutputTokens = 0, accTotalTokens = 0, accCachedTokens = 0, accReasoningTokens = 0;
    let stopped = false;

    for (let step = 0; step < maxSteps && !stopped; step++) {
      const pair = sequence ? sequence[seqIndex % sequence.length] : pickRandomPair(participants, interfaces);
      if (sequence) seqIndex++;
      if (!pair) break;
      const { participant, iface } = pair;

      if (participant.model === 'system') {
        const idx = nextStepIndexPerInterface.get(iface.id) ?? 0;
        const targetSteps = steps.filter((s) => s.targetInterfaceId === iface.id);
        if (idx >= targetSteps.length) continue; // nothing left for System to say here, skip silently
        const rawPrompt = targetSteps[idx].prompt || '';
        nextStepIndexPerInterface.set(iface.id, idx + 1);
        let content = await substituteVariables(rawPrompt, userId, adapter, processId);

        // $<resource id> references to data resources: the actual file joins
        // the room. Checked against every model in the room up front, so a
        // participant that can't read it fails the run with a clear message
        // instead of silently missing the file (see dataReferences.ts).
        const roomModels = participants
          .filter((p) => p.model !== 'system' && iface.participantIds.includes(p.id))
          .map((p) => p.model);
        const refs = await resolveDataReferences(content, { userId, adapter, models: roomModels, processId });
        let attachments: InterfaceAttachment[] | undefined;
        if (refs.attachmentMessages.length > 0) {
          if (iface.type === 'text') {
            throw new Error(`"${iface.name}" is a Text room, so the file referenced in its System step can't be sent. Switch the room to Text + Data.`);
          }
          attachments = [];
          content = refs.text;
          for (const am of refs.attachmentMessages) {
            const filePart = (am.content as any[]).find((p) => p.type === 'file');
            const textPart = (am.content as any[]).find((p) => p.type === 'text');
            if (filePart) {
              const row = await adapter.db.resource.findFirst({ where: { id: am.sourceResourceId, userId } });
              attachments.push({ resourceId: am.sourceResourceId, name: row?.name || am.sourceResourceId, mediaType: filePart.mediaType, data: filePart.data });
            } else if (textPart) {
              // A text file: inline it into the room, every model reads text.
              content = `${content}\n\n${textPart.text}`;
            }
          }
        }

        messages.push({
          role: 'assistant', content, timestamp: new Date().toISOString(),
          source: 'interfaces',
          interfaceId: iface.id, interfaceName: iface.name,
          participantId: participant.id, participantName: participant.name,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        });
        await adapter.db.run.update({ where: { id: runId }, data: { messages } });
        adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });

        if (stopKeyword && content.includes(stopKeyword)) stopped = true;
        continue;
      }

      const customActionHandler = customActionHandlerFactory?.(participant.model);
      const modelProvider = getModelProvider(participant.model, decryptedSettings);
      const executionContext: ExecutionContext = {
        model: participant.model,
        modelProvider,
        customActionHandler,
        onTokenUsage: async (input, output, total, cached, reasoning) => {
          accInputTokens += input; accOutputTokens += output; accTotalTokens += total;
          accCachedTokens += cached; accReasoningTokens += reasoning;
          const c = isUsingUserKey(participant.model, decryptedSettings) ? 0 : calculateTokenCost(participant.model, input, output, cached, reasoning);
          await checkAndUpdateCostLimit(userId, c, total, adapter);
        },
      };

      let finalText: string | null = null;
      let passedTurn = false;
      let lastPrompt = '';
      const turnStart = Date.now();
      // A 'text' room never sees the action catalog and never gets tools,
      // one plain generateText call, its reply is final (PASS or the line),
      // no inner loop needed at all since there's nothing to loop on.
      const roomAllowsActions = iface.type !== 'text';

      for (let inner = 0; inner < (roomAllowsActions ? MAX_ACTIONS_PER_TURN : 1); inner++) {
        const affordCheck = await canUserAffordApiCall(userId, adapter);
        if (!affordCheck.allowed) {
          await adapter.db.run.update({
            where: { id: runId },
            data: { status: 'ERROR', completedAt: new Date(), error: affordCheck.failureReason },
          });
          adapter.emitRunUpdate(runId, { type: 'status-update', status: 'ERROR', messages, runId, errorReason: affordCheck.failureReason });
          adapter.emitRunListUpdate(userId, { id: runId, status: 'ERROR' });
          return;
        }

        // Rebuilt fresh each inner iteration: `messages` already includes any
        // action-result messages pushed earlier this turn, since they carry a
        // real interfaceId and pass this same history filter like any other
        // room message.
        // Claude and GPT get every action as a native tool (with its
        // description) and use tools reliably, so the ~40k-character text
        // catalog would only repeat them. Other models keep it as the
        // JSON-convention fallback, in the cached stable part.
        const nativeActionsOnly = NATIVE_ACTIONS_ONLY_PROVIDERS.has(getProviderFromModel(participant.model));
        const { stable, turn } = buildParticipantPrompt(
          participant, iface, interfaces, messages,
          roomAllowsActions ? { catalog: nativeActionsOnly ? null : actionCatalogText, resources: resourcesText } : null,
        );
        lastPrompt = `${stable}\n\n${turn}`;
        let ourOwnTools: ReturnType<typeof buildActionTools> = {};
        let tools: any = undefined;
        // The stable part first, marked as a cache point for Claude (OpenAI and
        // Gemini cache a repeated prefix on their own). Then this participant's
        // room files, then the conversation and "speak in room X now".
        const fileParts = collectRoomFiles(participant, interfaces, messages);
        let promptMessages: Array<{ role: 'user'; content: any }> = [
          { role: 'user', content: [{ type: 'text', text: stable, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }] },
          { role: 'user', content: fileParts.length > 0 ? [...fileParts, { type: 'text', text: turn }] : turn },
        ];
        if (roomAllowsActions) {
          const nativeReplaced = getNativeReplacedActions(participant.model);
          const excludeVariants = [...nativeReplaced, ...getExcludedActions()];
          ourOwnTools = buildActionTools(excludeVariants.length > 0 ? { excludeVariants } : undefined);
          tools = {
            ...ourOwnTools,
            ...buildNativeProviderTools(participant.model),
          };
          promptMessages = annotateActionCatalogWithToolNotes(promptMessages, Object.keys(ourOwnTools));
        }
        const llmResult = await generateText({
          model: modelProvider,
          messages: promptMessages,
          ...(roomAllowsActions ? { tools, instructions: getPreferNativeToolCallInstructions(participant.model) } : {}),
          abortSignal: AbortSignal.timeout(120_000),
        });

        const usage = llmResult.usage;
        const inputTokens = usage?.inputTokens || 0;
        const outputTokens = usage?.outputTokens || 0;
        const totalTokens = usage?.totalTokens || (inputTokens + outputTokens);
        const cachedTokens = (usage as any)?.inputTokenDetails?.cacheReadTokens || 0;
        const reasoningTokens = (usage as any)?.outputTokenDetails?.reasoningTokens || 0;
        accInputTokens += inputTokens; accOutputTokens += outputTokens; accTotalTokens += totalTokens;
        accCachedTokens += cachedTokens; accReasoningTokens += reasoningTokens;

        const cost = isUsingUserKey(participant.model, decryptedSettings) ? 0 : calculateTokenCost(participant.model, inputTokens, outputTokens, cachedTokens, reasoningTokens);
        await checkAndUpdateCostLimit(userId, cost, totalTokens, adapter);

        const rawText = llmResult.text.trim();

        if (!roomAllowsActions) {
          if (PASS_KEYWORD.test(rawText)) { passedTurn = true; } else { finalText = rawText; }
          break;
        }

        const allToolCalls = llmResult.toolCalls || [];
        const clientToolCalls = allToolCalls.filter((tc: any) => !tc.providerExecuted);
        const providerExecutedCalls = allToolCalls.filter((tc: any) => tc.providerExecuted);
        const clientActions = clientToolCalls.map((tc: any) => ({ type: 'action' as const, variant: tc.toolName, parameters: tc.input }));
        let actedThisIteration = false;

        for (const call of providerExecutedCalls as any[]) {
          const toolResult = (llmResult.toolResults || []).find((tr: any) => tr.toolCallId === call.toolCallId);
          const formatted = formatNativeProviderResult(call.toolName, toolResult?.output);
          const ar: ActionResult = { success: true, message: formatted };
          messages.push(buildInterfaceActionMsg(ar, participant, iface, Date.now() - turnStart, lastPrompt));
          actedThisIteration = true;
        }

        // Pass clientActions whenever ANY tool call happened (even provider-executed-only),
        // not just when clientActions is non-empty, otherwise a provider-executed-only turn
        // falls through to processMessageActions re-scanning rawText for JSON action syntax
        // that was never there. Mirrors chatExecutor.ts's own aiActionResult call.
        const preParsed = allToolCalls.length > 0 ? clientActions : undefined;
        const actionResult = await processMessageActions(rawText, userId, adapter, processId, [], executionContext, preParsed as any);
        if (actionResult.hasActions && actionResult.actionResults.length > 0) {
          for (const ar of actionResult.actionResults) {
            messages.push(buildInterfaceActionMsg(ar, participant, iface, Date.now() - turnStart, lastPrompt));
          }
          actedThisIteration = true;
        }

        if (actedThisIteration) {
          await adapter.db.run.update({ where: { id: runId }, data: { messages } });
          adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });
          continue;
        }

        if (PASS_KEYWORD.test(rawText)) { passedTurn = true; } else { finalText = rawText; }
        break;
      }

      if (passedTurn) {
        adapter.log.info(`[Interfaces] "${participant.name}" passed on "${iface.name}"`);
        continue;
      }
      if (finalText === null) {
        adapter.log.warn(`[Interfaces] "${participant.name}" hit the ${MAX_ACTIONS_PER_TURN}-action budget on "${iface.name}" without a reply; skipping turn`);
        continue;
      }

      const content = await substituteVariables(finalText, userId, adapter, processId);
      messages.push({
        role: 'assistant', content, timestamp: new Date().toISOString(),
        source: 'interfaces', model: participant.model,
        interfaceId: iface.id, interfaceName: iface.name,
        participantId: participant.id, participantName: participant.name,
        debugPrompt: lastPrompt,
      });
      await adapter.db.run.update({ where: { id: runId }, data: { messages } });
      adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });

      if (stopKeyword && content.includes(stopKeyword)) stopped = true;
    }

    const updatedRun = await adapter.db.run.update({
      where: { id: runId },
      data: {
        messages, status: 'COMPLETED', completedAt: new Date(), model,
        promptTokens: (run.promptTokens || 0) + accInputTokens,
        completionTokens: (run.completionTokens || 0) + accOutputTokens,
        totalTokens: (run.totalTokens || 0) + accTotalTokens,
        cachedPromptTokens: (run.cachedPromptTokens || 0) + accCachedTokens,
        reasoningTokens: (run.reasoningTokens || 0) + accReasoningTokens,
        metadata: { ...(run.metadata as any || {}), isInterfacesRun: true },
      },
    });
    adapter.emitRunUpdate(runId, { type: 'messages-update', messages, runId });
    adapter.emitRunUpdate(runId, { type: 'status-update', status: 'COMPLETED', messages, runId });
    adapter.emitRunListUpdate(userId, updatedRun);
  } catch (err: any) {
    adapter.log.error(`[Interfaces] executeInterfacesProcess failed: ${err?.message}`, err);
    try {
      if (run?.id) {
        await adapter.db.run.update({ where: { id: runId }, data: { status: 'ERROR', completedAt: new Date(), error: err?.message } });
      }
      adapter.emitRunUpdate(runId, { type: 'status-update', status: 'ERROR', runId });
      adapter.emitRunListUpdate(userId, { id: runId, status: 'ERROR' });
    } catch { }
  }
}
