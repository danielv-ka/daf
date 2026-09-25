import type {
  SendEmailAction,
  ScrapeAction,
  SearchAction,
  NewsSearchAction,
  QuickSearchAction,
  TavilySearchAction,
  CheckDomainAction,
} from '../protocol';

// ============================================================================
// User / billing
// ============================================================================

export interface UserProviderSettings {
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  mistralApiKey?: string | null;
  googleApiKey?: string | null;
  xaiApiKey?: string | null;
  deepseekApiKey?: string | null;
  moonshotApiKey?: string | null;
  useOpenaiKey: boolean;
  useAnthropicKey: boolean;
  useMistralKey: boolean;
  useGoogleKey: boolean;
  useXaiKey: boolean;
  useDeepseekKey: boolean;
  useMoonshotKey?: boolean;
  tier: string;
  tokensUsedThisMonth: number;
  walletBalance: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
}

// ============================================================================
// Storage adapter record types
// ============================================================================

export interface DAFRunRecord {
  id: string;
  status: string;
  messages: any[];
  metadata: any;
  model: string;
  userId: string;
  processId: string;
}

export interface DAFProcessRecord {
  id: string;
  name: string;
  steps: any[];
  userId: string;
  description?: string | null;
  resourceIds?: string[];
  resources?: any[];
}

export interface DAFUserRecord {
  id: string;
  email: string;
  name?: string | null;
  tier: string;
  tokensUsedThisMonth: number;
  walletBalance: number;
  lastMonthlyReset: Date;
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  mistralApiKey?: string | null;
  googleApiKey?: string | null;
  xaiApiKey?: string | null;
  deepseekApiKey?: string | null;
  moonshotApiKey?: string | null;
  useOpenaiKey: boolean;
  useAnthropicKey: boolean;
  useMistralKey: boolean;
  useGoogleKey: boolean;
  useXaiKey: boolean;
  useDeepseekKey: boolean;
  useMoonshotKey?: boolean;
  variables?: Record<string, string>;
}

export interface DAFResourceRecord {
  id?: string;
  name: string;
  type: string;
  provider: string;
  url: string;
}

export interface DAFGoogleIntegration {
  id: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface DAFNotionIntegration {
  id: string;
  accessToken: string;
}

export interface DAFEmailIntegration {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  /** Decrypted SMTP password. The host is responsible for decryption. */
  pass: string;
  fromName?: string;
}

// ============================================================================
// Storage adapter
// ============================================================================

export interface DAFStorageAdapter {
  // Runs
  getRun(runId: string): Promise<DAFRunRecord | null>;
  createRun(data: Omit<DAFRunRecord, 'id'>): Promise<DAFRunRecord>;
  updateRun(runId: string, data: Partial<Omit<DAFRunRecord, 'id'>>): Promise<void>;
  countRunningRuns(userId: string): Promise<number>;
  getRunningRuns(processId: string): Promise<DAFRunRecord[]>;

  // Processes
  getProcess(processId: string, userId: string): Promise<DAFProcessRecord | null>;
  getProcesses(processIds: string[], userId: string): Promise<DAFProcessRecord[]>;
  updateProcess(processId: string, data: Partial<DAFProcessRecord>): Promise<void>;

  // Users
  getUser(userId: string): Promise<DAFUserRecord | null>;
  // Atomically increment token/cost counters; returns updated balance and token count
  updateUserUsage(userId: string, usage: TokenUsage): Promise<{ newBalance: number; newTokenCount: number }>;

  // Resources linked to a process (and its parents)
  getResourcesForProcess(processId: string, userId: string, parentProcessIds?: string[]): Promise<DAFResourceRecord[]>;
  getResourcesByIds(resourceIds: string[], userId: string): Promise<DAFResourceRecord[]>;

  // User-defined variables. processId/parentProcessIds are passed through so a
  // host's own app-level variable computation (e.g. anything scoped per-process)
  // can use them, the generic runtime itself has no opinion on what they're used for.
  getUserVariables(userId: string, processId?: string, parentProcessIds?: string[]): Promise<Record<string, string>>;

