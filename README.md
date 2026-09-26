# DAF

**DAF (Defined Action Framework)** is a TypeScript toolkit for defining, validating and
running agentic, multi-step AI automations. You describe a process as a DAF document,
validate it, and execute it inside your own backend.

Everything ships as a single package: [**`daf-sdk`**](./packages/daf-sdk).

```bash
npm install daf-sdk
```

## Two layers, one package

| Layer | Import path | What it provides | Dependencies |
|-------|-------------|------------------|--------------|
| **Protocol** | `daf-sdk/protocol` | DAF types, Zod validation, builders | light (zod only) |
| **Runtime** | `daf-sdk/runtime` | execution engine and action handlers | server deps |
| **Both** | `daf-sdk` | re-exports everything | server deps |

Import `daf-sdk/protocol` in client or browser code to keep the runtime's server
dependencies (googleapis, the AI SDK providers, and so on) out of your bundle.

## What the runtime does

- **Process execution**: runs a process's steps in order, including fixed loops,
  processes that stop on a keyword, sub-processes called as steps (with cycle
  detection), steps that pause for user input and resume later, and multi-participant
  Interfaces processes.
- **Chat**: `executeChatTurn` runs one turn of a conversation with the same actions.
- **Actions**: parses the actions a model requests, either as native tool calls or as
  JSON in its reply, validates them and executes them. Built in: Google Docs and Drive,
  Notion pages and databases, Markdown files, data resources, database operations and
  code execution (the last two through your adapter).
- **Models**: OpenAI, Anthropic, Google, Mistral, xAI, DeepSeek and Moonshot through the
  Vercel AI SDK, with the user's own API keys when they have them.
- **Variables and usage**: variable substitution in prompts, and token usage recorded
  for every model call.

## What your app provides

The runtime is an **embedded library**, not a service. Everything that depends on your
infrastructure or your business stays in your app, and the runtime reaches it through
a `DAFStorageAdapter` you implement:

- **Persistence**: runs, processes, resources, users and integrations, in any database.
- **Email and web retrieval**: `sendEmail`, `scrape`, `search`, `previewSearch`,
  `newsSearch`, `tavilySearch` and `checkDomain` are part of the protocol, but the SDK
  ships no provider for them. Each runs your adapter hook, or reports that it isn't
  available.
- **Code execution**: `runCode` runs through your hook, so sandboxing is yours to decide.
- **Pricing and spend policy**: register your model rates with `configurePricing()`, and
  decide whether a user may make another call in the `checkAffordability` hook. Without
  them, calls cost 0 and are always allowed.

See the [package README](./packages/daf-sdk/README.md#pluggable-host-hooks) for the hook
signatures.

## How it fits together

```
your app (HTTP routes, CLI or worker: yours to write)
        │ embeds, and implements the DAFStorageAdapter
┌───────▼─────────────────────────────────┐
│        daf-sdk  (runtime layer)         │
│  execution engine and action handlers   │
└───────┬─────────────────────────────────┘
        │ builds on
┌───────▼─────────────────────────────────┐
│        daf-sdk  (protocol layer)        │
│  DAF types · Zod validation · builders  │
└─────────────────────────────────────────┘
```

## Quick start

### 1. Build a DAF document

```typescript
import {
  DAFDocumentBuilder,
  ProcessBuilder,
  promptStep,
  fixedLoopStep,
  validateDAFDocument,
} from 'daf-sdk/protocol';

const doc = new DAFDocumentBuilder()
  .variable('USER_EMAIL', 'user@example.com')
  .process(
    new ProcessBuilder('Weekly Report', 'STATIC_DIALOGUE')
      .step(promptStep('Fetch data'))
      .step(fixedLoopStep('Process items', 10))
      .build()
  )
  .build();

const { valid, errors } = validateDAFDocument(doc);
```

**Process types.** A process is one of:
- `STATIC_DIALOGUE`: runs its steps in order, once.
- `ADVANCED_DIALOGUE`: adds loops and a `stopProcessKeyword` that ends the run.
- `INTERFACES_PROCESS`: several participants (models, plus a `system` participant that
  posts the process steps) talk in one or more rooms. It adds `interfaceParticipants`,
  `interfaceDefs` (rooms; `type` is `text` for conversation only, or `text+data`, the
  default, for actions and real files), `interfaceExecutionOrder`, `interfaceMaxSteps`,
  and a `targetInterfaceId` on each step. The schema checks that every participant,
  room and step points at ids that exist.

### 2. Run it

```typescript
import { executeProcess, configurePricing, type DAFStorageAdapter } from 'daf-sdk';

// Optional: only if you bill for usage.
configurePricing({ modelPricing: { 'my-model': { input: 1.0, output: 5.0 } } });

// Implement the adapter over your own database (Postgres, Mongo, in-memory, ...).
const adapter: DAFStorageAdapter = {
  db: myDb,
  emitRunUpdate: (runId, event) => myEventBus.publish(runId, event),
  log: console,
  // ...the rest of the DAFStorageAdapter interface, plus the hooks you need
} as DAFStorageAdapter;

// Runs in your process: no HTTP and no client.
await executeProcess(processId, userId, adapter);
```

## Development

```bash
npm install        # install dependencies
npm run build      # build the package
npm run typecheck
npm test
```

Contributions are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues as described in [SECURITY.md](./SECURITY.md).

## Links

- [Package README](./packages/daf-sdk/README.md): full API and adapter guide
- [Changelog](./CHANGELOG.md)
- [npm: daf-sdk](https://www.npmjs.com/package/daf-sdk)

## License

[MIT](./LICENSE)
