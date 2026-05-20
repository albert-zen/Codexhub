# Review Policy

The source of truth for substantial implementation review is `docs/review-gate.md`.

This file maps that review gate into the Canvas-driven workflow.

## Modes

| Mode                  | Owner   | When                                                                           |
| --------------------- | ------- | ------------------------------------------------------------------------------ |
| `worker-single-pass`  | Worker  | Non-trivial assigned issue before handoff                                      |
| `manager-single-pass` | Manager | Normal wave or low-risk branch                                                 |
| `manager-strict-loop` | Manager | High-risk, runtime-boundary, architecture-sensitive, or release-sensitive work |

## Review Axes

Use the Spec Review and Standards Review axes defined in
`docs/review-gate.md`.

## Reviewer Packet

Give the read-only reviewer:

- Original task spec or GitHub issue body.
- Changed-file list.
- Diff or paths to inspect.
- Worker implementation summary.
- Validation commands and results.
- Relevant Canvas/PRD/DAG artifacts when the task came from this workflow.

Do not give the reviewer authority to modify files or change scope.

## Approval Rule

Manager or human approval is required. Review metadata stored in Codexhub is observability only; it does not block completion, change session state, or replace human/manager judgment.

## Escalation

Run `align-with-canvas` when review finds:

- Spec ambiguity.
- Canvas/spec mismatch.
- Hard-to-reverse decision.
- Architecture direction change.
