# Subagent Ops Log

This log records implementation coordination friction and follow-up issues while
building Codexhub with parallel workers.

## Operating Rules

- Ownership for this pass is docs only.
- Do not revert edits made by other workers.
- Check `git status --short` before editing and before handoff.
- Keep each implementation PR aligned to one issue from `docs/github-issues.md`
  unless the issue explicitly allows a paired change.
- Prefer package ownership boundaries to reduce merge conflicts:
  `packages/core`, `apps/server`, `apps/cli`, `apps/web`, and `docs`.
- If an issue requires touching shared types, coordinate before editing server,
  CLI, and web code in the same pass.
- Include changed files and verification commands in every handoff.

## 2026-05-18

- Initial plan: split work by package to reduce merge conflicts.
- Repository observed as a new/untracked scaffold with packages for core,
  server, CLI, and web.
- Current server surface is only `/health`; workspace/session APIs are not
  implemented yet.
- Core already has useful shared contracts: domain types, item classifier, and
  session state helper tests.
- CLI currently only checks health.
- Web currently shows a placeholder shell.
- Docs pass expanded roadmap, lessons, ops notes, and seeded the first GitHub
  issue batch.
- Web worker completed cleanly inside `apps/web` and verified the Vite UI
  against the expected API-down error state.
- CLI worker completed cleanly inside `apps/cli` with mocked fetch contract
  tests.
- Server workers overlapped and one left a second implementation of workspace,
  runtime, repositories, and routes under different file names. The main agent
  consolidated on one server implementation and removed the duplicate generated
  files before final verification.
- Long-running server subagents were shut down once they stopped returning
  progress, because the next critical path depended on finishing the same
  package.
- Final integration keeps both `/api/v1/*` routes and root aliases, because the
  API plan uses `/api/v1` while the first CLI/web pass had already targeted root
  paths.
- Final verification passed `pnpm check`, `pnpm test`, `pnpm build`, and
  `pnpm format`.
- Added repo-level `AGENTS.md` for subagent delegation norms: every subagent
  prompt needs sufficient spec, explicit scope, acceptance criteria, validation,
  and handoff requirements.
- Do not store Codexhub project-specific subagent norms as a local machine
  Codex skill. Keep them in the repository so the policy travels with the code.
- Dogfood issue refresh found the first execution waves through GitHub issues
  `#1` through `#18` are now closed; local backlog docs need to present those as
  implemented baseline and keep the next active wave aligned to `#19` through
  `#27`.
- Codexhub's current result surfaces are technically useful but awkward for
  daily dogfood: manager agents have to query raw item fragments or remember
  longer CLI commands to answer "what happened?"
- Web trace UX currently exposes delta fragments as the primary reading surface.
  This verifies raw ingestion, but it is not a good manager or maintainer
  transcript.
- Empty-message continuation is ambiguous in a durable control plane. Continue
  actions should record the explicit instruction supplied by the caller.

## Coordination Friction

- The whole repository currently appears untracked, which makes `git status`
  less useful for distinguishing worker changes. Use explicit changed-file lists
  in handoffs.
- Storage work and API work can collide in `apps/server`; split repository,
  migration, and route issues when possible.
- Worker launch and item ingestion depend on the Codex app-server protocol
  details. Start with a launcher boundary and fixture ingestion tests.
- GUI work depends on API shape. Early web issues should use health/status
  surfaces until session endpoints are stable.
- Message dispatch touches shared state rules, server routes, CLI, and GUI.
  Keep the first dispatch issue server-only, then add CLI and GUI follow-ups.
- Subagents can finish useful package-local work quickly, but server work needs
  sharper file ownership. Splitting "persistence" and "runtime" inside the same
  package still collided because both needed API and route seams.
- When subagents do not commit to branches or worktrees, cleanup requires manual
  deletion of duplicate generated files. Prefer real git worktrees once the repo
  has an initial commit.
- Contract-first route names matter. The CLI and web should consume shared DTO
  definitions or a generated client before parallel UI/CLI work starts.
- Review specs need to be explicit, read-only by default, and tied to the
  original task spec. A reviewer cannot reliably judge intent satisfaction from
  a changed-file list alone.
- Parallel work needs non-overlapping scopes at file or package granularity.
  "Server persistence" and "server routes" are still likely to collide unless
  the task names exact files or sequencing.
- Dogfood sessions need result/trace convenience early. Raw item APIs are the
  right storage primitive, but the operator UX needs readable transcript,
  latest-result, recent-session, and watch commands.
- Backlog grooming should happen immediately after large implementation passes.
  Otherwise manager agents may delegate completed seed work instead of the real
  next bottleneck.
- Dogfooding `codexhub session trace <id> --limit 5` against a real stored
  session showed bounded context is useful, and `#14` added web item-window
  pagination. A remaining gap is conversation-level transcript paging: manager
  agents should page through complete prompts, agent messages, and tool rows
  instead of raw Codex item deltas. Tracked as `#19` and `#20`.
- Real dogfood sessions can end in stopped, completed, or failed states while
  follow-up work is still needed. Sending to a terminal session should remain
  invalid; the control-plane path should start a related follow-up session that
  references the previous task/session metadata. Tracked as `#23` and `#24`.
- CI can be green while still surfacing platform drift. The successful run for
  `91038bb` warned about GitHub Actions Node 20 deprecation and
  `windows-latest` redirection; that cleanup was tracked and closed as `#17`.
