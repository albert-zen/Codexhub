# Codexhub Roadmap

Codexhub is a local Codex worker scheduler and control plane. It gives a
manager agent or human operator a small, durable surface for starting workers,
reading their status, and sending follow-up instructions without replaying a full
Codex thread into context.

The first usable loop is:

create workspace -> start session -> save raw items -> read latest agentmessage ->
list filtered items -> send steer/continue -> inspect in GUI.

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
  state helpers.
- `apps/server` with Fastify routes, SQLite migrations/repository code,
  workspace creation, Codex app-server launch, raw item ingestion, message
  dispatch, and a fake worker path for integration tests.
- `apps/cli` with project, workspace, session, item, latest-message, send, and
  stop commands. Leaf commands support `--json`.
- `apps/web` with a compact project/session/detail UI, item type filter,
  latest agent message, send steer/continue, stop, and complete actions.
- Docs for Symphony lessons, subagent operations, roadmap, and first issue
  drafts.
- Top-level `pnpm build`, `pnpm check`, `pnpm test`, and `pnpm format` scripts
  all pass.

The following work remains open:

- Broaden real Codex app-server fixture coverage beyond the fake worker path.
- Harden process lifecycle behavior across server restarts.
- Add explicit cleanup/delete workspace endpoints if needed.
- Add smoke tests that drive the built CLI against a running test server.
- Decide whether root route aliases should remain after Manager Agent clients
  converge on `/api/v1`.

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
fake-worker integration coverage and real app-server dispatch paths.

- Queue manager and human messages.
- Enforce `canSendMessage` before dispatch.
- Dispatch `steer` and `continue` messages to the active Codex session.
- Record sent/failed message state and errors.

### Phase 5: Operator Surfaces

Status: complete for the first CLI and GUI loop.

- Expand CLI around workspaces, sessions, items, and messages.
- Replace the web placeholder with a session dashboard and detail page.
- Keep GUI controls state-aware so invalid message actions are hidden or
  disabled.

### Phase 6: Hardening

Status: open.

- Add fixture coverage for real Codex payloads.
- Add process cleanup behavior for stopped or failed sessions.
- Add README examples for the full local loop.
- Add smoke tests that prove server, CLI, and core contracts remain aligned.

## Definition Of Done

A v1 issue is done when:

- It is scoped to the files named by the issue or justified by the acceptance
  criteria.
- It has focused tests for the changed behavior when testable.
- `pnpm build`, `pnpm check`, and relevant package tests pass, or failures are
  documented with a concrete reason.
- New public API, CLI, or storage behavior is reflected in docs when needed.
