# PRD: Architecture Refactor

## Problem Statement

Codexhub has a working local worker control plane, but several modules now carry
too much interface and implementation complexity. The HTTP server routes,
repository, runtime controller, CLI formatting, and GUI presentation rules have
grown around the first usable product loop. This makes new work harder to assign
to workers, harder to review, and easier to regress during runtime-boundary or
operator-surface changes.

The goal is to refactor from the current working baseline toward the architecture
described in `docs/architecture/CANVAS.md` without rewriting the product or
breaking existing behavior. The refactor should preserve the valuable edge
behaviors already discovered through dogfood work while deepening modules around
earned seams.

## Goals

- Preserve the existing API, CLI, GUI, SQLite, and runtime behavior while
  changing internal module shape.
- Make the Product Manager, Runtime Ownership Seam, Codex App Server Adapter,
  Codexhub State Substrate, and Planning / Presentation responsibilities
  explicit in code.
- Reduce route, repository, and runtime module shallowness by moving product
  commands, protocol adaptation, raw event storage, and view projection behind
  focused interfaces.
- Keep raw Codex event storage lossless and append-first.
- Keep manager-facing reads bounded, structured, paginated, and low-context.
- Make future AFK implementation safer by creating smaller ownership areas and
  test surfaces.

## Non-Goals

- Do not start a new repo or rewrite Codexhub from scratch.
- Do not replace Codex App Server, Codex thread/turn/item concepts, or the core
  agent loop.
- Do not change public HTTP routes, CLI command names, CLI JSON shapes, GUI user
  workflows, or SQLite schema unless a later slice explicitly requires it.
- Do not add auth, remote multi-host scheduling, lease claiming, CI merge gates,
  escalation policy, validation gates, or deep GitHub/Linear binding.
- Do not rename persisted `worker_sessions` concepts just to match the Canvas
  term "worker record."
- Do not collapse runtime supervision and JSON-RPC protocol adaptation into one
  larger abstraction.

## Solution Overview

Codexhub will keep the current product line and refactor in place. The first
implementation pass should introduce internal interfaces while keeping existing
external behavior stable. Routes should become thinner adapters from HTTP
requests into product commands and presentation reads. Runtime ownership should
continue to prove process availability and fail closed, while a Codex App Server
adapter owns native JSON-RPC request/response/event translation. Persistence
should expose a stable facade while internally separating product records, raw
event log writes, and projection queries. Operator-facing views should move
toward shared planning / presentation helpers instead of being split across
server routes, CLI formatting, and GUI logic.

This is a refactor, not a feature launch. Each slice should pass current tests
and add targeted tests around the new interface it introduces.

## User Stories

1. As a human operator, I want the same CLI, API, and GUI behavior after the
   refactor, so that architecture improvement does not interrupt my workflow.
2. As a manager agent, I want session summaries, transcripts, dashboards, and
   latest results to stay bounded and stable, so that I can supervise workers
   without replaying full threads into context.
3. As an implementation worker, I want product commands and runtime adapters to
   have clear ownership, so that I can change one behavior without scanning the
   entire server route file.
4. As a reviewer, I want raw event storage and projections to have separate
   test surfaces, so that I can verify lossless storage and presentation behavior
   independently.
5. As a maintainer, I want runtime ownership and Codex protocol adaptation to be
   separate modules, so that supervisor durability work does not mutate native
   protocol handling by accident.

## Existing Behavior Inventory

These behaviors are valuable and should be treated as regression-sensitive:

- Raw Codex payloads are stored losslessly before projections are derived.
- Item sequences are monotonic per worker session.
- `last_agent_message` tracks the latest completed agent message, not streaming
  delta fragments.
- Transcript projection groups agent-message fragments, collapses tool/debug
  entries, and keeps raw item inspection available as an explicit debug surface.
- Transcript, item, session, review finding, and run group dashboard reads are
  bounded by default and support pagination or cursor windows where applicable.
- CLI JSON output remains stable and structured; human output remains compact.
- Canonical `/api/v1` routes remain supported, with root aliases retained for
  local CLI/web convenience.
- Session references accept canonical `sess_<uuid>` ids, unique leading
  prefixes including `sess_`, and unique UUID-portion prefixes; ambiguous
  prefixes return machine-readable candidate ids before side effects.
- `steer` is valid only for running or awaiting-input sessions; `continue` is
  valid only for awaiting-input sessions; both require non-empty content.
- Terminal sessions are not revived. Operators start follow-up sessions for
  stopped, completed, failed, or orphaned work.
- Missing live runtime ownership returns structured
  `session_process_unavailable` errors with a follow-up-session affordance.
- Server startup reconciliation fails closed for transient sessions unless the
  configured runtime can prove a live managed session.
