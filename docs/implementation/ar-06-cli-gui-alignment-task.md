# AR-06 Task Spec: CLI / GUI Presentation Alignment

## Problem

AR-05 introduced a shared core presentation helper for session action
availability, but app consumers still need a pass to ensure product eligibility
rules are not duplicated locally and that CLI/GUI contracts remain stable.

## Intent

Align CLI and GUI consumers with the shared presentation contract introduced by
AR-05 where it naturally applies, without changing user-visible behavior,
command output, API responses, or GUI workflows.

## Scope

You own AR-06 only:

- Audit CLI and GUI consumers for duplicated session action availability or
  related presentation rules already owned by `@codexhub/core`.
- Prefer direct consumption of the shared core helper where it is a natural fit.
- Keep app-local code responsible only for terminal text formatting or React
  rendering.
- Preserve CLI JSON output, CLI human output, GUI labels, GUI disabled states,
  and transcript/raw item readability.
- Update tests for any changed imports or app-local wrapper removal.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-06
  validation, compatibility notes, and documentation-impact check.

Likely files:

- `apps/web/src/main.tsx`
- `apps/web/src/session-actions.ts` / `apps/web/src/session-actions.test.ts`
- `apps/cli/src/program.ts` / `apps/cli/test/program.test.ts` only if a real
  CLI consumer exists
- `docs/implementation/architecture-refactor-evidence.md`

## Non-Scope

- Do not add new CLI flags, commands, or JSON fields.
- Do not remove CLI JSON fields or change CLI human output text.
- Do not redesign GUI layout or add new GUI workflows.
- Do not move server route response helpers, repository projections, runtime
  behavior, or Product Manager logic.
- Do not force a CLI code change when no current CLI surface consumes the
  shared session action helper.

## Required Behavior

- GUI action availability remains identical to AR-05 behavior.
- CLI JSON output for affected commands remains stable.
- CLI human output remains stable.
- Transcript and raw item views remain readable and bounded.
- App-local rendering code does not duplicate session eligibility rules already
  owned by `@codexhub/core`.

## Acceptance Criteria

- [ ] GUI consumers use the shared core presentation helper directly or through
      only a justified compatibility surface.
- [ ] CLI is audited; any non-change is explicitly justified in evidence.
- [ ] Existing GUI action availability tests still pass.
- [ ] Existing CLI tests pass if CLI code is touched; if not touched, evidence
      explains why no CLI-specific gate was needed.
- [ ] No API, CLI JSON, CLI human output, GUI label, or GUI workflow behavior
      changes are introduced.
- [ ] Evidence doc records validation and any follow-up issues.

## Feedback Loop

Run checks for touched packages. Likely commands:

```powershell
pnpm --filter @codexhub/core build
pnpm --filter @codexhub/web test
pnpm --filter @codexhub/web check
```

If CLI code is touched, also run:

```powershell
pnpm --filter @codexhub/cli test
pnpm --filter @codexhub/cli check
```

Run `pnpm lint`, `pnpm format`, and `git diff --check` when feasible because
AR-06 is mainly import/consumer alignment.

## Review Focus

Review should check:

- no duplicated eligibility rules remain in app-local GUI code;
- no CLI output contract changed;
- web behavior remains identical;
- AR-06 did not broaden into presentation redesign.

## Handoff Requirements

- List changed files.
- Summarize which consumers now use shared presentation contracts.
- Explain any CLI non-change.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
