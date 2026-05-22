# GitHub Issues

This file summarizes the current executable backlog after the initial Codexhub
implementation pass. GitHub issues are the active execution source of truth; this
doc keeps the local roadmap readable for manager agents and human maintainers.

Use these defaults unless an issue says otherwise:

- Branch from the current shared worktree state.
- Run `git status --short` before editing and before handoff.
- Do not revert unrelated edits.
- Keep each issue small enough for one branch and one PR.
- Keep changes inside the named area and avoid broad refactors.
- Check whether docs need updates before handoff.
- For code changes, verify with the narrow package checks plus broader root
  checks when the blast radius is unclear.

## Closed Baseline

GitHub issues `#1` through `#18` are closed. Treat them as implemented baseline,
not active backlog. The original CH-001 through CH-012 seed drafts are
superseded and should not be reopened as broad epics.

Closed implementation areas:

- Raw item fixtures, classification, and lossless storage hardening (`#1`).
- Server restart reconciliation for stale running/starting sessions (`#2`).
- CLI smoke tests against a real temporary server (`#3`).
- Explicit non-empty `continue` message content across API, CLI, and web (`#4`).
- First-stage shared API DTO/client contracts (`#5`).
- Repo docs/backlog refresh after the initial implementation (`#6`).
- Centralized server host, port, and database config parsing (`#7`).
- Canonical `/api/v1` route policy with supported local root aliases (`#8`).
- First readable web transcript surface and CLI result/trace shortcuts (`#9`,
  `#10`).
- README local loop documentation (`#11`).
- Workspace cleanup and git worktree workspace mode (`#12`, `#13`).
- Web raw-item transcript window pagination (`#14`).
- Task spec metadata on WorkerSessions (`#15`).
- Minimal worker run groups (`#16`).
- GitHub Actions runtime warning cleanup (`#17`).
- Review-gate status metadata as observability, not validation (`#18`).
- Terminal-session follow-up through API and CLI without reviving stopped,
  completed, or failed Codex processes (`#23`).
- Run group dashboard for bounded batch progress, latest messages, review state,
  and attention indicators (`#26`).
- CI-safe fake dogfood smoke script with explicit real Codex opt-in (`#27`).
- Runtime-supervisor ownership across API server reloads with fail-closed
  fallback when the configured runtime cannot prove a session is live (`#40`).

The important boundary after these closures: Codexhub has first-pass metadata
for task specs, worktrees, run groups, review status, terminal-session
follow-up, run group dashboards, fake-mode dogfood automation, and opt-in
external runtime-supervisor mode. It does not have durable recovery after the
supervisor process exits, the host reboots, or process ownership is otherwise
lost.

## Backlog Guardrails

- Keep transcript/result convenience focused on inspection, not full transcript
  replay as the primary manager-agent interface.
- Keep raw item storage lossless; transcript projections are additive.
- Keep Manager Agent reads bounded and paginated by default.
- Keep worker/process hardening local-first; do not add multi-host scheduling,
  leases, auth, or CI gate coupling in first-stage issues.
- Capture dogfood friction in `docs/subagent-ops-log.md` when a task reveals a
  reusable operations lesson.

## Current Backlog

No broad first-stage hardening issue is open in this local synthesis. Issues
`#19` through `#40` are closed and represent implemented baseline unless a later
dogfood run opens a narrower regression or UX follow-up.

After the Thread-first architecture/UI cleanup, the active GitHub backlog is
narrower:

- `#43`: add CodexHub Home for Codexhub-owned control-plane data. This replaces
  the old isolated-worker-`CODEX_HOME` direction; Codex login state should
  remain user-global by default.
- `#44`: deprecate the manager `complete` action. Do not add CLI parity for an
  unwanted concept; keep any retained route as legacy bookkeeping only.
- `#45`: residual wrong-mode send API contract characterization risk.
- `#46`: document supervisor-mode workflow for server-touching self-dogfood
  batches. Runtime behavior changes belong elsewhere.
- `#47`: linked-worktree Git commit/amend sandbox friction.
- `#48`: CLI `session start --file` relative-path resolution friction.
- `#49`: deferred deeper repository/state-substrate split beyond the raw item
  log.
- `#51`: decide whether RunGroup remains an optional batch/history surface, is
  renamed, or is deprecated from supported product language.
- `#53`: preserve detached/resumable Thread semantics on server startup instead
  of marking missing runtime ownership as task failure.
- `#54`: define the hook boundary for future external orchestration. CodexHub
  core should invoke, observe, message, and persist agent threads; task ordering,
  review assignment, retry policy, merge policy, and automatic scheduling belong
  to users, manager agents, hooks, or external orchestrators.

## Later Closed Follow-Ups

- `#38 feat(session): accept unique short session prefixes`
  - Session commands can use canonical `sess_<uuid>` ids, unique leading
    prefixes including `sess_`, or unique prefixes from only the UUID portion.
  - API responses keep canonical ids unchanged.
  - Ambiguous prefixes return `session_id_ambiguous` with machine-readable
    `candidate_ids`; side-effect commands refuse them before changing state.

- `#39 fix(session): keep latest agent message stable across streaming deltas`
  - `session latest`, session summaries, and `last_agent_message` track the
    last completed agent message only.
  - Raw `item/agentMessage/delta` payloads remain available through item reads
    and transcript/debug surfaces.

- `#40 feat(runtime): keep worker sessions continuable across server hot reloads`
  - Current implementation does not claim reattach durability. On server
    startup, persisted `starting`, `running`, and `awaiting_input` sessions are
    reconciled to `failed` with a restart-specific failure reason and cleared
    `process_pid`.
  - If a send reaches a non-terminal row without a managed live process, the API
    returns `409 session_process_unavailable` with `session_id`,
    `follow_up_available`, and `follow_up_endpoint`; the source session becomes
    terminal and can be continued through a fresh follow-up session.
  - Runtime details and the remaining boundary are documented in
    `docs/runtime-supervisor.md`.

- `#41 fix(web): make newly started sessions discoverable outside run groups`
  - Superseded by the Thread-first Web UI: project rows own Thread creation,
    project threads are listed directly, and new empty Threads open into the
    chat composer immediately.

- `#42 fix(web): separate stale historical run groups from active operator view`
  - Superseded by the Thread-first Web UI. RunGroups no longer dominate the
    default operator surface.

- `#50 refactor(core): complete presentation helpers for bounded operator views`
  - Closed as obsolete in its original session/run-group-dashboard form. Future
    helper extraction should be driven by concrete Thread UI/CLI duplication.

- `#52 refactor(session): separate resumable thread state from runtime liveness`
  - Superseded by the Thread-first state architecture and UI refactor. The
    remaining valid slice is tracked as `#53`.

## Runtime Supervisor Follow-Up Draft

The remaining durable-runtime work is a future durable reattach boundary after
supervisor-process loss, not a larger HTTP-route patch:

- Give the HTTP server and supervisor an attach/lease protocol that can recover
  or prove live ownership after supervisor restart or host interruption.
- Keep startup reconciliation conservative for any session the supervisor cannot
  prove is attached and healthy.
- Preserve the current follow-up-session fallback for failed, stopped, completed,
  and unrecoverable orphan sessions.
