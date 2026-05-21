# Architecture Refactor Evidence

## AR-06 CLI / GUI Presentation Alignment

Date: 2026-05-21

Scope: audited CLI and GUI consumers for duplicated session action availability
rules, then aligned the GUI production consumer with the shared
`@codexhub/core` presentation contract without changing CLI output, GUI labels,
disabled states, workflows, API responses, transcript views, or raw item views.

### Implementation Decisions

- Updated `apps/web/src/main.tsx` to import `SESSION_ACTIONS`,
  `getSessionActionAvailability`, and `SessionAction` directly from
  `@codexhub/core`.
- Removed the app-local `apps/web/src/session-actions.ts` compatibility
  re-export because production GUI code no longer needs an intermediary module.
- Updated `apps/web/src/session-actions.test.ts` to exercise the same shared
  core helper imported through the package boundary while preserving the web
  compatibility assertions for labels and reason strings.
- Audited `apps/cli/src/program.ts`. The CLI has no current session action
  availability presenter and does not duplicate session-status eligibility for
  `steer`, `continue`, `stop`, or `complete`. `session send` keeps only command
  input validation for non-empty content and `--mode`; runtime/session
  eligibility remains an API responsibility. `session stop` posts to the API and
  formats the response. No CLI code change was needed.
- No server route helpers, repository projections, runtime behavior, Product
  Manager logic, CLI JSON fields, CLI human output strings, GUI button labels,
  GUI disabled-state text, transcript rendering, raw item rendering, or
  workflows changed.

### Validation

- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/web test`
  Passed: 4 files, 13 tests.
- `pnpm --filter @codexhub/web check`
  Passed.
- `pnpm format`
  Initially reported Prettier differences in the touched files; after applying
  Prettier to those files, rerun passed.
- `pnpm lint`
  Passed.
- `git diff --check`
  Passed.
- CLI gates were not run because CLI code was audited but not touched; no CLI
  command output contract changed.

### Compatibility Notes

- GUI action labels remain `Send Steer`, `Continue`, `Stop`, and `Complete`.
- GUI action disabled-state calculations and reason strings remain owned by the
  shared core helper introduced in AR-05.
- CLI JSON and human output remain stable because AR-06 made no CLI code
  changes and found no CLI-local duplicate of the core session action
  availability rules.
- Transcript and raw item views were not modified.

### Issues And Follow-Ups

- No new Codexhub dogfood friction was discovered in this slice.
- No follow-up issues were found for AR-06.

### Documentation Impact

This evidence section is the required AR-06 documentation update. README,
AGENTS, roadmap, review-gate, CLI, GUI, schema, and workflow-skill
documentation did not need changes because this slice only removed a redundant
web compatibility wrapper and preserved all operator-facing behavior and
external contracts.

## AR-05 Planning / Presentation Helpers

Date: 2026-05-21

Scope: introduced a focused shared Planning / Presentation helper for session
action availability and wired the existing web action presenter to consume it,
without changing API route behavior, CLI output, GUI labels, disabled states, or
JSON contracts.

### Implementation Decisions

- Added `packages/core/src/session-presentation.ts` as the shared home for the
  first behavior-backed presentation rule set: `steer`, `continue`, `stop`, and
  `complete` action availability for operator-facing session views.
- Kept the helper small and pure. It accepts session status, message content,
  and the currently submitting action, then returns the same action labels,
  disabled flags, and reason strings the web UI already used.
- Reused core state-machine rules for send eligibility:
  `canSendMessage(status, "steer")` and
  `canSendMessage(status, "continue")`. The presentation helper adds only the
  operator-facing message-content, submitting, and stop/complete affordance
  interpretation.
- Exported the helper surface from `packages/core/src/index.ts` so AR-06 can
  consume it from CLI or GUI code without reaching into app-local modules.
- Replaced `apps/web/src/session-actions.ts` with a compatibility re-export
  over the shared core helper. Existing production imports in
  `apps/web/src/main.tsx` and existing web tests continue to use the same local
  module path while executing the shared core implementation.
- No server route helper, API response assembler, CLI formatter, transcript
  metadata, latest-result selection, run group dashboard, SQLite schema, route
  path, pagination, cursor, or raw/debug default behavior changed in this
  slice.

### Coverage Added

- `packages/core/src/session-presentation.test.ts` covers the shared
  presentation rules for:
  - `steer` availability while running or awaiting input with non-empty content;
  - `continue` availability only while awaiting input with non-empty content;
  - non-empty message requirements for send actions;
  - `stop` and `complete` availability before terminal states only;
  - terminal send guidance pointing operators to follow-up sessions;
  - submitting-state disabling for all actions.
- Existing `apps/web/src/session-actions.test.ts` remains as compatibility
  coverage for the web import surface and preserved GUI reason strings.

### Validation

- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/core test`
  Passed: 8 files, 36 tests after the package build artifacts were present.
