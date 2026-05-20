# Review Policy

Define when review runs and how strict it should be.

## Modes

| Mode                  | Owner   | When                                                                            |
| --------------------- | ------- | ------------------------------------------------------------------------------- |
| `worker-single-pass`  | Worker  | Non-trivial assigned issue before handoff                                       |
| `manager-single-pass` | Manager | Normal wave or low-risk branch                                                  |
| `manager-strict-loop` | Manager | High-risk, security-sensitive, release-blocking, or architecture-sensitive work |

## Review Axes

- **Standards Review**: architecture, TDD, ADRs, Canvas, repo conventions, quality gates.
- **Spec Review**: PRD, issue brief, acceptance criteria, DAG constraints.

## Reviewer Packet

The orchestrator gives reviewers:

- Frozen diff scope.
- Relevant spec or issue brief.
- Architecture Canvas.
- Relevant ADRs and standards.
- Test/lint/typecheck output.
- Evidence package.

Reviewers report findings only. They do not fix code or ask the human.

## Approval Rule

Approve only when:

- No blocking Standards findings remain.
- No blocking Spec findings remain.
- Required evidence from `docs/agents/quality-gates.md` is present.
- Any remaining non-blocking findings are explicitly accepted or deferred by the orchestrator.

## Strict Loop Rule

In `manager-strict-loop`, repeat only for blocking findings and missing evidence. Do not churn endlessly on non-blocking preferences.

## Escalation

Run `align-with-canvas` when review finds:

- Spec ambiguity.
- Canvas/spec mismatch.
- Hard-to-reverse decision.
- Architecture direction change.
