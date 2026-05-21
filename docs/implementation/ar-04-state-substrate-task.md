# AR-04 Task Spec: State Substrate Split

## Problem

`apps/server/src/repository.ts` currently mixes multiple state-substrate
responsibilities in one large class: product records, raw Codex item writes,
projection queries, run group dashboards, review metadata, row mapping, and
session reference resolution. This makes the repository facade hard to review
and makes later Planning / Presentation work too dependent on unrelated write
paths.

## Intent

Split repository internals into focused state-substrate modules while preserving
the existing `HubRepository` public facade, SQLite schema, API response
contracts, and caller behavior.

This implements the Canvas distinction between Codexhub Product Records, Raw
Codex Event Log, and Derived Projections without introducing a migration or a
new persistence technology.

## Scope

You own AR-04 only:

- Keep `HubRepository` as the compatibility facade used by current server,
  runtime, Product Manager, and tests.
- Extract focused internals behind the facade. Suggested boundaries:
  - product records: projects, workspaces, sessions, task specs, messages;
  - raw item/event log: `appendItem`, item reads, latest item reads;
  - projection reads: transcript windows, latest completed agent message,
    agent-message grouping, run group dashboard summaries;
  - collaboration/review records: run groups, review gate status, review
    findings;
  - row mapping and small SQL helpers where extraction improves locality.
- Preserve the existing SQLite schema and every public facade method signature
  unless a tiny private type move is required.
- Preserve raw item losslessness, per-session monotonic item sequencing,
  append-first semantics, bounded reads, and session resolution behavior.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-04
  decisions, validation, old-to-new responsibility map, and dogfood friction.

Likely files:

- `apps/server/src/repository.ts`
- new focused modules under `apps/server/src/` with names such as
  `state-*.ts`, `repository-*.ts`, or similarly local naming that matches the
  codebase
- `apps/server/test/repository-characterization.test.ts`
- other focused server repository tests if the extraction creates clean unit
  seams
- `docs/implementation/architecture-refactor-evidence.md`

## Non-Scope

- Do not rename database tables or add SQLite migrations.
- Do not introduce an ORM.
- Do not change API routes, CLI output, GUI behavior, pagination defaults,
  cursor semantics, or run group dashboard response shape.
- Do not move Planning / Presentation helpers; that is AR-05.
- Do not move Product Manager or runtime adapter responsibilities.
- Do not fix unrelated repository bugs unless they block the split; record
  follow-up issue candidates instead.

## Required Behavior

- Existing repository facade methods used by server, runtime, Product Manager,
  CLI/API tests, and web-facing routes keep working.
- Raw Codex payload storage remains lossless and append-only at the item-log
  boundary.
- `appendItem` still increments `last_item_sequence` per session and still
  updates latest completed agent-message projections exactly as before.
- Transcript reads remain bounded by default and keep current grouping/order
  behavior for messages, agent-message fragments, and non-agent items.
- Run group dashboard summaries keep current review status/count and attention
  reason behavior.
- Session reference resolution keeps canonical id, unique prefix, unique UUID
  prefix, ambiguity, and no-match behavior.

## Acceptance Criteria

- [ ] `HubRepository` remains the public compatibility facade.
- [ ] Repository internals are split into focused modules or classes with a
      clear map from old responsibilities to new boundaries.
- [ ] No schema migration, public API behavior change, CLI/GUI behavior change,
      pagination default change, or cursor semantic change is introduced.
- [ ] Raw item losslessness, monotonic sequencing, latest completed agent
      message, transcript windows, dashboard summaries, and session resolution
      behavior remain covered by tests.
- [ ] Evidence doc records validation, decisions, responsibility map,
      documentation-impact check, and any follow-up issues.

## Feedback Loop

Run the narrow checks first:

```powershell
pnpm --filter @codexhub/core build
pnpm --filter @codexhub/server test -- repository-characterization.test.ts
pnpm --filter @codexhub/server test
pnpm --filter @codexhub/server check
```

Run root `pnpm test` if the extraction affects route behavior, core shared
types, CLI/API response expectations, or more than server repository internals.

Given issue #47, if Git commit/amend fails from inside the worker linked
worktree, report the exact Git error and leave the worktree staged or clean for
manager-side recovery rather than broadening the code task.

## Review Focus

Review should check that the split creates real locality rather than thin
one-method wrappers, and that it preserves:

- item append/projection ordering,
- transcript pagination/grouping behavior,
- run group dashboard attention reasons,
- review metadata reads/writes,
- session reference resolution before side effects,
- public facade compatibility.

## Handoff Requirements

- List changed files.
- Summarize the new state-substrate module boundaries.
- Provide an old-to-new responsibility map for repository behavior.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
