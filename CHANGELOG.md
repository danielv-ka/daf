# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.4.1] - 2026-09-26

### Fixed
- **Models calling attachFile on a file they already had.** With a `$<resource id>` audio
  file in chat, Gemini answered correctly only about 1 time in 6: it either called
  attachFile on the file or said it couldn't read audio. attachFile's description now
  says a file already in the conversation should be read directly, and lists audio and
  video (Gemini) alongside images and PDFs, as does the `data` resource type. The
  attachment message's own label now says it is the file itself. In the same test this
  went to 12 out of 12.

## [2.4.0] - 2026-09-25

### Added
- **Audio and video data resources for Gemini models.** A `$<resource id>` reference (or
  attachFile) to an `audio/*` or `video/*` data resource now sends the file natively when
  the model is Gemini, up to 15MB. Other models get a clear error that says to pick a
  Gemini model.

### Changed
- **Smaller, cached Interfaces prompts.** Each participant's prompt is split into a stable
  part (instructions, actions, resources), marked for Anthropic prompt caching and reused
  as a prefix by OpenAI and Gemini, and a per-turn part (transcript, which room to speak
  in). Claude and GPT participants no longer get the roughly 40k character text catalog of
  actions, since they already get every action as a native tool with its description. In a
  two room, two participant test run this cut total tokens from 88,069 to 27,302.
- A resolved `$<resource id>` now reads "[Attached file: name, included above]" in the
  prompt. With the bare label, models sometimes called attachFile on the file instead of
  reading the copy they already had.

## [2.3.0] - 2026-09-25

### Added
- **Interfaces processes in the DAF format.** `INTERFACES_PROCESS` is now a process type,
  with `interfaceParticipants`, `interfaceDefs` (rooms, `type` `text` or `text+data`),
  `interfaceExecutionOrder`, `interfaceMaxSteps`, and `targetInterfaceId` on steps, all part
  of the process definition, so they appear and are validated in both process definition
  files and manifests. Until now they were only understood by the runtime and one host,
  which had to slip them past validation, so nothing checked them.
- Validation for Interfaces processes: at least one room and one participant, unique ids,
  and every participant, room and step pointing at ids that exist. Interfaces fields on
  any other process type are rejected.
- `INTERFACE_TYPES`, `INTERFACE_EXECUTION_ORDERS`, `INTERFACE_SYSTEM_MODEL` constants, and
  `DAFInterfaceParticipant` / `DAFInterfaceDef` types. The runtime's `InterfaceParticipant`
  and `InterfaceDef` are now aliases of these.

### Changed
- `stopProcessKeyword` is accepted on `INTERFACES_PROCESS` as well as
  `ADVANCED_DIALOGUE` (still rejected on `STATIC_DIALOGUE`).

## [2.2.0] - 2026-09-25

### Added
- **Data resources in manifests.** `data` is now a valid manifest resource type, with
  `mediaType` (required) and `content` (base64, optional, e.g. left out over a size limit).
- **Portable resource references in manifests.** A manifest resource can carry `ref`, its id
  in the exporting account, and a process can carry `resourceRefs`, the refs of the resources
  attached to it. An importer maps refs to the new ids, so it can re-attach resources to
  processes and rewrite `$<resource id>` references in step text. All three fields are
  optional, so older manifests still validate.

### Fixed
- **The six data actions were missing from `ACTION_TYPES`** (`readData`, `writeData`,
  `createData`, `deleteData`, `renameData`, `duplicateData`). Any manifest listing them failed
  validation, and they never had native tools. They now have parameter schemas matching the
  runtime's checks, and native tools with their catalog descriptions.

## [2.1.0] - 2026-09-25

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