- External runtime supervisor mode is opt-in and keeps API server reloads from
  implying worker shutdown only while the supervisor process remains live.
- Supervisor-unavailable errors are structured and do not become successful API
  responses with error bodies.
- Worktree workspace setup preserves Windows path behavior and grants the
  required linked-worktree Git metadata roots to the runtime sandbox.
- Workspace cleanup refuses active sessions and is safe around root paths and
  missing paths.
- Fake Codex mode remains available for CI-safe dogfood smoke tests.
- Run groups remain minimal grouping records, not a scheduler or project
  management system.
- Review-gate status and review findings remain observability records, not
  automatic validation or merge policy.
- Task spec metadata remains worker input and review context, not mutable proof
  that an implementation is correct.

## Behavior Requirements

- Public API behavior must remain compatible unless a work item explicitly
  calls out a migration.
- Existing CLI commands and `--json` responses must keep their current shape.
- GUI workflows for project/workspace/session inspection, transcript reading,
  message sending, follow-up creation, run group dashboards, review status, and
  review findings must continue to work.
- Runtime commands must continue to persist message sent/failed state and update
  worker session state consistently.
- Raw events must be appended before any normalized product state or projection
  uses the event.
- Runtime errors must preserve existing structured error codes where callers
  already depend on them.
- New modules must be introduced behind interfaces that can be tested without
  launching real Codex processes.
- Refactor slices must keep route aliases, DTO names, persisted table names, and
  documented non-goals intact.

## Implementation Decisions

- Keep the current monorepo packages. Do not create a parallel implementation.
- Introduce the Product Manager first as a server-side module that owns product
  commands such as start worker, start follow-up worker, send message, stop
  worker, complete worker, attach to run group, and update review metadata.
- Keep HTTP request parsing, route registration, and HTTP error mapping in the
  server adapter layer. Product Manager should not know Fastify request/response
  shapes.
- Preserve `CodexRuntimeController` as the Runtime Ownership Seam while
  extracting native Codex App Server JSON-RPC and event translation into a
  distinct adapter module.
- Keep `HubRepository` as a compatibility facade while internally splitting
  product-record writes, raw event log writes, and projection reads.
- Add Planning / Presentation helpers after product command and state substrate
  seams exist. Prefer server-side view models first; promote pure shared helpers
  into `packages/core` only when CLI and GUI both benefit.
- Treat Codex thread ids, turn ids, item ids, and OS process ids as foreign
  references. Codexhub worker session ids remain the product identity.
- Keep schema changes out of the initial refactor unless needed to preserve a
  behavior already documented here.

## Testing Decisions

- Use TDD for each new interface where practical: write characterization tests
  for current behavior before moving code.
- Start with narrow package tests for touched packages, then run broader root
  gates when behavior crosses API, CLI, GUI, runtime, or persistence.
- Add Product Manager tests around product commands, state transitions, message
  persistence, follow-up behavior, and runtime-error handling.
- Add runtime adapter tests around JSON-RPC payload construction, response
  handling, raw event append ordering, and normalized event outcomes.
- Add state substrate tests around raw item losslessness, latest completed agent
  message stability, transcript windows, run group dashboard summaries, and
  short session id resolution.
- Add presentation tests around bounded view models and action availability so
  GUI/CLI formatting does not own product rules.
- Keep fake Codex mode and dogfood smoke as integration evidence for cross-layer
  behavior.

## Quality And Standards

- Use `docs/architecture/CANVAS.md` as the architecture source of truth.
- Use `docs/agents/quality-gates.md` for required evidence and gate policy.
- Use the architecture vocabulary from `skills/improve-codebase-architecture`:
  module, interface, seam, adapter, depth, leverage, locality, deletion test.
- A new module should earn its seam: it should hide meaningful implementation
  complexity and improve locality for future changes.
- Avoid pass-through modules that only rename existing calls without reducing
  caller knowledge.
- Keep worker assignments small enough for review and avoid overlapping file
  ownership during parallel work.
- Every implementation handoff must include a documentation-impact check.

## Open Questions

- Should Planning / Presentation stay entirely server-side through the first
  refactor, or should specific pure helpers move to `packages/core` as soon as
  CLI and GUI share them?
- Should Product Manager start as one module, or should the first slice create a
  thin orchestrator over worker, workspace, run group, and review submodules?
- Which Codex App Server events should produce normalized outcomes consumed by
  Product Manager, and which should remain projection-only facts?
- Should `docs/architecture/canvas.html` stay manually synchronized with this
  refactor plan, or should a later docs task generate it from Markdown?

## Readiness

This PRD is ready for `prd-to-issues-dag`. The open questions are local enough
to record as assumptions in individual issue briefs rather than blockers.
