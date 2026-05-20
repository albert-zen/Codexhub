---
name: architecture-canvas
description: Build and maintain a shared architecture canvas that explains a codebase, prototype, or proposed system in a human-readable way. Use when the user wants to understand architecture, evaluate whether code is well designed, map modules/interfaces/dependencies, or co-design a system before planning implementation.
---

# Architecture Canvas

Create or update a durable architecture canvas that lets a human and AI reason about the same system model.

Read `docs/agents/artifact-paths.md` for the repo's Canvas paths. For durable Canvas output, this file must exist or the user must explicitly approve the output path. If neither is true, create only a temporary draft and recommend `setup-canvas-agent-skills`.

Markdown and HTML are both first-class Canvas formats. Markdown is easier to diff. HTML is often better for visual architecture understanding. Prefer both for substantial systems: Markdown as durable source text, HTML as durable visual canvas.

## Process

1. Gather context:
   - Read existing architecture docs, PRDs/specs, `CONTEXT.md`, ADRs, issue briefs, tests, and relevant code.
   - Read `docs/agents/domain.md` and `docs/agents/artifact-paths.md` if present.
   - Prefer code and tests as evidence when docs disagree with implementation.
   - Load `improve-codebase-architecture` when judging design quality.

2. Produce the canvas:
   - Explain the system as a map, not a file-by-file tour.
   - Use domain language from `CONTEXT.md` when present.
   - Cite concrete files only as supporting evidence, not as the main organizing structure.
   - For HTML output, follow [HTML-CANVAS.md](HTML-CANVAS.md). Use diagrams heavily enough that the user can reason visually.

3. Externalize judgment:
   - State what appears well-designed and why.
   - State what appears risky or confusing and the consequence if left unchanged.
   - Use the standards vocabulary: module, interface, seam, adapter, depth, leverage, locality, deletion test.

4. Support back-and-forth shaping:
   - Present a coherent model first; do not interrogate one question at a time.
   - Ask the user to correct the model, choose between alternatives, or confirm decision points.
   - Update the canvas after alignment, not just the conversation.

## Markdown Canvas Format

Use this structure unless the repo already has a strong local convention:

```markdown
# Architecture Canvas

## System Goal

What the system is trying to make possible, in product/domain terms.

## Domain Model

Core concepts, relationships, and lifecycle/state transitions.

## System Map

Mermaid diagram showing major modules and dependency direction.

## Key User/Runtime Flows

End-to-end flows that matter for behavior and testing.

## Modules And Interfaces

For each important module:

- Responsibility
- Public interface
- Callers/dependencies
- Test surface
- Design judgment: deep/shallow, leverage/locality, deletion test

## Quality Evidence

Relevant tests, type checks, linting, e2e coverage, manual verification, or missing signals.

## Risk Map

Complexity hotspots, weak seams, missing tests, security/performance/reliability concerns.

## Decisions And ADR Links

Hard-to-reverse or surprising tradeoffs and links to ADRs.

## Open Questions

Questions that block PRD, issue DAG, implementation, or review.
```

## Output

When responding, include:

- The canvas path or paths created/updated.
- A short explanation of the current architecture model.
- The top design risks and their likely consequences.
- The specific parts where human alignment is needed, if any.
