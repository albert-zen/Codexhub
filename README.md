# Codexhub

Codexhub is a local Codex worker control plane for manager agents and humans.

It creates and tracks workspaces, starts Codex app-server worker sessions, stores
raw Codex item streams, and exposes low-context API and CLI surfaces for reading
worker status and sending follow-up messages.

## Quick start

```powershell
pnpm install
pnpm build
pnpm --filter @codexhub/server dev
```

The server defaults to `http://127.0.0.1:4317` and stores local data under
`apps/server/data/codexhub.sqlite`.

Run the GUI in another terminal:

```powershell
pnpm --filter @codexhub/web dev
```

The GUI defaults to `http://127.0.0.1:4318`.

Optional runtime supervisor mode keeps worker process ownership outside the API
server so API hot reloads can reconnect to still-live supervised sessions. Run
the supervisor separately on its default `http://127.0.0.1:4319`, then opt the
API server in with an explicit URL:

```powershell
pnpm --filter @codexhub/server dev:runtime-supervisor
$env:CODEXHUB_RUNTIME_SUPERVISOR_URL = "http://127.0.0.1:4319"
pnpm --filter @codexhub/server dev
```

Use the same `CODEXHUB_DB_PATH` for both processes when overriding the default
database path.

## CLI example

The CLI defaults to `http://127.0.0.1:4317`. Use `--json` for Manager Agent
calls and omit it for human-readable output.

For machine-readable manager scripts, keep pnpm lifecycle output off stdout.
When running the development CLI through pnpm, use `pnpm --silent` so stdout is
only the Codexhub JSON payload:

```powershell
$Health = pnpm --silent --filter @codexhub/cli dev -- health --json | ConvertFrom-Json
```

For longer automation, build once and invoke the CLI directly:

```powershell
pnpm --filter @codexhub/cli build
$Health = node apps/cli/dist/index.js health --json | ConvertFrom-Json
```

Do not pipe plain `pnpm --filter @codexhub/cli dev -- ... --json` into a JSON
parser; pnpm may print script banners before the CLI payload. If parsing fails
after a side-effecting command such as `project create`, `workspace create`,
`session start`, `session follow-up`, `session send`, or `run-group create`,
inspect existing state before retrying so the manager does not create
duplicates.

```powershell
$Project = pnpm --silent --filter @codexhub/cli dev -- project create --name demo --workspace-root D:\desktop\Codexhub-workspaces --json | ConvertFrom-Json
$Workspace = pnpm --silent --filter @codexhub/cli dev -- workspace create --project $Project.project.id --source local --path D:\desktop\Codexhub-workspaces\demo --json | ConvertFrom-Json
$Session = pnpm --silent --filter @codexhub/cli dev -- session start --project $Project.project.id --workspace $Workspace.workspace.id --message "Inspect this workspace and report status." --task-spec-ref docs/task-specs/demo.md --task-spec-title "Demo workspace inspection" --codex-options "{\"fake\":true}" --json | ConvertFrom-Json

pnpm --filter @codexhub/cli dev -- session latest $Session.session.id
pnpm --filter @codexhub/cli dev -- session result $Session.session.id
pnpm --filter @codexhub/cli dev -- session trace $Session.session.id --limit 20
pnpm --silent --filter @codexhub/cli dev -- session items $Session.session.id --type agentmessage --limit 20 --json
pnpm --silent --filter @codexhub/cli dev -- session send $Session.session.id --mode continue --message "Please continue your work and report the next result." --json
pnpm --silent --filter @codexhub/cli dev -- session review-status set $Session.session.id --implementation-done --self-validation-done --review-requested --note "Ready for review." --json
$RunGroup = pnpm --silent --filter @codexhub/cli dev -- run-group create --name "Demo batch" --project $Project.project.id --purpose "Observe related worker sessions." --json | ConvertFrom-Json
pnpm --silent --filter @codexhub/cli dev -- run-group add-session $RunGroup.run_group.id --session $Session.session.id --json
pnpm --filter @codexhub/cli dev -- session watch $Session.session.id --limit 20
pnpm --silent --filter @codexhub/cli dev -- workspace cleanup $Workspace.workspace.id --json
```

