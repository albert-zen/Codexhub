# GitHub Issues

This file seeds the first batch of small, executable GitHub issues for Codex
Hub. Each section is intended to become one issue and one focused PR unless the
assignee calls out a narrower split before starting.

Use these defaults unless an issue says otherwise:

- Branch from the current shared worktree state.
- Run `git status --short` before editing and before handoff.
- Do not revert unrelated edits.
- Keep code changes inside the named area.
- Update docs only when acceptance criteria explicitly require it.
- Verify with `pnpm build`, `pnpm check`, and the relevant package tests when
  code changes are made.

## CH-001: Add Server Runtime Config

Area: `apps/server`

Goal: centralize server runtime config for host, port, and SQLite data path.

Scope:

- Add a small config module used by server startup.
- Keep existing default host `127.0.0.1` and port `4317`.
- Default database path to `apps/server/data/codexhub.sqlite`.
- Allow environment overrides for host, port, and database path.

Acceptance criteria:

- Server startup reads config from one module instead of scattered constants.
- Existing `/health` behavior is unchanged.
- Invalid port config fails with a clear startup error.
- Build and type checks pass.

Out of scope:

- Creating tables.
- Changing API routes.
- Launching Codex workers.

## CH-002: Bootstrap SQLite Schema And Migrations

Area: `apps/server`

Goal: create an idempotent local SQLite schema for the v1 domain model.

Scope:

- Add database open/bootstrap code.
- Create the parent data directory when missing.
- Add migrations for projects, workspaces, worker sessions, items, and messages.
- Keep table columns aligned with `packages/core/src/types.ts`.

Acceptance criteria:

- Starting the server against an empty data path creates the database and all v1
  tables.
- Re-starting the server does not fail or duplicate migrations.
- A test or script exercises bootstrap against a temporary database path.
- Raw item payload storage can preserve arbitrary JSON.
- Build, type checks, and relevant tests pass.

Out of scope:

- HTTP CRUD routes.
- Codex process launch.
- GUI changes.

## CH-003: Add Workspace Repository And API

Area: `apps/server`

Goal: create and read workspace records through the API.

Scope:

- Add repository functions for workspace create/read.
- Add `POST /workspaces`.
- Add `GET /workspaces/:id`.
- Validate request bodies with clear errors.
- Generate ids server-side.

Acceptance criteria:

- `POST /workspaces` stores a workspace with source type, path, cwd, optional
  repo metadata, and status.
- `GET /workspaces/:id` returns the stored record.
- Missing workspace ids return `404` with a compact error body.
- Tests cover create, read, validation failure, and missing id.
- Build, type checks, and relevant tests pass.

Out of scope:

- Cloning git repositories.
- Creating directories on disk beyond database/data bootstrap.
- Starting sessions.

## CH-004: Add Session Repository And Read API

Area: `apps/server`

Goal: persist worker session records and expose compact session reads.

Scope:

- Add repository functions for session create/read/update.
- Add `POST /sessions` for creating a session record tied to a workspace.
- Add `GET /sessions/:id`.
- Initialize sessions in `starting` status.

Acceptance criteria:

- A session cannot be created for a missing workspace.
- Created sessions include project id, workspace id, status, timestamps, and
  nullable Codex process/thread fields.
- `GET /sessions/:id` returns the stored session.
- Missing session ids return `404`.
- Tests cover create, missing workspace, read, and missing id.
- Build, type checks, and relevant tests pass.

Out of scope:

- Launching Codex app-server.
- Item ingestion.
- Message sending.

## CH-005: Add Codex Worker Launcher Boundary

Area: `apps/server`

Goal: introduce a testable boundary for launching and tracking Codex app-server
workers without coupling routes directly to child process details.

Scope:

- Define a launcher interface for start, stop, and send-message operations.
- Add a real launcher placeholder or minimal implementation behind the boundary.
- Add a fake launcher for tests.
- Persist process pid or startup failure reason when launch is attempted.

Acceptance criteria:

- Session start code depends on the launcher interface, not direct child process
  calls.
- Tests can exercise successful and failed launch paths with the fake launcher.
- Startup failure moves the session to `failed` with a failure reason.
- Build, type checks, and relevant tests pass.

Out of scope:

- Full Codex protocol support.
- Message dispatch implementation beyond interface shape.
- GUI changes.

## CH-006: Persist Raw Codex Items

Area: `apps/server`

Goal: ingest raw Codex payloads for a session and store classified item rows.

Scope:

- Add an internal ingestion function that accepts session id and raw payload.
- Assign monotonic per-session sequence numbers.
- Use `classifyCodexPayload` from `packages/core`.
- Store raw payload, method, Codex item id/type, item type, and text excerpt.
- Update `last_item_sequence` on the session.

Acceptance criteria:

