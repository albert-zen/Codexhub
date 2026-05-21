# AR-07 Task Spec: Integration Hardening And Documentation Sync

## Problem

AR-01 through AR-06 landed the architecture refactor in separate slices. The
branch now needs one final integration pass to catch cross-package regressions,
verify dogfood behavior after runtime/API refactors, and prepare a reviewable
handoff.

## Intent

Close the architecture refactor without broadening its scope. Prove that the
combined branch still satisfies Codexhub's core product boundaries: lossless raw
item storage, bounded manager-facing reads, stable CLI JSON, readable GUI
defaults, and opt-in runtime supervisor behavior.

## Scope

You own AR-07 only:

- Run the final quality gate or document any concrete failure with enough detail
  for a follow-up issue.
- Run the CI-safe fake dogfood smoke because earlier slices changed
  Product Manager orchestration and runtime protocol adaptation.
- Audit documentation sources listed in `docs/documentation-system.md` for
  stale public behavior, workflow, or architecture claims.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-07
  validation, documentation-impact check, review packet, open risks, and
  follow-up issues.
- Prepare a final review packet that links the Canvas, PRD, DAG, evidence, and
  changed implementation areas.

Likely files:

- `docs/implementation/architecture-refactor-evidence.md`
- `docs/implementation/architecture-refactor-dag.md` only if status or final
  execution notes need to be updated
- `docs/subagent-ops-log.md`, `docs/github-issues.md`, or other docs only if
  the audit finds stale guidance

## Non-Scope

- Do not add new architecture refactor features.
- Do not change API, CLI, GUI, runtime, repository, or schema behavior unless a
  final gate exposes a regression from AR-01 through AR-06.
- Do not introduce new validation-gate, escalation, scheduler, Linear/GitHub, or
  context-compiler behavior.
- Do not rewrite task intent or evidence to hide a failing check.

## Required Behavior

- Root `pnpm quality` passes, or any failure is documented with command output,
  suspected cause, and a follow-up issue.
- `pnpm smoke:dogfood -- --mode fake` runs after the combined refactor, or a
  concrete blocker is documented with a follow-up issue.
- Documentation audit checks the source-of-truth list in
  `docs/documentation-system.md`.
- Review packet is concise and includes changed areas, validation, risks, and
  references to Canvas/PRD/DAG.
- No known refactor regression remains untracked.

## Acceptance Criteria

- [ ] Final gate result is recorded in evidence.
- [ ] Fake dogfood smoke result is recorded in evidence.
- [ ] Documentation-impact check names the docs audited and any docs changed.
- [ ] Review packet is added to evidence with changed files/areas, validation,
      risks, and links to `docs/architecture/CANVAS.md`,
      `docs/prd/architecture-refactor.md`, and
      `docs/implementation/architecture-refactor-dag.md`.
- [ ] Any new Codexhub dogfood friction or product risk is recorded in an issue
      or explicitly marked as already tracked.
- [ ] A read-only review is performed against this task spec and
      `docs/review-gate.md`; findings and responses are recorded.

## Feedback Loop

Run the broad final checks first:

```powershell
pnpm quality
pnpm smoke:dogfood -- --fake
```

If a broad command fails, run the narrowest package command needed to isolate
the failure, then either fix a regression in scope or record a follow-up issue.

## Validation

- `pnpm quality`
- `pnpm smoke:dogfood -- --fake`
- `git diff --check`
- Read-only review against this task spec and `docs/review-gate.md`

## Review Focus

Review should check:

- final evidence is honest about every gate result;
- documentation-impact check uses `docs/documentation-system.md` as the source
  of truth;
- AR-07 does not expand the architecture refactor beyond final hardening;
- any remaining risk has a concrete issue or documented owner.

## Handoff Requirements

- Changed files.
- Commands run and results.
- Documentation audit summary.
- Review findings and worker responses.
- Open risks and follow-up issues.
