# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Real files in Text + Data Interfaces rooms.** A room message can now carry the actual
  file (`InterfaceMessage.attachments`): an attachFile result's bytes (when the host returns
  them live), or data resources a System step references as `$<resource id>`. On each turn,
  every participant of a Text + Data room gets those files as native file parts when its
  model can read the type, or a short note otherwise (the room's text description still
  applies). Text rooms never carry files.
- `resolveDataReferences` accepts `models` to check several readers at once (every
  participant of a room); the error names the model that can't read the file.

### Changed
- A `$<resource id>` in a System step now fails the run with a clear message when the room
  is Text only, or when any participant's model can't read the file, instead of the file
  silently not reaching participants.
- The "can't read this type" error for images and PDFs no longer suggests attachFile, which
  fails for the same model; it suggests picking a model that can read the type.

## [2.0.1] - 2026-09-25

### Changed
- Package metadata now points to the public repository, github.com/danielv-ka/daf.
- Documentation and code comments cleaned up for the public release. No behavior changes.

## [2.0.0] - 2026-09-25

First public release of this repository. Earlier versions were developed in a private
repository.

### Removed (breaking)
- **Email and web retrieval implementations.** `sendEmail`, `scrape`, `search`,
  `previewSearch`, `newsSearch`, `tavilySearch` and `checkDomain` remain in the protocol
  and the action catalog, but the SDK no longer implements them. Each runs the host's
  adapter hook (`sendEmail`, `webScrape`, `webSearch`, `webPreviewSearch`, `webNewsSearch`,
  `webTavilySearch`, `webCheckDomain`), or returns a "not available" error without one.
- **Pricing data.** `MODEL_PRICING` and `TIER_TOKEN_LIMITS` are no longer exported and
  there is no default fallback rate. Register rates with `configurePricing()`; without
  them every call costs 0.
- **Built-in spend policy.** Wallet and plan-limit rules are gone from the execution
  loop. `canUserAffordApiCall` and `checkAndUpdateCostLimit` delegate to the adapter's
  `checkAffordability` hook and allow every call when it is absent.
- Dependencies `nodemailer` and `@mendable/firecrawl-js`.

### Added
- `checkAffordability` receives `usingOwnApiKey`, so a host can exempt calls made on the
  user's own provider key from balance checks.

### Migration
- Implement the hooks for the email and web actions you use, and pass your rates to
  `configurePricing()` at startup, including `fallbackModel` if unknown models should
  not be free.
