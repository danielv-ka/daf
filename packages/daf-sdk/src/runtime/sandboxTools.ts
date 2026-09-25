import { randomBytes } from 'crypto';
import { validateAction, actionParamSchemas, type ActionVariant } from '../protocol';
import { buildActionTools } from './actionTools';

// ============================================================================
// Programmatic (sandbox) tool calling
//
// Lets code the model writes for the `runCode` action call a fixed set of our
// own actions directly, in a loop, instead of one action per model turn, the
// same problem Anthropic's own programmatic tool calling solves, but kept on
// our platform per the hybrid rule (code-execution/shell/programmatic tools
// stay ours, they don't get replaced by a provider's native equivalent).
//
// Deliberately read-only/search actions only: a generated loop that can
// silently send 50 emails or delete 50 rows with no per-call review is a
// different risk profile than one that can only read and filter. Mutating
// actions, askUserInput (needs a live human, impossible from a detached
// subprocess) and runCode/runShell themselves (recursive) are excluded.
// ============================================================================

// `readData` (the newer data-resource type) is deliberately left out, it has
// no entry in actionParamSchemas yet (see buildActionTools's own exclusion of
// it), so it can't pass the validateAction gate in resolveSandboxCall below.
export const SANDBOX_ALLOWED_ACTIONS: ActionVariant[] = [
  'search', 'scrape', 'tavilySearch', 'newsSearch', 'previewSearch', 'checkDomain',
  'readDocument', 'readFolder', 'readMdFile', 'readDatabase', 'dbFind',
];

let sandboxActionCallingEnabled = false;
let sandboxBaseUrl = '';

/**
 * Call once at host startup to opt into programmatic tool calling. `baseUrl`
 * is this server's own origin (e.g. http://127.0.0.1:3001), the sandboxed
 * subprocess calls back to it over localhost to invoke actions. Off by
 * default; a host that never calls this sees no behavior change.
 */
export function configureSandboxActionCalling(enabled: boolean, baseUrl?: string): void {
  sandboxActionCallingEnabled = enabled;
  if (baseUrl) sandboxBaseUrl = baseUrl.replace(/\/$/, '');
}

export function isSandboxActionCallingEnabled(): boolean {
  return sandboxActionCallingEnabled && !!sandboxBaseUrl;
}

interface SandboxTokenContext {
  userId: string;
  processId?: string;
  parentProcessIds: string[];
  expiresAt: number;
  callsRemaining: number;
}

// Single-run-scoped tokens, minted per runCode invocation and never exposed
// to the model, only injected into the generated code that call it back.
// In-memory is fine: a token only needs to outlive one runCode call on this
// same process, never needs to survive a restart or be shared across hosts.
const SANDBOX_TOKENS = new Map<string, SandboxTokenContext>();
const MAX_CALLS_PER_TOKEN = 50;

function cleanupExpiredTokens(): void {
  const now = Date.now();
  for (const [token, ctx] of SANDBOX_TOKENS) {
    if (ctx.expiresAt < now) SANDBOX_TOKENS.delete(token);
  }
}

export function mintSandboxToken(
  userId: string,
  processId: string | undefined,
  parentProcessIds: string[],
  ttlMs: number,
): string {
  cleanupExpiredTokens();
  const token = randomBytes(24).toString('hex');
  SANDBOX_TOKENS.set(token, {
    userId,
    processId,
    parentProcessIds,
    expiresAt: Date.now() + ttlMs,
    callsRemaining: MAX_CALLS_PER_TOKEN,
  });
  return token;
}

/** Called once the runCode invocation that minted this token has finished. */
export function invalidateSandboxToken(token: string): void {
  SANDBOX_TOKENS.delete(token);
}

/**
 * Validates one callback from inside the sandbox and, if it checks out,
 * returns the context to execute it with. Split out from the actual
 * `executeAction()` call (which lives in actionProcessor.ts, alongside
 * `executeAction` itself, to avoid a circular import between the two files)
 * so this file stays the single source of truth for token/allowlist rules.
 */
