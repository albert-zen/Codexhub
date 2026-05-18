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

The important boundary after `#18`: Codexhub has first-pass metadata for task
specs, worktrees, run groups, and review status. It does not yet have the full
orchestration UX around conversation-level transcript paging, terminal-session
follow-up, structured review findings, ownership conflict display, or run group
dashboards.

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

The next GitHub issue wave is `#19` through `#27`. GitHub remains the execution
source of truth for issue state; this section keeps the local manager-agent
reading path aligned with that tracker.

1. `#19 fix(transcript): add conversation-level transcript projection`
   - Add transcript entries distinct from raw items, with pagination by
     conversation entry and complete agent messages across raw item page
     boundaries.
   - Blocks `#20` and `#23`.
2. `#20 fix(web): consume conversation transcript in session detail`
   - Make web session detail default to prompt, complete agent message, and
     collapsed tool/debug transcript entries instead of raw item windows.
   - Depends on `#19`.
3. `#21 fix(web): explain disabled session actions`
   - Make unavailable steer/continue/stop/complete actions explain state and
     content requirements, especially terminal sessions.
   - Can run in parallel with `#19`.
4. `#22 docs(roadmap): reconcile implemented phases and next backlog`
   - Keep `docs/roadmap.md`, `docs/github-issues.md`, and dogfood findings
     current after the `#1` through `#18` closure and the `#19` through `#27`
     issue wave.
5. `#23 feat(session): start follow-up session from terminal session`
   - Create a new related session from stopped, completed, or failed sessions
     instead of reviving dead Codex processes.
   - Depends on `#19`.
6. `#24 feat(web): add session creation and follow-up flow`
   - Let humans start sessions and terminal-session follow-ups from the GUI with
     compact task-spec inputs and visible errors.
   - Depends on `#21` and `#23`.
7. `#25 feat(review): persist review findings and worker responses`
   - Store structured reviewer findings and worker accepted/rejected/deferred
     responses as observability records.
   - Can run after `#19`; avoid overlapping migrations with `#23`.
8. `#26 feat(run-groups): show batch dashboard with worker progress`
   - Show run group sessions, statuses, latest messages, review state, and
     blocked/failed attention indicators through bounded API/web reads.
   - Depends on `#25`.
9. `#27 test(dogfood): add long-running Codexhub smoke script`
   - Add a repeatable fake-mode dogfood smoke path, with real Codex mode manual
     and opt-in.
   - Depends on `#19` and `#23`.