- `pnpm --filter @codexhub/web test -- session-actions.test.ts`
  Passed: 1 file, 3 tests.
- `pnpm --filter @codexhub/server test`
  Passed: 9 files, 62 tests.
- `pnpm --filter @codexhub/server check`
  Passed.
- `pnpm --filter @codexhub/web test`
  Passed: 4 files, 13 tests.
- `pnpm --filter @codexhub/web check`
  Passed.
- `pnpm format`
  Initially failed on Prettier formatting in touched files; after applying
  Prettier to the touched files, rerun passed.
- `pnpm lint`
  Passed.
- `git diff --check`
  Passed.

### Compatibility Notes

- GUI labels are preserved: `Send Steer`, `Continue`, `Stop`, and `Complete`.
- GUI disabled-state reason strings are preserved, including non-empty message
  requirements, terminal follow-up guidance, status-specific send guidance, and
  submitting-state messages.
- Session action availability remains compatible with current web behavior and
  shared state-machine rules:
  - `steer`: running or awaiting input, plus non-empty message;
  - `continue`: awaiting input, plus non-empty message;
  - `stop`/`complete`: starting, running, or awaiting input.
- API/CLI/GUI public contracts remain unchanged. The web module path remains in
  place as an app-local compatibility surface, and `@codexhub/core` now owns the
  reusable rule.

### Issues And Follow-Ups

- No new Codexhub dogfood friction was discovered in this slice.
- Follow-up for AR-06: CLI and GUI callers can now import session action
  availability from `@codexhub/core`; later slices should move additional
  bounded latest-result, transcript-window, or dashboard interpretation rules
  only when a production caller consumes them.

### Documentation Impact

This evidence document is the required AR-05 documentation update. README,
AGENTS, roadmap, review-gate, runtime-supervisor, CLI, GUI, schema, and
workflow-skill documentation did not need changes because this slice introduced
an internal shared presentation helper while preserving operator-facing behavior
and external contracts.

## AR-04 State Substrate Split, Slices 1-2

Date: 2026-05-21

Scope: extracted repository row mapping and small SQL helpers from
`apps/server/src/repository.ts` into `apps/server/src/repository-sql.ts`, then
extracted the raw Codex item/event log boundary into
`apps/server/src/state-raw-item-log.ts`. `HubRepository` remains the public
compatibility facade and delegates raw item methods to the new store.

### Implementation Decisions

- Added `repository-sql.ts` as the shared home for id/time helpers, JSON
  encoding, pagination/cursor helpers, SQL placeholder generation, uniqueness,
  transcript unit source checks, and all SQLite row-to-domain mapping.
- Added `state-raw-item-log.ts` as the behavior-bearing store for
  `appendItem`, `listItems`, `getItem`, `latestItem`, and
  `latestCompletedAgentMessage`.
- Kept `appendItem` append-first behavior, per-session monotonic
  `last_item_sequence`, lossless raw JSON storage, and latest completed
  agent-message session projection update semantics unchanged.
- Kept `HubRepository` method signatures, route-facing contracts, SQL schema,
  projection reads, review/run group behavior, and session reference resolution
  unchanged.
- Deferred product-record, derived-projection, and collaboration/review store
  extraction to later slices. This keeps AR-04 reviewable while creating one
  real state-substrate boundary.
- No SQLite schema, migration, API route, CLI/GUI contract, pagination default,
  or cursor semantic changes were introduced.

### Responsibility Map

- Old `repository.ts` local helpers `id`, `isoNow`, `encodeJson`,
  `clampLimit`, `parseCursor`, `placeholders`, `unique`, and
  `requiredUnitSourceId` now live in `repository-sql.ts`.
- Old `repository.ts` row mappers for projects, workspaces, run groups,
  sessions, task specs, messages, raw items, transcript units, review gate
  statuses, run group dashboard summaries, and review findings now live in
  `repository-sql.ts`.
- Old `repository.ts` raw item/event-log behavior now lives in
  `state-raw-item-log.ts`: raw payload classification and insert,
  `last_item_sequence` updates, latest completed agent-message projection
  updates on `worker_sessions`, item pagination, direct item lookup, latest item
  lookup, and latest completed agent-message lookup.
