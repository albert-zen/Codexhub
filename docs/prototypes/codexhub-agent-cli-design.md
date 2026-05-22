# Codexhub Agent CLI Design Prototype

This design is for manager/worker agents that call Codexhub from scripts or
tool loops. Human-friendly command names can coexist, but the agent surface must
prefer stable JSON, bounded reads, idempotent writes, and clear project/thread
ownership.

## Current CLI Assessment

The existing CLI is usable for agents, but it is still session-first:

- `codexhub session start` requires project/workspace and usually a message.
- `codexhub session send` sends to a session, not a product thread.
- `codexhub session trace` and `watch` already provide useful bounded transcript
  windows.
- `codexhub sessions list/recent` can filter by project/workspace, but the
  command language does not match the new Project -> Thread model.
- `run-group` commands are top-level even though their product meaning is still
  unresolved.

## Agent CLI Principles

- Prefer thread language for durable work objects.
- Keep session commands as backward-compatible aliases during migration.
- JSON output must be stable, structured, and pagination-friendly.
- Writes should accept idempotency keys so retrying an agent tool call does not
  duplicate empty threads or messages.
- Reads should be bounded by default and never dump raw item logs unless
  explicitly requested.
- Runtime details are diagnostic fields, not the main control surface.
- Any command that sends work should be able to wait for useful milestones.

## Proposed Command Surface

```powershell
codexhub thread create --project <id> [--workspace <id>] [--json]
codexhub thread list --project <id> [--workspace <id>] [--limit 20] [--json]
codexhub thread inspect <thread-ref> [--json]
codexhub thread send <thread-ref> --message <text> [--wait turn-complete] [--timeout 10m] [--json]
codexhub thread trace <thread-ref> [--recent] [--limit 20] [--before <seq>] [--after <seq>] [--json]
codexhub thread latest <thread-ref> [--json]
codexhub thread context <thread-ref> [--limit 20] [--tools collapsed|expanded|hidden] [--json]
codexhub thread tool-calls <thread-ref> [--recent] [--limit 20] [--json]
codexhub thread stop-runtime <thread-ref> [--json]
```

Compatibility path:

- Existing `session` commands remain.
- `thread` commands initially call the same API backing store.
- `session_id` can remain present in JSON during migration, but new responses
  should also include `thread_id` or a `thread` object.

## Recommended Agent JSON Shapes

Thread creation:

```json
{
  "thread": {
    "id": "sess_123",
    "project_id": "proj_123",
    "workspace_id": "work_123",
    "thread_state": "empty",
    "conversation_state": "ready",
    "created_at": "2026-05-22T00:00:00.000Z",
    "updated_at": "2026-05-22T00:00:00.000Z"
  }
}
```

Thread send:

```json
{
  "thread": {
    "id": "sess_123",
    "thread_state": "active",
    "conversation_state": "streaming"
  },
  "message": {
    "id": "msg_123",
    "status": "sent"
  },
  "turn": {
    "id": "turn_123",
    "status": "running"
  }
}
```

Trace window:

```json
{
  "thread_id": "sess_123",
  "transcript": [],
  "limit": 20,
  "next_cursor": null
}
```

Context window:

```json
{
  "thread": {
    "id": "sess_123",
    "thread_state": "active",
    "conversation_state": "ready"
  },
  "latest_agent_message": "Done. Tests pass.",
  "allowed_actions": ["send", "stop_runtime", "archive"],
  "attention_reasons": [],
  "transcript": [],
  "limit": 20,
  "next_cursor": null
}
```

## Send Semantics

`thread send` is the primary continuation command. It should:

1. Persist the outgoing message.
2. Ensure runtime readiness internally.
3. Deliver the turn.
4. Return the message and current thread/turn state.
5. Optionally wait for a milestone:
   - `--wait accepted`: return after the message is accepted.
   - `--wait first-event`: return after the first Codex event arrives.
   - `--wait turn-complete`: return after the turn finishes or times out.

If runtime readiness fails, return a send failure with retry guidance. Do not ask
the caller to run a separate resume command.

## Context Window Commands

Agents need predictable context reads:

```powershell
codexhub thread trace <id> --recent --limit 10 --json
codexhub thread context <id> --limit 10 --tools collapsed --json
codexhub thread trace <id> --before 120 --limit 20 --json
codexhub thread latest <id> --json
```

These map to transcript read-model queries. The chosen window is not persisted
as thread state.

`thread context` is the preferred manager-agent read. It should combine the
small set of facts a manager normally needs: thread summary, latest agent
message, bounded transcript window, allowed actions, attention reasons, and
pagination cursors.

## Idempotency

For automation, add optional keys:

```powershell
codexhub thread create --project <id> --idempotency-key <key> --json
codexhub thread send <id> --message <text> --idempotency-key <key> --json
```

The server can safely return the original result when the same key is retried.

## Diagnostic Escape Hatches

Runtime/session diagnostics should be opt-in:

```powershell
codexhub thread inspect <id> --debug-runtime --json
codexhub session items <id> --type raw --recent --limit 20 --json
```

This keeps the agent's default path product-oriented while preserving access to
raw Codex details for debugging.

## Open Design Choices

Resolved first-pass decisions:

- `thread send --wait turn-complete` returns one final JSON object by default.
  Add `--stream-json` later only if agent consumers need event streaming.
- `thread create` requires enough input to make project/workspace ownership
  unambiguous. Add workspace inference later only after default workspace
  selection rules are explicit.
- `session` commands remain compatibility/debug commands during migration.
- Run groups are not part of the primary agent CLI path in this refactor.
