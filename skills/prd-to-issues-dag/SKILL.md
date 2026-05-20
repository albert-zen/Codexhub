---
name: prd-to-issues-dag
description: Convert a PRD/spec into vertical-slice issues plus a dependency DAG, execution waves, AFK/HITL classification, acceptance criteria, test requirements, and evidence requirements. Use when a PRD is ready to become executable implementation work.
---

# PRD To Issues DAG

Turn a PRD into AFK-ready issue slices and an execution DAG in one step. The issue split is the slice design; do not add a separate slice-planning phase.

Write the issue DAG to the path defined in `docs/agents/artifact-paths.md`. If that file is missing, run `setup-canvas-agent-skills` first.

## Process

1. Gather context:
   - Read the PRD, architecture canvas, ADRs, relevant code, `docs/agents/issue-tracker.md`, `docs/agents/artifact-paths.md`, `docs/agents/quality-gates.md`, `docs/agents/worker-model.md`, `docs/agents/review-policy.md`, `improve-codebase-architecture`, and `tdd`.
   - Explore enough code to understand likely modules and dependency constraints.

2. Draft vertical-slice issues:
   - Each issue should deliver a narrow but complete behavior path.
   - Prefer end-to-end, independently verifiable slices over horizontal tasks by layer.
   - Allow enabling issues only when they unblock real behavior and have clear acceptance criteria.

3. Classify each issue:
   - Always include: Mode, dependencies, acceptance criteria, required tests, required evidence.
   - Add risk/reversibility/testability/review/parallel-safety only when non-default or important.
   - Defaults: `AFK`, `low risk`, `reversible`, `clear seam`, `manager-single-pass`, `safe to parallelize`.

4. Build the DAG:
   - Model dependencies between issues.
   - Group issues into execution waves.
   - Identify which issues can run in parallel.
   - Mark integration checkpoints.

5. Apply readiness gate:
   - If any issue is `HITL`, `hard-to-reverse`, or lacks clear acceptance criteria, recommend `align-with-canvas`.
   - Human "white shift" is complete only when remaining work is AFK, clear, testable, and evidence requirements are explicit.

## Issue Brief Template

Base this on [AGENT-BRIEF.md](AGENT-BRIEF.md). The issue brief is the authoritative AFK contract.

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description

## Current Behavior

What happens now, or the current baseline this slice builds on.

## Desired Behavior

What should happen after this issue is complete.

## What To Build

The vertical behavior slice, described end-to-end.

## Key Interfaces

- Interface/type/config/entry point that matters for this issue.

## Acceptance Criteria

- [ ] Specific observable criterion
- [ ] Specific observable criterion

## Required Tests

- Public behavior tests to write first or maintain.

## Required Evidence

- Commands, screenshots, logs, traces, or test outputs needed to prove completion.

## Dependencies

- Blocked by: <issue ids or names>
- Blocks: <issue ids or names>

## Classification

- Mode:
- Risk:
- Reversibility:
- Testability:
- Review intensity:
- Parallel safety:

## Out Of Scope

- Adjacent work not allowed in this issue.
```

## Output Format

Return:

- Issue table.
- Mermaid DAG.
- Execution waves.
- Open questions.
- Recommendation on whether the DAG is ready for `afk-implementation-manager`.

Publish issues only when the user explicitly asks. Otherwise produce drafts.
