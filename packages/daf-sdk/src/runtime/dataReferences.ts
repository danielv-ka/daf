// ============================================================================
// $<resource id> references to data resources
// ============================================================================
//
// A prompt (a process step, a chat message, or a reply to a paused process)
// can reference a `data` resource by writing `$` followed by its id, e.g.
// "Summarize this file. $cm1abc123def456gh". The reference is replaced by a
// short "[Attached file: name]" label and the resource's actual content is
// sent to the model alongside the prompt, as a native file part, the same
// shape attachFile's live injection uses (see buildFileAttachmentMessage in
// executor.ts). Unlike attachFile, the model doesn't have to decide to fetch
// the file: whoever wrote the prompt already did.
//
// Which content can be sent depends on the model that will read it. Images
// and PDFs go as native file parts when the model's provider accepts them;
// plain-text formats are inlined as text, which every model reads. Anything
// else, or a type the chosen model can't read, fails with a clear error
// instead of a provider error mid-run.
//
// The substitution regex in substituteVariables leaves unknown $TOKENS alone,
// so a resource id survives variable substitution intact and is resolved here
// afterwards. Only ids of `data` resources accessible to the process (attached
// to it or a parent, the same rule readData uses) are treated as references;
// any other $word is left untouched.

import type { DAFStorageAdapter } from './types';
import type { MessageContentPart } from '../protocol';
import { getProviderFromModel } from './providers';

// Providers whose `ai` SDK integration accepts these as plain file parts.
// Kept narrow on purpose, several providers advertise broader support only
// through a separate mechanism (Mistral's OCR product for documents, xAI's
// search tool for PDFs) that a plain file part does not reach.
const NATIVE_IMAGE_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'mistral', 'xai', 'moonshot']);
const NATIVE_PDF_PROVIDERS = new Set(['anthropic', 'google', 'openai']);
// Anthropic's per-image limit is the tightest of the providers above.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TEXT_MEDIA_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'text/html', 'application/json']);

// Loose enough for cuid/cuid2/uuid-style ids, anchored on "$" so ordinary
// words are never looked up.
const REFERENCE_PATTERN = /\$([a-z0-9][a-z0-9_-]{15,})/gi;

export interface DataReferenceResolution {
  /** The text with each resolved `$id` replaced by an "[Attached file: name]" label. */
  text: string;
  /** One hidden, model-visible message per referenced file, to add right before the prompt. */
  attachmentMessages: any[];
}

export class DataReferenceError extends Error {}

/** Whether `model` can take a file of `mediaType` directly, and how. */
export function dataReferenceSupport(model: string, mediaType: string): 'file' | 'text' | null {
  if (TEXT_MEDIA_TYPES.has(mediaType) || mediaType.startsWith('text/')) return 'text';
  const provider = getProviderFromModel(model);
  if (mediaType.startsWith('image/')) return NATIVE_IMAGE_PROVIDERS.has(provider) ? 'file' : null;
  if (mediaType === 'application/pdf') return NATIVE_PDF_PROVIDERS.has(provider) ? 'file' : null;
  return null;
}

async function accessibleResourceIds(
  adapter: DAFStorageAdapter,
  userId: string,
  processId: string | undefined,
  parentProcessIds: string[],
  extraResourceIds: string[],
): Promise<Set<string>> {
  const ids = new Set<string>(extraResourceIds);
  const processIds = [processId, ...parentProcessIds].filter(Boolean) as string[];
  if (processIds.length > 0) {
    const processes = await adapter.db.process.findMany({
      where: { id: { in: processIds }, userId },
      select: { resourceIds: true },
    });
    for (const p of processes as any[]) for (const id of p.resourceIds || []) ids.add(id);
  }
  return ids;
}

/**
 * Finds `$<id>` references to accessible `data` resources in `text` and
 * prepares their content for `model`. Throws DataReferenceError, with a
 * message meant for the person who wrote the prompt, when a referenced file
 * can't be sent to this model.
 */
export async function resolveDataReferences(
  text: string,
  options: {
    userId: string;
    adapter: DAFStorageAdapter;
    model: string;
    processId?: string;
    parentProcessIds?: string[];
    /** Resource ids accessible in this context beyond the process's own (e.g. chat-attached ones). */
    extraResourceIds?: string[];
    /**
     * The run's messages so far. A file already attached earlier in the run
     * (e.g. a looped step referencing the same resource on every iteration)
     * is not attached again, only its label is written.
     */
    existingMessages?: any[];
  },
): Promise<DataReferenceResolution> {
  const candidates = [...new Set([...text.matchAll(REFERENCE_PATTERN)].map((m) => m[1]))];
  if (candidates.length === 0) return { text, attachmentMessages: [] };

  const { userId, adapter, model } = options;
  const rows = await adapter.db.resource.findMany({
    where: { userId, type: 'data', id: { in: candidates } },
  });
  if (rows.length === 0) return { text, attachmentMessages: [] };

  const accessible = await accessibleResourceIds(
    adapter, userId, options.processId, options.parentProcessIds ?? [], options.extraResourceIds ?? [],
  );

  const alreadyAttached = new Set(
    (options.existingMessages ?? []).filter((m) => m?.isFileAttachment && m?.sourceResourceId).map((m) => m.sourceResourceId),
  );

  let resolved = text;
  const attachmentMessages: any[] = [];
  for (const row of rows as any[]) {
    if (!accessible.has(row.id)) {
      throw new DataReferenceError(`"${row.name}" ($${row.id}) is not attached to this process, so it can't be sent to the model. Attach it first.`);
    }
    const content: unknown = row.metadata?.content;
    const mediaType: string = row.metadata?.mediaType || 'application/octet-stream';
    if (typeof content !== 'string' || content.length === 0) {
      throw new DataReferenceError(`"${row.name}" ($${row.id}) has no stored content to send.`);
    }
    const bytes = Buffer.from(content, 'base64');
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new DataReferenceError(`"${row.name}" is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${MAX_FILE_BYTES / 1024 / 1024}MB limit for sending a file with a prompt.`);
    }
    const support = dataReferenceSupport(model, mediaType);
    if (!support) {
      const hint = mediaType.includes('spreadsheet') || mediaType.includes('excel')
        ? ' No model reads spreadsheets directly: refer to it by name instead and let the model use attachFile, which reads it exactly.'
        : '';
      throw new DataReferenceError(`${model} can't read "${row.name}" (${mediaType}) directly.${hint || ' Pick a different model, or refer to it by name and let the model use attachFile.'}`);
    }

    const label = `[Attached file: ${row.name}]`;
    resolved = resolved.split(`$${row.id}`).join(label);
    if (alreadyAttached.has(row.id)) continue;
    const parts: MessageContentPart[] = support === 'file'
      ? [{ type: 'text', text: label }, { type: 'file', data: content, mediaType } as any]
      : [{ type: 'text', text: `${label}\n\n${bytes.toString('utf8')}` }];
    attachmentMessages.push({
      role: 'user',
      content: parts,
      timestamp: new Date().toISOString(),
      isFileAttachment: true, // hidden from chat UI, NOT excluded from the messages sent to the model
      sourceResourceId: row.id,
    });
  }
  return { text: resolved, attachmentMessages };
}
