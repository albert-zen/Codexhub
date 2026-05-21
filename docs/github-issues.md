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

Architecture-refactor evidence currently points to narrower follow-ups already
tracked in GitHub:

- `#44`: missing CLI `session complete` command and contradictory completed
  session response with stale `failure_reason`.
- `#45`: residual wrong-mode send API contract characterization risk.
- `#46`: self-dogfood session orphaning from API runtime ownership loss.
- `#47`: linked-worktree Git commit/amend sandbox friction.
- `#48`: CLI `session start --file` relative-path resolution friction.

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

## Runtime Supervisor Follow-Up Draft

The remaining durable-runtime work is a future durable reattach boundary after
supervisor-process loss, not a larger HTTP-route patch:

- Give the HTTP server and supervisor an attach/lease protocol that can recover
  or prove live ownership after supervisor restart or host interruption.
- Keep startup reconciliation conservative for any session the supervisor cannot
  prove is attached and healthy.
- Preserve the current follow-up-session fallback for failed, stopped, completed,
  and unrecoverable orphan sessions.