export function resolveSandboxCall(
  token: string,
  variant: string,
  parameters: Record<string, unknown>,
): { ok: true; userId: string; processId?: string; parentProcessIds: string[] } | { ok: false; error: string } {
  const ctx = SANDBOX_TOKENS.get(token);
  if (!ctx) return { ok: false, error: 'Invalid or expired sandbox token' };
  if (ctx.expiresAt < Date.now()) {
    SANDBOX_TOKENS.delete(token);
    return { ok: false, error: 'Sandbox token expired' };
  }
  if (ctx.callsRemaining <= 0) {
    return { ok: false, error: 'Sandbox call limit reached for this run' };
  }
  if (!SANDBOX_ALLOWED_ACTIONS.includes(variant as ActionVariant)) {
    return { ok: false, error: `Action "${variant}" is not available in the sandbox` };
  }

  const validation = validateAction({ type: 'action', variant, parameters });
  if (!validation.valid) {
    const detail = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    return { ok: false, error: `Invalid parameters for "${variant}": ${detail}` };
  }

  ctx.callsRemaining -= 1;
  return { ok: true, userId: ctx.userId, processId: ctx.processId, parentProcessIds: ctx.parentProcessIds };
}

/**
 * The JS prepended to the model's runCode source, defining one async
 * function per allowed action. Each one posts back to this same server and
 * returns the already-JSON-stringified result, so the model's code can
 * `JSON.parse()` it, same convention Anthropic's own programmatic tool
 * calling docs recommend for letting the model deserialize results in code.
 */
export function buildSandboxCodePreamble(token: string): string {
  const endpoint = JSON.stringify(`${sandboxBaseUrl}/api/internal/sandbox-action`);
  const fns = SANDBOX_ALLOWED_ACTIONS.map((variant) => `
async function ${variant}(parameters) {
  const res = await fetch(${endpoint}, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sandbox-token': ${JSON.stringify(token)} },
    body: JSON.stringify({ variant: ${JSON.stringify(variant)}, parameters: parameters || {} }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '${variant} failed');
  return data.result;
}`).join('\n');
  return `${fns}\n`;
}

/**
 * Documentation block for DESC_RUN_CODE, listing each sandbox function with
 * its description and parameter names, generated from the same DESC_*
 * prose the plain-JSON convention and native tool calling already use, so
 * this can't drift out of sync with what the actions actually do.
 */
export function buildSandboxDescriptionBlock(): string {
  const tools = buildActionTools({ allowedVariants: SANDBOX_ALLOWED_ACTIONS });
  const lines = SANDBOX_ALLOWED_ACTIONS.map((variant) => {
    const description = (((tools[variant] as any)?.description as string | undefined) || variant).replace(/\.+\s*$/, '');
    const schema = actionParamSchemas[variant];
    const shape = schema && 'shape' in schema ? Object.keys((schema as any).shape) : [];
    // Each function takes ONE object argument (see buildSandboxCodePreamble),
    // so it's written the way it's actually called. Listing the names
    // positionally, e.g. newsSearch(query, limit), led models to call it that
    // way and fail validation.
    const params = shape.length > 0 ? `({ ${shape.join(', ')} })` : '()';
    return `- \`${variant}${params}\`: ${description}.`;
  });
  return [
    ...lines,
    '',
    'How to call them: pass a single object, e.g. `await newsSearch({ query: "n8n", limit: 1 })`. Your code already runs inside an async function, so use `await` directly at the top level. Each call returns a JSON string: `JSON.parse()` it. The fields inside differ per action, so if you are not sure of the shape, print one parsed result first (or a small part of it) before relying on specific field names.',
  ].join('\n');
}

/**
 * The full program sent to the sandbox: the function preamble, then the
 * model's code inside an async function. Sandboxes run plain CommonJS, where
 * top-level `await` is a syntax error, and models naturally write
 * `await search(...)` at the top level, so without this wrapper the first
 * attempt usually fails. Errors, including rejected action calls, are printed
 * and turned into a non-zero exit code, the same outcome an uncaught error
 * has in an unwrapped script.
 */
export function buildSandboxProgram(token: string, code: string): string {
  return `${buildSandboxCodePreamble(token)}
(async () => {
${code}
})().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exitCode = 1; });
`;
}
