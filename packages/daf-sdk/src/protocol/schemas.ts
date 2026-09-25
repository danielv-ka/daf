/**
 * Zod schemas for validating DAF documents
 */

import { z } from 'zod';
import {
  SUPPORTED_VERSIONS,
  PROCESS_TYPES,
  STEP_TYPES,
  LOOP_TYPES,
  ACTION_TYPES,
  EDITOR_ACTION_TYPES,
  RESOURCE_TYPES,
  WRITE_OPERATIONS,
  DAF_FILE_TYPES,
} from './constants';

// ============================================================================
// Resource Schema
// ============================================================================

export const resourceSchema = z.object({
  name: z.string().min(1, 'Resource name is required'),
  type: z.enum([
    RESOURCE_TYPES.GOOGLE_DOC,
    RESOURCE_TYPES.NOTION_PAGE,
    RESOURCE_TYPES.GOOGLE_DRIVE_FOLDER,
    RESOURCE_TYPES.MD_FILE,
    RESOURCE_TYPES.NOTION_DATABASE,
    RESOURCE_TYPES.MONGODB_COLLECTION,
    RESOURCE_TYPES.DATA,
  ]),
  url: z.string().min(1, 'Resource URL or path is required'),
  isGlobal: z.boolean(),
});

// ============================================================================
// Step Schema
// ============================================================================

export const stepSchema = z.object({
  type: z.enum([
    STEP_TYPES.PROMPT,
    STEP_TYPES.PROCESS,
    STEP_TYPES.USER_FEEDBACK,
    STEP_TYPES.COMPLETION_WITHOUT_PROMPT,
  ]),

  // Prompt step fields
  prompt: z.string().optional(),

  // Process reference fields. processId is the legacy, environment-specific
  // reference; processName is the portable v2.0 convention (processes are
  // referenced by name, same as manifest schedules). Either satisfies a
  // process-type step, since an export may carry one or the other depending
  // on which format produced it.
  processId: z.string().optional(),
  processName: z.string().optional(),

  // Loop configuration
  loopType: z.enum([LOOP_TYPES.NONE, LOOP_TYPES.FIXED, LOOP_TYPES.STOP_ON]).optional(),
  forLoopCount: z.int().positive().optional(),
  stopOnKeyword: z.string().optional(),
  stopOnMaxLoops: z.int().positive().optional(),

  // Advanced dialogue options
  skipCompletion: z.boolean().optional(),
}).refine(
  (data) => {
    // Validate prompt step has prompt
    if (data.type === STEP_TYPES.PROMPT && !data.prompt) {
      return false;
    }
    // Validate process step has a reference, either form
    if (data.type === STEP_TYPES.PROCESS && !data.processId && !data.processName) {
      return false;
    }
    // Validate fixed loop has forLoopCount
    if (data.loopType === LOOP_TYPES.FIXED && !data.forLoopCount) {
      return false;
    }
    // Validate stopOn loop has stopOnKeyword
    if (data.loopType === LOOP_TYPES.STOP_ON && !data.stopOnKeyword) {
      return false;
    }
    return true;
  },
  {
    error: 'Invalid step configuration'
  }
);

// ============================================================================
// Process Schema
// ============================================================================

export const processSchema = z.object({
  name: z.string().min(1, 'Process name is required'),
  description: z.string().optional(),
  processType: z.enum([
    PROCESS_TYPES.STATIC_DIALOGUE,
    PROCESS_TYPES.ADVANCED_DIALOGUE,
  ]),
  stopProcessKeyword: z.string().optional(),
  resources: z.array(resourceSchema).optional(),
  // Manifests only: the `ref` of each manifest resource attached to this
  // process, so an import can re-attach them (see manifestResourceSchema).
  resourceRefs: z.array(z.string().min(1)).optional(),
  steps: z.array(stepSchema).min(1, 'Process must have at least one step'),
}).refine(
  (data) => {
    // stopProcessKeyword only valid for ADVANCED_DIALOGUE
    if (data.stopProcessKeyword && data.processType !== PROCESS_TYPES.ADVANCED_DIALOGUE) {
      return false;
    }
    return true;
  },
  {
    error: 'stopProcessKeyword is only valid for ADVANCED_DIALOGUE processes'
  }
);

