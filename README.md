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
`session start`, `session send`, or `run-group create`, inspect existing state
before retrying so the manager does not create duplicates.

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

`continue` messages must include explicit content. Codexhub does not treat an
empty message as an instruction to proceed.

Workspace cleanup archives the workspace record by default. Add `--delete-files`
only when you want Codexhub to remove the workspace directory after safety
checks.

For parallel work on one repository, create an isolated git worktree workspace:

```powershell
pnpm --silent --filter @codexhub/cli dev -- workspace create --project $Project.project.id --source git --mode worktree --repo-path D:\desktop\codex-hub --path D:\desktop\Codexhub-workspaces\worker-one --branch codexhub/worker-one --json
```

Review status is explicit observability metadata for manager agents and humans.
It is not a validation gate and does not decide whether worker output is correct.

Task spec metadata is an immutable input snapshot or reference stored on session
start. Workers should execute from it, not edit it, unless the assigned task is
explicitly documentation work.

Run groups are lightweight observation containers for related sessions. They do
not schedule workers or enforce quality gates.

## API routes

`/api/v1` is the canonical HTTP API prefix. Root routes such as `/sessions`
remain supported local aliases for the CLI and GUI.

## Current non-goals

Codexhub v1 is a local worker control plane. It does not implement escalation,
validation gates, context compilation, or deep Linear/GitHub issue binding.
