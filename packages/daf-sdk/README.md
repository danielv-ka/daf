# daf-sdk

**DAF (Defined Action Framework)** is a single TypeScript package for defining,
validating, and executing agentic, multi-step AI automations.

```bash
npm install daf-sdk
```

It ships two layers in one package:

- **Protocol**: DAF document/action types, Zod validation, builder utilities. No
  heavy dependencies, so it's safe to import in a frontend or any client.
- **Runtime**: the agentic execution engine (step loop, action handlers, token-cost
  calculation, variables, real-time updates). You embed it in your backend and supply a
  `DAFStorageAdapter`.

## Import paths

```typescript
import { executeProcess, validateDAFDocument } from 'daf-sdk';        // everything
import { validateDAFDocument, DAFDocumentBuilder } from 'daf-sdk/protocol'; // types only (lightweight)
import { executeProcess } from 'daf-sdk/runtime';                     // engine only
```

Use `daf-sdk/protocol` in browser or client code to avoid pulling the runtime's server
dependencies (googleapis, the AI SDK providers, and so on) into your bundle.

## Build a DAF document (protocol)

```typescript
import {
  DAFDocumentBuilder,
  ProcessBuilder,
  promptStep,
  validateDAFDocument,
} from 'daf-sdk/protocol';

const doc = new DAFDocumentBuilder()
  .variable('USER_EMAIL', 'user@example.com')
  .process(
    new ProcessBuilder('Weekly Report', 'STATIC_DIALOGUE')
      .step(promptStep('Fetch data'))
      .build()
  )
  .build();

const { valid, errors } = validateDAFDocument(doc);
```

## Execute it (runtime)

The runtime is an embedded library, not a service. Host concerns (database, HTTP
routes, auth, billing, schedules) stay in your app; the runtime reaches them only
through a `DAFStorageAdapter` you implement.

```typescript
import { executeProcess, type DAFStorageAdapter } from 'daf-sdk';

const adapter: DAFStorageAdapter = {
  db: myDb,                                          // your persistence layer
  emitRunUpdate: (runId, event) => bus.publish(runId, event),
  log: console,
  // ...the rest of the DAFStorageAdapter interface
} as DAFStorageAdapter;

await executeProcess(processId, userId, adapter);
```

### Pluggable host hooks

Some capabilities depend on your infrastructure or your business, so the SDK defines
them as optional hooks on the adapter and calls back into your app:

```typescript
const adapter: DAFStorageAdapter = {
  // ...core methods...
  executeCustomSkill: (skillName, params, userId) => myApp.runSkill(...),
  executeSkillScript: (skillName, scriptName, args, userId) => myApp.runScript(...),
  executeRunCode: (code, timeout, userId) => myApp.runCodeSandboxed(code, timeout),

  // Email and web retrieval: the SDK defines these actions but ships no provider.
  sendEmail: (params, userId, processId) => myMailer.send(params),
  webSearch: (params, userId) => mySearch.query(params.query, params.limit),
  webScrape: (params, userId) => myScraper.fetch(params.url),
  // also webPreviewSearch, webNewsSearch, webTavilySearch, webCheckDomain

  // Spend policy: decide whether a user may make another model call.
  checkAffordability: (userId, { model, usingOwnApiKey }) => myBilling.check(userId),
};
```

When a hook is absent, the corresponding action returns a clear "not available"
error instead of running, and without `checkAffordability` every call is allowed.
`runCode` is delegated on purpose: the SDK never executes arbitrary code itself, so
sandboxing and allowlisting are an explicit host responsibility.

### Pricing

The SDK ships no model rates or plan limits. If you bill for usage, register yours at
startup; otherwise every call is recorded at a cost of 0.

```typescript
import { configurePricing } from 'daf-sdk';

configurePricing({
  modelPricing: { 'my-model': { input: 1.0, output: 5.0, cachedInput: 0.1 } }, // USD per 1M tokens
  tierTokenLimits: { FREE: 200_000 },
  fallbackModel: 'my-model', // rate for models missing from the table
});
```

## Key exports

- `executeProcess`, `executeProcessInRun`, `resumeProcessExecution`: run and resume processes
- `executeAction`, `processMessageActions`, `extractActionsFromMessage`: action execution
- `calculateTokenCost`, `configurePricing`, `getModelProvider`, `getProviderFromModel`: pricing and providers
- `substituteVariables`, `mergeVariables`: variables
- `DAFStorageAdapter`, `ExecutionContext`, `UserProviderSettings`: runtime types
- `validateDAFDocument`, `DAFDocumentBuilder`, `ProcessBuilder`, all action types: protocol
