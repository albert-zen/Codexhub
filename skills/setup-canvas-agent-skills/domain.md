# Domain And Architecture Docs

Record where long-lived system understanding lives.

## Domain Language

- Single context: `CONTEXT.md`
- Multi-context: `CONTEXT-MAP.md` plus per-context `CONTEXT.md`

Use domain terms from these files in Canvas, PRD, issue titles, tests, review findings, and architecture recommendations.

## Architecture Canvas

Both Markdown and HTML formats are first-class. Markdown is easier to diff. HTML is better for visual review. Keep them consistent when both exist.

Canvas paths are defined only in `docs/agents/artifact-paths.md`.

## ADRs

Default: `docs/adr/`

Write ADRs only for decisions that are:

- Hard to reverse
- Surprising without context
- Real tradeoffs

## Architecture Review

Use `improve-codebase-architecture` for deep-module review and visual before/after architecture reports.
