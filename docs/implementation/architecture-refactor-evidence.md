# Architecture Refactor Evidence

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