// ============================================================================
// DAF Document Schema
// ============================================================================

export const dafDocumentSchema = z.object({
  dafVersion: z.enum(SUPPORTED_VERSIONS as any, {
    message: `DAF version must be one of: ${SUPPORTED_VERSIONS.join(', ')}`,
  }),
  variables: z.record(z.string(), z.string()).optional(),
  resources: z.array(resourceSchema).optional(),
  processes: z.array(processSchema).min(1, 'At least one process is required'),
});

// ============================================================================
// DAF v2.0: Process Definition & Manifest Schemas
// ============================================================================

export const processDefinitionFileSchema = z.object({
  dafVersion: z.literal('2.0.0'),
  dafType: z.literal(DAF_FILE_TYPES.PROCESS),
  processes: z.array(processSchema).min(1, 'At least one process is required'),
});

export const manifestVariablesSchema = z.object({
  user: z.record(z.string(), z.string()),
  system: z.record(z.string(), z.string()),
});

export const manifestResourceSchema = resourceSchema.extend({
  requiredIntegration: z.string().optional(),
  // The resource's id in the exporting account. Ids differ between accounts,
  // so anything that pointed at this resource by id (a process's attached
  // resources, a `$<id>` reference in step text) is exported against this
  // ref and remapped to the new id on import.
  ref: z.string().min(1).optional(),
  // `data` resources only: the stored file itself (base64) and its media type.
  // content may be left out (e.g. over a size limit); an importer then can't
  // recreate the file and should say so.
  mediaType: z.string().min(1).optional(),
  content: z.string().optional(),
}).refine(
  (r) => r.type !== RESOURCE_TYPES.DATA || !!r.mediaType,
  { error: 'A data resource needs a mediaType' },
);

export const manifestScheduleSchema = z.object({
  name: z.string().min(1, 'Schedule name is required'),
  processName: z.string().min(1, 'processName is required'),
  model: z.string().optional(),
  interval: z.enum([
    'IMMEDIATE', 'MINUTELY', 'FIVE_MINUTES', 'TEN_MINUTES', 'THIRTY_MINUTES',
    'HOURLY', 'TWO_HOURS', 'FOUR_HOURS', 'EIGHT_HOURS',
    'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM',
  ]),
  intervalValue: z.number().optional(),
  intervalUnit: z.enum(['SECONDS', 'MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS']).optional(),
  firstExecutionType: z.enum(['IMMEDIATE', 'DELAYED', 'MANUAL', 'EXACT']).optional(),
  firstExecutionDelay: z.number().optional(),
  firstExecutionUnit: z.enum(['SECONDS', 'MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS']).optional(),
  exactExecutionTime: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const manifestFileSchema = z.object({
  dafVersion: z.literal('2.0.0'),
  dafType: z.literal(DAF_FILE_TYPES.MANIFEST),
  variables: manifestVariablesSchema,
  resources: z.array(manifestResourceSchema),
  actions: z.array(z.enum(Object.values(ACTION_TYPES) as [string, ...string[]])),
  schedules: z.array(manifestScheduleSchema).optional(),
  processes: z.array(processSchema).min(1, 'At least one process is required'),
});

/**
 * Discriminates on `dafType` before applying the matching schema, so a
 * malformed or missing `dafType` fails with a clear error instead of falling
 * through to whichever schema happens to partially match.
 */
export const dafFileSchema = z.discriminatedUnion('dafType', [
  processDefinitionFileSchema,
  manifestFileSchema,
]);

// ============================================================================
// Action Schemas
//
// These mirror the per-variant field checks the runtime performs in its
// action processor (its isValid* functions), so that validation behaviour
// stays in parity across the SDK and the platform.
// ============================================================================

// Shared scrapeOptions shape used by search / newsSearch (kept loose).
const searchScrapeOptionsSchema = z
  .object({
    formats: z.array(z.string()).optional(),
    onlyMainContent: z.boolean().optional(),
    timeout: z.number().optional(),
    maxAge: z.number().optional(),
    parsers: z
      .array(z.object({ type: z.string(), maxPages: z.number().optional() }))
      .optional(),
    proxy: z.enum(['basic', 'enhanced', 'auto']).optional(),
  })
  .loose();

const rangeSchema = z.object({
  startIndex: z.number(),
  endIndex: z.number(),
});

export const sendEmailParamsSchema = z.object({
  to: z.string().min(1, 'Recipient is required'),
  subject: z.string().min(1, 'Subject is required'),
  content: z.string().min(1, 'Content is required'),
  from_name: z.string().optional(),
});

export const scrapeParamsSchema = z.object({
  url: z.string().min(1, 'URL is required'),
  timeout: z.number().optional(),
});

export const searchParamsSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().optional(),
  ignoreInvalidURLs: z.boolean().optional(),
  sources: z.array(z.enum(['web', 'news', 'images'])).optional(),
  categories: z.array(z.enum(['github', 'research', 'pdf'])).optional(),
  tbs: z.string().optional(),
  location: z.string().optional(),
  scrapeOptions: searchScrapeOptionsSchema.optional(),
});

