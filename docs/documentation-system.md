# Documentation System

Codexhub documentation is part of the control plane. It preserves product
intent, execution rules, and lessons learned so future workers do not need to
rediscover them from chat history.

## Sources Of Truth

- `README.md`: how to install, run, and use Codexhub.
- `AGENTS.md`: repo-facing agent README for architecture, package boundaries,
  Git rules, quality gates, and documentation checks.
- `docs/roadmap.md`: product direction, phases, current baseline, open work, and
  non-goals.
- `docs/symphony-lessons.md`: reusable Symphony experience and assumptions that
  Codexhub intentionally rejects.
- `docs/subagent-ops-log.md`: subagent coordination friction, worktree lessons,
  review-loop lessons, and follow-up operational issues.
- `docs/github-issues.md`: local backlog synthesis and issue drafts. GitHub
  issues are the active execution source of truth.
- `docs/task-spec-template.md`: task spec format for worker-sized tasks.
- `docs/review-gate.md`: read-only review subagent workflow and checklist.
- `docs/runtime-supervisor.md`: restart behavior, unavailable-process fallback,
  and the boundary for a future durable Codex process supervisor.
- `.github/ISSUE_TEMPLATE/task_spec.yml`: GitHub issue form for task specs.
- `.github/pull_request_template.md`: PR checklist for task specs, validation,
  and review gate completion.
- `skills/codexhub/SKILL.md`: repo-local skill for agents using Codexhub as a
  worker control plane from other projects or tasks.

## Update Rules

- Every task must perform a documentation-impact check before handoff, even when
  the expected answer is "no docs changed."
- Update docs in the same PR when public behavior, API/CLI/GUI commands,
  workflow rules, quality gates, or product boundaries change.
- Keep docs concise and operational. Prefer checklists and concrete examples.
- Avoid duplicating full rules in multiple docs. Link or point to the source of
  truth when a short reminder is enough.
- Treat stale docs as a bug. Fix directly when in scope, or create a follow-up
  issue.
- Record durable lessons where appropriate as concrete observations with
  context and consequence. Prefer `docs/subagent-ops-log.md` for coordination
  friction, `docs/symphony-lessons.md` for imported/rejected Symphony lessons,
  and `docs/roadmap.md` for product direction or boundary changes.

## Post-Task Documentation Checklist

After each worker task, check and report:

- Did the setup or usage surface change? Update `README.md`.
- Did repo-local agent workflow, architecture, or quality rules change? Update
  `AGENTS.md`.
- Did Codexhub usage, delegation, or large-scale worker-control guidance change?
  Update `skills/codexhub/SKILL.md`.
- Did product phase, baseline, or open work change? Update `docs/roadmap.md`.
- Did worker process ownership, restart behavior, or missing-process fallback
  change? Update `docs/runtime-supervisor.md`.
- Did the task reveal subagent friction or coordination lessons? Update
  `docs/subagent-ops-log.md`.
- Did the task confirm or reject a Symphony assumption? Update
  `docs/symphony-lessons.md`.
- Did the task make local issue drafts stale? Update `docs/github-issues.md` or
  the corresponding GitHub issue.
- Did task spec or review gate structure change? Update
  `docs/task-spec-template.md` or `docs/review-gate.md`.

If no docs are updated, the handoff should explicitly say "Docs checked; no
updates needed" and explain why.
