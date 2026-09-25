/**
 * Builder utilities for constructing valid DAF documents programmatically
 */

import { DAF_VERSION, DAF_V2_VERSION, ACTION_TYPES } from './constants';
import type {
  DAFDocument,
  DAFProcess,
  DAFStep,
  DAFResource,
  DAFAction,
  DAFEditorAction,
  DAFProcessDefinitionFile,
  DAFManifestFile,
  DAFManifestResource,
  DAFManifestVariables,
  DAFManifestSchedule,
  ProcessType,
  StepType,
  LoopType,
  ResourceType,
  ActionVariant,
  EditorActionVariant,
  SendEmailAction,
  ScrapeAction,
  SearchAction,
  NewsSearchAction,
  QuickSearchAction,
  TavilySearchAction,
  ReadDocumentAction,
  WriteDocumentAction,
  FormatDocumentAction,
  RemoveDocumentAction,
  RenameDocumentAction,
  DuplicateDocumentAction,
  AddDocumentAction,
  AddFolderAction,
  RemoveFolderAction,
  ReadFolderAction,
  RenameFolderAction,
  CreateDatabaseAction,
  ReadDatabaseAction,
  UpdateDatabaseAction,
  DeleteDatabaseAction,
  WriteDatabaseAction,
  DuplicateDatabaseAction,
  SendEmailParams,
  ScrapeParams,
  SearchParams,
  NewsSearchParams,
  PreviewSearchParams,
  TavilySearchParams,
  ReadDocumentParams,
  WriteDocumentParams,
  WriteOperation,
  FormatDocumentParams,
  RemoveDocumentParams,
  RenameDocumentParams,
  DuplicateDocumentParams,
  AddFolderParams,
  RemoveFolderParams,
  ReadFolderParams,
  RenameFolderParams,
  AddDocumentParams,
  CreateDatabaseParams,
  ReadDatabaseParams,
  UpdateDatabaseParams,
  DeleteDatabaseParams,
  WriteDatabaseParams,
  DuplicateDatabaseParams,
  EditorActionBaseParams,
  TranslateParams,
  DirectiveParams,
  ReadMdFileAction,
  WriteMdFileAction,
  CreateMdFileAction,
  DeleteMdFileAction,
  RenameMdFileAction,
  DuplicateMdFileAction,
  ReadMdFileParams,
  WriteMdFileParams,
  CreateMdFileParams,
  DeleteMdFileParams,
  RenameMdFileParams,
  DuplicateMdFileParams,
} from './types';

// ============================================================================
// DAF Document Builder
// ============================================================================

export class DAFDocumentBuilder {
  private doc: DAFDocument;

  constructor() {
    this.doc = {
      dafVersion: DAF_VERSION,
      processes: [],
    };
  }

  /**
   * Set variables for the document
   */
  variables(vars: Record<string, string>): this {
    this.doc.variables = vars;
    return this;
  }

  /**
   * Add a variable
   */
  variable(name: string, value: string): this {
    if (!this.doc.variables) {
      this.doc.variables = {};
    }
    this.doc.variables[name] = value;
    return this;
  }

  /**
   * Add resources to the document
   */
  resources(resources: DAFResource[]): this {
    this.doc.resources = resources;
    return this;
  }

  /**
   * Add a single resource
   */
  resource(resource: DAFResource): this {
    if (!this.doc.resources) {
      this.doc.resources = [];
    }
    this.doc.resources.push(resource);
    return this;
  }

  /**
   * Add a process to the document
   */
  process(process: DAFProcess): this {
    this.doc.processes.push(process);
    return this;
  }

  /**
   * Build and return the DAF document
   */
  build(): DAFDocument {
    return this.doc;
  }
}

// ============================================================================
// DAF v2.0: Process Definition & Manifest Builders
// ============================================================================

/**
 * The exporting app's complete action vocabulary, every action variant the
 * app knows how to execute, not what any single process happens to use.
 * Derived from ACTION_TYPES so it can never drift out of sync with the
 * variants isValidAction actually recognizes.
 */
export function buildManifestActions(): ActionVariant[] {
  return Object.values(ACTION_TYPES) as ActionVariant[];
}

/**
 * Build a portable, environment-agnostic process definition file. Contains
 * no variables or resources by design, see DAFProcessDefinitionFile.
 */
