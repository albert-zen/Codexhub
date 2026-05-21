# AR-02 Task Spec: Product Manager Command Module

## Problem

Server session routes currently parse HTTP inputs, enforce product lifecycle
rules, mutate persistence, call runtime controllers, and shape responses in one
place. This makes route code shallow and makes later architecture refactors
riskier.

## Intent

Introduce a Product Manager module that owns worker lifecycle product commands
without changing public API behavior. This deepens the Project Manager seam from
`docs/architecture/CANVAS.md` while keeping Fastify as an HTTP adapter.

## Scope

You own AR-02 only:

- Add a server-side Product Manager command module for:
  - start worker,
  - start follow-up worker,
  - send steer or continue message,
  - stop worker,
  - complete worker.
- Move product orchestration out of the migrated route handlers while preserving
  route parsing and HTTP error mapping in the server layer.
- Add focused tests for the Product Manager module using fake runtime and
  repository/database setup.
- Update `docs/implementation/architecture-refactor-evidence.md` with AR-02
  validation, decisions, and issues found.

Likely files:

- `apps/server/src/server.ts`
- new `apps/server/src/*product-manager*` or similarly named module
- `apps/server/test/*`
- `docs/implementation/architecture-refactor-evidence.md`

## Non-Scope

- Do not migrate run group, review, workspace cleanup, project creation, or
  workspace creation commands unless required by lifecycle commands.
- Do not extract runtime JSON-RPC/protocol handling; that is AR-03.
- Do not split repository/state substrate internals; that is AR-04.
- Do not change HTTP routes, response DTOs, CLI commands, GUI behavior, or
  SQLite schema.
- Do not fix unrelated dogfood issues unless they block AR-02; record follow-up
  issue candidates instead.

## Required Behavior

- Existing session start, follow-up, send, stop, and complete routes keep their
  successful response shapes.
- Existing errors for missing workspace/project, terminal sends, prompt/message
  validation, unavailable runtime, and follow-up source/workspace mismatch stay
  compatible.
- Product Manager should not know Fastify request/response shapes.
- Product Manager should depend on repository/state and runtime interfaces.
- Route handlers for migrated commands should become thinner HTTP adapters.

## Acceptance Criteria

- [ ] Product Manager module exists and owns the five lifecycle commands.
- [ ] Migrated route handlers delegate lifecycle orchestration to Product
      Manager.
- [ ] Existing server tests pass.
- [ ] New Product Manager tests cover start, follow-up, send, stop/complete,
      and unavailable-runtime behavior through fake runtime or controlled
      runtime stubs.
- [ ] No public API, CLI, GUI, or schema behavior changes are introduced.
- [ ] Evidence doc records validation and any follow-up issues.

## Feedback Loop

- Use TDD where practical: add Product Manager tests before or alongside moving
  route logic.
- Run:

```powershell
pnpm --filter @codexhub/core build
pnpm --filter @codexhub/server test
pnpm --filter @codexhub/server check
```

- Run broader `pnpm test` if the touched behavior crosses package contracts and
  the environment allows it.

## Review Focus

Review should scrutinize whether this is a real module-depth improvement rather
than a pass-through wrapper. The Product Manager interface should reduce route
caller knowledge and preserve error semantics.

## Handoff Requirements

- List changed files.
- Summarize Product Manager interface and implementation decisions.
- Report commands run and results.
- Report any Codexhub dogfood friction or follow-up issues discovered.
- Include documentation-impact check.