- `repository.ts` still owns product record writes/reads, derived transcript
  projection queries, review metadata, run-group dashboards, and session
  reference resolution. These are the next extraction candidates.

### Validation

- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/server test -- repository-characterization.test.ts`
  Passed: 1 file, 1 test.
- `pnpm --filter @codexhub/server test`
  Passed: 9 files, 62 tests.
- `pnpm --filter @codexhub/server check`
  Passed.
- `git diff --check`
  Passed.

### Issues And Follow-Ups

- Dogfood friction: `session start --file docs/...` resolved the relative path
  from `apps/cli`, so AR-04 startup required an absolute path. GitHub issue #48
  tracks this.
- Dogfood note: `task_spec.raw` was null in the started session because the
  command used `--file` rather than `--task-spec-file`; the task text still
  reached the worker as the initial prompt, but the structured task-spec raw
  field was not populated.
- Follow-up: extract the derived transcript/run-group projection reads next,
  while keeping `HubRepository` as the compatibility facade and preserving
  pagination/grouping behavior.

### Documentation Impact

This evidence document is the required AR-04 slice documentation update.
README, AGENTS, roadmap, review-gate, CLI, GUI, and schema documentation did
not need changes because these slices only moved internal repository helpers
and raw item-log behavior without changing operator workflow or external
contracts.

## AR-03 Runtime Protocol Adapter

Date: 2026-05-21

Scope: extracted Codex App Server protocol adaptation from `runtime.ts` without
changing public API routes, CLI/GUI behavior, SQLite schema, runtime supervisor
configuration, or Codex App Server protocol semantics.

### Implementation Decisions

- Added `apps/server/src/codex-app-server-adapter.ts` as the focused Codex App
  Server adapter for JSON-RPC request and notification payload construction,
  newline-delimited serialization, response extraction, stdout/stderr line
  normalization, nested thread/turn id extraction, and native turn-event
  normalization.
- Kept `CodexRuntime` responsible for process lifecycle, pending request
  bookkeeping, request id allocation, timeout handling, fake mode, and
  repository side effects.
- Preserved append-first raw event handling: parsed JSON payloads are appended
  to the repository before pending response resolution or normalized
  session-state effects are applied.
- Preserved non-JSON diagnostic handling by normalizing stdout/stderr lines into
  `{ stream, line }` raw items with the same trimmed line behavior.
- Kept native event outcomes compatible: `turn/completed` moves to
  `awaiting_input`; `turn/failed` and `turn/cancelled` fail the session with the
  same JSON failure reason shape; `turn/input_required` and `turn/needs_input`
  move to `awaiting_input`.
- Reused the orphaned `apps/server/test/codex-app-server-adapter.test.ts` from
  the failed session as useful WIP, then completed the adapter implementation
  against it.

### Coverage Added

- `apps/server/test/codex-app-server-adapter.test.ts` covers JSON-RPC payload
  construction for initialize, initialized, thread/start, turn/start, and
  turn/steer; newline-delimited serialization; JSON-RPC response extraction;
  nested Codex id extraction; stdout/stderr JSON versus diagnostic line
  normalization; and native turn-event normalization.
- Existing server runtime, supervisor, fake-mode, and API tests continue to
  cover broader worker lifecycle behavior and structured
  `session_process_unavailable` paths.

### Commands Run

- `pnpm --filter @codexhub/server test -- codex-app-server-adapter.test.ts`
  Initially failed while the first adapter draft imported `@codexhub/core`
  before core was built. The adapter was made self-contained for event status
  normalization, then the command passed: 1 file, 5 tests.
- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/server check`
  Initially surfaced one strict-null issue in the new adapter, which was fixed.
  Rerun passed.
- `pnpm --filter @codexhub/server test`
  Passed: 9 files, 62 tests.
- `pnpm format`
  Passed after applying Prettier to touched files.
- `git diff --check`
  Passed.
- `pnpm test`
  Passed: core build, then core/server/cli/web tests.
- `pnpm lint`
  Passed.
- `pnpm build`
  Passed: core, server, CLI, and web builds.

### Issues And Follow-Ups

- Dogfood recovery note: AR-03 was resumed after the previous Codexhub
  self-dogfood session was orphaned by API runtime ownership loss. This is
  workflow issue #46 and was not treated as a code-review finding against the
  implementation.
- Follow-up candidate: continue tracking package-level server validation on
  clean checkouts. The adapter test no longer needs a core build, but the
  documented broader server checks still require `@codexhub/core` to be built
  first.
