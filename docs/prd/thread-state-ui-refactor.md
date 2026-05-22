# PRD: Thread State And Chat UI Refactor

## Problem Statement

Codexhub currently exposes worker-session runtime bookkeeping too directly in
both state language and UI behavior. The result is confusing product semantics:
runtime liveness can look like task failure, "resume" can look like a required
user action, and global thread creation does not clearly state which project owns
the new conversation.

The desired product model is simpler: users and manager agents work inside
project-bound threads. Runtime/session details remain internal delivery
mechanics for sending the next turn.

## Goals

- Make Project -> Thread -> Chat the primary product model.
- Let each project create its own empty thread from the project navigation.
- Keep the composer visible for readable threads, including empty or detached
  threads.
- Automatically start, reconnect, or resume the underlying runtime when a user
  sends a message.
- Separate thread lifecycle, conversation/message flow, runtime attachment, and
  UI state.
- Keep transcript/message-window reads bounded, cursorable, and ready for
  virtualized rendering.
- Provide a thread-oriented CLI surface for manager/worker agents without
  breaking existing session commands.

## Non-Goals

- Do not add a board/dashboard workflow in this slice.
- Do not expose run groups as part of the chat UI.
- Do not perform a destructive database rename from sessions to threads.
- Do not add GitHub/Linear/CI deep integrations.
- Do not model deletion as a normal thread lifecycle state.
- Do not remove existing `session` CLI commands during the first migration.

## Solution Overview

Codexhub will keep the existing durable session/raw item substrate while adding a
thread-oriented product layer. Existing raw Codex item storage remains lossless.
Sent user/manager messages and raw Codex items continue to project into a
transcript. The UI consumes bounded transcript windows and displays a quiet chat
surface: project/thread navigation, current thread transcript, and always-visible
composer.

The send path owns runtime readiness. If the selected thread has no ready
runtime, the server attempts to ensure runtime readiness before delivering the
message. The UI may show a transient connecting/sending state, but it does not
present Resume as a primary control.

## User Stories

1. As a human operator, I want to create a new thread from a specific project, so
   that the thread's cwd and ownership are unambiguous.
2. As a human operator, I want an empty thread to immediately show an input area,
   so that I can start work without another setup step.
3. As a human or manager agent, I want to send a message to an existing thread
   without manually resuming it, so that continuing work feels like normal chat.
4. As a GUI user, I want long transcripts to load as bounded windows, so that
   large sessions remain responsive.
5. As a manager agent, I want CLI/API reads to stay bounded and structured, so
   that session observation remains low-context and stable.
6. As a manager agent, I want thread-oriented CLI commands with stable JSON, so
   that I can create, inspect, send to, and read context from threads without
   reasoning about runtime sessions.

## Behavior Requirements

- Project navigation shows a new-thread control scoped to each project.
- Creating a thread requires a project and selects the new empty thread.
- Empty threads have no transcript entries but do have a focused composer.
- Sending the first message turns an empty thread into an active thread.
- Sending to a detached/exited/not-started runtime automatically invokes runtime
  readiness before turn delivery.
- Runtime readiness failures are shown as send/retry failures, not as failed
  thread lifecycle.
- Persistent header badges for idle runtime, ready state, and transcript window
  internals are not shown in the default UI.
- Transcript APIs support recent windows and sequence-bounded windows.
- Message-window parameters are read parameters, not durable business state.
- CLI exposes thread-oriented aliases for create/list/inspect/send/trace/latest.
- CLI writes support an idempotency strategy or explicit follow-up issue before
  unattended agent execution relies on retries.
- CLI send supports automatic runtime readiness and can wait for useful
  milestones such as accepted, first event, or turn complete.
- Agent-facing reads include a compact context window that returns thread
  summary, latest agent message, recent transcript, allowed actions, attention
  reasons, and pagination cursors in one call.
- Tool calls are available as collapsed transcript rows by default and as
  expandable tool-call/read-item projections on demand.
