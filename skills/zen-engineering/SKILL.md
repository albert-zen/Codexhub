---
name: zen-engineering
description: Orchestrate Albert Zen's Canvas-driven AI engineering workflow. Use when Codex should help a human shape a software idea from conversation or HTML/Markdown Canvas into a PRD, issue DAG, AFK implementation plan, TDD execution, architecture review, or manager/worker review loop.
---

# Zen Engineering

Use this as the top-level entrypoint for the repo-local skill set in
`skills/SKILLSET.md`. It is an orchestrator, not a replacement for the narrower
skills.

## Decision

Use the smallest workflow that fits the task:

- **Set up a repo for this method**: use `setup-canvas-agent-skills`.
- **Build or revise a shared design surface**: use `architecture-canvas`.
- **Align before a hard decision**: use `align-with-canvas`.
- **Turn Canvas into product/spec text**: use `canvas-to-prd`.
- **Turn PRD into executable work**: use `prd-to-issues-dag`.
- **Run the implementation DAG**: use `afk-implementation-manager`.
- **Implement code with tight feedback**: use `tdd`.
- **Fix or investigate a bug**: use `diagnose`.
- **Find deepening opportunities**: use `improve-codebase-architecture`.
- **Review completed work**: use `review-loop`.

## Full Flow

For substantial, hard-to-reverse work:

1. Create or update the Architecture Canvas.
2. Align with the human on assumptions, evidence, tradeoffs, and open questions.
3. Generate the PRD or design spec.
4. Split the PRD into vertical-slice issues and a DAG.
5. Execute the DAG with manager/worker coordination.
6. Use TDD or diagnosis as the worker feedback loop.
7. Run review on two axes: Standards Review and Spec Review.
8. Record evidence, findings, and unresolved questions in the artifact paths
   defined by the repo setup.

## Lightweight Flow

For small reversible changes, skip PRD and DAG:

1. Use `tdd` or `diagnose`.
2. Run the repo's quality gates.
3. Use `review-loop` only when risk justifies it.

## Operating Rules

- Keep human attention on upstream planning and downstream review.
- Keep implementation tasks bounded, observable, and reversible.
- Keep repo-specific rules single-sourced. Reference setup docs instead of
  copying quality gates, worker rules, review policy, or artifact paths.
- Prefer HTML Canvas when visual structure helps the human understand or steer
  architecture.
- Treat reviewer agents as reporting agents. Managers or workers own fixes and
  loop control.
