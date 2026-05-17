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

```powershell
pnpm --filter @codexhub/cli dev -- project create --name demo --workspace-root D:\desktop\Codexhub-workspaces --json
pnpm --filter @codexhub/cli dev -- workspace create --project <project_id> --source local --path D:\desktop\Codexhub-workspaces\demo --json
pnpm --filter @codexhub/cli dev -- session start --project <project_id> --workspace <workspace_id> --message "Inspect this workspace." --codex-options "{\"fake\":true}" --json
pnpm --filter @codexhub/cli dev -- session latest <session_id>
pnpm --filter @codexhub/cli dev -- session items <session_id> --type agentmessage --limit 20 --json
pnpm --filter @codexhub/cli dev -- session send <session_id> --mode continue --message "Continue with the next step." --json
```
