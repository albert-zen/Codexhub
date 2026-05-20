---
name: review-loop
description: "Orchestrate review of implementation work along two separate axes: Standards Review against architecture/TDD standards, canvas, ADRs, and local conventions, and Spec Review against the PRD/issues/acceptance criteria. Use by a manager or worker agent when they need to spawn clean reviewer subagents for a worker issue, execution wave, branch, PR, or completed DAG."
---

# Review Loop

This is an **orchestrator skill**. It is read by the agent responsible for delivery:

- **Manager agent** — primary user. Runs review after waves and at the end of the DAG.
- **Worker agent** — secondary user. May run a single-pass review on its own issue before returning work to the manager.
- **Reviewer subagents** — do not own this workflow. They receive narrow review briefs produced by the orchestrator and report findings only.

The reviewer does not fix code, spawn more agents, change scope, or ask the human. The orchestrator decides whether to fix, delegate fixes, loop, or escalate to `align-with-canvas`.

## Place In The Workflow

```text
Canvas -> PRD -> Issue DAG -> AFK implementation
                                |
                                | worker optional single-pass review
                                v
                              Manager integration
                                |
                                | manager wave/final review loop
                                v
                              Done or fix loop
```

## Modes

Read mode definitions, thresholds, and approval criteria from `docs/agents/review-policy.md`. If that file is missing, run `setup-canvas-agent-skills` before durable review.

## Inputs For The Orchestrator

- Diff range or changed files.
- PRD/spec.
- Issue brief or issue DAG node.
- Architecture canvas.
- `improve-codebase-architecture`, `tdd`, ADRs, and repo coding conventions.
- `docs/agents/quality-gates.md`, `docs/agents/worker-model.md`, and `docs/agents/review-policy.md`.
- Test/lint/typecheck/e2e output.
- Worker/manager evidence package.

If the spec is missing, run Standards Review and report that Spec Review is blocked.

## Orchestration Process

1. Pin the review scope:
   - Worker mode: scope to the assigned issue and worker diff.
   - Manager wave mode: scope to the wave diff and integrated evidence.
   - Manager final mode: scope to the full DAG implementation.
   - Record the diff command, changed files, and commit list when available.
   - Persist review output to the path from `docs/agents/artifact-paths.md` when present.

2. Choose reviewer shape:
   - For small worker reviews, one clean reviewer may run both axes to save tokens.
   - For manager reviews, spawn two clean reviewers in parallel: Standards and Spec.
   - Follow `docs/agents/review-policy.md` for whether the scope requires single-pass or strict-loop review.

3. Give reviewers narrow briefs:
   - Pass only the sources needed for their axis.
   - Pass raw artifacts: diff, spec, canvas, standards files, evidence, test output.
   - Do not pass the implementer's intended answer or prior self-justification except as evidence to verify.

4. Aggregate findings:
   - Keep Standards and Spec findings separate.
   - Do not merge or rerank the axes.
   - Mark findings as blocking, non-blocking, or missing evidence.

5. Act on findings:
   - If spec is clear and implementation is wrong, fix or delegate the fix directly.
   - If standards are clear and code violates them, fix or delegate the fix directly.
   - If the spec/canvas is unclear or review exposes a hard-to-reverse decision, stop and run `align-with-canvas`.
   - In strict loop, repeat only according to `docs/agents/review-policy.md`.

## Reviewer Briefs

### Standards Reviewer

Give this brief to a clean reviewer subagent:

```text
You are the Standards reviewer. Do not modify files.

Read the architecture canvas, ADRs, local coding conventions, `improve-codebase-architecture`, and `tdd` guidance provided by the orchestrator. Then review the diff/evidence.

Report:
1. Violations of documented standards or ADRs.
2. Shallow modules, weak interfaces, poor seams, missing locality/leverage, or speculative adapters.
3. Tests that verify implementation details instead of behavior.
4. Missing evidence or quality gates.

Distinguish blocking findings from judgment calls. Cite files/lines where possible. Skip issues already enforced and passing through tooling.
```

### Spec Reviewer

Give this brief to a clean reviewer subagent:

```text
You are the Spec reviewer. Do not modify files.

Read the PRD/spec, issue brief, acceptance criteria, issue DAG constraints, and implementation diff/evidence.

Report:
1. Requirements that are missing or only partially implemented.
2. Behavior that was not requested or exceeds scope.
3. Implemented behavior that appears wrong relative to the spec.
4. Acceptance criteria or evidence that are missing.

If the spec is clear, give direct fix requirements. If the spec is ambiguous, identify the ambiguity and recommend `align-with-canvas`.
```

## Finding Format

```markdown
## Standards Review

### Blocking

- [file:line] Finding. Standard violated. Required fix.

### Non-Blocking

- Finding. Tradeoff or cleanup suggestion.

### Missing Evidence

- Evidence needed before approval.

## Spec Review

### Blocking

- Requirement missed or behavior wrong. Required fix.

### Non-Blocking

- Scope or polish issue.

### Missing Evidence

- Acceptance criterion not proven.
```

## Approval Rule

Use the approval rule in `docs/agents/review-policy.md`. Do not maintain a separate approval rule here.