export function buildProcessDefinitionFile(processes: DAFProcess[]): DAFProcessDefinitionFile {
  return {
    dafVersion: DAF_V2_VERSION,
    dafType: 'process',
    processes,
  };
}

export class ManifestBuilder {
  private manifest: DAFManifestFile;

  constructor() {
    this.manifest = {
      dafVersion: DAF_V2_VERSION,
      dafType: 'manifest',
      variables: { user: {}, system: {} },
      resources: [],
      actions: buildManifestActions(),
      processes: [],
    };
  }

  /**
   * Set the user-provided variables (name/value pairs).
   */
  userVariables(vars: Record<string, string>): this {
    this.manifest.variables.user = vars;
    return this;
  }

  /**
   * Set the system variables (name/value pairs), most of these are static
   * SDK constants, safe to include as-is. A per-user computed one like
   * "SKILLS" is a snapshot at export time, not a live binding; the
   * importing host recomputes it fresh at runtime rather than reusing it.
   */
  systemVariables(vars: Record<string, string>): this {
    this.manifest.variables.system = vars;
    return this;
  }

  variables(vars: DAFManifestVariables): this {
    this.manifest.variables = vars;
    return this;
  }

  resources(resources: DAFManifestResource[]): this {
    this.manifest.resources = resources;
    return this;
  }

  resource(resource: DAFManifestResource): this {
    this.manifest.resources.push(resource);
    return this;
  }

  /**
   * Override the declared action vocabulary. Defaults to the full set from
   * buildManifestActions(), only call this to export a deliberately
   * restricted subset (e.g. a sandboxed environment that doesn't support
   * everything the SDK does).
   */
  actions(actions: ActionVariant[]): this {
    this.manifest.actions = actions;
    return this;
  }

  process(process: DAFProcess): this {
    this.manifest.processes.push(process);
    return this;
  }

  schedules(schedules: DAFManifestSchedule[]): this {
    this.manifest.schedules = schedules;
    return this;
  }

  schedule(schedule: DAFManifestSchedule): this {
    if (!this.manifest.schedules) this.manifest.schedules = [];
    this.manifest.schedules.push(schedule);
    return this;
  }

  build(): DAFManifestFile {
    return this.manifest;
  }
}

/**
 * Attach a required-integration marker to a resource for manifest export.
 * Pass undefined/omit for resources that need no connected integration (a
 * plain web URL, a local md_file), don't infer it from `type`/`provider`
 * at the call site, that inference belongs here, once.
 */
export function manifestResource(
  resource: DAFResource,
  requiredIntegration?: string
): DAFManifestResource {
  return { ...resource, requiredIntegration };
}

// ============================================================================
// Process Builder
// ============================================================================

export class ProcessBuilder {
  private process: DAFProcess;

  constructor(name: string, processType: ProcessType = 'STATIC_DIALOGUE') {
    this.process = {
      name,
      processType,
      steps: [],
    };
  }

  /**
   * Set process description
   */
  description(desc: string): this {
    this.process.description = desc;
    return this;
  }

  /**
   * Set stop process keyword (Advanced Dialogue only)
   */
  stopKeyword(keyword: string): this {
    this.process.stopProcessKeyword = keyword;
    return this;
  }

  /**
   * Add resources to the process
   */
  resources(resources: DAFResource[]): this {
    this.process.resources = resources;
    return this;
  }

  /**
   * Add a single resource
   */
  resource(resource: DAFResource): this {
    if (!this.process.resources) {
      this.process.resources = [];
    }
    this.process.resources.push(resource);
    return this;
  }

  /**
   * Add a step to the process
   */
  step(step: DAFStep): this {
    this.process.steps.push(step);
    return this;
  }

  /**
   * Build and return the process
   */
  build(): DAFProcess {
    return this.process;
  }
}

// ============================================================================
// Step Builders
// ============================================================================

/**
 * Create a prompt step
 */
export function promptStep(prompt: string): DAFStep {
  return {
    type: 'prompt',
    prompt,
  };
}

/**
 * Create a process reference step
 */
export function processStep(processId: string): DAFStep {
  return {
    type: 'process',
    processId,
  };
}

/**
 * Create a prompt step with fixed loop
 */
export function fixedLoopStep(prompt: string, count: number): DAFStep {
  return {
    type: 'prompt',
    prompt,
    loopType: 'fixed',
    forLoopCount: count,
  };
}

/**
 * Create a prompt step with conditional loop
 */
