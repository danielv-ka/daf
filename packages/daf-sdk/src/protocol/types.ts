/**
 * Core TypeScript types for DAF (Defined Action Framework)
 */

// ============================================================================
// Root DAF Document
// ============================================================================

export interface DAFDocument {
  dafVersion: string;
  variables?: Record<string, string>;
  resources?: DAFResource[];
  processes: DAFProcess[];
}

// ============================================================================
// DAF v2.0: Process Definitions & Manifests
//
// v2.0 splits the old single DAFDocument shape into two distinct artifacts:
//
// - A process definition is fully environment-agnostic: just the process(es)
//   themselves, no variables, no resources. Portable in the strongest sense,
//   it says nothing about what environment will run it, only what it does.
// - A manifest is a process definition plus the full environment it expects:
//   variables (split into user-set values and expected system variable
//   names), resources (each optionally flagging which integration it needs),
//   and the exporting app's complete action vocabulary. A manifest describes
//   an environment, not just a workflow.
//
// Both are discriminated by `dafType`.
// ============================================================================

export type DafFileType = 'process' | 'manifest';

/**
 * A portable, environment-agnostic process definition. Contains no
 * variables or resources, a process definition assumes *some* DAF-compliant
 * environment will supply whatever its steps reference ($STARTERPROMPT,
 * action calls, etc.), it does not describe that environment itself.
 */
export interface DAFProcessDefinitionFile {
  dafVersion: string;
  dafType: 'process';
  processes: DAFProcess[];
}

/**
 * Variables split by origin: `user` are actual key/value pairs the user set
 * themselves (same shape as the v1.x `variables` field). `system` are
 * system-provided variables (e.g. the ~50 DESC_ action docs, RESOURCES,
 * DATETIME, STARTERPROMPT variables daf-sdk defines) with their values included,
 * most of these are static SDK constants, the same everywhere, so there's
 * no reason to withhold the value. The one exception is a per-user computed
 * variable like `SKILLS`: its value here is a snapshot taken at export
 * time, not a live binding, since a different host or user recomputes it
 * fresh at runtime rather than reusing whatever traveled with the export.
 */
export interface DAFManifestVariables {
  user: Record<string, string>;
  system: Record<string, string>;
}

/**
 * A resource as it appears in a manifest. Adds `requiredIntegration` on top
 * of the base DAFResource shape, deliberately a separate field from
 * `type`/`url`, since not every resource needs a connected integration (a
 * plain web URL or a local md_file needs nothing) so the importer shouldn't
 * have to infer it. Absent/undefined means no integration is required.
 */
export interface DAFManifestResource extends DAFResource {
  requiredIntegration?: string;
  /** The resource's id in the exporting account; step text and process attachments refer to it. */
  ref?: string;
  /** `data` resources only. */
  mediaType?: string;
  /** `data` resources only: the file, base64. May be omitted (e.g. over a size limit). */
  content?: string;
}

export type ScheduleInterval =
  | 'IMMEDIATE' | 'MINUTELY' | 'FIVE_MINUTES' | 'TEN_MINUTES' | 'THIRTY_MINUTES'
  | 'HOURLY' | 'TWO_HOURS' | 'FOUR_HOURS' | 'EIGHT_HOURS'
  | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export type ScheduleTimeUnit = 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS' | 'MONTHS';

export type ScheduleFirstExecution = 'IMMEDIATE' | 'DELAYED' | 'MANUAL' | 'EXACT';

/**
 * A schedule as it appears in a manifest, belongs only here, never in a
 * process definition, since when/how often a process runs is environment
 * configuration, not part of the portable process itself. References its
 * process by `processName` (resolved on import the same way nested process
 * steps already are), not an id, for the same portability reason. Runtime/
 * instance state (id, userId, status, lastRunAt, nextRunAt) is deliberately
 * excluded, an imported schedule is a fresh one, not a resumed one, and
 * should come in paused rather than firing immediately on data nobody
 * reviewed yet.
 */
