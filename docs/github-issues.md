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

## Initial Implementation Status

The original seed backlog for server config, SQLite persistence, workspace and
session APIs, worker launch, raw item ingestion, item reads, latest-message
projection, message queueing, CLI commands, and first web dashboard has been
substantially implemented.

Those early CH-001 through CH-012 drafts are superseded by the open GitHub issue
set below. Do not re-open the seed issues as large epics; use the current issues
or split a smaller follow-up when needed.

## Current Hardening Pass

These issues are resolved by the current hardening pass and should be closed
after CI is green:

1. `#6 docs(repo): refresh issue backlog after initial implementation`
   - Status: implemented.
   - Area: `docs`.
   - Goal: make roadmap, backlog, docs process, and dogfood notes current.
   - Acceptance: docs are concise, consistent with the product boundary, and no
     code or local Codex skill changes are made.

2. `#4 fix(api): require explicit continue message content`
   - Status: implemented.
   - Area: `apps/server`, `apps/cli`, `apps/web`, tests.
   - Goal: every `continue` message must contain the exact instruction sent by
     the manager or human.
   - Decision: empty `continue` is invalid; callers must persist an explicit
     instruction such as "Please continue your work."
   - Acceptance: server rejects empty `continue` with structured `400`, GUI
     cannot silently send empty continue, persisted content is explicit, and
     tests cover rejection plus explicit success.

3. `#9 feat(web): render session trace as readable transcript`
   - Status: implemented.
   - Area: `apps/web`, likely server/core transcript helpers.
   - Goal: make web session detail read like a conversation instead of raw item
     delta fragments.
   - Acceptance: default trace shows prompts, complete agent messages, and
     collapsed tool calls/results; raw JSON remains available as a debug view;
     aggregation is tested or explicitly justified for v1.

4. `#10 feat(cli): add convenient session result and trace commands`
   - Status: implemented.
   - Area: `apps/cli`, likely API/query helpers.
   - Goal: make normal "what happened?" inspection one short command.
   - Acceptance: add bounded `session result`, `session trace`,
     `session watch`, and `sessions recent` flows with structured JSON and
     cursor/range metadata for manager agents.

5. `#1 test(core/server): add realistic Codex app-server payload fixtures`
   - Status: implemented.
   - Area: `packages/core`, `apps/server`.
   - Goal: harden raw item ingestion and classification against real Codex
     app-server event shapes.
   - Acceptance: fixtures cover message deltas/completions, tool calls/results,
     state, reasoning, errors, malformed/non-protocol input, and raw preservation
     enough for replay/audit.

6. `#2 fix(server): reconcile persisted sessions on server startup`
   - Status: implemented.
   - Area: `apps/server`.
   - Goal: prevent persisted `starting` or `running` sessions from looking
     messageable after the server has lost in-memory process handles.
   - Acceptance: startup reconciliation marks stale sessions deterministically,
     clears stale pids, records a clear reason, and message send returns a
     structured error.

7. `#3 test(cli): add smoke tests against a running test server`
   - Status: implemented.
   - Area: `apps/cli`, test harness.
   - Goal: catch server/CLI contract drift beyond mocked fetch tests.
   - Acceptance: temporary-server smoke tests cover project/workspace/session
     creation, fake session start, latest, trace, and stable JSON fields.

8. `#7 fix(server): centralize host and port config validation`
   - Status: implemented.
   - Area: `apps/server`.
   - Goal: centralize `CODEXHUB_HOST`, `CODEXHUB_PORT`, and
     `CODEXHUB_DB_PATH` parsing.
   - Acceptance: defaults remain unchanged, invalid port fails clearly before
     Fastify starts, and config parser tests cover default/override/invalid
     cases.

9. `#8 feat(api): decide and enforce root route alias policy`
   - Status: implemented.
   - Area: `apps/server`, `apps/cli`, `apps/web`, docs.
   - Decision: `/api/v1` is canonical; root aliases remain a supported local
     convenience surface for CLI/web and are covered by route tests.

10. `#5 refactor(api): share DTO and client contracts across CLI and web`
    - Status: implemented for first-stage DTO sharing; continue incrementally
      when new API contracts are added.
    - Area: `packages/core`, `apps/cli`, `apps/web`.
    - Goal: reduce duplicate response/request shapes without introducing a
      heavy generated client.
    - Acceptance: CLI and web consume shared DTOs/helpers where practical, and
      type checks catch shared response field drift.

## Backlog Guardrails

- Keep transcript/result convenience focused on inspection, not full transcript
  replay as the primary manager-agent interface.
- Keep raw item storage lossless; transcript projections are additive.
- Keep Manager Agent reads bounded and paginated by default.
- Keep worker/process hardening local-first; do not add multi-host scheduling,
  leases, auth, or CI gate coupling in first-stage issues.
- Capture dogfood friction in `docs/subagent-ops-log.md` when a task reveals a
  reusable operations lesson.

## Next Backlog

The next small issues created after the first hardening pass are:

1. `#11 docs(readme): document the full local Codexhub loop`
   - Copy-pasteable server/CLI/fake-worker/result/trace workflow.
2. `#12 feat(workspace): add safe workspace cleanup flow`
   - Status: implemented; close after CI is green.
   - Conservative cleanup/delete semantics with path safety tests.
3. `#13 feat(workspace): add git worktree workspace mode`
   - Isolated write scopes for parallel worker sessions.
4. `#14 feat(web): paginate readable session transcript`
   - Status: implemented; close after CI is green.
   - Load transcript windows without rereading the first 200 items.
5. `#15 feat(session): attach task spec metadata to worker sessions`
   - Persist immutable task intent/scope/acceptance criteria references.
6. `#16 feat(control-plane): add minimal worker run groups`
   - Observe coordinated batches without becoming a project management system.
7. `#17 ci(repo): address GitHub Actions runtime warnings`
   - Handle Node 24 action runtime and Windows runner transition notices.
8. `#18 feat(session): track review-gate status metadata`
   - Track worker/reviewer progress as observability metadata, not a validation
     gate.
