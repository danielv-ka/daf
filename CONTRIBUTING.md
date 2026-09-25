# Contributing to DAF

Thanks for your interest in contributing. Issues and pull requests are welcome.

## Getting started

1. Fork the repository and clone your fork:
   `git clone https://github.com/your-username/daf.git`
2. Install dependencies: `npm install`
3. Create a branch: `git checkout -b feature/your-feature-name`

## Development

The package lives in `packages/daf-sdk`. From the repository root:

```bash
npm run build      # build the package
npm test           # run the test suite
npm run typecheck  # type check
```

## Scope

DAF defines the protocol and the execution loop. Anything that depends on a specific
provider or business model (sending email, web search, pricing, billing) is supplied by
the host application through adapter hooks, and does not belong in this package. See
the "Pluggable host hooks" section of `packages/daf-sdk/README.md`.

## Pull requests

1. Add tests for new behavior and make sure `npm test` and `npm run typecheck` pass.
2. Update the README if you change a public API.
3. Add an entry under `[Unreleased]` in `CHANGELOG.md`.
4. Describe what you changed and why.

## Reporting bugs

Open an issue with steps to reproduce, the expected and actual behavior, and your
Node.js version. For security issues, follow `SECURITY.md` instead of opening an issue.