export interface DAFManifestSchedule {
  name: string;
  processName: string;
  model?: string;
  interval: ScheduleInterval;
  intervalValue?: number;
  intervalUnit?: ScheduleTimeUnit;
  firstExecutionType?: ScheduleFirstExecution;
  firstExecutionDelay?: number;
  firstExecutionUnit?: ScheduleTimeUnit;
  exactExecutionTime?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A manifest: a process definition plus the full environment it expects.
 * `actions` is the exporting app's complete supported action vocabulary
 * (see ACTION_TYPES in constants.ts), not a per-process usage guess, since
 * nothing statically guarantees which actions a process's steps will
 * actually trigger at runtime. It's app-level capability, not
 * process-level, and is therefore constant across every manifest exported
 * by the same app version. `schedules` is optional since not every manifest
 * has any.
 */
export interface DAFManifestFile {
  dafVersion: string;
  dafType: 'manifest';
  variables: DAFManifestVariables;
  resources: DAFManifestResource[];
  actions: ActionVariant[];
  schedules?: DAFManifestSchedule[];
  processes: DAFProcess[];
}

export type DAFFile = DAFProcessDefinitionFile | DAFManifestFile;

// ============================================================================
// Resources
// ============================================================================

export type ResourceType =
  | 'google_doc'
  | 'notion_page'
  | 'google_drive_folder'
  | 'md_file'
  | 'notion_database'
  | 'mongodb_collection'
  | 'data';

export interface DAFResource {
  name: string;
  type: ResourceType;
  url: string;
  isGlobal: boolean;
}

// ============================================================================
// Processes
// ============================================================================

export type ProcessType = 'STATIC_DIALOGUE' | 'ADVANCED_DIALOGUE' | 'INTERFACES_PROCESS';

/** 'text' rooms are conversation only; 'text+data' (the default) also get actions and real files. */
export type DAFInterfaceType = 'text' | 'text+data';

export type DAFInterfaceExecutionOrder = 'RANDOM' | 'ROUND_ROBIN_INTERFACE_FIRST' | 'ROUND_ROBIN_PARTICIPANT_FIRST';

/** A participant of an Interfaces process: a model, or the process engine itself (model 'system'). */
export interface DAFInterfaceParticipant {
  id: string;
  name: string;
  /** A model id, or 'system' for the process engine (Participant 0), which posts the process steps. */
  model: string;
  /** Ids of the rooms this participant belongs to. */
  interfaceIds: string[];
  /** Optional instructions given only to this participant. */
  starterPrompt?: string;
}

/** A room (interface) of an Interfaces process. */
export interface DAFInterfaceDef {
  id: string;
  name: string;
  /** Ids of the participants in this room. */
  participantIds: string[];
  /** Defaults to 'text+data' when absent. */
  type?: DAFInterfaceType;
}

export interface DAFProcess {
  name: string;
  description?: string;
  processType: ProcessType;
  stopProcessKeyword?: string;
  resources?: DAFResource[];
  /** Manifests only: the `ref`s of the manifest resources attached to this process. */
  resourceRefs?: string[];
  // INTERFACES_PROCESS only
  interfaceParticipants?: DAFInterfaceParticipant[];
  interfaceDefs?: DAFInterfaceDef[];
  /** Defaults to ROUND_ROBIN_INTERFACE_FIRST. */
  interfaceExecutionOrder?: DAFInterfaceExecutionOrder;
  /** Hard cap on total turns; defaults to 200. */
  interfaceMaxSteps?: number;
  steps: DAFStep[];
}

// ============================================================================
// Steps
// ============================================================================

export type StepType = 'prompt' | 'process' | 'userFeedback' | 'completionWithoutPrompt';
export type LoopType = 'none' | 'fixed' | 'stopOn';

export interface DAFStep {
  type: StepType;

  // For prompt steps
  prompt?: string;

  // For process reference steps. processId is the legacy, environment-specific
  // reference; processName is the portable v2.0 convention.
  processId?: string;
  processName?: string;

