# DAF SDK

**DAF (Defined Action Framework)** — a TypeScript toolkit for defining, validating, and
executing agentic, multi-step AI automations. Build DAF documents, validate them, and run
them in your own backend.

Everything ships as a single package: [**`daf-sdk`**](./packages/daf-sdk).

```bash
npm install daf-sdk
```

## Two layers, one package

| Layer | Import path | What it provides | Dependencies |
|-------|-------------|------------------|--------------|
| **Protocol** | `daf-sdk/protocol` | DAF types, Zod validation, builders | light (zod only) |
| **Runtime** | `daf-sdk/runtime` | execution engine + action handlers | server deps |
| **Both** | `daf-sdk` | re-exports everything | server deps |

Import `daf-sdk/protocol` in client/browser code to keep the runtime's server
dependencies (googleapis, nodemailer, firecrawl, …) out of your bundle.

## How it fits together

```
your app (HTTP routes / CLI / worker, yours to write)
        │ embeds
┌───────▼────────────────────────────────┐
│        daf-sdk  (runtime layer)         │
│  execution engine + action handlers     │
│  (you inject a DAFStorageAdapter)       │
└───────┬─────────────────────────────────┘
        │ builds on
┌───────▼─────────────────────────────────┐
│        daf-sdk  (protocol layer)        │
│  DAF types · Zod validation · builders   │
└──────────────────────────────────────────┘
```

The runtime is an **embedded library**, not a service. There is no built-in network
client — your app exposes whatever interface it needs (REST, queue worker, cron) on top
of the runtime.

## Quick Start

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

### 2. Execute it

```typescript
import { executeProcess, type DAFStorageAdapter } from 'daf-sdk';

// Implement the adapter over YOUR database (Prisma/Postgres/Mongo/in-memory…)
const adapter: DAFStorageAdapter = {
  db: myDb,
  emitRunUpdate: (runId, event) => myEventBus.publish(runId, event),
  log: console,
  /* …the rest of the DAFStorageAdapter interface */
} as DAFStorageAdapter;

// Run a process in-process — no HTTP, no client
await executeProcess(processId, userId, adapter);
```

Need custom skills or skill scripts? Add optional `executeCustomSkill` /
`executeSkillScript` hooks to your `DAFStorageAdapter` — they're host-coupled, so the
runtime calls back into your app.

## Development

```bash
npm install      # install deps
npm run build    # build the package
npm run typecheck
npm test
```

## Publishing

```bash
npm publish --workspace=daf-sdk
```

## Documentation

- [Package README](./packages/daf-sdk/README.md) — full API & adapter guide

## Links

- [GitHub Repository](https://github.com/danielv-ka/daf)
- [npm — daf-sdk](https://www.npmjs.com/package/daf-sdk)