export function conditionalLoopStep(
  prompt: string,
  stopKeyword: string,
  maxLoops?: number
): DAFStep {
  return {
    type: 'prompt',
    prompt,
    loopType: 'stopOn',
    stopOnKeyword: stopKeyword,
    stopOnMaxLoops: maxLoops,
  };
}

/**
 * Create a prompt step that skips completion (Advanced Dialogue)
 */
export function skipCompletionStep(prompt: string): DAFStep {
  return {
    type: 'prompt',
    prompt,
    skipCompletion: true,
  };
}

// ============================================================================
// Resource Builders
// ============================================================================

/**
 * Create a Google Doc resource
 */
export function googleDocResource(
  name: string,
  url: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'google_doc',
    url,
    isGlobal,
  };
}

/**
 * Create a Notion page resource
 */
export function notionPageResource(
  name: string,
  url: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'notion_page',
    url,
    isGlobal,
  };
}

/**
 * Create a Google Drive folder resource
 */
export function googleDriveFolderResource(
  name: string,
  url: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'google_drive_folder',
    url,
    isGlobal,
  };
}

/**
 * Create a Notion database resource
 */
export function notionDatabaseResource(
  name: string,
  url: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'notion_database',
    url,
    isGlobal,
  };
}

/**
 * Create a MongoDB collection resource
 */
export function mongodbCollectionResource(
  name: string,
  url: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'mongodb_collection',
    url,
    isGlobal,
  };
}

// ============================================================================
// Action Builders
// ============================================================================

/**
 * Create a send email action
 */
export function sendEmailAction(
  to: string,
  subject: string,
  content: string
): SendEmailAction {
  return {
    type: 'action',
    variant: 'sendEmail',
    parameters: { to, subject, content } as SendEmailParams,
  };
}

/**
 * Create a scrape action
 */
export function scrapeAction(url: string, timeout?: number): ScrapeAction {
  return {
    type: 'action',
    variant: 'scrape',
    parameters: { url, timeout } as ScrapeParams,
  };
}

/**
 * Create a search action
 */
export function searchAction(query: string, limit?: number): SearchAction {
  return {
    type: 'action',
    variant: 'search',
    parameters: { query, limit } as SearchParams,
  };
}

/**
 * Create a read document action
 * @param resourceUrl - URL of the Google Doc or Notion page
 */
export function readDocumentAction(resourceUrl: string): ReadDocumentAction {
  return {
    type: 'action',
    variant: 'readDocument',
    parameters: { resourceUrl } as ReadDocumentParams,
  };
}

/**
 * Create a write document action
 * @param resourceUrl - URL of the Google Doc or Notion page
 * @param content - Content to write
 * @param options - Optional write mode (default: replace) and selective range
 */
export function writeDocumentAction(
  resourceUrl: string,
  content: string,
  options?: {
    mode?: WriteOperation;
    range?: { startIndex: number; endIndex: number };
  }
): WriteDocumentAction {
  return {
    type: 'action',
    variant: 'writeDocument',
    parameters: {
      resourceUrl,
      content,
      ...options,
    } as WriteDocumentParams,
  };
}

/**
 * Apply text formatting to a document (Google Docs only).
 * @param resourceUrl - URL of the document
 * @param formatting - Formatting options (bold, italic, fontSize)
 * @param range - Optional character range to apply formatting to
 */
export function formatDocumentAction(
  resourceUrl: string,
  formatting: FormatDocumentParams['formatting'],
  range?: FormatDocumentParams['range']
): FormatDocumentAction {
  return {
    type: 'action',
    variant: 'formatDocument',
    parameters: { resourceUrl, formatting, range } as FormatDocumentParams,
  };
}

/**
 * Delete a document (Google Doc or Notion page)
 */
export function removeDocumentAction(resourceUrl: string): RemoveDocumentAction {
  return {
    type: 'action',
    variant: 'removeDocument',
    parameters: { resourceUrl } as RemoveDocumentParams,
  };
}

/**
 * Rename a document (Google Doc or Notion page)
 */
export function renameDocumentAction(resourceUrl: string, newName: string): RenameDocumentAction {
  return {
    type: 'action',
    variant: 'renameDocument',
    parameters: { resourceUrl, newName } as RenameDocumentParams,
  };
}

/**
 * Duplicate a document (Google Doc or Notion page)
 */
