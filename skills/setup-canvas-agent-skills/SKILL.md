---
name: setup-canvas-agent-skills
description: Bootstrap a repo for the Canvas-driven agent workflow by recording issue tracker rules, domain docs, artifact paths, quality gates, worker model, and review policy. Use before running architecture-canvas, canvas-to-prd, prd-to-issues-dag, afk-implementation-manager, or review-loop in a repo for the first time.
---

# Setup Canvas Agent Skills

Scaffold the repo-level rules that the workflow consumes. This follows Matt Pocock's setup posture: explore first, present findings, confirm with the user, then write durable docs.

## What This Creates

Write these files under `docs/agents/`:

- `issue-tracker.md` — where PRDs/issues/DAG nodes live and how to publish/update them.
- `domain.md` — where Canvas, `CONTEXT.md`, and ADRs live.
- `artifact-paths.md` — canonical paths for Canvas, PRDs, DAGs, evidence, and reviews.
- `quality-gates.md` — lint/typecheck/test/e2e/browser commands and skip policy.
- `worker-model.md` — manager/worker/reviewer responsibilities, assignment packet, return packet, and conflict policy.
- `review-policy.md` — when to use worker single-pass, manager single-pass, or manager strict-loop.

These files are the single source of truth for repo-specific workflow rules. Other skills should reference them, not restate their contents.

Add or update an `## Agent workflow` block in `AGENTS.md` or `CLAUDE.md`, preferring whichever already exists.

## Process

### 1. Explore

Read:

- `git remote -v` and `.git/config`
- `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `CONTEXT-MAP.md`
- `docs/adr/`, `docs/architecture/`, `docs/prd/`, `docs/implementation/`
- `package.json`, `Makefile`, `justfile`, `pyproject.toml`, CI config, test config
- existing issue tracker references in commits, PR templates, or docs

### 2. Present Findings

Summarize what exists and what is missing. Then walk the user through the decisions one section at a time. Each section starts with a short explainer, states the default, and waits for the user's answer before continuing.

Sections:

1. Issue tracker: GitHub, Linear, local markdown, or other.
2. Artifact paths and Canvas format: Markdown Canvas, HTML Canvas, or both.
3. Quality gates: commands for lint, typecheck, tests, e2e, browser/screenshot checks.
4. Worker model: same branch, worktree, branch per worker, or other local convention.
5. Review policy defaults.

Use sensible defaults when the repo already makes them obvious, but do not invent unavailable commands.

### 3. Draft Docs

Use the templates in this skill folder:

- [issue-tracker.md](issue-tracker.md)
- [issue-tracker-github.md](issue-tracker-github.md)
- [issue-tracker-linear.md](issue-tracker-linear.md)
- [issue-tracker-local.md](issue-tracker-local.md)
- [domain.md](domain.md)
- [artifact-paths.md](artifact-paths.md)
- [quality-gates.md](quality-gates.md)
- [worker-model.md](worker-model.md)
- [review-policy.md](review-policy.md)

Show the draft summary before writing if the user is present.

### 4. Write

Create `docs/agents/` if needed. Update an existing `## Agent workflow` block in `AGENTS.md`/`CLAUDE.md`; do not append duplicates.

If neither `AGENTS.md` nor `CLAUDE.md` exists, ask the user which one to create. Do not choose silently.

## Agent Workflow Block

```markdown
## Agent workflow

This repo uses Canvas-driven agent workflow.

- Architecture Canvas: see `docs/agents/domain.md` and `docs/agents/artifact-paths.md`
- Issue tracker: see `docs/agents/issue-tracker.md`
- Quality gates: see `docs/agents/quality-gates.md`
- Worker model: see `docs/agents/worker-model.md`
- Review policy: see `docs/agents/review-policy.md`
```

## Done

Report the files created/updated and which skills now consume them.