- Side-effecting send/create paths are protected against duplicate agent retries
  through idempotency keys or transaction guards.
- Concurrent `continue`/send calls are guarded per thread/runtime attachment so
  two callers cannot accidentally start overlapping turns.
- Messages keep auditable `sender_type` and `sender_id` so human and agent
  interventions remain attributable.

## Implementation Decisions

- Human-approved product decisions:
  - Thread is the primary product resource. Session remains as compatibility and
    diagnostic language during migration.
  - Agent reads default to a compact thread context window rather than requiring
    callers to compose several low-level reads.
  - Tool calls appear as collapsed transcript rows by default and expand into
    structured details; raw payloads remain debug-only.
  - Run groups stay out of this refactor's primary UI/CLI path.

- Use product terms in new API/UI surfaces: Project, Thread, Conversation, and
  RuntimeAttachment.
- Keep existing `worker_sessions` persistence initially. Treat it as the backing
  store for thread records while new contracts expose thread semantics.
- Model thread lifecycle as:

  ```ts
  type ThreadState = "empty" | "active" | "archived";
  ```

- Model conversation flow separately:

  ```ts
  type ConversationState =
    | "loadingHistory"
    | "ready"
    | "sendingUserMessage"
    | "streamingAssistant"
    | "failedToSend"
    | "failedToLoad";
  ```

- Model runtime attachment separately:

  ```ts
  type RuntimeState =
    | "unknown"
    | "notStarted"
    | "starting"
    | "ready"
    | "busy"
    | "paused"
    | "exited"
    | "failed";
  ```

- `RuntimeState !== "ready"` is not thread failure.
- Delete support, if added later, should be a repository operation or
  `deletedAt` tombstone, not a `ThreadState`.
- Message window state belongs to request/query/UI state:

  ```ts
  type TranscriptWindowQuery = {
    recent?: boolean;
    limit?: number;
    before?: number;
    after?: number;
    cursor?: string;
  };
  ```

- The existing `/sessions/:id/transcript` implementation can remain while new
  thread aliases or DTOs are introduced.
- Agent CLI design is captured in
  `docs/prototypes/codexhub-agent-cli-design.md`.
- Default transcript entries should be product-level projections. Raw Codex
  payloads remain available through explicit item/debug reads.
- Runtime/session identifiers such as process PID, Codex thread ID, and Codex
  turn ID are foreign references, not authoritative product lifecycle states.

## Testing Decisions

- Add core tests for thread/conversation/runtime state derivation.
- Add server tests for project-scoped empty thread creation.
- Add server tests proving send automatically starts/reconnects/resumes runtime
  before delivery.
- Add server/API tests for transcript windows as query-derived read models.
- Add web tests for project-scoped new thread, empty-thread composer, no Resume
  button, no persistent runtime badges, and transient sending/streaming states.
- Add CLI tests for thread-oriented aliases, stable JSON compatibility,
  idempotency flags, and send wait modes as those features are implemented.
- Add tests for compact agent context-window responses, tool-call projection,
  allowed actions, and duplicate send/create retry behavior.
- Run package-level gates for touched packages and root `pnpm quality` before
  final handoff when blast radius spans core/server/web/cli.

## Quality And Standards

- Preserve raw Codex item payloads losslessly.
- Keep manager-facing reads bounded, structured, and paginated.
- Prefer shared `packages/core` DTOs for API-facing contracts.
- Keep GUI defaults readable for humans; raw/debug views are opt-in.
- Keep runtime process lifecycle logic out of presentation components.
- Avoid hard-breaking CLI/API output unless a compatibility path is explicitly
  documented.

## Open Questions

- None blocking for planning or initial implementation.

Current execution assumptions:

- Implement compatible thread aliases/read models before any destructive session
  naming migration.
- Keep deletion out of the thread lifecycle.
- Keep board/run-group UI out of this refactor.
- Treat transcript windows as query/read-model state, not persisted state.