export function duplicateDocumentAction(resourceUrl: string, newName: string): DuplicateDocumentAction {
  return {
    type: 'action',
    variant: 'duplicateDocument',
    parameters: { resourceUrl, newName } as DuplicateDocumentParams,
  };
}

/**
 * Create a new folder (Google Drive) or page (Notion)
 */
export function addFolderAction(
  folderName: string,
  provider: 'google' | 'notion',
  parentUrl?: string
): AddFolderAction {
  return {
    type: 'action',
    variant: 'addFolder',
    parameters: { folderName, provider, parentUrl } as AddFolderParams,
  };
}

/**
 * Delete a folder (Google Drive) or page (Notion)
 */
export function removeFolderAction(folderUrl: string): RemoveFolderAction {
  return {
    type: 'action',
    variant: 'removeFolder',
    parameters: { folderUrl } as RemoveFolderParams,
  };
}

/**
 * List the contents of a folder (Google Drive) or page (Notion)
 */
export function readFolderAction(folderUrl: string): ReadFolderAction {
  return {
    type: 'action',
    variant: 'readFolder',
    parameters: { folderUrl } as ReadFolderParams,
  };
}

/**
 * Rename a folder (Google Drive) or page (Notion)
 */
export function renameFolderAction(folderUrl: string, newName: string): RenameFolderAction {
  return {
    type: 'action',
    variant: 'renameFolder',
    parameters: { folderUrl, newName } as RenameFolderParams,
  };
}

/**
 * Create a new document (Google Doc or Notion page)
 * @param documentName - Name for the new document
 * @param provider - Storage provider
 * @param locationUrl - Optional parent folder/page URL
 * @param content - Optional initial content
 */
export function addDocumentAction(
  documentName: string,
  provider: 'google' | 'notion',
  locationUrl?: string,
  content?: string
): AddDocumentAction {
  return {
    type: 'action',
    variant: 'addDocument',
    parameters: { documentName, provider, locationUrl, content } as AddDocumentParams,
  };
}

/**
 * Create a new Notion database
 */
export function createDatabaseAction(
  databaseName: string,
  parentPageUrl?: string
): CreateDatabaseAction {
  return {
    type: 'action',
    variant: 'createDatabase',
    parameters: { databaseName, parentPageUrl } as CreateDatabaseParams,
  };
}

/**
 * Read entries from a Notion database
 */
export function readDatabaseAction(databaseUrl: string): ReadDatabaseAction {
  return {
    type: 'action',
    variant: 'readDatabase',
    parameters: { databaseUrl } as ReadDatabaseParams,
  };
}

/**
 * Update a Notion database's name or properties schema
 */
export function updateDatabaseAction(
  databaseUrl: string,
  options?: { databaseName?: string; properties?: Record<string, any> }
): UpdateDatabaseAction {
  return {
    type: 'action',
    variant: 'updateDatabase',
    parameters: { databaseUrl, ...options } as UpdateDatabaseParams,
  };
}

/**
 * Delete a Notion database
 */
export function deleteDatabaseAction(databaseUrl: string): DeleteDatabaseAction {
  return {
    type: 'action',
    variant: 'deleteDatabase',
    parameters: { databaseUrl } as DeleteDatabaseParams,
  };
}

/**
 * Add a new page (row) to a Notion database
 * @param databaseUrl - URL of the Notion database
 * @param properties - Page properties matching the database schema
 * @param content - Optional markdown content for the page body
 */
export function writeDatabaseAction(
  databaseUrl: string,
  properties: Record<string, any>,
  content?: string
): WriteDatabaseAction {
  return {
    type: 'action',
    variant: 'writeDatabase',
    parameters: { databaseUrl, properties, content } as WriteDatabaseParams,
  };
}

/**
 * Duplicate a Notion database
 */
export function duplicateDatabaseAction(
  databaseUrl: string,
  newDatabaseName?: string
): DuplicateDatabaseAction {
  return {
    type: 'action',
    variant: 'duplicateDatabase',
    parameters: { databaseUrl, newDatabaseName } as DuplicateDatabaseParams,
  };
}

/**
 * Search news articles
 */
export function newsSearchAction(
  query: string,
  options?: Omit<NewsSearchParams, 'query'>
): NewsSearchAction {
  return {
    type: 'action',
    variant: 'newsSearch',
    parameters: { query, ...options } as NewsSearchParams,
  };
}

/**
 * Preview web search results
 */