- Dogfood worker worktrees can trigger Git's safe-directory guard when the
  worktree owner differs from the sandbox user. Codexhub now injects
  environment-scoped `safe.directory=<workspace>` Git config into worker
  processes, so worker `git status`, `git diff`, and commit commands trust only
  their assigned workspace without changing global Git config. Tracked as
  `#28`.
- Issue `#22` could edit docs and run validation, but could not commit because
  the worktree `.git` file pointed at metadata under the parent checkout outside
  the sandbox writable roots. Agents should leave validated changes intact and
  report the exact commit command for the main integrator instead of fighting
  the sandbox. Tracked as `#30`.
- Worktree-mode workers that need to commit require writable access to the
  source repo Git metadata root in addition to the workspace path. Codexhub's
  default runtime sandbox now grants that controlled metadata root for linked
  worktrees; custom sandbox policies must preserve it explicitly.
- When a commit closes a large batch of issues, create the next issue batch
  immediately while the dogfood findings are fresh. This keeps the manager's
  next planning session focused on current bottlenecks rather than stale seed
  work.
- In the `#28` / `#32` / `#34` parallel dogfood batch, workers could now commit
  from linked worktrees, but validation remained noisy because each worktree did
  not have predictable dependency hydration. Several workers hit missing
  `node_modules`, missing `@types/node` or `vitest`, and one created an
  untracked `.pnpm-store/` that polluted `pnpm format` until staged files were
  selected explicitly. Track dependency/cache setup for worker worktrees as
  `#36`.
- Issue `#36` standardizes pnpm dependency hydration for worktree workers:
  install dependencies in the source checkout first, then Codexhub runs an
  offline frozen pnpm install inside each created pnpm worktree using the source
  install's recorded store. `node_modules/` and `.pnpm-store/` are ignored so
  generated dependency artifacts stay out of source diffs; missing source
  dependencies or store paths are documented blockers.
- Follow-up review on `#36` tightened failure safety: source dependency blockers
  are preflighted before `git worktree add` where possible, failed hydration
  removes the created worktree and prunes Git worktree metadata, pnpm hydration
  forces dev dependencies with `--prod=false`, and worker `node_modules` links
  must not resolve outside the worker workspace.
- Review agents should stop after identifying a known environment blocker and
  complete a static review from the diff. Without explicit steer, reviewers may
  retry Vitest/TypeScript variants even after `spawn EPERM` or missing
  dependency causes are already recorded.
- Main-integrator validation remains necessary after worker handoff. The same
  batch passed static review, but the main checkout caught a real CLI help test
  fragility caused by line wrapping. That was fixed before push, after
  `pnpm check`, server tests, CLI tests, and `pnpm format` passed.

## 2026-05-19

- Issue `#31` reproduced the Windows worktree web validation failure: direct
  web type-checks need `@codexhub/core` built first, and Vite/Vitest can fail
  with `spawn EPERM` when the worker sandbox blocks `node:child_process` child
  creation. Web package scripts now build core before package validation and
  fail early with an actionable preflight error for build/test instead of
  letting Vite/Vitest emit opaque EPERM stacks. Workers must not report web
  build or test validation as passed from a spawn-blocked sandbox; rerun the
  same command from a checkout or deliberate sandbox policy that permits child
  processes.
- Issue `#27` added the dogfood smoke script as a compiled-JS path instead of a
  `tsx` runtime path after fake smoke validation hit the same Windows
  `spawn EPERM` restriction through esbuild. Running the root smoke script with
  `--silent` and `--json` now produces clean machine-readable JSON, and the
  script's `friction` array reported no fake-mode control-plane issues in the
  local run.
- Issue `#40` confirmed the review-gate loop is useful for runtime-boundary
  changes. The implementation worker added a supervisor availability seam and
  passed static gates, but a read-only reviewer caught a send-time unavailable
  persistence bug for custom runtime controllers. The worker fixed it after a
  `continue` message in the same Codexhub session, and the main integrator then
  reran full unsandboxed validation. Keep this pattern for risky server/runtime
  work: worker implements, reviewer checks the original task intent, worker
  addresses findings, main integrator validates from the shared checkout.
- The same `#40` run repeated the known worktree sandbox limitation: Vitest and
  recursive pnpm commands can hit `spawn EPERM` inside a worker sandbox even
  when the code is valid. Workers should report the blocked command precisely
  and run narrower static checks or direct smoke scripts; the main integrator
  remains responsible for final `pnpm test` and root quality gates.
- The external-supervisor slice of `#40` showed two practical review rules:
  check `git status --short` for untracked source files before accepting a
  worker handoff, and verify new default ports against the local dev topology.
  The runtime supervisor now defaults to `4319` because API uses `4317` and web
  dev commonly uses `4318`.
- Runtime boundary reviews should include protocol-failure cases, not just happy
  path reconnects. A reviewer caught that invalid `200` responses from a
  supervisor could become API `200` error bodies; the fix maps supervisor
  protocol parse failures to non-2xx upstream errors.

## Suggested Ownership Map

- Core contracts and classifiers: one worker.
- Server config, migrations, and repositories: one worker.
- Server HTTP routes: one worker after repository contracts settle.
- Codex worker process adapter: one worker with fixture-first tests.
- CLI commands: one worker after route contracts settle.
- Web dashboard: one worker after read APIs settle.
- Docs and issue grooming: one worker.

## Handoff Checklist

- State the issue id being handled.
- List files changed.
- Note any files intentionally left untouched because another worker owns them.
- Record tests or checks run.
- Record blocked assumptions, especially around Codex app-server launch,
  payload shape, or database package choice.