`session trace` reads the latest transcript window by default. Use `--recent`
to make that default explicit, `--no-recent` to read forward from the beginning
with cursor pagination, `--cursor <cursor>` to continue a non-recent page, and
`--after-sequence` / `--before-sequence` to bound the read by sequence. Cursor
and sequence filters disable the default recent window.

Session commands accept the canonical `sess_<uuid>` id, a unique leading prefix
including `sess_`, or a unique leading prefix from only the UUID portion.
Responses always keep canonical ids unchanged. Ambiguous prefixes fail with
`session_id_ambiguous` and include `candidate_ids` in JSON error payloads.
Side-effect commands such as `session follow-up`, `session send`,
`session stop`, `session review-status set`, and `run-group add-session` refuse
the request before changing state.

`session latest` and session list summaries report the last completed agent
message. Streaming `item/agentMessage/delta` fragments remain available through
`session trace` and raw `session items` reads, but they do not replace the stable
latest message until Codex emits the completed agent message item, including
when `session latest --type all` is used.

`continue` messages must include explicit content. Codexhub does not treat an
empty message as an instruction to proceed.

Stopped, completed, and failed sessions do not have a live Codex process to
message. Start a follow-up session to continue in a fresh worker. The follow-up
keeps the previous session unchanged, records `previous_session_id`, defaults to
the same workspace, and copies the prior task-spec metadata unless new metadata
is supplied:

```powershell
$FollowUp = pnpm --silent --filter @codexhub/cli dev -- session follow-up $TerminalSessionId --message "Continue from the previous result and report status." --json | ConvertFrom-Json
$FollowUp.session.previous_session_id
```

Pass `--workspace <workspace-id>` to run the follow-up in a different workspace
from the same project.

Without `CODEXHUB_RUNTIME_SUPERVISOR_URL`, server hot reloads can orphan
`starting`, `running`, or `awaiting_input` session records because the HTTP
server owns the Codex process stdio handles. On startup, Codexhub marks those
rows `failed` instead of pretending it can reattach. With the external runtime
supervisor enabled, API restarts can continue sessions only while the supervisor
stays alive and proves the session is still managed. If a send finds a
non-terminal row without a live process, the API returns
`session_process_unavailable` with a `follow_up_endpoint` for starting a fresh
related session.

Workspace cleanup archives the workspace record by default. Add `--delete-files`
only when you want Codexhub to remove the workspace directory after safety
checks.

For parallel work on one repository, create an isolated git worktree workspace:

```powershell
pnpm --silent --filter @codexhub/cli dev -- workspace create --project $Project.project.id --source git --mode worktree --repo-path D:\desktop\codex-hub --path D:\desktop\Codexhub-workspaces\worker-one --branch codexhub/worker-one --json
```

Clone and worktree modes have different isolation tradeoffs. Clone mode keeps a
full `.git` directory inside the worker workspace, so the default worker sandbox
only needs the workspace path writable, at the cost of another checkout.
Worktree mode is faster and uses isolated branches, but Git stores commit
objects, refs, and indexes under the source repo's `.git` metadata. Codexhub's
default worker sandbox adds that controlled Git metadata root for linked
worktree workspaces so workers can commit on their branch. If you provide a
custom `codex_options.sandboxPolicy`, include both the worktree path and the
source repo Git metadata root when the worker must commit.

For pnpm workspaces, install dependencies in the source checkout before creating
worktree workers:

```powershell
Set-Location D:\desktop\codex-hub
pnpm install
```

