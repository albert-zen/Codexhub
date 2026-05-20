---
name: align-with-canvas
description: Align human and AI understanding by presenting the AI's system model, observed problems, consequences, options, and recommended decisions against an architecture canvas. Use when a design, PRD, issue DAG, implementation, or review reveals ambiguity, conflicting assumptions, hard-to-reverse decisions, or unclear architecture tradeoffs.
---

# Align With Canvas

Use the architecture canvas to make the AI's current understanding discussable. This is not a one-question-at-a-time interview. Present the model, the problem, the consequences, and the proposed change so the user can respond at the right level.

## Trigger Conditions

Run this when:

- The canvas, PRD, issue DAG, or implementation has unresolved assumptions.
- A decision is hard to reverse or changes architecture direction.
- Review finds a mismatch between the spec and implementation where the spec itself may be unclear.
- A module looks shallow, hard to test, or poorly aligned with the domain model.
- The user says they do not understand part of the architecture.

Do not run this when the spec is clear and implementation is simply wrong. In that case, give the fix directly.

## Process

1. Ground in artifacts:
   - Read the architecture canvas, relevant PRD/spec, ADRs, issue briefs, and code.
   - Check facts in the code when possible instead of asking the user.
   - Use `improve-codebase-architecture` vocabulary for design judgments.

2. Write an alignment brief:

```markdown
## Current Understanding

How the system/design appears to work.

## Observed Problems Or Ambiguities

What is unclear, conflicting, risky, or missing.

## Consequences

What happens if we keep the current design, choose option A, or choose option B.

## Proposed Change

The recommended direction and why it fits the canvas, standards, and current goals.

## Alternatives

Other credible options and why they are weaker or more costly.

## Decision Points

The decisions a human actually needs to make. Include the recommended answer for each.
```

3. Ask for response:
   - Ask the user to correct the model, choose a direction, or add constraints.
   - Avoid asking low-value questions the code or docs can answer.

4. Persist the result:
   - Update the canvas when shared understanding changes.
   - Offer an ADR only for hard-to-reverse, surprising, real tradeoff decisions.
   - Update PRD or issue DAG if the alignment changes execution.

## Decision Rule

If a choice is safe, reversible, and local, choose the conservative option and record it. If it affects product meaning, architecture direction, security, data shape, or hard-to-reverse behavior, pause for human alignment.
