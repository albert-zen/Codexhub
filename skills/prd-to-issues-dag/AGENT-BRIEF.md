# Work Item Briefs

A work item brief is the authoritative AFK contract for an agent. The original PRD, conversation, and issue thread are context; the brief is what the worker implements.

Publication mechanics belong in `docs/agents/issue-tracker.md`. This file defines the tracker-neutral content of the brief.

## Principles

### Durable Over Brittle

The work item may sit in a queue while the codebase changes. Write briefs so they survive file moves and refactors.

Prefer:

- Behavior contracts
- Public interfaces
- Type/config shapes
- Acceptance criteria
- Evidence requirements

Avoid:

- Line numbers
- Brittle file-path instructions
- Step-by-step edits unless the path is itself the stable public interface

### Behavioral, Not Procedural

Describe what the system should do, not the exact implementation path.

Good:

- "When a user exports a report, the exported file includes all filtered rows."
- "`ReportExportOptions` accepts an optional `timezone` field."

Bad:

- "Open `src/export.ts` and add a branch near line 42."

### Complete Acceptance Criteria

Each criterion should be independently verifiable.

### Explicit Scope Boundaries

State what is out of scope so the worker does not expand the task.

## Template

```markdown
## Agent Brief

**Category:** bug / enhancement / refactor
**Summary:** one-line behavior-oriented summary

## Current Behavior

What happens now, or the baseline this work builds on.

## Desired Behavior

What should happen after the work is complete. Include edge cases and error behavior when relevant.

## Key Interfaces

- Interface/type/config/entry point — what needs to change and why

## Acceptance Criteria

- [ ] Specific, testable criterion
- [ ] Specific, testable criterion

## Required Tests

- Public behavior tests or diagnosis feedback loop required for this work.

## Required Evidence

- Evidence required by `docs/agents/quality-gates.md`.

## Dependencies

- Blocked by:
- Blocks:

## Out Of Scope

- Adjacent work that must not be changed.
```
