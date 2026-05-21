# AR-05 Task Spec: Planning / Presentation Helpers

## Problem

Operator-facing presentation rules are still split across server route helpers,
CLI formatters, and web utilities/components. This keeps bounded-view behavior,
latest-result selection, action availability, transcript metadata, and run group
dashboard interpretation harder to align before AR-06 moves CLI and GUI
consumers.

## Intent

Introduce focused Planning / Presentation helpers for bounded operator views
while preserving current API response shapes, CLI output, GUI behavior, and
pagination semantics.

This slice should create a stable helper surface that AR-06 can consume from
CLI and GUI without redesigning either app.

## Scope

You own AR-05 only:

- Add pure helper(s) for a narrow first set of presentation rules. Suggested
  candidates:
  - session action availability using the shared core state-machine rules;
  - latest-result item selection / fallback rules;
  - transcript window metadata or bounded-view labels;
  - run group dashboard attention/count interpretation.
- Prefer `packages/core` for helpers that are useful across server, CLI, and
  GUI. Use an `apps/server` helper only for server-only route response assembly.
- Wire at least one existing production caller to the helper so this is not a
  dead abstraction, while keeping behavior unchanged.
- Add focused helper tests and keep existing server/CLI/web tests passing.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-05
  decisions, validation, compatibility notes, and documentation-impact check.

Likely files:

- `packages/core/src/*presentation*` or another locally consistent helper name
- `packages/core/src/index.ts`
- `packages/core/src/*test.ts`
- `apps/server/src/server.ts` or a new server presentation module if the helper
  is server-only
- `apps/web/src/session-actions.ts` / tests if action availability is the first
  consumer
- `apps/web/src/run-group-dashboard.ts` / tests if dashboard interpretation is
  the first consumer
- `docs/implementation/architecture-refactor-evidence.md`

## Non-Scope

- Do not redesign the GUI or change visible labels unless the same text is
  preserved.
- Do not change API response shapes, route paths, CLI command names, CLI JSON
  shapes, pagination defaults, cursor semantics, or raw/debug view defaults.
- Do not move Product Manager, runtime adapter, repository item-log, or schema
  responsibilities.
- Do not centralize everything in one large presentation module. Keep the first
  helper surface small and behavior-backed.
- Do not make raw/debug views the default operator view.

## Required Behavior

- Bounded reads remain bounded by default.
- Existing latest result behavior keeps preferring completed agent-message
  projection where the current route does so.
- Session action availability remains compatible with current web behavior and
  shared state-machine rules:
  - `steer`: running or awaiting input, plus non-empty message;
  - `continue`: awaiting input, plus non-empty message;
  - `stop`/`complete`: starting, running, or awaiting input.
- Run group dashboard attention counts/labels remain compatible if touched.
- Transcript window labels/metadata remain compatible if touched.

## Acceptance Criteria

- [ ] At least one presentation helper is added with focused tests.
- [ ] At least one existing production caller uses the helper.
- [ ] API/CLI/GUI user-visible behavior and JSON contracts remain unchanged.
- [ ] Helper ownership is clear: shared reusable rules live in core; server-only
      response assembly stays server-side.
- [ ] Evidence doc records validation, compatibility notes, and any follow-up
      issues.

## Feedback Loop

Run the narrow checks for touched packages. Likely commands:

```powershell
pnpm --filter @codexhub/core build
pnpm --filter @codexhub/core test
pnpm --filter @codexhub/server test
pnpm --filter @codexhub/server check
pnpm --filter @codexhub/web test
```

If CLI formatters or CLI JSON are touched, also run:

```powershell
pnpm --filter @codexhub/cli test
pnpm --filter @codexhub/cli check
```

Run broader root tests if the helper crosses more than one app/package.

## Review Focus

Review should check that the helper is a real presentation/planning boundary,
not a one-line wrapper, and that it preserves:

- state-machine action eligibility,
- bounded latest/transcript/dashboard behavior for any touched views,
- public API/CLI/GUI contracts,
- app-local rendering responsibilities.

## Handoff Requirements

- List changed files.
- Summarize which presentation rules moved and which caller(s) now use them.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
