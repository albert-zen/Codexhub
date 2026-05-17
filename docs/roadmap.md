# Codexhub Roadmap

Codexhub is a local Codex worker scheduler and control plane. It gives a
manager agent or human operator a small, durable surface for starting workers,
reading their status, and sending follow-up instructions without replaying a full
Codex thread into context.

The first usable loop now exists:

create project/workspace -> start session -> save raw items -> read latest
agentmessage -> list filtered items -> send steer/continue -> inspect in GUI.

The current product step is hardening that loop for repeated dogfood use:
parallel workspace safety, longer-running worker supervision, and review/task
metadata. The first readable transcript/result surfaces now exist, so normal
inspection no longer requires reading JSON deltas.

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
- `apps/web` with a compact project/session/detail UI, readable transcript,
  item type filter, latest agent message, send steer/continue, stop, and
  complete actions.
- Docs for Symphony lessons, subagent operations, roadmap, and first issue
  drafts.
- Top-level `pnpm build`, `pnpm check`, `pnpm test`, and `pnpm format` scripts
  all pass.

The following work remains open next:

- Document the complete local loop in README (`#11`).
- Workspace cleanup/delete endpoint and CLI command now exist for conservative
  archive-first cleanup.
- Broaden real Codex app-server fixture coverage as more live payloads are
  observed.
- Improve process cleanup behavior for stopped or failed real sessions.
- Continue sharing API DTO/client contracts across CLI and web where it removes
  real duplication without creating a large client abstraction.
- Add worktree-aware workspace creation for parallel worker sessions (`#13`).
- Web transcript pagination now exposes bounded item windows and previous/next
  navigation.
- Add task spec metadata and minimal run groups so large batches can be
  observed without becoming project management (`#15`, `#16`).
- Review-gate status metadata now tracks worker/reviewer progress as
  observability, not validation.
- Define and automate task-spec, worker, review-subagent, and quality-gate
  workflows for larger parallel builds.
- Keep using the documentation system so task outcomes, workflow friction, and
  lessons are captured after each worker run.

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
- Reconcile persisted `starting` and `running` sessions after server restart
  when no live runtime process exists.
- Centralize and validate host, port, and database runtime config.
- Decide and test the route policy: `/api/v1` is canonical, root routes remain
  supported local aliases for CLI/web convenience.
- Add README examples for the full local loop.
- Add smoke tests that prove server, CLI, and core contracts remain aligned.

### Phase 7: Readable Trace And Query Ergonomics

Status: complete for the first readable result and trace pass.

- Build a transcript projection that aggregates Codex agent-message deltas into
  complete readable messages.
- Show sent prompts/messages, full agent messages, and collapsible tool calls in
  chronological order.
- Keep raw JSONL/item inspection available as an explicit debug mode.
- Make the web session detail default to readable transcript/result inspection,
  not raw delta fragments.
- Add CLI shortcuts for `session result`, `session trace`, `session watch`, and
  `sessions recent`.
- Default result queries to a recent bounded window, such as the latest 10 or 20
  transcript turns/messages.
- Support cursor/range pagination so Manager Agents can inspect 20-50 without
  re-reading 1-20.

### Phase 8: Explicit Task Specs

Status: open.

- Introduce a task-spec format for feature, component, and bug work.
- Store task intent, scope, non-scope, acceptance criteria, validation commands,
  and review focus separately from worker implementation notes.
- Treat the task spec as immutable input for the worker unless a manager
  explicitly assigns doc updates.
- Let API/CLI/GUI associate WorkerSessions with task specs so humans can inspect
  what a worker was asked to do.
- Add issue templates that map cleanly into task specs for one issue / one
  branch / one PR workflows.
- Require each task to check which docs need updates before handoff.

### Phase 9: Review Subagent Quality Gate

Status: open.

- Require substantial worker tasks to spawn a read-only review subagent after the
  first implementation pass.
- Pass the review subagent the original task spec, changed files, validation
  output, and diff paths.
- Ask the review subagent to judge intent satisfaction, acceptance criteria,
  tests, product boundaries, regressions, Windows/process risks, and
  over-broad refactors.
- Require the worker to respond to review findings as accepted, rejected, or
  deferred.
- Persist review findings and worker responses as part of the session/task
  record.
- Include documentation impact in the reviewer checklist.

### Phase 10: Parallel Build Orchestration

Status: open.

- Add worktree-aware workspace creation for parallel workers that need isolated
  write scopes.
- Track package/file ownership per WorkerSession to avoid conflicts.
- Add worker run groups so a manager can launch a coordinated batch of workers
  for one roadmap slice.
- Add quality-gate status per worker: implementation done, self-validation done,
  review requested, review addressed, ready for human review.
- Add a dashboard view for run groups, blocked workers, failed quality gates,
  and review findings.
- Keep this as a control-plane feature, not a project management replacement.

### Phase 10.5: Documentation Memory

Status: open.

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
