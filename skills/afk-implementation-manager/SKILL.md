---
name: afk-implementation-manager
description: Manage implementation of an issue DAG using TDD, Matt Pocock's architecture-improvement standards, worker delegation, wave integration, quality gates, and evidence collection. Use when the user wants an agent manager to execute AFK-ready implementation work from a PRD/issue DAG.
---

# AFK Implementation Manager

Execute an approved issue DAG while preserving test feedback, architecture quality, and reviewable evidence.

## Required Inputs

- Architecture canvas.
- PRD/spec.
- Issue DAG with execution waves.
- `improve-codebase-architecture`.
- `tdd`.
- `diagnose` for bug issues or regressions.
- `docs/agents/quality-gates.md`.
- `docs/agents/worker-model.md`.
- `docs/agents/review-policy.md`.

Do not proceed if core issues are still `HITL`, hard-to-reverse, or missing acceptance criteria. Run `align-with-canvas` instead.

## Manager Responsibilities

1. Plan the wave:
   - Confirm dependencies are satisfied.
   - Identify issues that can run in parallel.
   - Assign disjoint write scopes when using workers.

2. Apply TDD first:
   - For each behavior slice, start with a failing behavior test when there is a valid test seam.
   - Use tracer bullets: one behavior test, minimal implementation, then next behavior.
   - If TDD is not appropriate, record the alternative feedback loop before implementation.
   - For bug issues, use `diagnose`: build the reproduction loop first, then fix and add regression coverage.

3. Delegate carefully:
   - Use workers for concrete, bounded issues with clear acceptance criteria.
   - Build worker assignment packets from `docs/agents/worker-model.md`.
   - Tell workers they are not alone in the codebase, must not revert others' work, and must stay within assigned scope.
   - Require each worker to return changed files, tests run, evidence, and residual risks.
   - Allow workers to invoke `review-loop` in `worker-single-pass` mode for risky or non-trivial assigned issues.

4. Integrate:
   - Review worker changes for conflicts, overlapping assumptions, and scope creep.
   - Run required quality gates from `docs/agents/quality-gates.md` after each wave.
   - Run `review-loop` in `manager-single-pass` mode after normal waves, or `manager-strict-loop` mode for high-risk waves.
   - Update open questions and the architecture canvas when implementation changes system understanding.

5. Decision handling:
   - For safe, reversible, local decisions: choose the conservative option and log it.
   - For product meaning, architecture direction, schema/data migration, security, or hard-to-reverse decisions: stop and run `align-with-canvas`.

## Evidence Package

Collect the evidence package defined in `docs/agents/quality-gates.md` plus the worker return packet defined in `docs/agents/worker-model.md`. Do not maintain a separate evidence schema here.

## Completion Gate

The DAG is not done until:

- All acceptance criteria are satisfied or explicitly deferred by the user.
- Required gates and evidence from `docs/agents/quality-gates.md` are satisfied.
- `review-loop` has passed at the required review intensity for the issue DAG.
