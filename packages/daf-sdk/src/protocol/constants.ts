/**
 * Protocol version constants
 */
export const DAF_VERSION = '1.2.0';
export const SUPPORTED_VERSIONS = ['1.0.0', '1.1.0', '1.2.0', '2.0.0'] as const;

/**
 * v2.0.0 introduces two distinct file types built on the same `processes`
 * shape: a process definition (portable, environment-agnostic, just steps)
 * and a manifest (a process definition plus the full environment it expects:
 * variables, resources, and the app's supported action vocabulary). See
 * DAFProcessDefinitionFile / DAFManifestFile in types.ts.
 */
export const DAF_V2_VERSION = '2.0.0';

export const DAF_FILE_TYPES = {
  PROCESS: 'process',
  MANIFEST: 'manifest',
} as const;

/**
 * Process types
 */
export const PROCESS_TYPES = {
  STATIC_DIALOGUE: 'STATIC_DIALOGUE',
  ADVANCED_DIALOGUE: 'ADVANCED_DIALOGUE',
  // Several participants (models) talking in one or more rooms (interfaces);
  // see DAFInterfaceDef / DAFInterfaceParticipant.
  INTERFACES_PROCESS: 'INTERFACES_PROCESS',
} as const;

/**
 * Interfaces processes: what a room (interface) carries. 'text' rooms are
 * conversation only; 'text+data' rooms (the default) also give participants
 * actions and real files.
 */
export const INTERFACE_TYPES = {
  TEXT: 'text',
  TEXT_AND_DATA: 'text+data',
} as const;

/** Interfaces processes: the order in which participants are asked to speak. */
export const INTERFACE_EXECUTION_ORDERS = {
  RANDOM: 'RANDOM',
  ROUND_ROBIN_INTERFACE_FIRST: 'ROUND_ROBIN_INTERFACE_FIRST',
  ROUND_ROBIN_PARTICIPANT_FIRST: 'ROUND_ROBIN_PARTICIPANT_FIRST',
} as const;

/** Interfaces processes: the participant id convention and model for the process engine itself. */
export const INTERFACE_SYSTEM_MODEL = 'system';

/**
 * Step types
 */
export const STEP_TYPES = {
  PROMPT: 'prompt',
  PROCESS: 'process',
  USER_FEEDBACK: 'userFeedback',
  COMPLETION_WITHOUT_PROMPT: 'completionWithoutPrompt',
} as const;

/**
 * Loop types
 */
export const LOOP_TYPES = {
  NONE: 'none',
  FIXED: 'fixed',
  STOP_ON: 'stopOn',
} as const;

/**
 * Action types
 */
export const ACTION_TYPES = {
  SEND_EMAIL: 'sendEmail',
  SCRAPE: 'scrape',
  SEARCH: 'search',
  NEWS_SEARCH: 'newsSearch',
  PREVIEW_SEARCH: 'previewSearch',
  TAVILY_SEARCH: 'tavilySearch',
  CHECK_DOMAIN: 'checkDomain',
  CRAWL: 'crawl',
  READ_DOCUMENT: 'readDocument',
  WRITE_DOCUMENT: 'writeDocument',
  FORMAT_DOCUMENT: 'formatDocument',
  REMOVE_DOCUMENT: 'removeDocument',
  RENAME_DOCUMENT: 'renameDocument',
  DUPLICATE_DOCUMENT: 'duplicateDocument',
  ADD_DOCUMENT: 'addDocument',
  ADD_FOLDER: 'addFolder',
  REMOVE_FOLDER: 'removeFolder',
  READ_FOLDER: 'readFolder',
  RENAME_FOLDER: 'renameFolder',
  CREATE_DATABASE: 'createDatabase',
  READ_DATABASE: 'readDatabase',
  UPDATE_DATABASE: 'updateDatabase',
  DELETE_DATABASE: 'deleteDatabase',
  WRITE_DATABASE: 'writeDatabase',
  DUPLICATE_DATABASE: 'duplicateDatabase',
  DB_FIND: 'dbFind',
  DB_INSERT: 'dbInsert',
  DB_UPDATE: 'dbUpdate',
  DB_DELETE: 'dbDelete',
  ASK_USER_INPUT: 'askUserInput',
  RUN_CODE: 'runCode',
  RUN_SHELL: 'runShell',
  READ_MD_FILE: 'readMdFile',
  WRITE_MD_FILE: 'writeMdFile',
  CREATE_MD_FILE: 'createMdFile',
  DELETE_MD_FILE: 'deleteMdFile',
  RENAME_MD_FILE: 'renameMdFile',
  DUPLICATE_MD_FILE: 'duplicateMdFile',
  ATTACH_FILE: 'attachFile',
  READ_DATA: 'readData',
  WRITE_DATA: 'writeData',
  CREATE_DATA: 'createData',
  DELETE_DATA: 'deleteData',
  RENAME_DATA: 'renameData',
  DUPLICATE_DATA: 'duplicateData',
} as const;

/**
 * Editor action types
 */
export const EDITOR_ACTION_TYPES = {
  FIX_SPELLING_GRAMMAR: 'fixSpellingGrammar',
  REWRITE: 'rewrite',
  EXTEND_TEXT: 'extendText',
  ADD_TEXT: 'addText',
  REDUCE_TEXT: 'reduceText',
  REMOVE_TEXT: 'removeText',
  SIMPLIFY: 'simplify',
  COMPLETE_SENTENCE: 'completeSentence',
  TRANSLATE: 'translate',
  FORMAT_TEXT: 'formatText',
  DIRECTIVE: 'directive',
} as const;

/**
 * Editor action variants that are applied directly by the client and therefore
 * do not require a non-empty `selectedText` for validation.
 */
export const DIRECT_APPLY_EDITOR_ACTIONS = ['addText', 'removeText', 'formatText'] as const;

/**
 * Resource types
 */
export const RESOURCE_TYPES = {
  GOOGLE_DOC: 'google_doc',
  NOTION_PAGE: 'notion_page',
  GOOGLE_DRIVE_FOLDER: 'google_drive_folder',
  MD_FILE: 'md_file',
  NOTION_DATABASE: 'notion_database',
  MONGODB_COLLECTION: 'mongodb_collection',
  DATA: 'data',
} as const;

/**
 * Write document operations
 */
export const WRITE_OPERATIONS = {
  REPLACE: 'replace',
  APPEND: 'append',
  SELECTIVE: 'selective',
} as const;

/**
 * Maximum nesting depth for processes
 */
export const MAX_PROCESS_DEPTH = 10;

/**
 * Default timeout for scraping in milliseconds
 */
export const DEFAULT_SCRAPE_TIMEOUT = 30000;

/**
 * Default search result limit
 */
export const DEFAULT_SEARCH_LIMIT = 5;
