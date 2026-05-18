# Runtime Supervisor Boundary

Codexhub can run Codex `app-server` child processes in two modes:

- Default in-process mode: the HTTP/API server owns each worker's stdin,
  stdout, stderr, pending JSON-RPC requests, and process handle.
- External runtime supervisor mode: a separate local HTTP service owns
  `CodexRuntime`, while the API server talks to it through
  `SupervisorRuntimeClient`.

The default remains in-process and fail-closed. The API server uses the external
supervisor only when `CODEXHUB_RUNTIME_SUPERVISOR_URL` is explicitly set.

## Current Restart Contract

On server startup, persisted sessions in `starting`, `running`, or
`awaiting_input` are reconciled to `failed` when the configured runtime cannot
prove they still have a live Codex process. The failure reason says the server
restarted without a live Codex process, `process_pid` is cleared, and `ended_at`
is set.

This is deliberate. A persisted `codex_thread_id`, `codex_turn_id`, or OS pid is
not enough to safely continue a session after the HTTP server has lost stdio
ownership. Codexhub does not claim those sessions are live or continuable.

The default in-process `CodexRuntime` has no durable registry across HTTP server
restarts, so the default behavior remains fail-closed. `createServer` accepts a
runtime factory whose controller can answer whether a persisted transient
session is still live. When `CODEXHUB_RUNTIME_SUPERVISOR_URL` is configured,
the API server uses `SupervisorRuntimeClient` as that controller. Startup
reconciliation skips only sessions that the configured runtime explicitly marks
available; every other transient session still uses the failed-session
follow-up path.

If a message send reaches a non-terminal session record but the runtime has no
managed process for it, the API returns `409 session_process_unavailable`. The
error includes:

- `session_id`
- `follow_up_available: true`
- `follow_up_endpoint`

The failed send is recorded on the source session, the source session is marked
`failed`, and operators can start a fresh related worker through
`POST /api/v1/sessions/:id/follow-up`.

## External Supervisor Mode

Start the runtime supervisor in a separate terminal and point the API server at
it:

```powershell
$env:CODEXHUB_DB_PATH = "D:\data\codexhub.sqlite"
pnpm --filter @codexhub/server dev:runtime-supervisor
```

```powershell
$env:CODEXHUB_DB_PATH = "D:\data\codexhub.sqlite"
$env:CODEXHUB_RUNTIME_SUPERVISOR_URL = "http://127.0.0.1:4319"
pnpm --filter @codexhub/server dev
```

Supervisor listener environment:

- `CODEXHUB_RUNTIME_SUPERVISOR_HOST`: defaults to `127.0.0.1`.
- `CODEXHUB_RUNTIME_SUPERVISOR_PORT`: defaults to `4319`.
- `CODEXHUB_DB_PATH`: must point at the same SQLite database used by the API
  server.

API server environment:

- `CODEXHUB_HOST`: defaults to `127.0.0.1`.
- `CODEXHUB_PORT`: defaults to `4317`.
- `CODEXHUB_RUNTIME_SUPERVISOR_URL`: unset by default. Set it to the external
  supervisor URL to opt in.
- `CODEXHUB_DB_PATH`: must point at the same SQLite database used by the
  supervisor.

When this mode is enabled, closing or hot-reloading the API server does not call
`shutdownAll()` on the supervisor-owned runtime. A replacement API server can
reconnect to the same supervisor URL, ask whether persisted transient sessions
are live, and continue only those sessions the supervisor proves are still
managed.

If the supervisor is missing or unreachable during a message send, the API uses
the existing structured `409 session_process_unavailable` fallback with a
follow-up endpoint. If a new session start cannot reach the supervisor, the API
returns a structured `503 runtime_supervisor_unavailable` error and records the
created session as failed.

## Guarantees And Limits

This mode guarantees only a local process-bound ownership split: API server
restarts no longer imply worker shutdown while the external supervisor process
keeps running and both processes use the same SQLite database.

It does not provide durable recovery if the supervisor process exits, the host
reboots, stdio ownership is lost, or the supervisor cannot prove a session is
live. It also does not add scheduling policy, queueing, auth, multi-host
dispatch, validation gates, escalation, Context Compiler behavior, or project
management.

## Not Implemented

Codexhub still does not implement a durable, multi-process reattach protocol for
supervisor restarts. Restart recovery remains a clear failure plus follow-up
path for any session the configured runtime cannot prove live.