  // Integration / OAuth tokens
  getGoogleIntegration(userId: string): Promise<DAFGoogleIntegration | null>;
  updateGoogleIntegration(integrationId: string, data: { accessToken: string; expiresAt: Date }): Promise<void>;
  getNotionIntegration(userId: string): Promise<DAFNotionIntegration | null>;
  getEmailIntegration(userId: string): Promise<DAFEmailIntegration | null>;

  // Optional: pause scheduled runs when user runs out of funds
  pauseUserSchedules?(userId: string): Promise<void>;
  getScheduleForProcess?(processId: string): Promise<{ id: string } | null>;

  // Optional: notification hooks, called when billing limits are crossed
  onMonthlyLimitReached?(userId: string, user: any): Promise<void>;
  onWalletDepleted?(userId: string, user: any): Promise<void>;

  // Optional: pluggable arbitrary-code execution for the `runCode` action.
  // Running untrusted code is a host concern (sandboxing, allowlists, resource
  // limits are the host's responsibility), so the SDK does NOT execute code
  // itself, it delegates to this hook. When absent, runCode returns a graceful
  // error instead of running anything.
  executeRunCode?(
    code: string,
    timeout: number,
    userId: string
  ): Promise<ActionExecutionResult>;

  // Optional: pluggable shell command execution for the `runShell` action.
  // Same host-owned-sandboxing rationale as executeRunCode above. When absent,
  // runShell returns a graceful error instead of running anything.
  executeRunShell?(
    command: string,
    timeout: number,
    userId: string
  ): Promise<ActionExecutionResult>;

  // Optional: MongoDB operations for the dbFind/dbInsert/dbUpdate/dbDelete actions.
  // Mongo access (connection strings, encryption, pooling) is platform-coupled, so
  // the host owns it. The SDK only checks that the resource is attached to the process,
  // then delegates the query here. When these are absent, db* actions return a
  // graceful error instead of touching a database.
  mongoFind?(
    resourceUrl: string,
    userId: string,
    filter: Record<string, unknown>,
    options: { sort?: Record<string, 1 | -1>; limit?: number; projection?: Record<string, 0 | 1> }
  ): Promise<any[]>;
  mongoInsert?(
    resourceUrl: string,
    userId: string,
    document: Record<string, unknown>
  ): Promise<{ insertedId: string }>;
  mongoUpdate?(
    resourceUrl: string,
    userId: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { multi?: boolean; upsert?: boolean }
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }>;
  mongoDelete?(
    resourceUrl: string,
    userId: string,
    filter: Record<string, unknown>,
    options: { multi?: boolean }
  ): Promise<{ deletedCount: number }>;

  // Optional: outbound email delivery for the `sendEmail` action. Mail transport
  // is platform-coupled (SMTP credentials, per-user provider settings, sender
  // reputation, unsubscribe handling), so the host owns it. When absent, the SDK
  // falls back to its built-in transport if one is configured, and otherwise
  // returns a graceful error.
  sendEmail?(
    params: SendEmailAction['parameters'],
    userId: string,
    processId?: string
  ): Promise<ActionExecutionResult>;

