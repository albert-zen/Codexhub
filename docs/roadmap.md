# Codexhub Roadmap

Codexhub is a local Codex worker scheduler and control plane. It gives a
manager agent or human operator a small, durable surface for starting workers,
reading their status, and sending follow-up instructions without replaying a full
Codex thread into context.

The first usable loop now exists:

create project/workspace -> start session -> save raw items -> read latest
agentmessage -> list filtered items -> send steer/continue -> inspect in GUI.

The current product step is improving the manager-facing reading and follow-up
loop after the first orchestration metadata pass. Worktree workspaces, task spec
metadata, run groups, and review-gate status now exist as first-pass control
plane records. The next gaps are conversation-level transcript paging,
terminal-session follow-up, clearer web actions, and batch dashboards.

## V1 Outcome

Codexhub v1 is complete when a local operator can:

- Create a workspace record for a local checkout or cloned git source.
- Start one Codex app-server worker session in that workspace.
- Persist the raw Codex item stream before deriving any projections.
- Read a compact session summary, latest agent message, and filtered item list.
- Send a `steer` message while a worker is running or awaiting input.
- Send a `continue` message only when the worker is awaiting input.
- Inspect active and completed worker sessions in the web UI.
- Use the CLI for the same core loop when a GUI is not available.

## Current Baseline

The repository currently contains:

- `packages/core` with shared TypeScript types, item classification, and session
  state helpers, plus shared API DTOs for the main HTTP contracts.
- `apps/server` with Fastify routes, SQLite migrations/repository code,
  workspace creation, Codex app-server launch, raw item ingestion, message
  dispatch, and a fake worker path for integration tests.
- `apps/cli` with project, workspace, session, item, latest/result/trace/watch,
  send, stop, and recent-session commands. Leaf commands support `--json`.
  Session commands accept canonical session ids, unique leading session id
  prefixes, or unique UUID-portion prefixes while API responses keep canonical
  ids.
- `apps/web` with a compact project/session/detail UI, readable transcript,
  item type filter, latest agent message, send steer/continue, stop, and
  complete actions.
- Docs for Symphony lessons, subagent operations, roadmap, task specs,
  review-gate workflow, and local issue/backlog synthesis.
- Top-level `pnpm build`, `pnpm check`, `pnpm test`, and `pnpm format` scripts
  all pass.

Issues `#1` through `#18` are closed and represent the implemented baseline for
payload fixtures, restart reconciliation, CLI smoke coverage, API route policy,
README loop docs, workspace cleanup/worktrees, web item-window pagination, task
spec metadata, minimal run groups, CI warning cleanup, and review-gate status
metadata.

The following work remains open next:

- Add a conversation-level transcript projection so manager reads page through
  complete transcript entries instead of raw item deltas (`#19`).
- Make the web session detail consume that conversation transcript by default
  (`#20`).
- Explain disabled web session actions, especially terminal states that require
  follow-up instead of sending to a dead session (`#21`).
- Keep roadmap and local issue docs synchronized with the closed baseline and
  next backlog (`#22`).
- Start follow-up sessions from stopped, completed, or failed sessions without
  reviving dead Codex processes (`#23`).
- Add compact GUI flows for starting sessions and follow-up sessions (`#24`).
- Persist structured review findings and worker responses as observability, not
  a validation gate (`#25`).
- Add a run group dashboard for worker progress, latest messages, review state,
  and attention indicators (`#26`).
- Add a CI-safe fake dogfood smoke script, with real Codex runs manual and
  opt-in (`#27`).

First-stage priority order is tracked in `docs/github-issues.md`; the active
GitHub issue tracker is the execution source of truth.

## Product Principles

- Local first: v1 runs on one machine and stores data under
  `apps/server/data/codexhub.sqlite` by default.
- Raw first: store every Codex payload before creating summaries or projections.
- Low context: manager-facing reads must be compact and filterable by item type,
  sequence, and session.
- Explicit state: message send rules come from the shared state machine, not
  scattered endpoint checks.
- Narrow surfaces: v1 favors a small set of predictable APIs over a broad
  orchestration platform.
- Shared repo discipline: work should be split into small PR-sized issues that
  avoid unrelated files and respect concurrent edits.

## Non-Goals For V1

- Linear as the runtime queue.
- Claim leases or multi-agent task claiming.
- Remote multi-host scheduling.
- Multi-tenant authentication and authorization.
- Automated validation gates, merge policy, or escalation policy.
- Full transcript replay as the primary manager-agent interface.
- Replacing the Codex app-server protocol.