  // Loop configuration
  loopType?: LoopType;
  forLoopCount?: number;
  stopOnKeyword?: string;
  stopOnMaxLoops?: number;

  // Advanced dialogue options
  skipCompletion?: boolean;

  /** INTERFACES_PROCESS only: the room (interface id) this step is posted to. */
  targetInterfaceId?: string;
}

// ============================================================================
// Actions
//
// NOTE: These definitions mirror the action contracts the runtime
// actually executes (the runtime's actionProcessor). `DAFAction` is a
// discriminated union on `variant`, so consumers keep full parameter narrowing
// inside a `switch (action.variant)`.
// ============================================================================

export type ActionVariant =
  | 'sendEmail'
  | 'scrape'
  | 'search'
  | 'newsSearch'
  | 'previewSearch'
  | 'tavilySearch'
  | 'checkDomain'
  | 'crawl'
  | 'readDocument'
  | 'writeDocument'
  | 'formatDocument'
  | 'removeDocument'
  | 'renameDocument'
  | 'duplicateDocument'
  | 'addFolder'
  | 'removeFolder'
  | 'readFolder'
  | 'renameFolder'
  | 'addDocument'
  | 'createDatabase'
  | 'readDatabase'
  | 'updateDatabase'
  | 'deleteDatabase'
  | 'writeDatabase'
  | 'duplicateDatabase'
  | 'dbFind'
  | 'dbInsert'
  | 'dbUpdate'
  | 'dbDelete'
  | 'askUserInput'
  | 'runCode'
  | 'runShell'
  | 'readMdFile'
  | 'writeMdFile'
  | 'createMdFile'
  | 'deleteMdFile'
  | 'renameMdFile'
  | 'duplicateMdFile'
  | 'readData'
  | 'writeData'
  | 'createData'
  | 'deleteData'
  | 'renameData'
  | 'duplicateData'
  | 'attachFile';

export type EditorActionVariant =
  | 'fixSpellingGrammar'
  | 'rewrite'
  | 'extendText'
  | 'addText'
  | 'reduceText'
  | 'removeText'
  | 'simplify'
  | 'completeSentence'
  | 'translate'
  | 'formatText'
  | 'directive';

export type WriteOperation = 'replace' | 'append' | 'selective';

// ── Email ─────────────────────────────────────────────────────────────────

export interface SendEmailAction {
  type: 'action';
  variant: 'sendEmail';
  parameters: {
    to: string;
    subject: string;
    content: string;
    from_name?: string;
  };
}

// ── Documents (Google Doc / Notion page) ────────────────────────────────────

export interface ReadDocumentAction {
  type: 'action';
  variant: 'readDocument';
  parameters: {
    resourceUrl: string; // URL of the resource (Google Doc or Notion page)
  };
}

export interface WriteDocumentAction {
  type: 'action';
  variant: 'writeDocument';
  parameters: {
    resourceUrl: string; // URL of the resource (Google Doc or Notion page)
    content: string; // Content to write
    mode?: WriteOperation; // Default: replace
    range?: { startIndex: number; endIndex: number }; // For selective mode
  };
}

export interface FormatDocumentAction {
  type: 'action';
  variant: 'formatDocument';
  parameters: {
    resourceUrl: string;
    range?: { startIndex: number; endIndex: number };
    formatting: {
      bold?: boolean;
      italic?: boolean;
      fontSize?: number;
    };
  };
}

export interface RemoveDocumentAction {
  type: 'action';
  variant: 'removeDocument';
  parameters: {
    resourceUrl: string;
  };
}

export interface RenameDocumentAction {
  type: 'action';
  variant: 'renameDocument';
  parameters: {
    resourceUrl: string;
    newName: string;
  };
}

export interface DuplicateDocumentAction {
  type: 'action';
  variant: 'duplicateDocument';
  parameters: {
    resourceUrl: string;
    newName: string;
  };
}

export interface AddDocumentAction {
  type: 'action';
  variant: 'addDocument';
  parameters: {
    locationUrl?: string; // Folder (GDrive) or page (Notion) URL; if omitted, creates in root/workspace
    documentName: string;
    content?: string;
    provider: 'google' | 'notion';
  };
}

// ── Folders (Google Drive folder / Notion page) ─────────────────────────────

export interface AddFolderAction {
  type: 'action';
  variant: 'addFolder';
  parameters: {
    folderName: string;
    parentUrl?: string;
    provider: 'google' | 'notion';
  };
}

export interface RemoveFolderAction {
  type: 'action';
  variant: 'removeFolder';
  parameters: {
    folderUrl: string;
  };
}

export interface ReadFolderAction {
  type: 'action';
  variant: 'readFolder';
  parameters: {
    folderUrl: string;
  };
}

export interface RenameFolderAction {
  type: 'action';
  variant: 'renameFolder';
  parameters: {
    folderUrl: string;
    newName: string;
  };
}

// ── Notion databases ────────────────────────────────────────────────────────

export interface CreateDatabaseAction {
  type: 'action';
  variant: 'createDatabase';
  parameters: {
    parentPageUrl?: string;
    databaseName: string;
  };
}

export interface ReadDatabaseAction {
  type: 'action';
  variant: 'readDatabase';
  parameters: {
    databaseUrl: string;
  };
}

export interface UpdateDatabaseAction {
  type: 'action';
  variant: 'updateDatabase';
  parameters: {
    databaseUrl: string;
    databaseName?: string;
    properties?: Record<string, any>;
  };
}

export interface DeleteDatabaseAction {
  type: 'action';
  variant: 'deleteDatabase';
  parameters: {
    databaseUrl: string;
  };
}

export interface WriteDatabaseAction {
  type: 'action';
  variant: 'writeDatabase';
  parameters: {
    databaseUrl: string;
    properties: Record<string, any>;
    content?: string;
  };
}

export interface DuplicateDatabaseAction {
  type: 'action';
  variant: 'duplicateDatabase';
  parameters: {
    databaseUrl: string;
    newDatabaseName?: string;
  };
}

// ── Web scraping / search ────────────────────────────────────────────────────

// Firecrawl action types for page interaction (used by crawl scrapeOptions)
export type FirecrawlActionType =
  | { type: 'wait'; milliseconds?: number; selector?: string }
  | { type: 'click'; selector: string }
  | { type: 'write'; text: string; selector?: string }
  | { type: 'press'; key: string }
  | { type: 'scroll'; direction?: 'up' | 'down'; selector?: string; amount?: number }
  | { type: 'screenshot'; fullPage?: boolean }
  | { type: 'scrape' };

export interface LocationSettings {
  country?: string; // ISO 3166-1 alpha-2 country code
  languages?: string[];
}

export interface JsonFormatOptions {
  type: 'json';
  schema?: any;
  prompt?: string;
}

export interface ScreenshotFormatOptions {
  type: 'screenshot';
  fullPage?: boolean;
  quality?: number;
  viewport?: { width: number; height: number };
}

export type ScrapeFormat =
  | 'markdown'
  | 'html'
  | 'rawHtml'
  | 'links'
  | 'screenshot'
  | 'summary'
  | JsonFormatOptions
  | ScreenshotFormatOptions;

export interface ScrapeAction {
  type: 'action';
  variant: 'scrape';
  parameters: {
    url: string;
    timeout?: number; // Request timeout in ms (default: 30000)
  };
}

export interface SearchAction {
  type: 'action';
  variant: 'search';
  parameters: {
    query: string;
    limit?: number;
    ignoreInvalidURLs?: boolean;
    sources?: Array<'web' | 'news' | 'images'>;
    categories?: Array<'github' | 'research' | 'pdf'>;
    tbs?: string;
    location?: string;
    scrapeOptions?: {
      formats?: string[];
      onlyMainContent?: boolean;
      timeout?: number;
      maxAge?: number;
      parsers?: Array<{ type: string; maxPages?: number }>;
      proxy?: 'basic' | 'enhanced' | 'auto';
    };
  };
}

export interface NewsSearchAction {
  type: 'action';
  variant: 'newsSearch';
  parameters: {
    query: string;
    limit?: number;
    ignoreInvalidURLs?: boolean;
    tbs?: string;
    location?: string;
    scrapeOptions?: {
      formats?: string[];
      onlyMainContent?: boolean;
      timeout?: number;
      maxAge?: number;
      parsers?: Array<{ type: string; maxPages?: number }>;
      proxy?: 'basic' | 'enhanced' | 'auto';
    };
  };
}

export interface QuickSearchAction {
  type: 'action';
  variant: 'previewSearch';
  parameters: {
    query: string;
    limit?: number;
    sources?: Array<'web' | 'news'>;
  };
}

export interface TavilySearchAction {
  type: 'action';
  variant: 'tavilySearch';
  parameters: {
    query: string;
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeAnswer?: boolean;
  };
}

export interface CheckDomainAction {
  type: 'action';
  variant: 'checkDomain';
  parameters: {
    domains: string[];
  };
}

export interface WebhookConfig {
  url: string;
  metadata?: Record<string, any>;
  events?: ('started' | 'page' | 'completed' | 'failed')[];
}

export interface CrawlAction {
  type: 'action';
  variant: 'crawl';
  parameters: {
    url: string;
    limit?: number;
    maxDepth?: number;
    allowBackwardLinks?: boolean;
    allowExternalLinks?: boolean;
    allowSubdomains?: boolean;
    crawlEntireDomain?: boolean;
    ignoreSitemap?: boolean;
    includePaths?: string[];
    excludePaths?: string[];
    maxFileSize?: number;
    webhook?: WebhookConfig;
    scrapeOptions?: {
      formats?: ScrapeFormat[];
      onlyMainContent?: boolean;
      includeTags?: string[];
      excludeTags?: string[];
      headers?: Record<string, string>;
      waitFor?: number;
      maxAge?: number;
      storeInCache?: boolean;
      actions?: FirecrawlActionType[];
      location?: LocationSettings;
      mobile?: boolean;
      skipTlsVerification?: boolean;
      removeBase64Images?: boolean;
    };
  };
}

// ── Generic DB actions (provider-agnostic: mongodb or notion) ────────────────

export interface DbFindAction {
  type: 'action';
  variant: 'dbFind';
  parameters: {
    resourceUrl: string;
    filter?: Record<string, unknown>;
    sort?: Record<string, 1 | -1>;
    limit?: number;
    projection?: Record<string, 0 | 1>;
  };
}

export interface DbInsertAction {
  type: 'action';
  variant: 'dbInsert';
  parameters: {
    resourceUrl: string;
    document: Record<string, unknown>;
  };
}

export interface DbUpdateAction {
  type: 'action';
  variant: 'dbUpdate';
  parameters: {
    resourceUrl: string;
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
    multi?: boolean;
    upsert?: boolean;
  };
}

export interface DbDeleteAction {
  type: 'action';
  variant: 'dbDelete';
  parameters: {
    resourceUrl: string;
    filter: Record<string, unknown>;
    multi?: boolean;
    confirm: true;
  };
}

// ── Interactive / skills / code ──────────────────────────────────────────────

export interface AskUserInputAction {
  type: 'action';
  variant: 'askUserInput';
  parameters: {
    message?: string;
  };
}

export interface RunCodeAction {
  type: 'action';
  variant: 'runCode';
  parameters: {
    code: string;
    timeout?: number; // milliseconds, default 30000
  };
}

export interface RunShellAction {
  type: 'action';
  variant: 'runShell';
  parameters: {
    command: string;
    timeout?: number; // milliseconds, default 30000
  };
}

// ── MD Files (local filesystem Markdown files) ───────────────────────────────

export interface ReadMdFileAction {
  type: 'action';
  variant: 'readMdFile';
  parameters: {
    id: string;
  };
}

export interface WriteMdFileAction {
  type: 'action';
  variant: 'writeMdFile';
  parameters: {
    id: string;
    content: string;
    mode?: 'replace' | 'append';
  };
}

export interface CreateMdFileAction {
  type: 'action';
  variant: 'createMdFile';
  parameters: {
    name: string;
    content?: string;
  };
}

export interface DeleteMdFileAction {
  type: 'action';
  variant: 'deleteMdFile';
  parameters: {
    id: string;
  };
}

export interface RenameMdFileAction {
  type: 'action';
  variant: 'renameMdFile';
  parameters: {
    id: string;
    newName: string;
  };
}

export interface DuplicateMdFileAction {
  type: 'action';
  variant: 'duplicateMdFile';
  parameters: {
    id: string;
    newName: string;
  };
}

// ── Data resources (non-text content: files, images, audio, video, ...) ──────
// Unlike a URL-referenced resource, a "data" resource is not just a pointer:
// its actual content lives in the resource record itself, addressed by id and
// changed only through these actions, the same storage pattern MD files use.
// Content always travels as a base64 string plus its mediaType (e.g.
// "image/png", "application/pdf"), so any binary payload fits the same shape.

export interface ReadDataAction {
  type: 'action';
  variant: 'readData';
  parameters: {
    id: string;
  };
}

export interface WriteDataAction {
  type: 'action';
  variant: 'writeData';
  parameters: {
    id: string;
    content: string; // base64-encoded
    mediaType?: string;
  };
}

export interface CreateDataAction {
  type: 'action';
  variant: 'createData';
  parameters: {
    name: string;
    content: string; // base64-encoded
    mediaType: string;
  };
}

export interface DeleteDataAction {
  type: 'action';
  variant: 'deleteData';
  parameters: {
    id: string;
  };
}

export interface RenameDataAction {
  type: 'action';
  variant: 'renameData';
  parameters: {
    id: string;
    newName: string;
  };
}

export interface DuplicateDataAction {
  type: 'action';
  variant: 'duplicateData';
  parameters: {
    id: string;
    newName: string;
  };
}

// ── Attach file (host-handled, no SDK-level execution) ───────────────────────
// The SDK only recognizes this variant so a host's customActionHandler can
// receive it, it has no built-in executeAction case, so a host that doesn't
// register a customActionHandler will get the generic "unsupported action"
// fallback.

export interface AttachFileAction {
  type: 'action';
  variant: 'attachFile';
  parameters: {
    id: string;
  };
}

// ── Message content parts (native multimodal attachments) ────────────────────
// Mirrors the AI SDK's own user-content-part shape (already used ad hoc by
// pdfActionHandler.ts and attachFileActionHandler.ts for one-shot calls). A
// stored conversation message's `content` is `string | MessageContentPart[]`,
// still untyped at the `messages: any[]` storage layer, this type exists so
// hosts and the runtime branch that builds these messages share one contract.
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mediaType: string; filename?: string };

