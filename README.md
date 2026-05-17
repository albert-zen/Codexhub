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

```powershell
$Project = pnpm --filter @codexhub/cli dev -- project create --name demo --workspace-root D:\desktop\Codexhub-workspaces --json | ConvertFrom-Json
$Workspace = pnpm --filter @codexhub/cli dev -- workspace create --project $Project.project.id --source local --path D:\desktop\Codexhub-workspaces\demo --json | ConvertFrom-Json
$Session = pnpm --filter @codexhub/cli dev -- session start --project $Project.project.id --workspace $Workspace.workspace.id --message "Inspect this workspace and report status." --codex-options "{\"fake\":true}" --json | ConvertFrom-Json

pnpm --filter @codexhub/cli dev -- session latest $Session.session.id
pnpm --filter @codexhub/cli dev -- session result $Session.session.id
pnpm --filter @codexhub/cli dev -- session trace $Session.session.id --limit 20
pnpm --filter @codexhub/cli dev -- session items $Session.session.id --type agentmessage --limit 20 --json
pnpm --filter @codexhub/cli dev -- session send $Session.session.id --mode continue --message "Please continue your work and report the next result." --json
pnpm --filter @codexhub/cli dev -- session review-status set $Session.session.id --implementation-done --self-validation-done --review-requested --note "Ready for review." --json
pnpm --filter @codexhub/cli dev -- session watch $Session.session.id --limit 20
pnpm --filter @codexhub/cli dev -- workspace cleanup $Workspace.workspace.id --json
```

`continue` messages must include explicit content. Codexhub does not treat an
empty message as an instruction to proceed.

Workspace cleanup archives the workspace record by default. Add `--delete-files`
only when you want Codexhub to remove the workspace directory after safety
checks.

Review status is explicit observability metadata for manager agents and humans.
It is not a validation gate and does not decide whether worker output is correct.

## API routes

`/api/v1` is the canonical HTTP API prefix. Root routes such as `/sessions`
remain supported local aliases for the CLI and GUI.

## Current non-goals

Codexhub v1 is a local worker control plane. It does not implement escalation,
validation gates, context compilation, or deep Linear/GitHub issue binding.