  // Optional: web retrieval hooks for the scrape/search family. Each maps to one
  // action variant. These depend on third-party retrieval providers and their API
  // keys, which are a host concern, so the host supplies the implementation.
  // When a hook is absent, that action returns a graceful error.
  webScrape?(
    params: ScrapeAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;
  webSearch?(
    params: SearchAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;
  webPreviewSearch?(
    params: QuickSearchAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;
  webTavilySearch?(
    params: TavilySearchAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;
  webCheckDomain?(
    params: CheckDomainAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;
  webNewsSearch?(
    params: NewsSearchAction['parameters'],
    userId?: string
  ): Promise<ActionExecutionResult>;

  // Optional: spend authorization before an LLM call. Plan tiers, wallet balances
  // and quota policy are commercial concerns that belong to the host, not the
  // protocol. When absent, the runtime allows every call, which is the correct
  // default for a self-hosted deployment with no billing model.
  checkAffordability?(
    userId: string,
    context: {
      model?: string;
      estimatedCostUsd?: number;
      /** The call runs on the user's own provider key (a host may exempt it from balance checks). */
      usingOwnApiKey?: boolean;
    }
  ): Promise<DAFAffordabilityResult>;

  // Low-level DB operations used by the execution engine and action processor.
  // Uses Prisma-style query objects (where/data/select) so implementations can
  // map directly to Prisma. The interface is typed loosely so any DB backend
  // (Prisma, Drizzle, plain SQL) can implement it without importing Prisma types.
  db: {
    user: {
      findUnique(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<any>;
    };
    run: {
      create(args: { data: Record<string, any> }): Promise<any>;
      update(args: { where: Record<string, any>; data: Record<string, any>; select?: Record<string, any> }): Promise<any>;
      findUnique(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      findFirst(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      findMany(args: { where: Record<string, any>; select?: Record<string, any>; orderBy?: Record<string, any> }): Promise<any[]>;
      count(args: { where: Record<string, any> }): Promise<number>;
    };
    resource: {
      create(args: { data: Record<string, any> }): Promise<any>;
      update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<void>;
      delete(args: { where: Record<string, any> }): Promise<void>;
      findFirst(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      findMany(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any[]>;
    };
    process: {
      findUnique(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      findFirst(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      findMany(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any[]>;
      update(args: { where: Record<string, any>; data: Record<string, any> }): Promise<void>;
    };
    integration: {
      findUnique(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
    };
    schedule: {
      findFirst(args: { where: Record<string, any>; select?: Record<string, any> }): Promise<any | null>;
      updateMany(args: { where: Record<string, any>; data: Record<string, any> }): Promise<void>;
    };
  };

  // SSE event emitters, implementations call their own event bus
  emitRunUpdate(runId: string, event: any): void;
  emitRunListUpdate(userId: string, event: any): void;
  emitRunningCountUpdate(userId: string, count: number): void;

  // Logging
  log: {
    info(msg: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
  };
}

// ============================================================================
// Action config, external API keys needed by action implementations
// ============================================================================

export interface ActionConfig {
  firecrawlApiKey?: string;
  serpApiKey?: string;
  tavilyApiKey?: string;
}

// ============================================================================
// Execution context passed into the action processor
// ============================================================================

/**
 * Minimal result shape returned by action handlers. Mirrors actionProcessor's
 * ActionResult; declared here too so ExecutionContext hooks can be typed without
 * a circular import.
 */
export interface ActionExecutionResult {
  success: boolean;
  error?: string;
  message?: string;
  data?: any;
  pauseForInput?: boolean;
}

/**
 * Outcome of a host spend-authorization check. `failureReason` is an open string
 * so hosts can define their own policy vocabulary; the runtime only branches on
 * `allowed` and passes the rest through to notification hooks and run messages.
 */
export interface DAFAffordabilityResult {
  allowed: boolean;
  message?: string;
  failureReason?: string;
  /** Host user record, forwarded to onWalletDepleted / onMonthlyLimitReached. */
  user?: any;
}

export interface ExecutionContext {
  model: string;
  modelProvider: any;
  onTokenUsage?: (input: number, output: number, total: number, cached: number, reasoning: number) => Promise<void>;
  isChatContext?: boolean;
  // Generic host extension point, checked at the top of executeAction before its
  // built-in dispatch runs. The SDK has no opinion on what this is used for, it
  // exists so a host app can handle an action type (or a specific resource) itself
  // without that logic living in the SDK. Return null/undefined to fall through to
  // the built-in handling; a non-null result short-circuits it entirely.
  customActionHandler?: (
    action: any,
    ctx: { userId: string; adapter: any; processId: string; parentProcessIds: string[] }
  ) => Promise<ActionExecutionResult | null>;
}
