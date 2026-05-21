# AR-01 Task Spec: Characterize Protected Behavior

## Problem

Codexhub is about to undergo an architecture refactor. Several valuable edge
behaviors already exist, but not all of them may be explicitly protected by
tests. Moving code before characterizing those behaviors risks semantic
regressions.

## Intent

Create a stronger regression safety net before any production module extraction.
This protects the product boundary defined in `docs/prd/architecture-refactor.md`:
refactor internals while keeping API, CLI, GUI, SQLite, and runtime behavior
stable.

## Scope

You own AR-01 only:

- Audit tests against the `Existing Behavior Inventory` in
  `docs/prd/architecture-refactor.md`.
- Add or sharpen focused characterization tests for high-risk uncovered
  behavior.
- Update or create `docs/implementation/architecture-refactor-evidence.md` with
  an AR-01 coverage note, commands run, and any lessons/issues discovered.

Likely areas to inspect:

- `packages/core/src/*`
- `apps/server/test/*`
- `apps/cli/test/*`
- `apps/web/src/*.test.ts`
- supporting implementation files only when needed to understand or test
  behavior.

## Non-Scope

- Do not move production modules.
- Do not introduce Product Manager, runtime adapter, state substrate, or
  presentation helper refactors.
- Do not change public API, CLI, GUI, or SQLite behavior.
- Do not rewrite the PRD or DAG to make implementation easier.
- Do not commit unrelated formatting churn.

## Required Behavior

The test suite should make the highest-risk protected behaviors harder to
regress. Prioritize gaps around:

- raw append and projection ordering,
- latest completed agent message stability,
- structured unavailable-runtime fallback,
- short session id ambiguity before side effects,
- bounded transcript/dashboard reads,
- GUI/CLI action eligibility.

Existing tests count if they clearly cover the behavior. Add tests only where
coverage is missing or too weak.

## Acceptance Criteria

- [ ] Produce a coverage note mapping PRD protected behaviors to existing or new
      tests.
- [ ] Add focused tests for the highest-risk uncovered behaviors.
- [ ] Keep public behavior unchanged.
- [ ] Keep production code changes minimal and only where required by tests.
- [ ] Record any Codexhub dogfood friction, missing coverage, or follow-up issue
      candidates in `docs/implementation/architecture-refactor-evidence.md`.

## Feedback Loop

- Start with test audit and targeted test additions.
- Run narrow package tests for every touched package.
- Run `pnpm test` if more than one package is touched and the environment
  allows it.
- If a test command is blocked by environment issues, record the exact command
  and failure.

## Validation

Run the narrowest relevant checks for touched packages. Prefer:

```powershell
pnpm --filter @codexhub/core test
pnpm --filter @codexhub/server test
pnpm --filter @codexhub/cli test
pnpm --filter @codexhub/web test
pnpm test
```

Also run check/build commands for touched packages when tests cross TypeScript
contracts.

## Review Focus

Review should check that this slice only adds characterization coverage and
evidence, does not start the architecture refactor early, and accurately records
which protected behaviors are already covered versus newly covered.

## Handoff Requirements

- List changed files.
- Summarize coverage gaps found and tests added.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