- Multiple ingested payloads for one session receive contiguous sequence values.
- Raw payload JSON is preserved losslessly enough to round-trip through the DB.
- Classified fields match the core classifier result.
- Ingestion fails clearly for a missing session id.
- Tests cover agent message, tool call/result, error, and raw fallback payloads.
- Build, type checks, and relevant tests pass.

Out of scope:

- Public event ingest API, unless needed for tests.
- Live Codex stream wiring.
- GUI changes.

## CH-007: Add Item Listing API

Area: `apps/server`

Goal: expose compact, filterable item reads for manager agents and the GUI.

Scope:

- Add `GET /sessions/:id/items`.
- Support `type`, `after`, and `limit` query parameters.
- Return the shared `Page<Item>` shape.
- Keep default limit small enough for low-context reads.

Acceptance criteria:

- Items are returned in ascending sequence order.
- `after` returns only items with a greater sequence.
- `type` filters by item type.
- `limit` is bounded and reflected in the response.
- Missing session ids return `404`.
- Tests cover pagination, filtering, and invalid query values.
- Build, type checks, and relevant tests pass.

Out of scope:

- Full text search.
- Transcript rendering.
- GUI changes.

## CH-008: Maintain Latest Agent Message Projection

Area: `apps/server`

Goal: keep session-level latest agent message fields up to date during item
ingestion.

Scope:

- Update `last_agent_message`, `last_agent_message_item_id`, and
  `last_agent_message_at` when an agent message item is completed.
- Decide and document how deltas are handled before completion.
- Add `GET /sessions/:id/latest-agent-message`.

Acceptance criteria:

- Completed agent message payloads update the session projection.
- Non-agentmessage items do not overwrite the projection.
- The latest-agent-message route returns the compact projection for a session.
- A session with no agent message returns `null` fields, not an error.
- Tests cover first message, later message replacement, and non-message items.
- Build, type checks, and relevant tests pass.

Out of scope:

- Full message delta reconstruction if completion payloads already contain text.
- GUI changes.

## CH-009: Add Message Queue API With State Guards

Area: `apps/server`

Goal: queue `steer` and `continue` messages only when the current session state
allows them.

Scope:

- Add `POST /sessions/:id/messages`.
- Validate mode, content, sender type, and optional sender id.
- Use `canSendMessage` from `packages/core`.
- Persist queued/sent/failed message records.
- Move session state according to shared state helpers when dispatch succeeds.

Acceptance criteria:

- `steer` is accepted for `running` and `awaiting_input` sessions.
- `continue` is accepted only for `awaiting_input` sessions.
- Invalid mode/state combinations return `409` with a clear error code.
- Accepted messages are persisted with status and timestamps.
- Tests cover valid steer, valid continue, invalid state, and missing session.
- Build, type checks, and relevant tests pass.

Out of scope:

- CLI message commands.
- GUI composer.
- Sophisticated retry policy.

## CH-010: Expand CLI For The V1 Loop

Area: `apps/cli`

Goal: expose the core local workflow through CLI commands once server routes
exist.

Scope:

- Add workspace create/get commands.
- Add session create/get commands.
- Add item list command with `--type`, `--after`, and `--limit`.
- Add message send command for `steer` and `continue`.
- Support `--json` output for each command.

Acceptance criteria:

- CLI commands call the documented API routes.
- Human output is concise and stable.
- JSON output is parseable and matches API response bodies.
- HTTP errors produce non-zero exit codes and useful messages.
- Build, type checks, and relevant tests pass.

Out of scope:

- Interactive prompts.
- GUI changes.
- Implementing missing server routes in the CLI PR.

## CH-011: Replace Web Placeholder With Session Dashboard

Area: `apps/web`

Goal: provide the first GUI inspection surface for Codexhub sessions.

Scope:

- Replace the placeholder with a session dashboard.
- Fetch health and session summary data from the API.
- Show status, workspace path/cwd, last agent message, and updated time.
- Add a session detail area with item list filters if item APIs are available.

Acceptance criteria:

- The page clearly distinguishes API offline, empty state, loading, and loaded
  states.
- Session rows are scannable and do not require reading raw JSON.
- The UI does not expose message actions until server state guards exist.
- Build and type checks pass.
- A browser smoke check confirms the page renders without console errors.

Out of scope:

- Auth.
- Charts.
- Full transcript rendering.
- Implementing missing server APIs in the web PR.

## CH-012: Add Realistic Codex Payload Fixtures

Area: `packages/core`

Goal: harden classification against realistic Codex app-server event shapes.

Scope:

- Add fixture payloads for agent messages, command execution, tool calls,
  reasoning deltas, turn state, and errors.
- Extend classifier tests to use the fixtures.
- Document any unknown event shape as raw instead of forcing a brittle
  classification.

Acceptance criteria:

- Fixture tests cover every `ItemType`.
- Existing classifier behavior remains backward compatible unless a fixture
  proves it wrong.
- Unknown future events still classify as `raw`.
- Package tests pass.

Out of scope:

- Server ingestion.
- Database schema.
- Live app-server integration.