When the source checkout has `pnpm-lock.yaml`, Codexhub hydrates each created
worktree by running
`pnpm install --offline --frozen-lockfile --ignore-scripts --prod=false` inside
the worktree. If the source install records a pnpm store path, Codexhub uses
that store explicitly so validation can resolve `@types/node`, `vitest`,
workspace package links, and other dependencies without network access. The
resulting `node_modules/` and any local `.pnpm-store/` are ignored by default.
If the source checkout is missing `node_modules/` or its recorded store, workspace
creation fails before adding the worktree where possible, with a blocker that
tells the operator to rerun `pnpm install` in the source checkout. If hydration
fails after Git creates the worktree, Codexhub removes the worktree and prunes
Git worktree metadata before returning the failure. Codexhub also refuses to run
pnpm when an existing worker `node_modules` link resolves outside the worker
workspace. If pnpm reports a store permission error, run Codexhub from an
environment that can write to the source install's recorded pnpm store or
rehydrate the source checkout with a writable store.

Web validation has one extra sandbox requirement. The web `check` script builds
`@codexhub/core` first so direct package checks can resolve shared types. The
web `build` and `test` scripts also run a preflight before Vite or Vitest. If
the worker sandbox blocks `node:child_process` spawn, the commands fail early
with an actionable EPERM message because Vite/Vitest need child processes for
esbuild, worker pools, and Windows path resolution. Do not mark web build or
test validation as passed from that sandbox; rerun the same pnpm command from a
checkout or deliberate worker sandbox policy that permits Node child-process
spawn.

Review status is explicit observability metadata for manager agents and humans.
It is not a validation gate and does not decide whether worker output is correct.
Structured review findings are also non-gating observability records. A review
session can attach findings to an implementation session, and workers can record
accepted, rejected, or deferred responses:

```powershell
$ReviewerSessionId = "sess_review_session_id"
$Finding = pnpm --silent --filter @codexhub/cli dev -- session review-findings add $Session.session.id --reviewer-session $ReviewerSessionId --severity high --summary "Missing server test coverage." --details "Add focused API coverage for the changed route." --json | ConvertFrom-Json
pnpm --filter @codexhub/cli dev -- session review-findings list $Session.session.id
pnpm --silent --filter @codexhub/cli dev -- session review-findings set $Session.session.id $Finding.review_finding.id --status accepted --response "Added focused server and CLI tests." --json
```

Task spec metadata is an immutable input snapshot or reference stored on session
start. Workers should execute from it, not edit it, unless the assigned task is
explicitly documentation work.

Run groups are lightweight observation containers for related sessions. They do
not schedule workers or enforce quality gates.

## Dogfood smoke

Use the dogfood smoke script to exercise Codexhub as a worker control plane
without spending Codex quota:

```powershell
pnpm --silent smoke:dogfood -- --json
```

Fake mode is the default. The script starts a temporary Codexhub API server,
creates a project, run group, local workspaces, sessions, a continue turn, and a
terminal-session follow-up through `/api/v1` routes. The JSON output includes
canonical session ids, statuses, latest messages, bounded trace excerpts,
follow-up links, query examples, and a `friction` array. Use `--keep-artifacts`
when you want to inspect the temporary SQLite DB and workspaces after the run.

To point the same fake-safe path at an existing server:

```powershell
pnpm --silent smoke:dogfood -- --api http://127.0.0.1:4317 --workspace-root D:\tmp\codexhub-dogfood --json
```

Real Codex mode is manual and explicit:

```powershell
pnpm --silent smoke:dogfood -- --real --timeout-ms 600000 --keep-artifacts --json
```

Real mode still creates dedicated smoke workspaces and uses read-only prompts
that tell workers not to edit files. Do not run real mode in CI by default, and
copy durable items from the output `friction` array into
`docs/subagent-ops-log.md` instead of treating them as transient console noise.

## API routes

`/api/v1` is the canonical HTTP API prefix. Root routes such as `/sessions`
remain supported local aliases for the CLI and GUI.

Follow-up sessions are created with `POST /api/v1/sessions/:id/follow-up`.
The request accepts `initial_message` or `prompt`, optional `workspace_id`,
optional `task_spec`, and optional `codex_options`; the response includes the
new `session` plus `previous_session_id`.

## Current non-goals

Codexhub v1 is a local worker control plane. It does not implement escalation,
validation gates, context compilation, or deep Linear/GitHub issue binding.
