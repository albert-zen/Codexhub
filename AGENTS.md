# Codexhub Agent README

This file is for agents working inside this repository. It explains the repo
shape, local workflow, and gates that protect code quality and documentation.

For guidance on using Codexhub as a worker control plane from another project,
see `skills/codexhub/SKILL.md`.

## Repository Shape

Codexhub is a local Codex worker control plane. It lets a manager or human create
workspaces, start Codex worker sessions, persist raw Codex item streams, inspect
bounded session output, and send steer or continue messages.

Packages:

- `apps/server`: Fastify API, SQLite persistence, workspace builder, workspace
  cleanup, and Codex runtime process management.
- `apps/cli`: `codexhub` command surface for manager agents and humans.
- `apps/web`: React/Vite GUI for observing and controlling sessions.
- `packages/core`: shared API DTOs, domain types, item classification, fixtures,
  and session state machine.
- `docs`: product roadmap, documentation rules, review gate, Symphony lessons,
  issue notes, and operational logs.
- `skills/codexhub`: repo-local skill documentation for agents that want to use
  Codexhub as a large-scale worker scheduler.

Core product boundaries:

- Preserve raw Codex item payloads. Projections and transcripts are additive.
- Keep manager-facing reads bounded, structured, paginated, and low-context.
- Prefer API/CLI as the primary control surface; GUI is for observation and
  human takeover.
- Do not add escalation, validation-gate, context-compiler, or deep
  Linear/GitHub/CI binding behavior unless an explicit task asks for it.

## Working In This Repo

Start by reading the relevant files instead of guessing from memory. Prefer
small, scoped changes that fit the existing package boundaries.

Use shared `packages/core` types for API-facing contracts. If server, CLI, and
web all depend on a shape, add or update it in core instead of copying local
interfaces.

When changing runtime behavior, check the impact on:

- SQLite schema and repository mapping.
- HTTP response contracts.
- CLI JSON output stability.
- GUI readability.
- Session state transitions.
- Windows path, cwd, process lifecycle, and stdio behavior.

When changing docs or workflow rules, update the source of truth listed in
`docs/documentation-system.md`.

## Git History

Use Conventional Commits:

- Format: `type(scope): summary`.
- Use imperative present tense and keep the summary concise.
- Prefer these types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`,
  `build`, `ci`.
- Use scopes such as `server`, `cli`, `web`, `core`, `docs`, `repo`, or
  `workspace` when they clarify ownership.
- Keep commits logically small enough to review.
- Do not mix unrelated feature, docs, and formatting work unless formatting is
  required by the change.
- Reference GitHub issues in the commit body when a commit closes or follows up
  an issue.

Do not rewrite public history or run destructive Git commands unless the user
explicitly asks.

## Review Gate

Substantial code changes should pass the review workflow in
`docs/review-gate.md`. That document owns:

- Worker-reviewer flow.
- Reviewer checklist.
- Acceptance criteria standards.
- Worker response format.
- Documentation impact checks.

Use the original task spec or GitHub issue as the source of truth for intent.
Workers should not rewrite task intent after implementation to make the result
look correct.

## Documentation Gate

Every task needs a documentation-impact check before handoff, even if no docs
change. Use `docs/documentation-system.md` as the source of truth.

Common destinations:

- `README.md`: setup, quick start, operator commands, and external
  requirements.
- `AGENTS.md`: repo architecture, repo-local workflow, Git rules, and quality
  gates.
- `docs/roadmap.md`: product phases, baseline, open work, and non-goals.
- `docs/review-gate.md`: review workflow and acceptance criteria standards.
- `docs/task-spec-template.md`: task spec shape.
- `docs/subagent-ops-log.md`: coordination friction and lessons learned.
- `docs/symphony-lessons.md`: reusable and rejected Symphony assumptions.
- `docs/github-issues.md`: local backlog synthesis; GitHub issues remain the
  active execution source of truth.
- `skills/codexhub/SKILL.md`: using Codexhub as a control-plane skill outside
  this repo.

If no docs need changes, say so in the handoff and explain why.

## Quality Gates

Before code is handed off or committed, run the narrowest relevant checks plus
the broader checks when the blast radius is unclear.

Default full gate:

```powershell
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```

Shortcut:

```powershell
pnpm quality
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

On a clean checkout, build `@codexhub/core` before checking packages that import
it, or run the root `pnpm check` / `pnpm test` scripts, which do this
explicitly.

Coding standards:

- Keep raw item storage lossless.
- Keep list/read APIs paginated by default.
- Keep CLI JSON output stable and structured.
- Keep GUI defaults readable for humans; raw/debug views should be opt-in.
- Add tests with risk proportional to the blast radius.