## Architecture Slices

### Core Package

`packages/core` owns shared contracts and pure behavior:

- Public TypeScript types for projects, workspaces, sessions, items, messages,
  and pages.
- `classifyCodexPayload` for raw Codex payload projection.
- Worker session state helpers for message eligibility and state transitions.
- Fixture-based tests for known Codex event shapes.

### Server

`apps/server` owns runtime coordination:

- Config and data directory bootstrap.
- SQLite schema migrations and repositories.
- HTTP API contracts.
- Codex app-server child process lifecycle.
- Event ingestion and session projection updates.
- Message queueing and dispatch to active sessions.

### CLI

`apps/cli` owns scriptable operations:

- Health checks.
- Workspace creation and lookup.
- Session creation and lookup.
- Item listing with compact filters.
- Message send commands for `steer` and `continue`.

### Web

`apps/web` owns operator inspection:

- Session list with status and latest agent message.
- Session detail with filtered item timeline.
- Message composer that exposes only valid actions for the current state.
- Error and terminal-state visibility.

## Implemented API Shape

The server exposes these routes under `/api/v1` and also keeps root aliases for
the first CLI/web pass:

- `GET /health`
- `POST /projects`
- `GET /projects`
- `GET /projects/:id/sessions`
- `POST /workspaces`
- `GET /workspaces`
- `GET /workspaces/:id`
- `POST /sessions`
- `GET /sessions`
- `GET /sessions/:id`
- `POST /sessions/:id/messages`
- `GET /sessions/:id/messages`
- `POST /sessions/:id/stop`
- `POST /sessions/:id/complete`
- `GET /sessions/:id/items?type=&after=&limit=`
- `GET /sessions/:id/items/latest?type=agentmessage`
- `GET /sessions/:id/latest`

API responses use shared core shapes where possible and return compact errors
with machine-readable codes.

Session `:id` route parameters and `session_id` query/body fields accept the
canonical `sess_<uuid>` id, a unique leading prefix including `sess_`, or a
unique leading prefix from only the UUID portion. Ambiguous prefixes return
`session_id_ambiguous` with machine-readable `candidate_ids`, and side-effect
routes reject them before changing state.

## Execution Plan

### Phase 0: Baseline Scaffold

Status: complete.

- Monorepo package layout exists.
- Core type and classifier tests exist.
- Server and CLI health paths exist.
- Web placeholder exists.

### Phase 1: Durable Model

Status: complete.

- Add server config for the SQLite path and data directory.
- Add idempotent migrations for projects, workspaces, worker sessions, items,
  and messages.
- Add repository functions for create/read/list paths needed by the v1 loop.
- Keep raw JSON payloads lossless.

### Phase 2: Workspace And Session Control

Status: complete for local workspaces, git clone/checkout, fake worker tests,
and a first real Codex app-server adapter.

- Implement workspace create/read API.
- Implement session create/read API.
- Add a Codex worker launcher boundary that can be tested without launching the
  real app-server.
- Persist process metadata and status changes.

### Phase 3: Item Ingestion

Status: complete for raw item storage, classification, pagination, and latest
agent message.

- Persist raw Codex events in arrival order with monotonic per-session sequence.
- Classify each event with `packages/core`.
- Update session projections such as `last_item_sequence`,
  `last_agent_message`, and failure state.
- Add compact item listing by session, type, sequence cursor, and limit.

### Phase 4: Message Flow

Status: complete for persisted `initial`, `steer`, and `continue` messages with
fake-worker integration coverage, real app-server dispatch paths, and explicit
non-empty `continue` content across API, CLI, and GUI.

- Queue manager and human messages.
- Enforce `canSendMessage` before dispatch.
- Dispatch `steer` and `continue` messages to the active Codex session.
- Record sent/failed message state and errors.
- Require explicit, auditable `continue` content from every caller.

### Phase 5: Operator Surfaces

Status: complete for the first CLI and GUI loop.

- Expand CLI around workspaces, sessions, items, and messages.
- Replace the web placeholder with a session dashboard and detail page.
- Keep GUI controls state-aware so invalid message actions are hidden or
  disabled.

### Phase 6: Hardening

Status: complete for the first hardening pass.

- Add fixture coverage for real Codex payloads.
- Reconcile persisted `starting`, `running`, and non-continuable
  `awaiting_input` sessions after server restart when no live runtime process
  exists.
