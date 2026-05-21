# AR-03 Task Spec: Runtime Protocol Adapter

## Problem

`apps/server/src/runtime.ts` currently mixes process ownership, JSON-RPC payload
construction, pending request handling, raw event append, and native event
interpretation. This makes runtime durability work hard to reason about and
keeps the Runtime Ownership Seam too coupled to Codex App Server protocol
details.

## Intent

Extract a Codex App Server protocol adapter that owns request payload creation,
response extraction, stdout/stderr event parsing support, and native event
normalization while preserving runtime ownership behavior. This implements the
Canvas distinction between Runtime Ownership Seam and Codex App Server Adapter.

## Scope

You own AR-03 only:

- Extract protocol/event adaptation from `apps/server/src/runtime.ts` into a
  focused adapter module.
- Preserve `CodexRuntimeController` behavior and external supervisor behavior.
- Preserve append-first raw event handling.
- Add focused adapter tests for request payload construction, response
  extraction, non-JSON diagnostic handling if exposed, and native event
  normalization.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-03
  validation, decisions, and issues found.

Likely files:

- `apps/server/src/runtime.ts`
- new `apps/server/src/*codex*adapter*` or similarly named module
- `apps/server/test/*`
- `docs/implementation/architecture-refactor-evidence.md`

## Non-Scope

- Do not change public API routes, CLI, GUI, SQLite schema, or runtime
  supervisor config.
- Do not add durable reattach after supervisor restart.
- Do not change Codex App Server protocol semantics.
- Do not move Product Manager or repository/state substrate responsibilities.
- Do not fix unrelated runtime bugs unless they block extraction; record
  follow-up issue candidates instead.

## Required Behavior

- Start, steer, continue, fake mode, stop, complete, and shutdown behavior stay
  compatible.
- Raw stdout/stderr JSON payloads are appended before normalized event effects
  are applied.
- Non-JSON process output remains stored as raw diagnostic items.
- Turn completed, failed, cancelled, and input-required events keep the same
  session-state outcomes.
- Supervisor mode keeps the same structured unavailable and
  `session_process_unavailable` behavior.

## Acceptance Criteria

- [ ] Runtime protocol adapter module exists and owns JSON-RPC request/response
      and event normalization concerns.
- [ ] `CodexRuntime` still owns process lifecycle and pending request
      bookkeeping.
- [ ] Existing runtime/server/supervisor tests pass.
- [ ] New adapter tests cover protocol payloads and native event normalization.
- [ ] No public API, CLI, GUI, config, or schema behavior changes are
      introduced.
- [ ] Evidence doc records validation and any follow-up issues.

## Feedback Loop

Use TDD around the extracted adapter where practical. Run:

```powershell
pnpm --filter @codexhub/core build
pnpm --filter @codexhub/server test
pnpm --filter @codexhub/server check
```

Run broader root tests when feasible because runtime behavior crosses API and
dogfood surfaces.

## Review Focus

Review should check append-first ordering, supervisor behavior, fake mode
preservation, and whether the adapter is a real seam rather than a thin wrapper.

## Handoff Requirements

- List changed files.
- Summarize adapter interface and implementation decisions.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