export function previewSearchAction(
  query: string,
  options?: Omit<PreviewSearchParams, 'query'>
): QuickSearchAction {
  return {
    type: 'action',
    variant: 'previewSearch',
    parameters: { query, ...options } as PreviewSearchParams,
  };
}

/**
 * Search using Tavily
 */
export function tavilySearchAction(
  query: string,
  options?: Omit<TavilySearchParams, 'query'>
): TavilySearchAction {
  return {
    type: 'action',
    variant: 'tavilySearch',
    parameters: { query, ...options } as TavilySearchParams,
  };
}

// ============================================================================
// MD File Resource Builder
// ============================================================================

/**
 * Create an MD file resource (local filesystem Markdown file)
 */
export function mdFileResource(
  name: string,
  id: string,
  isGlobal = false
): DAFResource {
  return {
    name,
    type: 'md_file',
    url: id,
    isGlobal,
  };
}

// ============================================================================
// MD File Action Builders
// ============================================================================

/**
 * Read the content of a local Markdown file
 */
export function readMdFileAction(id: string): ReadMdFileAction {
  return {
    type: 'action',
    variant: 'readMdFile',
    parameters: { id } as ReadMdFileParams,
  };
}

/**
 * Write content to a local Markdown file
 * @param mode - 'replace' (default) overwrites the file; 'append' adds to end
 */
export function writeMdFileAction(
  id: string,
  content: string,
  mode?: 'replace' | 'append'
): WriteMdFileAction {
  return {
    type: 'action',
    variant: 'writeMdFile',
    parameters: { id, content, mode } as WriteMdFileParams,
  };
}

/**
 * Create a new local Markdown file
 */
export function createMdFileAction(
  name: string,
  content?: string
): CreateMdFileAction {
  return {
    type: 'action',
    variant: 'createMdFile',
    parameters: { name, content } as CreateMdFileParams,
  };
}

/**
 * Delete a local Markdown file
 */
export function deleteMdFileAction(id: string): DeleteMdFileAction {
  return {
    type: 'action',
    variant: 'deleteMdFile',
    parameters: { id } as DeleteMdFileParams,
  };
}

/**
 * Rename (move) a local Markdown file
 */
export function renameMdFileAction(
  id: string,
  newName: string
): RenameMdFileAction {
  return {
    type: 'action',
    variant: 'renameMdFile',
    parameters: { id, newName } as RenameMdFileParams,
  };
}

/**
 * Duplicate a local Markdown file to a new path
 */
export function duplicateMdFileAction(
  id: string,
  newName: string
): DuplicateMdFileAction {
  return {
    type: 'action',
    variant: 'duplicateMdFile',
    parameters: { id, newName } as DuplicateMdFileParams,
  };
}

// ============================================================================
// Editor Action Builders
// ============================================================================

function editorAction(
  variant: EditorActionVariant,
  params: EditorActionBaseParams | TranslateParams | DirectiveParams
): DAFEditorAction {
  return { type: 'editorAction', variant, parameters: params };
}

/**
 * Fix spelling and grammar in selected text
 */
export function fixSpellingGrammarAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('fixSpellingGrammar', { selectedText, ...options });
}

/**
 * Rewrite selected text for clarity and flow
 */
export function rewriteAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('rewrite', { selectedText, ...options });
}

/**
 * Extend selected text with more detail or depth
 */
export function extendTextAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('extendText', { selectedText, ...options });
}

/**
 * Condense selected text into a shorter version
 */
export function reduceTextAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('reduceText', { selectedText, ...options });
}

/**
 * Simplify selected text using simpler language
 */
export function simplifyAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('simplify', { selectedText, ...options });
}

/**
 * Complete a sentence or paragraph naturally
 */
export function completeSentenceAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('completeSentence', { selectedText, ...options });
}

/**
 * Translate selected text to a target language
 */
export function translateAction(
  selectedText: string,
  language: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('translate', { selectedText, language, ...options } as TranslateParams);
}

/**
 * Format selected text with proper capitalization, punctuation, and structure
 */
export function formatTextAction(
  selectedText: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('formatText', { selectedText, ...options });
}

/**
 * Apply a custom directive/instruction to the selected text
 */
export function directiveAction(
  selectedText: string,
  directive: string,
  options?: { from?: number; to?: number }
): DAFEditorAction {
  return editorAction('directive', { selectedText, directive, ...options } as DirectiveParams);
}