- Centralize and validate host, port, and database runtime config.
- Decide and test the route policy: `/api/v1` is canonical, root routes remain
  supported local aliases for CLI/web convenience.
- Add README examples for the full local loop.
- Add smoke tests that prove server, CLI, and core contracts remain aligned.

### Phase 7: Readable Trace And Query Ergonomics

Status: first-pass complete for readable result/trace shortcuts; conversation
projection remains open.

Implemented:

- CLI shortcuts exist for `session result`, `session trace`, `session watch`,
  and `sessions recent`.
- The first web session detail pass can render a more readable trace while
  preserving raw JSON/item inspection as an explicit debug surface.
- Result and trace reads are bounded by default so normal inspection does not
  dump a full raw session history.
- Web item-window pagination exists for raw/session item inspection.

Remaining:

- Add a conversation-level transcript projection that produces complete prompt,
  agent-message, and tool/debug entries independent of raw item windows (`#19`).
- Make the web session detail consume that conversation transcript by default
  instead of relying on raw item windows (`#20`).
- Page by transcript entry cursor/window so Manager Agents can inspect complete
  conversation slices without rereading earlier entries (`#19`).

### Phase 8: Explicit Task Specs

Status: first-pass complete for session metadata; workflow polish remains open.

Implemented:

- Task spec templates and GitHub issue forms exist for feature, component, and
  bug-sized work.
- Worker sessions can store task spec metadata and expose it through API, CLI,
  and GUI detail surfaces.
- Task intent, scope, non-scope, acceptance criteria, validation commands, and
  review focus are treated as worker input rather than implementation notes.
- Documentation-impact checks are part of the repo workflow.

Remaining:

- Keep refining issue-template/task-spec ergonomics as more dogfood sessions run.
- Preserve the task spec as immutable input unless a manager explicitly assigns
  doc updates.
- Avoid turning task specs into project management records or validation gates.

### Phase 9: Review Subagent Quality Gate

Status: partially complete.

Implemented:

- Review-gate workflow docs define the read-only reviewer role and checklist.
- Review-gate status metadata tracks worker/reviewer progress as explicit
  observability, not as automatic validation.

Remaining:

- Persist structured review findings and worker responses (`#25`).
- Keep reviewer judgment focused on original task intent, acceptance criteria,
  tests, product boundaries, regressions, Windows/process risks, over-broad
  refactors, and documentation impact.
- Do not block worker completion or create merge policy inside Codexhub.

### Phase 10: Parallel Build Orchestration

Status: first-pass complete for worktrees, run groups, and review status;
orchestration UX remains open.

Implemented:

- Worktree-aware workspace creation supports isolated branches and paths for
  parallel workers.
- Minimal run groups can associate related WorkerSessions without becoming a
  project management system.
- Review-gate status metadata can track implementation, self-validation, review,
  and human-review readiness as worker-reported state.

Remaining:

- Track package/file ownership per WorkerSession to reduce conflicts during
  parallel work.
- Add a run group dashboard for sessions, statuses, latest messages, review
  state, blocked/failed indicators, and attention needs (`#26`).
- Keep batch supervision bounded and read-oriented; do not add scheduling
  policy, project management, validation gates, or CI coupling.

### Phase 10.5: Documentation Memory

Status: first-pass complete; keep current during dogfood.

- Keep a clear documentation map so agents know where to write setup, roadmap,
  lessons, subagent operations, issue drafts, task specs, and review rules.
- Add post-task documentation checks to worker handoffs.
- Capture reusable experience from every large worker/reviewer cycle.
- Treat stale docs as a bug or follow-up issue.
- Avoid turning docs into chat transcripts; record concrete operational lessons
  and product decisions.

### Phase 11: Automation And CI Integration

Status: partially complete.

- Repository CI runs `pnpm quality`.
- Add package-level CI jobs when the repo grows enough to benefit from faster
  feedback.
- CLI/server smoke tests run against a temporary Codexhub server.
- Add optional long-running dogfood jobs that create Codexhub sessions and
  report discovered issues without mutating code.
- Keep CI as an external validation surface; do not turn Codexhub itself into a
  validation gate for worker output.

## Definition Of Done

A v1 issue is done when:

- It is scoped to the files named by the issue or justified by the acceptance
  criteria.
- It has focused tests for the changed behavior when testable.
- `pnpm build`, `pnpm check`, and relevant package tests pass, or failures are
  documented with a concrete reason.
- New public API, CLI, or storage behavior is reflected in docs when needed.
