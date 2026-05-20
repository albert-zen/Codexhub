---
name: canvas-to-prd
description: Turn an architecture canvas, current conversation, and repo context into a PRD/spec that defines goals, scope, behavior, implementation decisions, testing decisions, and open questions. Use when the user wants to move from design understanding to an executable product/engineering specification.
---

# Canvas To PRD

Convert shared understanding into a PRD. Do not split issues here; that belongs to `prd-to-issues-dag`.

Write the PRD to the path defined in `docs/agents/artifact-paths.md`. If that file is missing, run `setup-canvas-agent-skills` first.

## Process

1. Gather sources:
   - Architecture canvas.
   - Current conversation and user goals.
   - Existing PRDs/specs, ADRs, issue briefs, tests, and relevant code.
   - `improve-codebase-architecture` and `tdd` for implementation and testing expectations.
   - `docs/agents/artifact-paths.md`, `docs/agents/domain.md`, and `docs/agents/quality-gates.md` if present.

2. Check readiness:
   - If product goal, system boundary, success criteria, or hard-to-reverse decisions are unclear, run `align-with-canvas`.
   - If questions are local and reversible, record assumptions and continue.

3. Write the PRD:
   - Describe behavior and contracts, not file-by-file implementation steps.
   - Use domain language from the canvas.
   - Include enough implementation direction to constrain the later issue DAG.
   - Include testing decisions early so implementation starts with feedback loops.

## PRD Template

```markdown
# PRD: <title>

## Problem Statement

The user's problem and why it matters.

## Goals

- Goal 1
- Goal 2

## Non-Goals

- Out-of-scope item 1
- Out-of-scope item 2

## Solution Overview

The proposed solution from the user's perspective.

## User Stories

1. As a <actor>, I want <capability>, so that <benefit>.

## Behavior Requirements

Observable behavior the system must provide.

## Implementation Decisions

Important modules, interfaces, data contracts, integration points, and architectural constraints. Avoid brittle file paths unless they are stable public entry points.

## Testing Decisions

Required feedback loops, public interfaces to test, critical paths, and cases where TDD is expected.

## Quality And Standards

Architecture and testing standards that matter most for this change.

## Open Questions

Questions that block issue DAG creation or require human judgment.
```

## Output

Return the PRD path or draft. State whether it is ready for `prd-to-issues-dag`. If not ready, list the blocking questions and recommend `align-with-canvas`.