- No new product, API, CLI, GUI, schema, or supervisor follow-ups were found in
  this slice.

### Documentation Impact

This evidence document is the required AR-03 documentation update. README,
AGENTS, roadmap, PRD, DAG, CLI, GUI, schema, and supervisor documentation did
not need changes because the public operator workflow and external contracts
were intentionally kept unchanged.

## AR-02 Product Manager Command Module

Date: 2026-05-21

Scope: extracted worker lifecycle product commands from Fastify session routes
without changing route paths, response DTOs, CLI/GUI behavior, or SQLite schema.

### Implementation Decisions

- Added `apps/server/src/product-manager.ts` as the server-side Product Manager
  module for worker lifecycle commands: start worker, start follow-up worker,
  send steer/continue/initial-shaped messages, stop worker, and complete worker.
- Kept Fastify route handlers responsible for HTTP parsing, enum parsing, and
  HTTP status/detail mapping. Product Manager throws `ProductManagerError`
  values with product codes and details, not Fastify request/reply objects.
- Product Manager depends on `HubRepository` and `CodexRuntimeController`,
  centralizing session creation, task spec persistence/merge behavior, message
  creation, runtime calls, terminal/follow-up checks, and unavailable-runtime
  persistence.
- Follow-up endpoint affordances remain HTTP-layer details. Product Manager
  reports `session_process_unavailable` with the session id and follow-up
  availability; the route mapper adds the versioned route prefix.
- Existing non-migrated reads, review records, run groups, workspace cleanup,
  workspace creation, and runtime protocol handling were left in place for later
  AR slices.

### Coverage Added

- `apps/server/test/product-manager.test.ts` covers Product Manager behavior
  directly with a fake runtime and in-memory SQLite repository:
  start worker persistence, follow-up worker task-spec merge, send message
  persistence/runtime handoff, stop/complete runtime handoff, and unavailable
  runtime failure persistence.
- Existing API tests continue to cover public route response shapes, follow-up
  errors, ambiguous session references, terminal follow-up rejection, and
  structured unavailable-runtime responses.

### Commands Run

- `pnpm --filter @codexhub/server check`
  Failed before building `@codexhub/core`: TypeScript could not resolve the
  core package entry on this clean checkout. The same run also surfaced a new
  strict optional `sender_id` issue in `product-manager.ts`, which was fixed.
- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/server check`
  Passed.
- `pnpm --filter @codexhub/server test -- product-manager.test.ts`
  Passed: 1 file, 5 tests.
- `pnpm --filter @codexhub/server test`
  Passed: 8 files, 57 tests.
- `pnpm format`
  Passed.
- `git diff --check`
  Passed.

### Issues And Follow-Ups

- Dogfood friction: package-level server checks still require
  `@codexhub/core` to be built first on a clean checkout. This is documented in
  `AGENTS.md` and was observed again during AR-02 validation.
- GitHub issue
  [#45](https://github.com/albert-zen/Codexhub/issues/45) tracks the residual
  wrong-mode send API contract characterization risk.
- The Product Manager boundary is a real orchestration move, but AR-03/AR-04
  still own runtime protocol extraction and repository/state substrate
  splitting.

### Documentation Impact

This evidence document is the required AR-02 documentation update. README,
AGENTS, roadmap, PRD, DAG, CLI, GUI, and schema documentation did not need
changes because the public API and operator workflow were intentionally kept
unchanged.

## AR-01 Characterization Coverage

Date: 2026-05-21

Scope: test audit and focused characterization before production module
extraction. No production modules were moved or refactored.

### Coverage Note

Protected behavior from `docs/prd/architecture-refactor.md`:

- Raw Codex payloads are stored losslessly before projections are derived.
  Covered by new
  `apps/server/test/repository-characterization.test.ts`, plus existing
  `apps/server/test/server.test.ts` latest/raw item tests.
- Item sequences are monotonic per worker session.
  Covered by new repository characterization test and existing transcript/item
  pagination tests in `apps/server/test/server.test.ts`.
- `last_agent_message` tracks the latest completed agent message, not streaming
  delta fragments.
  Covered by existing server tests for stable latest, draft-only latest, and
  polluted projection repair, with CLI formatting coverage in
  `apps/cli/test/program.test.ts`.
- Transcript projection groups agent-message fragments, collapses tool/debug
  entries, and keeps raw item inspection explicit.
  Covered by `packages/core/src/transcript.test.ts`,
  `apps/server/test/server.test.ts`, `apps/web/src/transcript-view.test.ts`,
  and CLI trace tests in `apps/cli/test/program.test.ts`.
- Transcript, item, session, review finding, and run group dashboard reads are
  bounded by default and support pagination/cursor windows where applicable.
  Covered by server dashboard/transcript/item/review finding tests and CLI trace
  pagination tests. Existing project/workspace list reads are bounded by their
  current small local-control-plane behavior.
- CLI JSON output remains stable and structured; human output remains compact.
  Covered by `apps/cli/test/program.test.ts` JSON shape and human output tests.
- Canonical `/api/v1` routes remain supported, with root aliases retained.
  Covered by `apps/server/test/server.test.ts`.
- Session references accept canonical ids, unique prefixes, and unique UUID
  prefixes; ambiguous prefixes return machine-readable candidates before side
  effects.
  Covered by existing server and CLI tests for unique/ambiguous references.
- `steer` is valid only for running or awaiting-input sessions; `continue` is
  valid only for awaiting-input sessions; both require non-empty content.
  Covered by `packages/core/src/state-machine.test.ts`,
  `apps/web/src/session-actions.test.ts`, and server message-required tests.
- Terminal sessions are not revived; follow-up sessions start new sessions.
  Covered by existing server follow-up tests for terminal and non-terminal
  source sessions.
- Missing live runtime ownership returns structured
  `session_process_unavailable` errors with a follow-up affordance.
  Covered by existing server tests for orphaned in-process sessions, registry
  loss, and external supervisor disappearance.
- Startup reconciliation fails closed for transient sessions unless runtime can
  prove a live managed session.
  Covered by existing server restart reconciliation tests.
- External runtime supervisor mode is opt-in and preserves workers across API
  reloads only while supervisor remains live.
  Covered by existing external supervisor restart/disappearance tests.
- Supervisor-unavailable errors are structured and do not become successful API
  responses with error bodies.
  Covered by existing invalid-supervisor-response test.
- Worktree workspace setup preserves Windows path behavior and grants required
  linked-worktree Git metadata roots.
  Covered by existing server workspace builder/runtime sandbox tests.
- Workspace cleanup refuses active sessions and is safe around root/missing
  paths.
  Covered by existing server workspace cleanup tests.
- Fake Codex mode remains available for CI-safe dogfood smoke tests.
  Covered by existing fake worker API tests and `apps/server/test/dogfood-smoke.test.ts`.
- Run groups remain minimal grouping records, not a scheduler.
  Covered by existing run group create/add/list/dashboard tests.
- Review-gate status and review findings remain observability records, not
  automatic validation or merge policy.
  Covered by existing server and CLI review status/finding tests.
- Task spec metadata remains worker input and review context, not mutable proof
  that an implementation is correct.
  Covered by existing start/follow-up task spec persistence and merge tests.

### Tests Added

- `apps/server/test/repository-characterization.test.ts`
  characterizes state-substrate behavior directly:
  raw payload JSON survives SQLite round-trip exactly, item sequences are
  monotonic per session, `last_agent_message` derives only from completed agent
  messages, and transcript projection groups raw delta/completed items without
  dropping raw inspection data.

### Commands Run

- `pnpm --filter @codexhub/server test`
  Failed before building `@codexhub/core`: Vite could not resolve the core
  package entry.
- `pnpm --filter @codexhub/core build`
  Passed.
- `pnpm --filter @codexhub/server test`
  Passed: 7 files, 52 tests.
- `pnpm --filter @codexhub/server check`
  Passed.
- `pnpm test`
  Passed: core build, then core/server/cli/web tests.
- `pnpm format`
  Passed.

### Lessons And Follow-Ups

- Dogfood friction: package-level server tests can fail on a clean checkout if
  `@codexhub/core` has not been built first. The repo already documents this;
  the root `pnpm test` command handled it correctly.
- Follow-up candidate: consider a later server/API characterization around
  invalid send state responses before extracting product commands. Core and GUI
  rules are covered, and runtime rejects invalid sends, but the exact HTTP
  contract for non-terminal wrong-mode sends should be made explicit before
  route logic moves.
- Dogfood issue recorded: GitHub issue
  [#44](https://github.com/albert-zen/Codexhub/issues/44) tracks the missing
  CLI `session complete` command and contradictory `completed` session response
  with a stale `failure_reason`.

### Documentation Impact

This evidence document is the required AR-01 documentation update. The PRD,
DAG, AGENTS guidance, and user-facing README did not need changes because this
slice only added characterization coverage and recorded validation evidence.
