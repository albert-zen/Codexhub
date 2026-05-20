# Worker Model

Codexhub already defines its worker model in:

- `skills/codexhub/SKILL.md`
- `docs/review-gate.md`
- `docs/task-spec-template.md`
- `docs/subagent-ops-log.md`

This file maps those sources into the Canvas-driven agent workflow.

## Roles

- **Manager**: prepares the task spec or issue DAG, assigns bounded worker scopes, starts Codexhub sessions, integrates work, runs quality gates, and controls the review loop.
- **Worker**: implements one bounded task spec or issue slice. The worker must not rewrite the task spec after implementation.
- **Reviewer**: read-only subagent that reviews against the original task spec, changed files, implementation summary, and validation output.

## Worker Assignment

Use the prompt structure in `skills/codexhub/SKILL.md` under `Delegating Workers`.

Every assignment should include:

- Goal
- Intent
- Scope
- Non-scope
- Requirements
- Acceptance criteria
- Validation
- Handoff requirements

For parallel work, prefer disjoint workspaces or Git worktrees and disjoint file ownership. Workers are not alone in the codebase and must not revert other workers' or user changes.

## Worker Return

Use the handoff requirements from `docs/task-spec-template.md` and `skills/codexhub/SKILL.md`:

- Changed files
- Implementation summary
- Commands run and results
- Review findings and worker responses
- Risks, assumptions, and follow-up issues
- Documentation-impact check

## Conflict Policy

If two workers need the same file or behavior seam, the manager serializes the work or narrows scopes before dispatch. If a worker discovers required scope expansion, it reports the issue instead of proceeding silently.