// ── Editor transform action (LLM-powered or direct-apply) ────────────────────

export interface DAFEditorAction {
  type: 'editorAction';
  variant: EditorActionVariant;
  parameters: {
    selectedText: string;
    language?: string;
    directive?: string;
    from?: number;
    to?: number;
  };
}

// ── Discriminated unions ─────────────────────────────────────────────────────

export type DAFAction =
  | SendEmailAction
  | ScrapeAction
  | SearchAction
  | NewsSearchAction
  | QuickSearchAction
  | TavilySearchAction
  | CheckDomainAction
  | CrawlAction
  | ReadDocumentAction
  | WriteDocumentAction
  | FormatDocumentAction
  | RemoveDocumentAction
  | RenameDocumentAction
  | DuplicateDocumentAction
  | AddFolderAction
  | RemoveFolderAction
  | ReadFolderAction
  | RenameFolderAction
  | AddDocumentAction
  | CreateDatabaseAction
  | ReadDatabaseAction
  | UpdateDatabaseAction
  | DeleteDatabaseAction
  | WriteDatabaseAction
  | DuplicateDatabaseAction
  | DbFindAction
  | DbInsertAction
  | DbUpdateAction
  | DbDeleteAction
  | AskUserInputAction
  | RunCodeAction
  | RunShellAction
  | ReadMdFileAction
  | WriteMdFileAction
  | CreateMdFileAction
  | DeleteMdFileAction
  | RenameMdFileAction
  | DuplicateMdFileAction
  | ReadDataAction
  | WriteDataAction
  | CreateDataAction
  | DeleteDataAction
  | RenameDataAction
  | DuplicateDataAction
  | AttachFileAction;

