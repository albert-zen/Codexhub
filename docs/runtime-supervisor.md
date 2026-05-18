# Runtime Supervisor Boundary

Codexhub currently starts Codex `app-server` child processes inside the HTTP
server process. The server owns each worker's stdin, stdout, stderr, pending
JSON-RPC requests, and process handle.

## Current Restart Contract

On server startup, persisted sessions in `starting`, `running`, or
`awaiting_input` are reconciled to `failed` with a failure reason that says the
server restarted without a live Codex process. `process_pid` is cleared and
`ended_at` is set.

This is deliberate. A persisted `codex_thread_id`, `codex_turn_id`, or OS pid is
not enough to safely continue a session after the HTTP server has lost stdio
ownership. Codexhub does not claim those sessions are live or continuable.

If a message send reaches a non-terminal session record but the runtime has no
managed process for it, the API returns `409 session_process_unavailable`. The
error includes:

- `session_id`
- `follow_up_available: true`
- `follow_up_endpoint`

The failed send is recorded on the source session, the source session is marked
`failed`, and operators can start a fresh related worker through
`POST /api/v1/sessions/:id/follow-up`.

## Not Implemented

Codexhub does not yet run a durable supervisor outside the hot-reloading HTTP
server. A real supervisor would need to own worker process lifetimes and stdio
across API server restarts, expose an explicit attach/lease protocol to the HTTP
server, and prove that a resumed session is still connected to the original live
Codex runtime before accepting `steer` or `continue`.

Until that exists, restart recovery is a clear failure plus follow-up path, not
reattach durability.
