# Review Gate

Codexhub uses a worker-reviewer loop for substantial implementation tasks.

## Flow

1. Manager prepares or selects a task spec.
2. Worker receives the task spec and implements within the assigned scope.
3. Worker runs the required validation.
4. Worker asks a read-only review subagent to review the work against the
   original task spec.
5. Reviewer reports findings on the Spec axis and Standards axis separately,
   including missing tests, risks, and scope violations.
6. Worker checks whether docs or experience logs need updates.
7. Worker responds to each finding as accepted, rejected, or deferred.
8. Worker reruns validation after accepted fixes.
9. Human or manager reviews the final handoff.

## Reviewer Inputs

- Original task spec or GitHub issue body.
- Changed-file list.
- Diff or paths to inspect.
- Worker implementation summary.
- Validation commands and results.

## Reviewer Checklist

Run review on two axes. Keep findings separate so correct-looking code does not
hide wrong behavior, and spec-compliant behavior does not hide architecture or
testing problems.

### Spec Review

- Does the implementation satisfy the task intent?
- Are all acceptance criteria met?
- Were non-scope items avoided?
- Does the behavior match the original task spec or GitHub issue rather than a
  rewritten post-implementation interpretation?

### Standards Review

- Are raw Codex items preserved when projections are added?
- Are Manager Agent reads bounded, structured, paginated, and low-context?
- Are GUI defaults readable for humans?
- Are CLI JSON outputs stable and machine-readable?
- Are tests proportional to the blast radius?
- Do tests verify public behavior through stable interfaces rather than
  implementation details?
- Did the worker use a TDD-style tracer bullet or another explicit feedback
  loop for substantial behavior changes?
- For bug fixes, did the worker reproduce the failure before fixing it and add
  regression coverage where a correct test seam exists?
- Are Windows path, process lifecycle, and restart risks considered?
- Are failures structured and actionable?
- Did the worker avoid unrelated refactors?
- Are relevant docs updated, or did the worker explain why docs did not need
  changes?
- Did the worker record reusable experience or friction in the right doc?

## Acceptance Criteria Standard

Acceptance criteria should be checkable by another agent, a test, or a concrete
manual action.

Good:

- `POST /api/v1/sessions` returns `{ session, workspace }` and persists the
  initial message.
- `pnpm --filter @codexhub/server test` passes.
- `GET /api/v1/sessions/:id/items?type=agentmessage` defaults to 20 items and
  returns `next_cursor` when more items exist.

Too vague:

- Improve session startup.
- Make the UI better.
- Ensure it works.

Include negative criteria when they protect product boundaries:

- Do not add Linear/GitHub deep binding unless the issue asks for it.
- Do not replace raw item storage with summaries.
- Do not introduce validation gates, escalation, or context compiler behavior
  into first-phase runtime/session work.

## Feedback Loop Standard

Substantial behavior changes should define a feedback loop before broad
implementation:

- Prefer TDD tracer bullets: one behavior test, minimal implementation, then the
  next behavior.
- Test through public interfaces and stable contracts. Avoid tests that only
  assert internal call order, private helpers, or incidental file structure.
- For bugs and regressions, reproduce the reported failure first. If no correct
  test seam exists, document that as an architecture risk rather than adding a
  shallow test that gives false confidence.
- If UI behavior changes, include browser or screenshot verification when an
  automated test does not cover the user-visible result.

## Worker Response Format

For each review finding:

- **Accepted**: describe the fix and validation rerun.
- **Rejected**: explain why the finding does not apply.
- **Deferred**: link or create a follow-up issue.

The final handoff should include the review findings and responses.

Codexhub can persist structured review findings and worker responses on a
session. These records are for observability only: they do not block completion,
change session state, or replace the human/manager decision about whether the
work is acceptable.

## Documentation Check

Every review should ask whether the task affects:

- `README.md` for setup and usage.
- `AGENTS.md` for agent workflow or quality rules.
- `docs/roadmap.md` for product phase and current baseline.
- `docs/subagent-ops-log.md` for coordination friction and subagent lessons.
- `docs/symphony-lessons.md` for reusable or rejected Symphony assumptions.
- `docs/github-issues.md` for local backlog synthesis.
- `docs/task-spec-template.md` for task spec norms.
- `docs/review-gate.md` for review process changes.

If docs are stale, treat that as a review finding.