export const newsSearchParamsSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().optional(),
  ignoreInvalidURLs: z.boolean().optional(),
  tbs: z.string().optional(),
  location: z.string().optional(),
  scrapeOptions: searchScrapeOptionsSchema.optional(),
});

export const previewSearchParamsSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().optional(),
  sources: z.array(z.enum(['web', 'news'])).optional(),
});

export const tavilySearchParamsSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  maxResults: z.number().optional(),
  searchDepth: z.enum(['basic', 'advanced']).optional(),
  includeAnswer: z.boolean().optional(),
});

export const checkDomainParamsSchema = z.object({
  domains: z.array(z.string().trim().min(1)).min(1, 'At least one domain is required'),
});

export const readDocumentParamsSchema = z.object({
  resourceUrl: z.string().min(1, 'resourceUrl is required'),
});

export const writeDocumentParamsSchema = z
  .object({
    resourceUrl: z.string().min(1, 'resourceUrl is required'),
    content: z.string(),
    mode: z
      .enum([
        WRITE_OPERATIONS.REPLACE,
        WRITE_OPERATIONS.APPEND,
        WRITE_OPERATIONS.SELECTIVE,
      ])
      .optional(),
    range: rangeSchema.optional(),
  })
  .refine(
    (data) => {
      // Selective mode requires a valid range
      if (data.mode === WRITE_OPERATIONS.SELECTIVE) {
        if (!data.range) return false;
        if (data.range.startIndex < 0 || data.range.endIndex <= data.range.startIndex) {
          return false;
        }
      }
      return true;
    },
    { error: 'Selective mode requires a valid range (startIndex >= 0, endIndex > startIndex)' }
  );

export const formatDocumentParamsSchema = z
  .object({
    resourceUrl: z.string().min(1, 'resourceUrl is required'),
    range: rangeSchema.optional(),
    formatting: z.object({
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      fontSize: z.number().optional(),
    }),
  })
  .refine(
    (data) =>
      data.formatting.bold !== undefined ||
      data.formatting.italic !== undefined ||
      data.formatting.fontSize !== undefined,
    { error: 'At least one formatting option (bold, italic, fontSize) is required' }
  );

export const removeDocumentParamsSchema = z.object({
  resourceUrl: z.string().min(1, 'resourceUrl is required'),
});

