# Canvas-Driven Agentic Engineering Skills

This local skill collection is a working draft of a collaboration method for human-led, AI-executed software projects.

It is not installed into Codex. The skills live under `skills/` and can later be copied into a Codex skill directory or packaged as a plugin.

## Core Idea

Human attention should concentrate on:

- Upstream planning: goals, meaning, architecture, tradeoffs, and executable specs.
- Downstream review: evidence, standards, spec compliance, and risk.

AI should handle:

- Codebase exploration.
- Architecture modeling.
- PRD and issue DAG drafting.
- AFK implementation.
- Test-driven execution.
- Evidence collection.
- Review loops.

## Main Flow

```text
setup-canvas-agent-skills
  -> repo rules: issue tracker, artifacts, quality gates, worker model, review policy

zen-engineering
  -> top-level entrypoint for choosing the smallest suitable workflow

architecture-canvas
  -> align-with-canvas
  -> canvas-to-prd
  -> prd-to-issues-dag
  -> afk-implementation-manager
       uses: tdd + diagnose + improve-codebase-architecture
  -> review-loop
       axis 1: Standards Review
       axis 2: Spec Review
```

`align-with-canvas` can be used at any stage when assumptions, tradeoffs, or hard-to-reverse decisions need human alignment.

## Skills

- `zen-engineering` — top-level entrypoint for Albert Zen's Canvas-driven engineering workflow.
- `architecture-canvas` — build a shared architecture canvas for understanding and design judgment.
- `setup-canvas-agent-skills` — bootstrap repo rules for issue tracker, artifact paths, quality gates, worker model, and review policy.
- `align-with-canvas` — externalize the AI's system model, problems, consequences, options, and recommendations.
- `canvas-to-prd` — convert canvas and conversation context into a PRD/spec.
- `prd-to-issues-dag` — convert a PRD into vertical-slice issues and an execution DAG.
- `afk-implementation-manager` — execute the issue DAG with manager/worker coordination, TDD, quality gates, and evidence.
- `review-loop` — orchestrator skill used by a manager or worker to spawn clean reviewer subagents; reviews separate Standards and Spec axes, with worker single-pass, manager single-pass, or manager strict-loop modes.
- `tdd` — copied from Matt Pocock's skills and intended to be used verbatim.
- `diagnose` — copied from Matt Pocock's skills and intended to be used verbatim for bug/regression work.
- `improve-codebase-architecture` — adapted from Matt Pocock's latest skill and used as the architecture quality standard.

## Design Bias

- Keep Matt Pocock's `tdd` unchanged.
- Keep Matt Pocock's `diagnose` unchanged.
- Keep Matt Pocock's architecture vocabulary and report style in `improve-codebase-architecture`; local integration edits are allowed when they remove broken references.
- Support both Markdown and HTML Canvas as durable artifacts.
- Keep repo-specific rules single-sourced in `docs/agents/*.md`. Workflow skills reference those files; they do not duplicate quality gates, artifact paths, worker rules, issue tracker rules, or review policy.
- Do not create an extra standards layer unless real usage proves it necessary.
- Let issue generation include vertical slicing and DAG modeling in one step.
- Let review split Standards and Spec instead of mixing findings.
- Treat review as manager/worker orchestration. Reviewer subagents report findings only; they do not own the loop or fix code.

## Lightweight Path

Small, reversible changes do not need the full Canvas -> PRD -> DAG flow. Use:

```text
tdd or diagnose
  -> quality gates from docs/agents/quality-gates.md
  -> review-loop in worker-single-pass or manager-single-pass mode when risk justifies it
```

Escalate to the full flow when the change affects architecture direction, product meaning, multiple workers, persistent data, security, or hard-to-reverse behavior.
