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

## Task Specs

Every non-trivial worker task should start from a task spec. The task spec is the
source of truth for intent and acceptance; workers execute it but do not modify
it unless the manager explicitly assigns documentation updates.

A task spec should include:

- **Problem**: what user or system pain this task addresses.
- **Intent**: why this change matters and what product boundary it protects.
- **Scope**: components, packages, files, API routes, CLI commands, or GUI views
  expected to change.
- **Non-scope**: things that must not be included even if nearby.
- **Behavior**: required user-visible or API-visible behavior.
- **Acceptance criteria**: concrete pass/fail requirements.
- **Validation**: exact commands, tests, screenshots, or manual checks.
- **Review focus**: what the review subagent should scrutinize most closely.

Workers should copy the relevant task spec into their prompt or receive a path
to the spec. The worker should not rewrite the task intent to match the
implementation after the fact.

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

## Worker Review Gate

For substantial code changes, the worker must request a review subagent after
its first implementation pass and before handoff is considered complete.

The review subagent must be read-only by default. It receives:

- The original task spec or issue body.
- The worker's changed-file list.
- The worker's summary and validation output.
- The relevant diff or paths to inspect.

The review subagent should evaluate:

- Whether the implementation satisfies the task intent, not just the literal
  code changes.
- Whether all acceptance criteria are met.
- Whether tests cover the behavior and likely regressions.
- Whether package boundaries and product non-goals were respected.
- Whether Manager Agent interfaces remain low-context, structured, and
  paginated where relevant.
- Whether GUI output is readable and not just technically present.
- Whether raw Codex item storage remains lossless when projections are added.
- Whether there are race conditions, restart hazards, Windows path issues, or
  process lifecycle gaps.
- Whether changes introduce unrelated refactors, broad abstractions, or hidden
  coupling.

The worker then responds to each review point:

- **Accepted**: make the change and rerun relevant validation.
- **Rejected**: explain why the review point does not apply.
- **Deferred**: create or reference a follow-up issue.

The final handoff should include both the review findings and the worker's
responses.

## Documentation Gate

Every task must include a documentation check before handoff.

The worker should identify whether the change requires updates to:

- `README.md`: setup, quick start, operator commands, or external requirements.
- `docs/roadmap.md`: product phases, current baseline, open work, or non-goals.
- `docs/symphony-lessons.md`: reusable or rejected lessons from Symphony.
- `docs/subagent-ops-log.md`: coordination friction, subagent handoff lessons,
  or workflow problems discovered while building.
- `docs/github-issues.md`: local backlog notes that should mirror or summarize
  GitHub issue direction.
- `docs/task-spec-template.md`: task-spec fields or acceptance criteria norms.
- `docs/review-gate.md`: reviewer workflow, checklist, or worker response rules.
- `AGENTS.md`: repository-wide agent, quality, git, and coding rules.

If documentation does not need changes, the worker must say so in the handoff
and explain why. If the task reveals reusable experience, record it in the
appropriate doc before handoff or create a follow-up issue.

The review subagent should explicitly check documentation impact:

- Are public behavior changes documented?
- Did new workflow friction get captured?
- Did the task reveal a reusable lesson or anti-pattern?
- Are issue/task specs stale after the implementation?
- Are docs concise and placed in the right file?

## Documentation System

Use docs as operational memory, not as a dumping ground.

- `README.md` is for running and using Codexhub.
- `AGENTS.md` is for repo-wide rules that agents must follow while working.
- `docs/roadmap.md` is for product direction, phases, current baseline, and
  open work.
- `docs/symphony-lessons.md` is for lessons imported from Symphony and explicit
  assumptions Codexhub rejects.
- `docs/subagent-ops-log.md` is for coordination friction, review-loop lessons,
  and subagent operations experience.
- `docs/github-issues.md` is for local issue drafts and backlog synthesis; the
  GitHub issue tracker is the source of truth for active execution.
- `docs/task-spec-template.md` defines what a worker task spec should contain.
- `docs/review-gate.md` defines how review subagents audit worker output.

Documentation standards:

- Keep docs close to the behavior they describe.
- Prefer short, operational sections over long essays.
- Update docs in the same PR when behavior, commands, workflow, or quality gates
  change.
- Do not duplicate the same rule in many places unless one location is a short
  pointer to the source of truth.
- Treat stale docs as a bug. Fix them directly when in scope, or create a
  follow-up issue.
- Record experience as concrete lessons with context, not vague advice.

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

## Quality Gates

Before code is handed off or committed, run the narrowest relevant checks plus
the broader checks when the blast radius is unclear.

Default full gate:

```powershell
pnpm format
pnpm check
pnpm test
pnpm build
```

Package-level gates:

- Core: `pnpm --filter @codexhub/core check` and
  `pnpm --filter @codexhub/core test`.
- Server: `pnpm --filter @codexhub/server check` and
  `pnpm --filter @codexhub/server test`.
- CLI: `pnpm --filter @codexhub/cli check` and
  `pnpm --filter @codexhub/cli test`.
- Web: `pnpm --filter @codexhub/web check`,
  `pnpm --filter @codexhub/web build`, and browser verification for meaningful
  UI changes.

Coding standards:

- Prefer shared `packages/core` types for API-facing contracts.
- Keep raw item storage lossless; projections must not replace raw payloads.
- Keep list/read APIs paginated by default.
- Keep CLI JSON output stable and structured.
- Keep GUI defaults readable for humans; raw/debug views should be opt-in.
- Add tests with risk proportional to the blast radius.
- Do not introduce Linear/GitHub/CI/validation-gate coupling into runtime
  control-plane work unless the task explicitly asks for it.
