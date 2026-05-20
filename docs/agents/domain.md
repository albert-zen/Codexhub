# Domain And Architecture Docs

This repo does not currently use `CONTEXT.md` or `CONTEXT-MAP.md`. Use the existing documentation map instead.

Primary sources:

- `AGENTS.md` for repo shape, package boundaries, working rules, Git rules, quality gates, and documentation checks.
- `docs/roadmap.md` for product direction, phases, current baseline, non-goals, and product boundaries.
- `docs/runtime-supervisor.md` for runtime ownership, restart behavior, unavailable-process fallback, and the durable supervisor boundary.
- `docs/documentation-system.md` for documentation source-of-truth rules.
- `docs/symphony-lessons.md` for imported and rejected Symphony assumptions.
- `docs/subagent-ops-log.md` for coordination friction and reusable worker/reviewer lessons.

## Architecture Canvas

Canvas artifact paths are defined in `docs/agents/artifact-paths.md`.

Both Markdown and HTML Canvas are first-class for Codexhub:

- Markdown is easier to diff and review in PRs.
- HTML is better for visualizing the control plane, worker lifecycle, module seams, and review flow.

Keep both synchronized when both exist.

## ADRs

No ADR directory exists yet. If a hard-to-reverse, surprising, real tradeoff needs to be recorded, create `docs/adr/` lazily and add the ADR in the same change.

## Architecture Vocabulary

Use Matt Pocock's `improve-codebase-architecture` vocabulary when judging design:

- module
- interface
- seam
- adapter
- depth
- leverage
- locality
- deletion test

Map those terms onto Codexhub concepts such as worker sessions, workspaces, raw item storage, projections, manager reads, review findings, and runtime supervision.
