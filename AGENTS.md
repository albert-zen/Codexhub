# Codexhub Agent Guidelines

## Git History

Use Conventional Commits for repository history:

- Format: `type(scope): summary`.
- Use imperative present tense and keep the summary concise.
- Prefer these types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`,
  `build`, `ci`.
- Use a scope when it clarifies ownership, for example `server`, `cli`, `web`,
  `core`, `docs`, or `repo`.
- Keep commits logically small enough to review. Do not mix unrelated feature,
  docs, and formatting work unless the formatting is required by the change.
- Reference GitHub issues in the body when a commit closes or follows up an
  issue.

## Subagent Delegation

Use subagents only when the user explicitly asks for subagents, workers,
delegation, or parallel agent work. Before spawning, decide what the main agent
will do locally and which side tasks can run in parallel without blocking the
critical path.

Every subagent prompt must include:

- **Goal**: the concrete outcome expected from the subagent.
- **Scope**: the files, package, module, or read-only question it owns.
- **Non-scope**: files, modules, or product decisions it must not touch.
- **Context**: enough product and technical background to act without guessing.
- **Acceptance criteria**: observable requirements that define done.
- **Validation**: exact commands, tests, or checks to run when possible.
- **Handoff**: changed files, commands run, risks, and assumptions to report.

For code-editing workers, give disjoint file ownership. Tell them they are not
alone in the codebase, must not revert others' changes, and must adapt to nearby
edits.

## Delegation Prompt Template

```text
You are Worker <name> on Codexhub.

Goal:
- <single concrete outcome>

Context:
- <relevant product/architecture facts>
- <current branch/worktree or workspace path>

Scope:
- You own: <files/directories/responsibility>
- Do not edit: <files/directories/responsibilities owned by others>

Requirements:
- <behavioral requirement>
- <data/API/CLI/UI contract requirement>
- <compatibility or safety constraint>

Acceptance criteria:
- <specific observable result>
- <specific output/API response/test behavior>
- <no unrelated refactors or metadata churn>

Validation:
- Run: <command>
- If a command cannot be run, explain why and what remains unverified.

Handoff:
- List changed files.
- Summarize implementation decisions.
- Report commands run and results.
- Report risks, assumptions, and follow-up issues.
```

## Acceptance Criteria Standard

Acceptance criteria should be checkable by another agent, a test, or a concrete
manual action.

Good:

- `POST /api/v1/sessions` returns `{ session, workspace }` and persists the
  initial message.
- `pnpm --filter @codexhub/server test` passes.
- `GET /api/v1/sessions/:id/items?type=agentmessage` defaults to 20 items and
  returns `next_cursor` when more items exist.

Too vague:

- Improve session startup.
- Make the UI better.
- Ensure it works.

Include negative criteria when they protect product boundaries:

- Do not add Linear/GitHub deep binding unless the issue asks for it.
- Do not replace raw item storage with summaries.
- Do not introduce validation gates, escalation, or context compiler behavior
  into first-phase runtime/session work.

## Handoff Review

When a subagent returns, first review the owned scope. Then check whether:

- The acceptance criteria are satisfied.
- The validation commands actually ran.
- Any changed file is outside delegated scope.
- The work conflicts with other active subagents.
- Reported assumptions need a follow-up issue or doc update.

Record notable friction in `docs/subagent-ops-log.md`.