export const renameDocumentParamsSchema = z.object({
  resourceUrl: z.string().min(1, 'resourceUrl is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const duplicateDocumentParamsSchema = z.object({
  resourceUrl: z.string().min(1, 'resourceUrl is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const addDocumentParamsSchema = z.object({
  documentName: z.string().min(1, 'documentName is required'),
  provider: z.enum(['google', 'notion']),
  locationUrl: z.string().optional(),
  content: z.string().optional(),
});

export const addFolderParamsSchema = z.object({
  folderName: z.string().min(1, 'folderName is required'),
  provider: z.enum(['google', 'notion']),
  parentUrl: z.string().optional(),
});

export const removeFolderParamsSchema = z.object({
  folderUrl: z.string().min(1, 'folderUrl is required'),
});

export const readFolderParamsSchema = z.object({
  folderUrl: z.string().min(1, 'folderUrl is required'),
});

export const renameFolderParamsSchema = z.object({
  folderUrl: z.string().min(1, 'folderUrl is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const createDatabaseParamsSchema = z.object({
  databaseName: z.string().min(1, 'databaseName is required'),
  parentPageUrl: z.string().min(1).optional(),
});

export const readDatabaseParamsSchema = z.object({
  databaseUrl: z.string().min(1, 'databaseUrl is required'),
});

export const updateDatabaseParamsSchema = z
  .object({
    databaseUrl: z.string().min(1, 'databaseUrl is required'),
    databaseName: z.string().optional(),
    properties: z.record(z.string(), z.any()).optional(),
  })
  .refine((data) => data.databaseName !== undefined || data.properties !== undefined, {
    error: 'At least one of databaseName or properties is required',
  });

export const deleteDatabaseParamsSchema = z.object({
  databaseUrl: z.string().min(1, 'databaseUrl is required'),
});

export const writeDatabaseParamsSchema = z.object({
  databaseUrl: z.string().min(1, 'databaseUrl is required'),
  properties: z.record(z.string(), z.any()),
  content: z.string().optional(),
});

export const duplicateDatabaseParamsSchema = z.object({
  databaseUrl: z.string().min(1, 'databaseUrl is required'),
  newDatabaseName: z.string().optional(),
});

export const dbFindParamsSchema = z
  .object({ resourceUrl: z.string().min(1, 'resourceUrl is required') })
  .loose();

export const dbInsertParamsSchema = z.object({
  resourceUrl: z.string().min(1, 'resourceUrl is required'),
  document: z.record(z.string(), z.unknown()),
});

export const dbUpdateParamsSchema = z
  .object({
    resourceUrl: z.string().min(1, 'resourceUrl is required'),
    filter: z.record(z.string(), z.unknown()),
    update: z.record(z.string(), z.unknown()),
  })
  .loose();

export const dbDeleteParamsSchema = z
  .object({
    resourceUrl: z.string().min(1, 'resourceUrl is required'),
    filter: z.record(z.string(), z.unknown()),
  })
  .loose();

export const askUserInputParamsSchema = z
  .object({ message: z.string().optional() })
  .loose();

export const runCodeParamsSchema = z.object({
  code: z.string().min(1, 'code is required'),
  timeout: z.number().optional(),
});

export const runShellParamsSchema = z.object({
  command: z.string().min(1, 'command is required'),
  timeout: z.number().optional(),
});

export const readMdFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const writeMdFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  content: z.string(),
  mode: z.enum(['replace', 'append']).optional(),
});

export const createMdFileParamsSchema = z.object({
  name: z.string().min(1, 'name is required'),
  content: z.string().optional(),
});

export const deleteMdFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const renameMdFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const duplicateMdFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const attachFileParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

// Data resource actions. Mirror the runtime's isValid* checks for each
// variant (actionProcessor.ts); content is base64.
export const readDataParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const writeDataParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  content: z.string().min(1, 'content is required'),
  mediaType: z.string().optional(),
});

export const createDataParamsSchema = z.object({
  name: z.string().min(1, 'name is required'),
  content: z.string().min(1, 'content is required'),
  mediaType: z.string().min(1, 'mediaType is required'),
});

export const deleteDataParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
});

export const renameDataParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const duplicateDataParamsSchema = z.object({
  id: z.string().min(1, 'id is required'),
  newName: z.string().min(1, 'newName is required'),
});

export const editorActionBaseParamsSchema = z.object({
  selectedText: z.string().min(1, 'selectedText is required'),
  from: z.int().nonnegative().optional(),
  to: z.int().nonnegative().optional(),
});

export const translateParamsSchema = editorActionBaseParamsSchema.extend({
  language: z.string().min(1, 'language is required'),
});

export const directiveParamsSchema = editorActionBaseParamsSchema.extend({
  directive: z.string().min(1, 'directive is required'),
});

export const actionSchema = z.object({
  type: z.literal('action'),
  variant: z.enum(Object.values(ACTION_TYPES) as [string, ...string[]]),
  parameters: z.record(z.string(), z.any()),
});

export const editorActionSchema = z.object({
  type: z.literal('editorAction'),
  variant: z.enum(Object.values(EDITOR_ACTION_TYPES) as [string, ...string[]]),
  parameters: z.record(z.string(), z.any()),
});
