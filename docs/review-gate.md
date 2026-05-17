# Review Gate

Codexhub uses a worker-reviewer loop for substantial implementation tasks.

## Flow

1. Manager prepares or selects a task spec.
2. Worker receives the task spec and implements within the assigned scope.
3. Worker runs the required validation.
4. Worker asks a read-only review subagent to review the work against the
   original task spec.
5. Reviewer reports findings, missing tests, risks, and scope violations.
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

- Does the implementation satisfy the task intent?
- Are all acceptance criteria met?
- Were non-scope items avoided?
- Are raw Codex items preserved when projections are added?
- Are Manager Agent reads bounded, structured, paginated, and low-context?
- Are GUI defaults readable for humans?
- Are CLI JSON outputs stable and machine-readable?
- Are tests proportional to the blast radius?
- Are Windows path, process lifecycle, and restart risks considered?
- Are failures structured and actionable?
- Did the worker avoid unrelated refactors?
- Are relevant docs updated, or did the worker explain why docs did not need
  changes?
- Did the worker record reusable experience or friction in the right doc?

## Worker Response Format

For each review finding:

- **Accepted**: describe the fix and validation rerun.
- **Rejected**: explain why the finding does not apply.
- **Deferred**: link or create a follow-up issue.

The final handoff should include the review findings and responses.

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