// ── Per-variant parameter aliases (convenience for builders/consumers) ────────

export type SendEmailParams = SendEmailAction['parameters'];
export type ScrapeParams = ScrapeAction['parameters'];
export type SearchParams = SearchAction['parameters'];
export type NewsSearchParams = NewsSearchAction['parameters'];
export type PreviewSearchParams = QuickSearchAction['parameters'];
export type TavilySearchParams = TavilySearchAction['parameters'];
export type CheckDomainParams = CheckDomainAction['parameters'];
export type CrawlParams = CrawlAction['parameters'];
export type ReadDocumentParams = ReadDocumentAction['parameters'];
export type WriteDocumentParams = WriteDocumentAction['parameters'];
export type FormatDocumentParams = FormatDocumentAction['parameters'];
export type RemoveDocumentParams = RemoveDocumentAction['parameters'];
export type RenameDocumentParams = RenameDocumentAction['parameters'];
export type DuplicateDocumentParams = DuplicateDocumentAction['parameters'];
export type AddDocumentParams = AddDocumentAction['parameters'];
export type AddFolderParams = AddFolderAction['parameters'];
export type RemoveFolderParams = RemoveFolderAction['parameters'];
export type ReadFolderParams = ReadFolderAction['parameters'];
export type RenameFolderParams = RenameFolderAction['parameters'];
export type CreateDatabaseParams = CreateDatabaseAction['parameters'];
export type ReadDatabaseParams = ReadDatabaseAction['parameters'];
export type UpdateDatabaseParams = UpdateDatabaseAction['parameters'];
export type DeleteDatabaseParams = DeleteDatabaseAction['parameters'];
export type WriteDatabaseParams = WriteDatabaseAction['parameters'];
export type DuplicateDatabaseParams = DuplicateDatabaseAction['parameters'];
export type DbFindParams = DbFindAction['parameters'];
export type DbInsertParams = DbInsertAction['parameters'];
export type DbUpdateParams = DbUpdateAction['parameters'];
export type DbDeleteParams = DbDeleteAction['parameters'];
export type AskUserInputParams = AskUserInputAction['parameters'];
export type RunCodeParams = RunCodeAction['parameters'];
export type RunShellParams = RunShellAction['parameters'];
export type ReadMdFileParams = ReadMdFileAction['parameters'];
export type WriteMdFileParams = WriteMdFileAction['parameters'];
export type CreateMdFileParams = CreateMdFileAction['parameters'];
export type DeleteMdFileParams = DeleteMdFileAction['parameters'];
export type RenameMdFileParams = RenameMdFileAction['parameters'];
export type DuplicateMdFileParams = DuplicateMdFileAction['parameters'];
export type ReadDataParams = ReadDataAction['parameters'];
export type WriteDataParams = WriteDataAction['parameters'];
export type CreateDataParams = CreateDataAction['parameters'];
export type DeleteDataParams = DeleteDataAction['parameters'];
export type RenameDataParams = RenameDataAction['parameters'];
export type DuplicateDataParams = DuplicateDataAction['parameters'];
export type AttachFileParams = AttachFileAction['parameters'];

// Editor action params

export interface EditorActionBaseParams {
  selectedText: string;
  from?: number;
  to?: number;
}

export interface TranslateParams extends EditorActionBaseParams {
  language: string;
}

export interface DirectiveParams extends EditorActionBaseParams {
  directive: string;
}

// ============================================================================
// Validation Results
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  code?: string;
}
